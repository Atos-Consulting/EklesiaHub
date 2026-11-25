-- ═════════════════════════════════════════════════════════════════════
-- EklesiaHub — migration v11: tipo contábil opcional com a contabilidade desligada
-- ═════════════════════════════════════════════════════════════════════
-- Com o parâmetro "contabilidade.ativa" = 'false' (Parâmetros → Sistema → Módulos), os itens da nota
-- podem ficar sem tipo contábil (e, portanto, sem conta de débito/crédito) e a nota aprova assim.
-- Com a contabilidade ligada (padrão), nada muda: o tipo contábil continua obrigatório.
-- Itens que já têm tipo continuam contabilizados normalmente. Rodar depois da v10.

-- 1. Item sem tipo contábil não tem conta
ALTER TABLE documento_entrada_itens ALTER COLUMN conta_id DROP NOT NULL;

-- 2. A igreja usa a contabilidade? (padrão sim; só 'false' desliga)
CREATE OR REPLACE FUNCTION usa_contabilidade(p_empresa bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM parametros
                      WHERE empresa_id = p_empresa AND chave = 'contabilidade.ativa' AND valor = 'false');
$$;
REVOKE ALL ON FUNCTION usa_contabilidade(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION usa_contabilidade(bigint) TO authenticated;

-- 3. Regras dos itens, da aprovação e da gravação da nota (iguais às da v6/v8, exceto o tipo contábil)

CREATE OR REPLACE FUNCTION documento_entrada_itens_regras() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  doc_id bigint := CASE WHEN TG_OP = 'DELETE' THEN OLD.documento_id ELSE NEW.documento_id END;
  doc_st text;
  conta  plano_contas%ROWTYPE;
  tipo   tipos_contabeis%ROWTYPE;
BEGIN
  SELECT status INTO doc_st FROM documentos_entrada WHERE id = doc_id;
  IF NOT FOUND THEN
    -- exclusão em cascata da própria nota (só permitida em rascunho pela RLS)
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF doc_st <> 'rascunho' THEN
    RAISE EXCEPTION 'Itens só podem ser alterados enquanto a nota é rascunho (status atual: %).', doc_st;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    -- As contas de débito e crédito do item vêm SEMPRE do tipo contábil (o que o cliente mandar é ignorado).
    IF NEW.tipo_contabil_id IS NOT NULL THEN
      SELECT * INTO tipo FROM tipos_contabeis WHERE id = NEW.tipo_contabil_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Tipo contábil não encontrado.'; END IF;
      IF TG_OP = 'INSERT' AND NOT tipo.ativo THEN
        RAISE EXCEPTION 'O tipo contábil "%" está inativo.', tipo.nome;
      END IF;
      NEW.conta_id := tipo.conta_debito_id;
      NEW.conta_credito_id := tipo.conta_credito_id;
    ELSIF TG_OP = 'INSERT' AND usa_contabilidade(NEW.empresa_id) THEN
      RAISE EXCEPTION 'Selecione o tipo contábil de todos os itens.';
    ELSIF TG_OP = 'INSERT' THEN
      -- contabilidade desligada: item sem tipo contábil fica sem contas
      NEW.conta_id := NULL;
      NEW.conta_credito_id := NULL;
    END IF;

    SELECT * INTO conta FROM plano_contas WHERE id = NEW.conta_id;
    IF NEW.conta_id IS NOT NULL AND (NOT conta.analitica OR NOT conta.ativo OR conta.natureza NOT IN ('despesa', 'ativo')) THEN
      RAISE EXCEPTION 'A conta % - % não aceita itens de nota (precisa ser analítica, ativa e de despesa/ativo).',
        conta.codigo, conta.nome;
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION documentos_entrada_regras() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  soma numeric(15,2);
  esperado numeric(15,2);
  qtd  integer;
  inativo text;
  ignorar text[] := ARRAY['status', 'motivo_cancelamento', 'cancelado_por', 'cancelado_em',
                          'aprovado_por', 'aprovado_em', 'atualizado_em'];
BEGIN
  IF NEW.status = 'lancada' THEN
    RAISE EXCEPTION 'Status "lancada" ainda não está disponível (depende do módulo Contábil).';
  END IF;

  IF OLD.status IN ('cancelada', 'lancada') THEN
    RAISE EXCEPTION 'Nota % não pode mais ser alterada.', OLD.status;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('aprovada', 'cancelada')
     AND NOT tem_nivel('administrador', 'supervisor') THEN
    RAISE EXCEPTION 'Somente Supervisor ou Administrador pode aprovar ou cancelar notas.';
  END IF;

  IF OLD.status = 'aprovada' THEN
    IF NEW.status <> 'cancelada' THEN
      RAISE EXCEPTION 'Nota aprovada é imutável; só pode ser cancelada (com motivo).';
    END IF;
    IF (to_jsonb(NEW) - ignorar) IS DISTINCT FROM (to_jsonb(OLD) - ignorar) THEN
      RAISE EXCEPTION 'Ao cancelar uma nota aprovada, nenhum outro campo pode ser alterado.';
    END IF;
  END IF;

  IF OLD.status = 'rascunho' AND NEW.status = 'aprovada' THEN
    SELECT coalesce(sum(valor_total), 0), count(*) INTO soma, qtd
      FROM documento_entrada_itens WHERE documento_id = NEW.id;
    IF qtd = 0 THEN
      RAISE EXCEPTION 'A nota precisa ter ao menos um item para ser aprovada.';
    END IF;
    IF NEW.conta_caixa_id IS NULL THEN
      RAISE EXCEPTION 'Informe a conta caixa para aprovar a nota.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM contas_caixa WHERE id = NEW.conta_caixa_id AND ativo) THEN
      RAISE EXCEPTION 'A conta caixa da nota está inativa.';
    END IF;
    IF usa_contabilidade(NEW.empresa_id)
       AND EXISTS (SELECT 1 FROM documento_entrada_itens WHERE documento_id = NEW.id AND tipo_contabil_id IS NULL) THEN
      RAISE EXCEPTION 'Todos os itens precisam de um tipo contábil. Edite a nota e selecione o tipo de cada item.';
    END IF;
    SELECT t.nome INTO inativo
      FROM documento_entrada_itens i JOIN tipos_contabeis t ON t.id = i.tipo_contabil_id
     WHERE i.documento_id = NEW.id AND NOT t.ativo LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'O tipo contábil "%" está inativo. Troque o tipo dos itens que o usam.', inativo;
    END IF;
    -- Fixa a contabilização na data da aprovação, com as regras VIGENTES de cada tipo contábil.
    UPDATE documento_entrada_itens SET tipo_contabil_id = tipo_contabil_id WHERE documento_id = NEW.id;

    esperado := soma + NEW.valor_frete + NEW.valor_seguro + NEW.valor_outras - NEW.valor_desconto
                + coalesce((NEW.fiscal->>'ipi')::numeric, 0) + coalesce((NEW.fiscal->>'icms_st')::numeric, 0);
    IF esperado <> NEW.valor_total THEN
      RAISE EXCEPTION 'O total da nota (%) não confere com os itens e ajustes (%).', NEW.valor_total, esperado;
    END IF;
    NEW.aprovado_por := auth.uid();
    NEW.aprovado_em  := now();
  END IF;

  IF NEW.status = 'cancelada' AND OLD.status <> 'cancelada' THEN
    NEW.cancelado_por := auth.uid();
    NEW.cancelado_em  := now();
  END IF;

  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

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
  IF usa_contabilidade(minha_empresa_id())
     AND EXISTS (SELECT 1 FROM jsonb_to_recordset(v_itens) AS i(tipo_contabil_id bigint) WHERE i.tipo_contabil_id IS NULL) THEN
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
