-- ═════════════════════════════════════════════════════════════════════
-- EklesiaHub — migration v18: cadastro de formas de pagamento
-- ═════════════════════════════════════════════════════════════════════
-- As formas de pagamento deixam de ser uma lista fixa e viram cadastro da igreja (Parâmetros →
-- Financeiro → Formas de pagamento, Administrador). Cada forma tem um nome livre (ex.: "Cartão Sicredi")
-- e um comportamento, que é um dos 8 tipos de antes e decide o que a tela pede (boleto → linha
-- digitável; PIX → chave; transferência → banco/agência/conta).
--  • condicoes_pagamento, titulos_financeiros e entradas ganham forma_pagamento_id. A coluna antiga
--    forma_pagamento continua, preenchida pelo gatilho forma_pagamento_sync() com o comportamento da
--    forma, para as regras e telas que já dependem dela (ex.: entrada não aceita boleto).
--  • Cada igreja recebe as 8 formas de antes; as linhas que já existem passam a apontar para elas.
--  • As RPCs aceitam forma_pagamento_id (e ainda aceitam o código antigo).
-- Rodar depois da v17.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Cadastro
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE formas_pagamento (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id    bigint NOT NULL DEFAULT minha_empresa_id() REFERENCES empresas(id),
  nome          text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 60),
  tipo          text NOT NULL CHECK (tipo IN ('dinheiro', 'pix', 'boleto', 'transferencia', 'cartao_credito', 'cartao_debito', 'cheque', 'outro')),
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT formas_pagamento_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT formas_pagamento_empresa_nome_uq UNIQUE (empresa_id, nome)
);
CREATE TRIGGER formas_pagamento_atualizado BEFORE UPDATE ON formas_pagamento
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
CREATE TRIGGER formas_pagamento_log_trg AFTER INSERT OR UPDATE OR DELETE ON formas_pagamento
  FOR EACH ROW EXECUTE FUNCTION registrar_log();

ALTER TABLE formas_pagamento ENABLE ROW LEVEL SECURITY;
CREATE POLICY formas_pagamento_select ON formas_pagamento FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY formas_pagamento_write ON formas_pagamento FOR ALL TO authenticated
  USING (empresa_id = minha_empresa_id() AND tem_nivel('administrador'))
  WITH CHECK (empresa_id = minha_empresa_id() AND tem_nivel('administrador'));
REVOKE ALL ON formas_pagamento FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON formas_pagamento TO authenticated;

-- O comportamento de uma forma já usada não muda (os lançamentos guardam o comportamento de quando foram feitos).
CREATE FUNCTION formas_pagamento_regras() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.tipo IS DISTINCT FROM OLD.tipo AND (
       EXISTS (SELECT 1 FROM condicoes_pagamento WHERE forma_pagamento_id = OLD.id)
    OR EXISTS (SELECT 1 FROM titulos_financeiros WHERE forma_pagamento_id = OLD.id)
    OR EXISTS (SELECT 1 FROM entradas WHERE forma_pagamento_id = OLD.id)) THEN
    RAISE EXCEPTION 'A forma "%" já foi usada, então o comportamento não pode mudar. Cadastre uma forma nova.', OLD.nome;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER formas_pagamento_regras_trg BEFORE UPDATE ON formas_pagamento
  FOR EACH ROW EXECUTE FUNCTION formas_pagamento_regras();

