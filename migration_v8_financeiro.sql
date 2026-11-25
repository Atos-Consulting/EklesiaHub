-- Migration v8 — EklesiaHub ERP: condições de pagamento, Financeiro (contas a pagar) e mais tributos na nota
--
-- Pré-requisito: migration_v7_niveis_usuarios.sql.  Rode UMA vez, no SQL Editor.
--
-- O que muda:
--  1. TRIBUTOS: novas bases e alíquotas na nota e nos itens (IPI, PIS, COFINS, ISS e ICMS ST).
--  2. CONDIÇÕES DE PAGAMENTO (cadastro novo, em Parâmetros → Financeiro): tipo (à vista ou parcelado),
--     quantidade de parcelas, prazo da 1ª parcela e intervalo entre parcelas.
--  3. A nota de entrada passa a ter a condição de pagamento (obrigatória para aprovar).
--  4. FINANCEIRO — contas a pagar: aprovar a nota gera os títulos (parcelas) do fornecedor, no valor
--     LÍQUIDO (total − retenções). À vista: o título já nasce pago pela conta caixa da nota.
--     Parcelado: os títulos ficam em aberto até o pagamento (baixa) no módulo Financeiro.
--  5. O SALDO DA CONTA CAIXA passa a descontar os PAGAMENTOS (e não mais as notas aprovadas).
--     As notas já aprovadas viram títulos pagos (origem "migração"), então o saldo de hoje não muda.
--  6. Cancelar a nota cancela os títulos em aberto e estorna os pagamentos automáticos. Se alguma parcela
--     já foi paga no Financeiro, o cancelamento é recusado até o pagamento ser estornado.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Tributos: chaves novas (as antigas continuam valendo)
--    Nova chave de tributo? Acrescente aqui e em src/erp/tributos.js.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fiscal_valido(f jsonb, nivel text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  k text; v jsonb;
  nums text[]; strs text[]; bools text[];
BEGIN
  IF f IS NULL OR jsonb_typeof(f) <> 'object' THEN RETURN false; END IF;
  IF nivel = 'item' THEN
    nums  := ARRAY['icms_base', 'icms_aliquota', 'icms', 'icms_st_base', 'icms_st', 'ipi_base', 'ipi_aliquota', 'ipi',
                   'pis_aliquota', 'pis', 'cofins_aliquota', 'cofins', 'iss_aliquota', 'iss', 'inss', 'irrf', 'csll'];
    strs  := ARRAY['ncm', 'cfop', 'unidade', 'cst'];
    bools := ARRAY[]::text[];
  ELSE
    nums  := ARRAY['icms_base', 'icms', 'icms_st_base', 'icms_st', 'ipi_base', 'ipi', 'pis_base', 'pis', 'cofins_base',
                   'cofins', 'iss_base', 'iss_aliquota', 'iss', 'inss', 'irrf', 'csll', 'outras_retencoes', 'total_tributos'];
    strs  := ARRAY['protocolo'];
    bools := ARRAY['iss_retido'];
  END IF;
  FOR k, v IN SELECT * FROM jsonb_each(f) LOOP
    IF k = ANY (nums) THEN
      IF jsonb_typeof(v) <> 'number' OR (v #>> '{}')::numeric < 0 OR (v #>> '{}')::numeric >= 1e13 THEN RETURN false; END IF;
    ELSIF k = ANY (strs) THEN
      IF jsonb_typeof(v) <> 'string' OR length(v #>> '{}') > 60 THEN RETURN false; END IF;
    ELSIF k = ANY (bools) THEN
      IF jsonb_typeof(v) <> 'boolean' THEN RETURN false; END IF;
    ELSE
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

-- Retenções da nota (ficam com a igreja para recolher ao governo; não são pagas ao fornecedor).
CREATE FUNCTION nota_retencoes(f jsonb) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce((f->>'inss')::numeric, 0) + coalesce((f->>'irrf')::numeric, 0) + coalesce((f->>'csll')::numeric, 0)
       + coalesce((f->>'outras_retencoes')::numeric, 0)
       + CASE WHEN coalesce((f->>'iss_retido')::boolean, false) THEN coalesce((f->>'iss')::numeric, 0) ELSE 0 END
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Condições de pagamento
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE condicoes_pagamento (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id      bigint NOT NULL DEFAULT minha_empresa_id() REFERENCES empresas(id),
  nome            text NOT NULL CHECK (length(btrim(nome)) > 0),
  tipo            text NOT NULL CHECK (tipo IN ('a_vista', 'parcelado')),
  forma_pagamento text CHECK (forma_pagamento IN ('dinheiro', 'pix', 'boleto', 'transferencia', 'cartao_credito',
                                                  'cartao_debito', 'cheque', 'outro')),
  parcelas        integer NOT NULL DEFAULT 1 CHECK (parcelas BETWEEN 1 AND 120),
  dias_primeira   integer NOT NULL DEFAULT 0 CHECK (dias_primeira BETWEEN 0 AND 3650),
  intervalo_dias  integer NOT NULL DEFAULT 30 CHECK (intervalo_dias BETWEEN 1 AND 365),
  ativo           boolean NOT NULL DEFAULT true,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT condicoes_pagamento_empresa_nome_uq UNIQUE (empresa_id, nome),
  CONSTRAINT condicoes_pagamento_id_empresa_uq UNIQUE (id, empresa_id),
  -- à vista = uma parcela, paga no ato
  CONSTRAINT condicoes_pagamento_a_vista_ck CHECK (tipo = 'parcelado' OR (parcelas = 1 AND dias_primeira = 0))
);
CREATE TRIGGER condicoes_pagamento_atualizado BEFORE UPDATE ON condicoes_pagamento
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

ALTER TABLE documentos_entrada ADD COLUMN condicao_pagamento_id bigint;
ALTER TABLE documentos_entrada ADD CONSTRAINT documentos_entrada_condicao_fk
  FOREIGN KEY (condicao_pagamento_id, empresa_id) REFERENCES condicoes_pagamento (id, empresa_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3. Financeiro: títulos (contas a pagar) e pagamentos (baixas)
--    Ninguém grava direto nessas tabelas: só as funções abaixo (SECURITY DEFINER) e o gatilho da nota.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE titulos_financeiros (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id          bigint NOT NULL REFERENCES empresas(id),
  natureza            text NOT NULL DEFAULT 'pagar' CHECK (natureza IN ('pagar')), -- 'receber' virá com dízimos/vendas
  documento_id        bigint,
  pessoa_id           bigint NOT NULL,
  descricao           text NOT NULL,
  parcela             integer NOT NULL,
  total_parcelas      integer NOT NULL,
  emissao             date NOT NULL,
  vencimento          date NOT NULL,
  valor               numeric(15,2) NOT NULL CHECK (valor > 0),
  forma_pagamento     text,
  conta_caixa_id      bigint,  -- conta prevista para o pagamento (sugestão na baixa)
  centro_custo_id     bigint,
  status              text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'pago', 'cancelado')),
  cancelado_em        timestamptz,
  motivo_cancelamento text,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  CHECK (parcela BETWEEN 1 AND total_parcelas),
  CONSTRAINT titulos_financeiros_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT titulos_financeiros_parcela_uq UNIQUE (documento_id, parcela),
  CONSTRAINT titulos_financeiros_documento_fk FOREIGN KEY (documento_id, empresa_id) REFERENCES documentos_entrada (id, empresa_id),
  CONSTRAINT titulos_financeiros_pessoa_fk FOREIGN KEY (pessoa_id, empresa_id) REFERENCES pessoas (id, empresa_id),
  CONSTRAINT titulos_financeiros_caixa_fk FOREIGN KEY (conta_caixa_id, empresa_id) REFERENCES contas_caixa (id, empresa_id),
  CONSTRAINT titulos_financeiros_centro_fk FOREIGN KEY (centro_custo_id, empresa_id) REFERENCES centros_custo (id, empresa_id)
);
CREATE INDEX titulos_financeiros_venc_idx ON titulos_financeiros (empresa_id, status, vencimento);
CREATE TRIGGER titulos_financeiros_atualizado BEFORE UPDATE ON titulos_financeiros
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

CREATE TABLE pagamentos (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id      bigint NOT NULL REFERENCES empresas(id),
  titulo_id       bigint NOT NULL,
  conta_caixa_id  bigint,
  data_pagamento  date NOT NULL,
  valor_principal numeric(15,2) NOT NULL CHECK (valor_principal > 0),
  juros           numeric(15,2) NOT NULL DEFAULT 0 CHECK (juros >= 0),
  multa           numeric(15,2) NOT NULL DEFAULT 0 CHECK (multa >= 0),
  desconto        numeric(15,2) NOT NULL DEFAULT 0 CHECK (desconto >= 0),
  valor_pago      numeric(15,2) GENERATED ALWAYS AS (valor_principal + juros + multa - desconto) STORED,
  -- manual = baixa no Financeiro; aprovacao = à vista, pago ao aprovar a nota; migracao = notas aprovadas antes da v8
  origem          text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'aprovacao', 'migracao')),
  observacao      text,
  pago_por        uuid,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  estornado       boolean NOT NULL DEFAULT false,
  estornado_por   uuid,
  estornado_em    timestamptz,
  motivo_estorno  text,
  CHECK (valor_principal + juros + multa - desconto > 0),
  CHECK (conta_caixa_id IS NOT NULL OR origem = 'migracao'),
  CONSTRAINT pagamentos_titulo_fk FOREIGN KEY (titulo_id, empresa_id) REFERENCES titulos_financeiros (id, empresa_id),
  CONSTRAINT pagamentos_caixa_fk FOREIGN KEY (conta_caixa_id, empresa_id) REFERENCES contas_caixa (id, empresa_id)
);
-- Um título tem no máximo um pagamento válido (baixa total).
CREATE UNIQUE INDEX pagamentos_ativo_uq ON pagamentos (titulo_id) WHERE NOT estornado;
CREATE INDEX pagamentos_caixa_idx ON pagamentos (conta_caixa_id, data_pagamento) WHERE NOT estornado;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Aprovar a nota gera os títulos; cancelar a nota cancela os títulos
-- ─────────────────────────────────────────────────────────────────────