-- Formas padrão (as 8 de antes). Chamada por semear_financeiro, ao criar igreja.
CREATE FUNCTION semear_formas_pagamento(p_empresa bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO formas_pagamento (empresa_id, nome, tipo)
  VALUES (p_empresa, 'Dinheiro', 'dinheiro'), (p_empresa, 'PIX', 'pix'), (p_empresa, 'Boleto', 'boleto'),
         (p_empresa, 'Transferência', 'transferencia'), (p_empresa, 'Cartão de crédito', 'cartao_credito'),
         (p_empresa, 'Cartão de débito', 'cartao_debito'), (p_empresa, 'Cheque', 'cheque'), (p_empresa, 'Outro', 'outro')
  ON CONFLICT (empresa_id, nome) DO NOTHING;
END;
$$;
REVOKE EXECUTE ON FUNCTION semear_formas_pagamento(bigint) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION semear_financeiro(p_empresa bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM semear_formas_pagamento(p_empresa); -- v18: antes das condições, que apontam para as formas
  INSERT INTO condicoes_pagamento (empresa_id, nome, tipo, forma_pagamento, parcelas, dias_primeira, intervalo_dias)
  VALUES (p_empresa, 'À vista', 'a_vista', 'dinheiro', 1, 0, 30),
         (p_empresa, '30 dias', 'parcelado', 'boleto', 1, 30, 30),
         (p_empresa, '30/60/90 dias', 'parcelado', 'boleto', 3, 30, 30)
  ON CONFLICT (empresa_id, nome) DO NOTHING;
END;
$$;

SELECT semear_formas_pagamento(id) FROM empresas;

-- ─────────────────────────────────────────────────────────────────────
-- 2. forma_pagamento_id nas tabelas, com o comportamento sincronizado
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE condicoes_pagamento ADD COLUMN forma_pagamento_id bigint,
  ADD CONSTRAINT condicoes_pagamento_forma_fk FOREIGN KEY (forma_pagamento_id, empresa_id) REFERENCES formas_pagamento (id, empresa_id);
ALTER TABLE titulos_financeiros ADD COLUMN forma_pagamento_id bigint,
  ADD CONSTRAINT titulos_financeiros_forma_fk FOREIGN KEY (forma_pagamento_id, empresa_id) REFERENCES formas_pagamento (id, empresa_id);
ALTER TABLE entradas ADD COLUMN forma_pagamento_id bigint,
  ADD CONSTRAINT entradas_forma_fk FOREIGN KEY (forma_pagamento_id, empresa_id) REFERENCES formas_pagamento (id, empresa_id);

-- Com o id: grava o comportamento da forma em forma_pagamento (forma nova precisa estar ativa).
-- Só com o código antigo: aponta para a 1ª forma da igreja com esse comportamento.
CREATE FUNCTION forma_pagamento_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f formas_pagamento%ROWTYPE;
BEGIN
  IF NEW.forma_pagamento_id IS NOT NULL THEN
    SELECT * INTO f FROM formas_pagamento WHERE id = NEW.forma_pagamento_id AND empresa_id = NEW.empresa_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Forma de pagamento não encontrada.'; END IF;
    IF NOT f.ativo AND (TG_OP = 'INSERT' OR NEW.forma_pagamento_id IS DISTINCT FROM OLD.forma_pagamento_id) THEN
      RAISE EXCEPTION 'A forma de pagamento "%" está inativa.', f.nome;
    END IF;
    NEW.forma_pagamento := f.tipo;
  ELSIF NEW.forma_pagamento IS NOT NULL THEN
    SELECT id INTO NEW.forma_pagamento_id FROM formas_pagamento
     WHERE empresa_id = NEW.empresa_id AND tipo = NEW.forma_pagamento ORDER BY ativo DESC, id LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER condicoes_pagamento_forma_trg BEFORE INSERT OR UPDATE OF forma_pagamento, forma_pagamento_id ON condicoes_pagamento
  FOR EACH ROW EXECUTE FUNCTION forma_pagamento_sync();
CREATE TRIGGER titulos_financeiros_forma_trg BEFORE INSERT OR UPDATE OF forma_pagamento, forma_pagamento_id ON titulos_financeiros
  FOR EACH ROW EXECUTE FUNCTION forma_pagamento_sync();
CREATE TRIGGER entradas_forma_trg BEFORE INSERT OR UPDATE OF forma_pagamento, forma_pagamento_id ON entradas
  FOR EACH ROW EXECUTE FUNCTION forma_pagamento_sync();

-- Linhas que já existem passam a apontar para a forma do mesmo comportamento.
UPDATE condicoes_pagamento c SET forma_pagamento_id = f.id FROM formas_pagamento f
 WHERE c.forma_pagamento IS NOT NULL AND f.empresa_id = c.empresa_id AND f.tipo = c.forma_pagamento;
UPDATE titulos_financeiros t SET forma_pagamento_id = f.id FROM formas_pagamento f
 WHERE t.forma_pagamento IS NOT NULL AND f.empresa_id = t.empresa_id AND f.tipo = t.forma_pagamento;
UPDATE entradas e SET forma_pagamento_id = f.id FROM formas_pagamento f
 WHERE f.empresa_id = e.empresa_id AND f.tipo = e.forma_pagamento;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Views com o nome da forma (colunas novas no fim)
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW titulos_pagar WITH (security_invoker = true) AS
SELECT t.id, t.empresa_id, t.documento_id, t.pessoa_id, t.descricao, t.parcela, t.total_parcelas, t.emissao,
       t.vencimento, t.valor, t.forma_pagamento, t.conta_caixa_id, t.centro_custo_id, t.status, t.cancelado_em,
       t.motivo_cancelamento, t.criado_em,
       pe.nome AS fornecedor_nome, pe.documento AS fornecedor_documento, pe.tipo_pessoa AS fornecedor_tipo,
       d.tipo AS documento_tipo, d.numero AS documento_numero, d.serie AS documento_serie,
       pg.id AS pagamento_id, pg.data_pagamento, pg.valor_pago, pg.juros, pg.multa, pg.desconto,
       pg.conta_caixa_id AS pagamento_conta_caixa_id, pg.origem AS pagamento_origem,
       t.linha_digitavel, t.pix_chave, t.banco, t.agencia, t.conta, t.observacao,
       pg.observacao AS pagamento_observacao,
       t.forma_pagamento_id, fp.nome AS forma_pagamento_nome
  FROM titulos_financeiros t
  JOIN pessoas pe ON pe.id = t.pessoa_id
  LEFT JOIN documentos_entrada d ON d.id = t.documento_id
  LEFT JOIN formas_pagamento fp ON fp.id = t.forma_pagamento_id
  LEFT JOIN pagamentos pg ON pg.titulo_id = t.id AND NOT pg.estornado
 WHERE t.natureza = 'pagar';

CREATE OR REPLACE VIEW titulos_receber WITH (security_invoker = true) AS
SELECT t.id, t.empresa_id, t.documento_id, t.pessoa_id, t.descricao, t.parcela, t.total_parcelas, t.emissao,
       t.vencimento, t.valor, t.forma_pagamento, t.conta_caixa_id, t.centro_custo_id, t.status, t.cancelado_em,
       t.motivo_cancelamento, t.criado_em,
       pe.nome AS fornecedor_nome, pe.documento AS fornecedor_documento, pe.tipo_pessoa AS fornecedor_tipo,
       NULL::text AS documento_tipo, NULL::text AS documento_numero, NULL::text AS documento_serie,
       pg.id AS pagamento_id, pg.data_pagamento, pg.valor_pago, pg.juros, pg.multa, pg.desconto,
       pg.conta_caixa_id AS pagamento_conta_caixa_id, pg.origem AS pagamento_origem,
       t.linha_digitavel, t.pix_chave, t.banco, t.agencia, t.conta, t.observacao,
       pg.observacao AS pagamento_observacao,
       t.forma_pagamento_id, fp.nome AS forma_pagamento_nome
  FROM titulos_financeiros t
  JOIN pessoas pe ON pe.id = t.pessoa_id
  LEFT JOIN formas_pagamento fp ON fp.id = t.forma_pagamento_id
  LEFT JOIN pagamentos pg ON pg.titulo_id = t.id AND NOT pg.estornado
 WHERE t.natureza = 'receber';

CREATE OR REPLACE VIEW entradas_lista WITH (security_invoker = true) AS
SELECT en.id, en.empresa_id, en.tipo, en.data, en.valor, en.conta_caixa_id, en.forma_pagamento, en.pessoa_id,
       en.campanha_id, en.centro_custo_id, en.descricao, en.registrado_por_nome, en.criado_em,
       en.estornado, en.estornado_em, en.motivo_estorno,
       pe.nome AS pessoa_nome, ca.nome AS campanha_nome, cx.nome AS conta_caixa_nome, cc.nome AS centro_custo_nome,
       en.forma_pagamento_id, fp.nome AS forma_pagamento_nome
  FROM entradas en
  LEFT JOIN formas_pagamento fp ON fp.id = en.forma_pagamento_id
  LEFT JOIN pessoas pe ON pe.id = en.pessoa_id
  LEFT JOIN campanhas ca ON ca.id = en.campanha_id
  JOIN contas_caixa cx ON cx.id = en.conta_caixa_id
  LEFT JOIN centros_custo cc ON cc.id = en.centro_custo_id;

-- ─────────────────────────────────────────────────────────────────────
-- 4. RPCs aceitam forma_pagamento_id (cópias das versões anteriores)
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION gerar_titulos_nota(p_doc bigint) RETURNS void
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
                                     vencimento, valor, forma_pagamento, forma_pagamento_id, conta_caixa_id, centro_custo_id)
    VALUES (d.empresa_id, d.id, d.fornecedor_id, v_desc, i, c.parcelas, d.data_emissao, v_venc, v_valor,
            c.forma_pagamento, c.forma_pagamento_id, d.conta_caixa_id, d.centro_custo_id)
    RETURNING id INTO v_tit;

    IF c.tipo = 'a_vista' THEN
      INSERT INTO pagamentos (empresa_id, titulo_id, conta_caixa_id, data_pagamento, valor_principal, origem, pago_por)
      VALUES (d.empresa_id, v_tit, d.conta_caixa_id, d.data_entrada, v_valor, 'aprovacao', auth.uid());
      UPDATE titulos_financeiros SET status = 'pago' WHERE id = v_tit;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION atualizar_titulo(p_titulo bigint, p_dados jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_forma text := nullif(p_dados->>'forma_pagamento', '');
  v_forma_id bigint := nullif(p_dados->>'forma_pagamento_id', '')::bigint; -- v18: cadastro de formas
  v_linha text := nullif(regexp_replace(coalesce(p_dados->>'linha_digitavel', ''), '\D', '', 'g'), '');
  v_venc  date := nullif(p_dados->>'vencimento', '')::date;
BEGIN
  IF NOT tem_nivel('administrador', 'supervisor') THEN
    RAISE EXCEPTION 'Somente Supervisor ou Administrador pode alterar lançamentos.' USING ERRCODE = '42501';
  END IF;
  IF v_venc IS NULL THEN RAISE EXCEPTION 'Informe o vencimento.'; END IF;
  IF v_forma IS NOT NULL AND v_forma NOT IN ('dinheiro', 'pix', 'boleto', 'transferencia', 'cartao_credito',
                                             'cartao_debito', 'cheque', 'outro') THEN
    RAISE EXCEPTION 'Forma de pagamento inválida.';
  END IF;
  IF v_linha IS NOT NULL AND length(v_linha) NOT BETWEEN 44 AND 48 THEN
    RAISE EXCEPTION 'A linha digitável / código de barras deve ter de 44 a 48 números (tem %).', length(v_linha);
  END IF;

  UPDATE titulos_financeiros SET
    vencimento      = v_venc,
    forma_pagamento = CASE WHEN v_forma_id IS NULL THEN v_forma END, -- com o id, o gatilho preenche o comportamento
    forma_pagamento_id = v_forma_id,
    linha_digitavel = v_linha,
    pix_chave       = nullif(btrim(coalesce(p_dados->>'pix_chave', '')), ''),
    banco           = nullif(btrim(coalesce(p_dados->>'banco', '')), ''),
    agencia         = nullif(btrim(coalesce(p_dados->>'agencia', '')), ''),
    conta           = nullif(btrim(coalesce(p_dados->>'conta', '')), ''),
    observacao      = nullif(btrim(coalesce(p_dados->>'observacao', '')), '')
  WHERE id = p_titulo AND empresa_id = minha_empresa_id() AND status = 'aberto';
  IF NOT FOUND THEN RAISE EXCEPTION 'Só é possível alterar lançamentos em aberto.'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION criar_contas_receber(p_dados jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa  bigint := minha_empresa_id();
  v_pessoa   bigint := nullif(p_dados->>'pessoa_id', '')::bigint;
  v_desc     text := nullif(btrim(coalesce(p_dados->>'descricao', '')), '');
  v_obs      text := nullif(btrim(coalesce(p_dados->>'observacao', '')), '');
  v_forma    text := nullif(p_dados->>'forma_pagamento', '');
  v_forma_id bigint := nullif(p_dados->>'forma_pagamento_id', '')::bigint; -- v18: cadastro de formas
  v_caixa    bigint := nullif(p_dados->>'conta_caixa_id', '')::bigint;
  v_centro   bigint := nullif(p_dados->>'centro_custo_id', '')::bigint;
  v_por      text := coalesce(nullif(p_dados->>'valor_por', ''), 'total');
  v_period   text := coalesce(nullif(p_dados->>'periodicidade', ''), 'mensal');
  v_emissao  date;
  v_venc1    date;
  v_valor    numeric;
  v_parcelas integer;
  v_interv   integer;
  v_cent bigint; v_base bigint; v_resto bigint;
BEGIN
  IF NOT tem_nivel('administrador', 'supervisor') THEN
    RAISE EXCEPTION 'Somente Supervisor ou Administrador pode lançar contas a receber.';
  END IF;
  BEGIN
    v_emissao  := coalesce(nullif(p_dados->>'emissao', '')::date, current_date);
    v_venc1    := (p_dados->>'primeiro_vencimento')::date;
    v_valor    := round((p_dados->>'valor')::numeric, 2);
    v_parcelas := coalesce(nullif(p_dados->>'parcelas', '')::integer, 1);
    v_interv   := coalesce(nullif(p_dados->>'intervalo_dias', '')::integer, 30);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Data, valor ou número de parcelas inválido.';
  END;

  IF v_pessoa IS NULL OR NOT EXISTS (SELECT 1 FROM pessoas WHERE id = v_pessoa AND empresa_id = v_empresa AND ativo) THEN
    RAISE EXCEPTION 'Informe de quem a igreja vai receber (cadastro ativo).';
  END IF;
  IF v_desc IS NULL THEN RAISE EXCEPTION 'Informe a descrição.'; END IF;
  IF length(v_desc) > 200 THEN RAISE EXCEPTION 'A descrição pode ter no máximo 200 caracteres.'; END IF;
  IF length(v_obs) > 500 THEN RAISE EXCEPTION 'A observação pode ter no máximo 500 caracteres.'; END IF;
  IF v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'O valor precisa ser maior que zero.'; END IF;
  IF v_valor > 9999999999999 THEN RAISE EXCEPTION 'Valor alto demais.'; END IF;
  IF v_parcelas NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Informe de 1 a 120 parcelas.'; END IF;
  IF v_venc1 IS NULL THEN RAISE EXCEPTION 'Informe o vencimento da 1ª parcela.'; END IF;
  IF v_por NOT IN ('total', 'parcela') THEN RAISE EXCEPTION 'Informe se o valor é o total ou o de cada parcela.'; END IF;
  IF v_period NOT IN ('mensal', 'dias') THEN RAISE EXCEPTION 'Periodicidade inválida.'; END IF;
  IF v_period = 'dias' AND v_interv NOT BETWEEN 1 AND 365 THEN RAISE EXCEPTION 'O intervalo entre parcelas vai de 1 a 365 dias.'; END IF;
  IF v_forma IS NOT NULL AND v_forma NOT IN ('dinheiro', 'pix', 'boleto', 'transferencia', 'cartao_credito', 'cartao_debito', 'cheque', 'outro') THEN
    RAISE EXCEPTION 'Forma de recebimento inválida.';
  END IF;
  IF v_caixa IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contas_caixa WHERE id = v_caixa AND empresa_id = v_empresa AND ativo) THEN
    RAISE EXCEPTION 'Conta caixa não encontrada ou inativa.';
  END IF;
  IF v_centro IS NOT NULL AND NOT EXISTS (SELECT 1 FROM centros_custo WHERE id = v_centro AND empresa_id = v_empresa AND ativo) THEN
    RAISE EXCEPTION 'Centro de custo não encontrado ou inativo.';
  END IF;

  IF v_por = 'parcela' THEN
    v_base := round(v_valor * 100)::bigint;
    v_resto := 0;
  ELSE
    v_cent  := round(v_valor * 100)::bigint;
    v_base  := v_cent / v_parcelas;
    v_resto := v_cent - v_base * v_parcelas;
    IF v_base = 0 THEN
      RAISE EXCEPTION 'O valor (%) é pequeno demais para dividir em % parcelas.', v_valor, v_parcelas;
    END IF;
  END IF;

  FOR i IN 1..v_parcelas LOOP
    INSERT INTO titulos_financeiros (empresa_id, natureza, pessoa_id, descricao, parcela, total_parcelas, emissao, vencimento,
                                     valor, forma_pagamento, forma_pagamento_id, conta_caixa_id, centro_custo_id, observacao)
    VALUES (v_empresa, 'receber', v_pessoa, v_desc, i, v_parcelas, v_emissao,
            CASE WHEN v_period = 'mensal' THEN (v_venc1 + make_interval(months => i - 1))::date
                 ELSE v_venc1 + (i - 1) * v_interv END,
            (v_base + CASE WHEN i = 1 THEN v_resto ELSE 0 END) / 100.0,
            CASE WHEN v_forma_id IS NULL THEN v_forma END, v_forma_id, v_caixa, v_centro, v_obs);
  END LOOP;
  RETURN v_parcelas;
END;
$$;

CREATE OR REPLACE FUNCTION registrar_entrada(p_dados jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa  bigint := minha_empresa_id();
  v_tipo     text := p_dados->>'tipo';
  v_data     date;
  v_valor    numeric;
  v_caixa    bigint := nullif(p_dados->>'conta_caixa_id', '')::bigint;
  v_forma    text := nullif(p_dados->>'forma_pagamento', '');
  v_forma_id bigint := nullif(p_dados->>'forma_pagamento_id', '')::bigint; -- v18: cadastro de formas
  v_pessoa   bigint := nullif(p_dados->>'pessoa_id', '')::bigint;
  v_campanha bigint := nullif(p_dados->>'campanha_id', '')::bigint;
  v_centro   bigint := nullif(p_dados->>'centro_custo_id', '')::bigint;
  v_desc     text := nullif(btrim(coalesce(p_dados->>'descricao', '')), '');
  cx         contas_caixa%ROWTYPE;
  v_id       bigint;
BEGIN
  -- v16: qualquer nível da igreja registra (quem conta o dinheiro no culto); estornar continua Supervisor+.
  IF NOT tem_nivel('administrador', 'supervisor', 'usuario') THEN
    RAISE EXCEPTION 'Sem acesso para registrar entradas nesta igreja.';
  END IF;
  -- v16: "outra" saiu; o que não é contribuição vira entrada avulsa em Caixa (registrar_movimento).
  IF v_tipo = 'outra' THEN
    RAISE EXCEPTION 'Entradas que não são dízimo, oferta ou campanha (ex.: rendimento, venda, reembolso) são lançadas em Financeiro → Caixa → Extrato e movimentos, como entrada avulsa.';
  END IF;
  IF v_tipo IS NULL OR v_tipo NOT IN ('dizimo', 'oferta', 'campanha') THEN
    RAISE EXCEPTION 'Tipo de entrada inválido.';
  END IF;
  BEGIN
    v_data := (p_dados->>'data')::date;
    v_valor := round((p_dados->>'valor')::numeric, 2);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Data ou valor inválido.';
  END;
  IF v_data IS NULL THEN RAISE EXCEPTION 'Informe a data da entrada.'; END IF;
  IF v_data > current_date THEN RAISE EXCEPTION 'A data da entrada não pode ser futura.'; END IF;
  IF v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'O valor precisa ser maior que zero.'; END IF;
  IF v_valor > 9999999999999 THEN RAISE EXCEPTION 'Valor alto demais.'; END IF;
  IF v_forma IS NULL AND v_forma_id IS NULL THEN RAISE EXCEPTION 'Informe a forma de recebimento.'; END IF;
  IF v_forma_id IS NOT NULL AND (SELECT tipo FROM formas_pagamento WHERE id = v_forma_id AND empresa_id = v_empresa) = 'boleto' THEN
    RAISE EXCEPTION 'Boleto não é forma de recebimento de dízimo, oferta ou campanha.';
  END IF;
  IF length(v_desc) > 200 THEN RAISE EXCEPTION 'A descrição pode ter no máximo 200 caracteres.'; END IF;

  SELECT * INTO cx FROM contas_caixa WHERE id = v_caixa AND empresa_id = v_empresa;
  IF NOT FOUND THEN RAISE EXCEPTION 'Informe a conta caixa que recebeu o valor.'; END IF;
  IF NOT cx.ativo THEN RAISE EXCEPTION 'A conta caixa "%" está inativa.', cx.nome; END IF;
  IF v_data < cx.data_saldo_inicial THEN
    RAISE EXCEPTION 'A data é anterior ao saldo inicial da conta caixa "%" (%).', cx.nome, to_char(cx.data_saldo_inicial, 'DD/MM/YYYY');
  END IF;

  IF v_pessoa IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pessoas WHERE id = v_pessoa AND empresa_id = v_empresa AND ativo) THEN
    RAISE EXCEPTION 'Pessoa não encontrada ou inativa.';
  END IF;
  IF v_tipo = 'campanha' THEN
    IF v_campanha IS NULL THEN RAISE EXCEPTION 'Escolha a campanha.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM campanhas WHERE id = v_campanha AND empresa_id = v_empresa AND ativo) THEN
      RAISE EXCEPTION 'Campanha não encontrada ou inativa.';
    END IF;
  ELSE
    v_campanha := NULL;
  END IF;
  IF v_centro IS NOT NULL AND NOT EXISTS (SELECT 1 FROM centros_custo WHERE id = v_centro AND empresa_id = v_empresa AND ativo) THEN
    RAISE EXCEPTION 'Centro de custo não encontrado ou inativo.';
  END IF;

  INSERT INTO entradas (empresa_id, tipo, data, valor, conta_caixa_id, forma_pagamento, forma_pagamento_id, pessoa_id, campanha_id,
                        centro_custo_id, descricao, registrado_por, registrado_por_nome)
  VALUES (v_empresa, v_tipo, v_data, v_valor, v_caixa, CASE WHEN v_forma_id IS NULL THEN v_forma END, v_forma_id, v_pessoa, v_campanha, v_centro, v_desc, auth.uid(),
          (SELECT coalesce(nullif(btrim(nome), ''), email) FROM profiles WHERE user_id = auth.uid()))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