CREATE FUNCTION gerar_titulos_nota(p_doc bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d documentos_entrada%ROWTYPE;
  c condicoes_pagamento%ROWTYPE;
  v_ret numeric;
  v_liq numeric(15,2);
  v_cent bigint; v_base bigint; v_resto bigint;
  v_valor numeric(15,2);
  v_venc date;
  v_desc text;
  v_tit bigint;
BEGIN
  SELECT * INTO d FROM documentos_entrada WHERE id = p_doc;
  IF d.condicao_pagamento_id IS NULL THEN
    RAISE EXCEPTION 'Informe a condição de pagamento para aprovar a nota.';
  END IF;
  SELECT * INTO c FROM condicoes_pagamento WHERE id = d.condicao_pagamento_id;
  IF NOT c.ativo THEN
    RAISE EXCEPTION 'A condição de pagamento "%" está inativa. Escolha outra.', c.nome;
  END IF;
  IF EXISTS (SELECT 1 FROM titulos_financeiros WHERE documento_id = p_doc) THEN
    RAISE EXCEPTION 'Esta nota já gerou títulos no Financeiro.';
  END IF;

  v_ret := nota_retencoes(d.fiscal);
  v_liq := d.valor_total - v_ret;
  IF v_liq <= 0 THEN
    RAISE EXCEPTION 'As retenções (%) não podem ser iguais ou maiores que o total da nota (%).', v_ret, d.valor_total;
  END IF;

  -- Divide em centavos; a sobra da divisão vai para a 1ª parcela.
  v_cent  := round(v_liq * 100)::bigint;
  v_base  := v_cent / c.parcelas;
  v_resto := v_cent - v_base * c.parcelas;
  IF v_base = 0 THEN
    RAISE EXCEPTION 'O valor a pagar (%) é pequeno demais para dividir em % parcelas.', v_liq, c.parcelas;
  END IF;
  v_desc  := CASE d.tipo WHEN 'nfe' THEN 'NF-e' WHEN 'nfse' THEN 'NFS-e' WHEN 'recibo' THEN 'Recibo'
                         WHEN 'fatura' THEN 'Fatura' ELSE 'Documento' END
             || ' ' || d.numero || CASE WHEN coalesce(d.serie, '') <> '' THEN '/' || d.serie ELSE '' END;

  FOR i IN 1..c.parcelas LOOP
    v_valor := (v_base + CASE WHEN i = 1 THEN v_resto ELSE 0 END) / 100.0;
    v_venc  := CASE WHEN c.tipo = 'a_vista' THEN d.data_entrada
                    ELSE d.data_emissao + c.dias_primeira + (i - 1) * c.intervalo_dias END;
    INSERT INTO titulos_financeiros (empresa_id, documento_id, pessoa_id, descricao, parcela, total_parcelas, emissao,
                                     vencimento, valor, forma_pagamento, conta_caixa_id, centro_custo_id)
    VALUES (d.empresa_id, d.id, d.fornecedor_id, v_desc, i, c.parcelas, d.data_emissao, v_venc, v_valor,
            c.forma_pagamento, d.conta_caixa_id, d.centro_custo_id)
    RETURNING id INTO v_tit;

    IF c.tipo = 'a_vista' THEN
      INSERT INTO pagamentos (empresa_id, titulo_id, conta_caixa_id, data_pagamento, valor_principal, origem, pago_por)
      VALUES (d.empresa_id, v_tit, d.conta_caixa_id, d.data_entrada, v_valor, 'aprovacao', auth.uid());
      UPDATE titulos_financeiros SET status = 'pago' WHERE id = v_tit;
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION documentos_entrada_financeiro() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'rascunho' AND NEW.status = 'aprovada' THEN
    PERFORM gerar_titulos_nota(NEW.id);
  ELSIF NEW.status = 'cancelada' AND OLD.status <> 'cancelada' THEN
    IF EXISTS (SELECT 1 FROM pagamentos p JOIN titulos_financeiros t ON t.id = p.titulo_id
                WHERE t.documento_id = NEW.id AND NOT p.estornado AND p.origem = 'manual') THEN
      RAISE EXCEPTION 'Esta nota tem parcelas já pagas no Financeiro. Estorne esses pagamentos antes de cancelar a nota.';
    END IF;
    UPDATE pagamentos SET estornado = true, estornado_por = auth.uid(), estornado_em = now(),
                          motivo_estorno = 'Cancelamento da nota: ' || coalesce(NEW.motivo_cancelamento, '')
     WHERE NOT estornado AND titulo_id IN (SELECT id FROM titulos_financeiros WHERE documento_id = NEW.id);
    UPDATE titulos_financeiros SET status = 'cancelado', cancelado_em = now(),
                                   motivo_cancelamento = 'Cancelamento da nota: ' || coalesce(NEW.motivo_cancelamento, '')
     WHERE documento_id = NEW.id AND status <> 'cancelado';
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER documentos_entrada_financeiro_trg AFTER UPDATE OF status ON documentos_entrada
  FOR EACH ROW EXECUTE FUNCTION documentos_entrada_financeiro();

-- ─────────────────────────────────────────────────────────────────────
-- 5. Ações do Financeiro (Supervisor e Administrador)
-- ─────────────────────────────────────────────────────────────────────

-- Baixa (pagamento total) de um título em aberto.
CREATE FUNCTION pagar_titulo(p_titulo bigint, p_conta_caixa bigint, p_data date, p_juros numeric, p_multa numeric,
                             p_desconto numeric, p_observacao text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t titulos_financeiros%ROWTYPE;
  cx contas_caixa%ROWTYPE;
  v_juros numeric := coalesce(p_juros, 0);
  v_multa numeric := coalesce(p_multa, 0);
  v_desc  numeric := coalesce(p_desconto, 0);
  v_id bigint;
BEGIN
  IF NOT tem_nivel('administrador', 'supervisor') THEN
    RAISE EXCEPTION 'Somente Supervisor ou Administrador pode registrar pagamentos.';
  END IF;
  SELECT * INTO t FROM titulos_financeiros WHERE id = p_titulo AND empresa_id = minha_empresa_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Título não encontrado.'; END IF;
  IF t.status <> 'aberto' THEN
    RAISE EXCEPTION 'Este título não está em aberto (situação: %).', t.status;
  END IF;
  SELECT * INTO cx FROM contas_caixa WHERE id = p_conta_caixa AND empresa_id = t.empresa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Informe a conta caixa de onde sai o pagamento.'; END IF;
  IF NOT cx.ativo THEN RAISE EXCEPTION 'A conta caixa "%" está inativa.', cx.nome; END IF;
  IF p_data IS NULL THEN RAISE EXCEPTION 'Informe a data do pagamento.'; END IF;
  IF p_data > current_date + 1 THEN RAISE EXCEPTION 'A data do pagamento não pode ser futura.'; END IF;
  IF v_juros < 0 OR v_multa < 0 OR v_desc < 0 THEN RAISE EXCEPTION 'Juros, multa e desconto não podem ser negativos.'; END IF;
  IF t.valor + v_juros + v_multa - v_desc <= 0 THEN
    RAISE EXCEPTION 'O desconto não pode ser igual ou maior que o valor a pagar.';
  END IF;

  INSERT INTO pagamentos (empresa_id, titulo_id, conta_caixa_id, data_pagamento, valor_principal, juros, multa, desconto,
                          origem, observacao, pago_por)
  VALUES (t.empresa_id, t.id, cx.id, p_data, t.valor, round(v_juros, 2), round(v_multa, 2), round(v_desc, 2),
          'manual', nullif(btrim(coalesce(p_observacao, '')), ''), auth.uid())
  RETURNING id INTO v_id;
  UPDATE titulos_financeiros SET status = 'pago' WHERE id = t.id;
  RETURN v_id;
END;
$$;

-- Estorna um pagamento: o título volta a ficar em aberto e o valor volta para a conta caixa.
CREATE FUNCTION estornar_pagamento(p_pagamento bigint, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p pagamentos%ROWTYPE;
BEGIN
  IF NOT tem_nivel('administrador', 'supervisor') THEN
    RAISE EXCEPTION 'Somente Supervisor ou Administrador pode estornar pagamentos.';
  END IF;
  IF length(btrim(coalesce(p_motivo, ''))) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo do estorno (mínimo de 5 caracteres).';
  END IF;
  SELECT * INTO p FROM pagamentos WHERE id = p_pagamento AND empresa_id = minha_empresa_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pagamento não encontrado.'; END IF;
  IF p.estornado THEN RAISE EXCEPTION 'Este pagamento já foi estornado.'; END IF;

  UPDATE pagamentos SET estornado = true, estornado_por = auth.uid(), estornado_em = now(), motivo_estorno = btrim(p_motivo)
   WHERE id = p.id;
  UPDATE titulos_financeiros SET status = 'aberto' WHERE id = p.titulo_id AND status = 'pago';
END;
$$;

-- Ajusta o vencimento de um título em aberto (ex.: boleto chegou com outra data).
CREATE FUNCTION alterar_vencimento(p_titulo bigint, p_vencimento date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT tem_nivel('administrador', 'supervisor') THEN
    RAISE EXCEPTION 'Somente Supervisor ou Administrador pode alterar vencimentos.';
  END IF;
  IF p_vencimento IS NULL THEN RAISE EXCEPTION 'Informe o novo vencimento.'; END IF;
  UPDATE titulos_financeiros SET vencimento = p_vencimento
   WHERE id = p_titulo AND empresa_id = minha_empresa_id() AND status = 'aberto';
  IF NOT FOUND THEN RAISE EXCEPTION 'Só é possível alterar o vencimento de títulos em aberto.'; END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 6. Salvar nota: passa a gravar a condição de pagamento (resto igual à v6)
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION salvar_nota_entrada(p_id bigint, p_doc jsonb, p_itens jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_id bigint := p_id;
  v_itens jsonb := coalesce(p_itens, '[]'::jsonb);
  v_fiscal jsonb := coalesce(p_doc->'fiscal', '{}'::jsonb);
  v_soma numeric;
  v_total numeric(15,2);
  v_frete numeric := coalesce(nullif(p_doc->>'valor_frete', '')::numeric, 0);
  v_seguro numeric := coalesce(nullif(p_doc->>'valor_seguro', '')::numeric, 0);
  v_outras numeric := coalesce(nullif(p_doc->>'valor_outras', '')::numeric, 0);
  v_desconto numeric := coalesce(nullif(p_doc->>'valor_desconto', '')::numeric, 0);
BEGIN
  IF jsonb_array_length(v_itens) = 0 THEN
    RAISE EXCEPTION 'Inclua ao menos um item na nota.';
  END IF;
  IF NOT fiscal_valido(v_fiscal, 'nota')
     OR EXISTS (SELECT 1 FROM jsonb_to_recordset(v_itens) AS i(fiscal jsonb)
                 WHERE i.fiscal IS NOT NULL AND NOT fiscal_valido(i.fiscal, 'item')) THEN
    RAISE EXCEPTION 'Os tributos informados são inválidos: use apenas os campos previstos, com valores numéricos não negativos.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_itens) AS i(tipo_contabil_id bigint) WHERE i.tipo_contabil_id IS NULL) THEN
    RAISE EXCEPTION 'Selecione o tipo contábil de todos os itens.';
  END IF;

  SELECT coalesce(sum(i.valor_total), 0) INTO v_soma FROM jsonb_to_recordset(v_itens) AS i(valor_total numeric);
  v_total := round(v_soma + v_frete + v_seguro + v_outras - v_desconto
                   + coalesce((v_fiscal->>'ipi')::numeric, 0) + coalesce((v_fiscal->>'icms_st')::numeric, 0), 2);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'O total da nota precisa ser maior que zero.';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO documentos_entrada (tipo, numero, serie, chave_acesso, fornecedor_id, data_emissao, data_entrada,
                                    valor_total, centro_custo_id, conta_caixa_id, condicao_pagamento_id, natureza_operacao,
                                    observacoes, valor_frete, valor_seguro, valor_outras, valor_desconto, fiscal)
    VALUES (p_doc->>'tipo', p_doc->>'numero', coalesce(p_doc->>'serie', ''), nullif(p_doc->>'chave_acesso', ''),
            (p_doc->>'fornecedor_id')::bigint, (p_doc->>'data_emissao')::date,
            coalesce((p_doc->>'data_entrada')::date, current_date), v_total,
            nullif(p_doc->>'centro_custo_id', '')::bigint, nullif(p_doc->>'conta_caixa_id', '')::bigint,
            nullif(p_doc->>'condicao_pagamento_id', '')::bigint,
            nullif(p_doc->>'natureza_operacao', ''), nullif(p_doc->>'observacoes', ''),
            v_frete, v_seguro, v_outras, v_desconto, v_fiscal)
    RETURNING id INTO v_id;
  ELSE
    UPDATE documentos_entrada SET
      tipo = p_doc->>'tipo',
      numero = p_doc->>'numero',
      serie = coalesce(p_doc->>'serie', ''),
      chave_acesso = nullif(p_doc->>'chave_acesso', ''),
      fornecedor_id = (p_doc->>'fornecedor_id')::bigint,
      data_emissao = (p_doc->>'data_emissao')::date,
      data_entrada = coalesce((p_doc->>'data_entrada')::date, data_entrada),
      valor_total = v_total,
      centro_custo_id = nullif(p_doc->>'centro_custo_id', '')::bigint,
      conta_caixa_id = nullif(p_doc->>'conta_caixa_id', '')::bigint,
      condicao_pagamento_id = nullif(p_doc->>'condicao_pagamento_id', '')::bigint,
      natureza_operacao = nullif(p_doc->>'natureza_operacao', ''),
      observacoes = nullif(p_doc->>'observacoes', ''),
      valor_frete = v_frete, valor_seguro = v_seguro, valor_outras = v_outras, valor_desconto = v_desconto,
      fiscal = v_fiscal
    WHERE id = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Nota % não encontrada ou sem permissão.', v_id;
    END IF;
    DELETE FROM documento_entrada_itens WHERE documento_id = v_id;
  END IF;

  INSERT INTO documento_entrada_itens (documento_id, descricao, quantidade, valor_unitario, valor_total,
                                       tipo_contabil_id, centro_custo_id, fiscal)
  SELECT v_id, i.descricao, i.quantidade, i.valor_unitario, i.valor_total, i.tipo_contabil_id, i.centro_custo_id,
         coalesce(i.fiscal, '{}'::jsonb)
    FROM jsonb_to_recordset(v_itens) AS i(
      descricao text, quantidade numeric, valor_unitario numeric, valor_total numeric,
      tipo_contabil_id bigint, centro_custo_id bigint, fiscal jsonb);

  RETURN v_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 7. Dados padrão: condições de pagamento (empresas novas e as que já existem)
-- ─────────────────────────────────────────────────────────────────────

CREATE FUNCTION semear_financeiro(p_empresa bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO condicoes_pagamento (empresa_id, nome, tipo, forma_pagamento, parcelas, dias_primeira, intervalo_dias)
  VALUES (p_empresa, 'À vista', 'a_vista', 'dinheiro', 1, 0, 30),
         (p_empresa, '30 dias', 'parcelado', 'boleto', 1, 30, 30),
         (p_empresa, '30/60/90 dias', 'parcelado', 'boleto', 3, 30, 30)
  ON CONFLICT (empresa_id, nome) DO NOTHING;
END;
$$;

-- Mesma função da v6, agora também semeando o Financeiro (é chamada por semear_empresa ao criar empresa).
CREATE OR REPLACE FUNCTION semear_parametros_contabeis(p_empresa bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO contas_caixa (empresa_id, nome, conta_contabil_id)
  SELECT p_empresa, 'Caixa geral', (SELECT id FROM plano_contas WHERE empresa_id = p_empresa AND codigo = '1.1.01')
  ON CONFLICT (empresa_id, nome) DO NOTHING;

  INSERT INTO tipos_contabeis (empresa_id, nome, descricao, conta_debito_id, conta_credito_id)
  SELECT p_empresa, v.nome, v.descricao, d.id, c.id
    FROM (VALUES
      ('Água, luz e telefone',                '5.1.01', 'Contas de consumo da igreja'),
      ('Material de escritório e limpeza',    '5.1.02', 'Papelaria, produtos de limpeza e copa'),
      ('Serviços de terceiros',               '5.1.03', 'Prestadores de serviço, honorários, assessorias'),
      ('Manutenção e reparos',                '5.1.04', 'Conserto e conservação do templo e equipamentos'),
      ('Prebendas e salários',                '5.2.01', 'Remuneração de pastores e funcionários'),
      ('Eventos e ministérios',               '5.3.01', 'Despesas de eventos, cultos especiais e ministérios'),
      ('Missões e ação social',               '5.3.02', 'Missões, doações e assistência social'),
      ('Compra de mercadorias para revenda',  '1.1.03', 'Livros e produtos da livraria e do bazar (vão para o estoque)'),
      ('Aquisição de bens (imobilizado)',     '1.2.01', 'Equipamentos, móveis e instrumentos de uso duradouro')
    ) AS v(nome, debito, descricao)
    JOIN plano_contas d ON d.empresa_id = p_empresa AND d.codigo = v.debito
    JOIN plano_contas c ON c.empresa_id = p_empresa AND c.codigo = '1.1.01'
  ON CONFLICT (empresa_id, nome) DO NOTHING;

  PERFORM semear_financeiro(p_empresa);
END;
$$;

SELECT semear_financeiro(id) FROM empresas;

-- ─────────────────────────────────────────────────────────────────────
-- 8. Notas já aprovadas viram títulos pagos (o saldo das contas caixa continua o mesmo)
-- ─────────────────────────────────────────────────────────────────────

WITH novos AS (
  INSERT INTO titulos_financeiros (empresa_id, documento_id, pessoa_id, descricao, parcela, total_parcelas, emissao,
                                   vencimento, valor, conta_caixa_id, centro_custo_id, status)
  SELECT d.empresa_id, d.id, d.fornecedor_id,
         CASE d.tipo WHEN 'nfe' THEN 'NF-e' WHEN 'nfse' THEN 'NFS-e' WHEN 'recibo' THEN 'Recibo'
                     WHEN 'fatura' THEN 'Fatura' ELSE 'Documento' END
           || ' ' || d.numero || CASE WHEN coalesce(d.serie, '') <> '' THEN '/' || d.serie ELSE '' END,
         1, 1, d.data_emissao, d.data_entrada, d.valor_total, d.conta_caixa_id, d.centro_custo_id, 'pago'
    FROM documentos_entrada d
   WHERE d.status IN ('aprovada', 'lancada') AND d.valor_total > 0
     AND NOT EXISTS (SELECT 1 FROM titulos_financeiros t WHERE t.documento_id = d.id)
  RETURNING id, empresa_id, documento_id, valor, conta_caixa_id
)
INSERT INTO pagamentos (empresa_id, titulo_id, conta_caixa_id, data_pagamento, valor_principal, origem, observacao)
SELECT n.empresa_id, n.id, n.conta_caixa_id, d.data_entrada, n.valor, 'migracao',
       'Nota aprovada antes do módulo Financeiro'
  FROM novos n JOIN documentos_entrada d ON d.id = n.documento_id;

-- ─────────────────────────────────────────────────────────────────────
-- 9. Saldo da conta caixa = saldo inicial − pagamentos (não estornados) a partir da data do saldo inicial
-- ─────────────────────────────────────────────────────────────────────

DROP VIEW contas_caixa_saldo;
CREATE VIEW contas_caixa_saldo WITH (security_invoker = true) AS
SELECT c.id, c.empresa_id, c.nome, c.banco, c.agencia, c.numero_conta, c.saldo_inicial, c.data_saldo_inicial,
       c.conta_contabil_id, c.ativo,
       coalesce(s.saidas, 0)::numeric(15,2)                    AS total_saidas,
       (c.saldo_inicial - coalesce(s.saidas, 0))::numeric(15,2) AS saldo_atual,
       coalesce(s.qtd, 0)::int                                  AS qtd_pagamentos
  FROM contas_caixa c
  LEFT JOIN LATERAL (
    SELECT sum(p.valor_pago) AS saidas, count(*) AS qtd
      FROM pagamentos p
     WHERE p.conta_caixa_id = c.id AND NOT p.estornado AND p.data_pagamento >= c.data_saldo_inicial
  ) s ON true;

-- Listas para as telas do Financeiro (respeitam a RLS de cada tabela).
CREATE VIEW titulos_pagar WITH (security_invoker = true) AS
SELECT t.id, t.empresa_id, t.documento_id, t.pessoa_id, t.descricao, t.parcela, t.total_parcelas, t.emissao,
       t.vencimento, t.valor, t.forma_pagamento, t.conta_caixa_id, t.centro_custo_id, t.status, t.cancelado_em,
       t.motivo_cancelamento, t.criado_em,
       pe.nome AS fornecedor_nome, pe.documento AS fornecedor_documento, pe.tipo_pessoa AS fornecedor_tipo,
       d.tipo AS documento_tipo, d.numero AS documento_numero, d.serie AS documento_serie,
       pg.id AS pagamento_id, pg.data_pagamento, pg.valor_pago, pg.juros, pg.multa, pg.desconto,
       pg.conta_caixa_id AS pagamento_conta_caixa_id, pg.origem AS pagamento_origem
  FROM titulos_financeiros t
  JOIN pessoas pe ON pe.id = t.pessoa_id
  LEFT JOIN documentos_entrada d ON d.id = t.documento_id
  LEFT JOIN pagamentos pg ON pg.titulo_id = t.id AND NOT pg.estornado
 WHERE t.natureza = 'pagar';

CREATE VIEW pagamentos_lista WITH (security_invoker = true) AS
SELECT p.id, p.empresa_id, p.titulo_id, p.conta_caixa_id, p.data_pagamento, p.valor_principal, p.juros, p.multa,
       p.desconto, p.valor_pago, p.origem, p.observacao, p.criado_em, p.estornado, p.estornado_em, p.motivo_estorno,
       t.descricao, t.parcela, t.total_parcelas, t.vencimento, t.documento_id, pe.nome AS fornecedor_nome,
       cx.nome AS conta_caixa_nome
  FROM pagamentos p
  JOIN titulos_financeiros t ON t.id = p.titulo_id
  JOIN pessoas pe ON pe.id = t.pessoa_id
  LEFT JOIN contas_caixa cx ON cx.id = p.conta_caixa_id;

-- ─────────────────────────────────────────────────────────────────────
-- 10. RLS e permissões
-- ─────────────────────────────────────────────────────────────────────

REVOKE ALL ON condicoes_pagamento, titulos_financeiros, pagamentos, contas_caixa_saldo, titulos_pagar, pagamentos_lista FROM anon;
-- Títulos e pagamentos: só leitura pelo navegador; gravação apenas pelas funções.
REVOKE INSERT, UPDATE, DELETE ON titulos_financeiros, pagamentos FROM authenticated;
GRANT SELECT ON titulos_financeiros, pagamentos, contas_caixa_saldo, titulos_pagar, pagamentos_lista TO authenticated;

ALTER TABLE condicoes_pagamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE titulos_financeiros ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagamentos          ENABLE ROW LEVEL SECURITY;

CREATE POLICY condicoes_pagamento_select ON condicoes_pagamento FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY condicoes_pagamento_write ON condicoes_pagamento FOR ALL TO authenticated
  USING (empresa_id = minha_empresa_id() AND tem_nivel('administrador'))
  WITH CHECK (empresa_id = minha_empresa_id() AND tem_nivel('administrador'));
CREATE POLICY titulos_financeiros_select ON titulos_financeiros FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY pagamentos_select ON pagamentos FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());

REVOKE EXECUTE ON FUNCTION gerar_titulos_nota(bigint), documentos_entrada_financeiro(), semear_financeiro(bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION pagar_titulo(bigint, bigint, date, numeric, numeric, numeric, text),
  estornar_pagamento(bigint, text), alterar_vencimento(bigint, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pagar_titulo(bigint, bigint, date, numeric, numeric, numeric, text),
  estornar_pagamento(bigint, text), alterar_vencimento(bigint, date) TO authenticated;
