-- ═════════════════════════════════════════════════════════════════════
-- EklesiaHub — migration v28: tributos a recuperar no tipo contábil e campos de IBS/CBS
-- ═════════════════════════════════════════════════════════════════════
--  • Reforma tributária: a nota e o item ganham IBS e CBS (base, alíquotas e valores), também lidos do XML.
--  • Tipo contábil ganha "tributos a recuperar" (tipos_contabeis.tributos_recuperar = { tributo: conta }), para
--    ICMS, IPI, PIS, COFINS, ISS, CBS e IBS. Marcado, o valor desse tributo destacado no item sai do custo e
--    vai para a conta escolhida (ativo, "a recuperar"). Ex.: item de R$ 100 com ICMS 18 → D Material 82,
--    D ICMS a recuperar 18. Se os tributos marcados passarem do valor do item, nada é separado naquele item.
--  • O item da nota guarda as contas do tipo na gravação (documento_entrada_itens.tributos_contas), como já
--    guarda a conta de débito: mudar o tipo vale para notas novas.
--  • O custo do estoque (v27) também sai sem esses tributos.
--  • Contas novas no plano (se o código não existir): 1.1.05 a 1.1.11 (ICMS, IPI, PIS, COFINS, ISS, CBS e IBS
--    a recuperar). Nenhum tipo passa a recuperar sozinho: o Administrador marca em Parâmetros → Tipos contábeis.
-- Rodar depois da v27.

-- ─────────────────────────────────────────────────────────────────────
-- 1. IBS e CBS nos tributos da nota e do item
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
                   'pis_aliquota', 'pis', 'cofins_aliquota', 'cofins', 'iss_aliquota', 'iss', 'inss', 'irrf', 'csll',
                   'ibs_cbs_base', 'cbs_aliquota', 'cbs', 'ibs_aliquota', 'ibs'];
    strs  := ARRAY['ncm', 'cfop', 'unidade', 'cst'];
    bools := ARRAY[]::text[];
  ELSE
    nums  := ARRAY['icms_base', 'icms', 'icms_st_base', 'icms_st', 'ipi_base', 'ipi', 'pis_base', 'pis', 'cofins_base',
                   'cofins', 'iss_base', 'iss_aliquota', 'iss', 'inss', 'irrf', 'csll', 'pis_retido', 'cofins_retido',
                   'outras_retencoes', 'total_tributos', 'ibs_cbs_base', 'cbs', 'ibs'];
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

-- ─────────────────────────────────────────────────────────────────────
-- 2. Tributos a recuperar no tipo contábil
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE tipos_contabeis ADD COLUMN tributos_recuperar jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE documento_entrada_itens ADD COLUMN tributos_contas jsonb NOT NULL DEFAULT '{}'::jsonb;

-- { tributo: id da conta }: tributos conhecidos, contas analíticas e ativas de ativo da mesma igreja.
CREATE FUNCTION tipos_contabeis_tributos() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  k text;
  v jsonb;
  c plano_contas%ROWTYPE;
BEGIN
  IF NEW.tributos_recuperar IS NULL OR jsonb_typeof(NEW.tributos_recuperar) <> 'object' THEN
    RAISE EXCEPTION 'Tributos a recuperar inválidos.';
  END IF;
  FOR k, v IN SELECT * FROM jsonb_each(NEW.tributos_recuperar) LOOP
    IF k NOT IN ('icms', 'ipi', 'pis', 'cofins', 'iss', 'cbs', 'ibs') THEN RAISE EXCEPTION 'Tributo desconhecido: %.', k; END IF;
    IF jsonb_typeof(v) <> 'number' THEN RAISE EXCEPTION 'Escolha a conta do % a recuperar.', upper(k); END IF;
    SELECT * INTO c FROM plano_contas WHERE id = (v #>> '{}')::bigint AND empresa_id = NEW.empresa_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Conta do % a recuperar não encontrada.', upper(k); END IF;
    IF NOT c.analitica OR NOT c.ativo OR c.natureza <> 'ativo' THEN
      RAISE EXCEPTION 'A conta do % a recuperar precisa ser uma conta analítica e ativa do ativo (ex.: % a recuperar).', upper(k), upper(k);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tipos_contabeis_tributos_trg BEFORE INSERT OR UPDATE OF tributos_recuperar ON tipos_contabeis
  FOR EACH ROW EXECUTE FUNCTION tipos_contabeis_tributos();

-- O item guarda as contas de tributos do tipo na gravação (como guarda a conta de débito).
CREATE FUNCTION documento_entrada_itens_tributos() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.tributos_contas := coalesce((SELECT tributos_recuperar FROM tipos_contabeis
                                    WHERE id = NEW.tipo_contabil_id AND empresa_id = NEW.empresa_id), '{}'::jsonb);
  RETURN NEW;
END;
$$;
CREATE TRIGGER documento_entrada_itens_tributos_trg BEFORE INSERT OR UPDATE OF tipo_contabil_id ON documento_entrada_itens
  FOR EACH ROW EXECUTE FUNCTION documento_entrada_itens_tributos();

-- Valor a recuperar do item: soma dos tributos marcados no tipo; zero se passar do valor do item.
CREATE FUNCTION tributos_recuperar_item(p_fiscal jsonb, p_contas jsonb, p_valor numeric) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN s < p_valor THEN s ELSE 0 END
    FROM (SELECT coalesce(sum(coalesce((p_fiscal ->> k)::numeric, 0)), 0) AS s FROM jsonb_object_keys(coalesce(p_contas, '{}'::jsonb)) AS k) x;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Contas a recuperar no plano (igrejas novas e as que já existem)
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION semear_contabilidade(p_empresa bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  v_rfb bigint;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('1.1.04', 'Contas a receber', 'ativo', '1.1'), ('4.3', 'Outras receitas', 'receita', '4'),
      ('4.4', 'Receitas financeiras', 'receita', '4'), ('5.5', 'Despesas financeiras', 'despesa', '5'),
      ('5.6', 'Outras despesas', 'despesa', '5'),
      ('2.1.03', 'INSS retido a recolher', 'passivo', '2.1'), ('2.1.04', 'IRRF retido a recolher', 'passivo', '2.1'),
      ('2.1.05', 'CSLL retida a recolher', 'passivo', '2.1'), ('2.1.06', 'ISS retido a recolher', 'passivo', '2.1'),
      ('2.1.07', 'PIS retido a recolher', 'passivo', '2.1'), ('2.1.08', 'COFINS retida a recolher', 'passivo', '2.1'),
      ('1.1.05', 'ICMS a recuperar', 'ativo', '1.1'), ('1.1.06', 'IPI a recuperar', 'ativo', '1.1'),
      ('1.1.07', 'PIS a recuperar', 'ativo', '1.1'), ('1.1.08', 'COFINS a recuperar', 'ativo', '1.1'),
      ('1.1.09', 'ISS a recuperar', 'ativo', '1.1'), ('1.1.10', 'CBS a recuperar', 'ativo', '1.1'),
      ('1.1.11', 'IBS a recuperar', 'ativo', '1.1')) AS v(codigo, nome, natureza, pai)
  LOOP
    INSERT INTO plano_contas (empresa_id, codigo, nome, natureza, analitica, pai_id)
    SELECT p_empresa, r.codigo, r.nome, r.natureza, true, p.id
      FROM plano_contas p
     WHERE p.empresa_id = p_empresa AND p.codigo = r.pai AND NOT p.analitica AND p.natureza = r.natureza
       AND NOT EXISTS (SELECT 1 FROM plano_contas WHERE empresa_id = p_empresa AND codigo = r.codigo);
  END LOOP;

  INSERT INTO regras_contabeis (empresa_id, chave, conta_id)
  SELECT p_empresa, v.chave, c.id
    FROM (VALUES ('patrimonio', '3.1'), ('fornecedores', '2.1.01'), ('retencoes', '2.1.02'), ('contas_receber', '1.1.04'),
                 ('receita_receber', '4.3'), ('despesa_sem_nota', '5.6'), ('dizimo', '4.1.01'), ('oferta', '4.1.02'),
                 ('campanha', '4.1.03'), ('entrada_avulsa', '4.3'), ('saida_avulsa', '5.6'),
                 ('despesas_financeiras', '5.5'), ('receitas_financeiras', '4.4'),
                 ('ret_inss', '2.1.03'), ('ret_irrf', '2.1.04'), ('ret_csll', '2.1.05'), ('ret_iss', '2.1.06'),
                 ('ret_pis', '2.1.07'), ('ret_cofins', '2.1.08'),
                 ('estoque', '1.1.03'), ('vendas', '4.2.01'), ('cmv', '5.4'), ('ajuste_estoque', '5.6'),
                 ('quebra_caixa', '5.6')) AS v(chave, codigo)
    JOIN plano_contas c ON c.empresa_id = p_empresa AND c.codigo = v.codigo AND c.analitica AND c.ativo
   WHERE c.natureza = CASE
    WHEN v.chave IN ('fornecedores', 'retencoes', 'ret_inss', 'ret_irrf', 'ret_csll', 'ret_pis', 'ret_cofins', 'ret_iss') THEN 'passivo'
    WHEN v.chave IN ('contas_receber', 'estoque') THEN 'ativo'
    WHEN v.chave = 'patrimonio' THEN 'patrimonio_social'
    WHEN v.chave IN ('receita_receber', 'dizimo', 'oferta', 'campanha', 'entrada_avulsa', 'receitas_financeiras', 'vendas') THEN 'receita'
    ELSE 'despesa' END
  ON CONFLICT (empresa_id, chave) DO NOTHING;

  -- órgão padrão das guias federais: Receita Federal do Brasil
  SELECT id INTO v_rfb FROM pessoas WHERE empresa_id = p_empresa AND documento = '00394460005887';
  IF v_rfb IS NULL THEN
    INSERT INTO pessoas (empresa_id, tipo_pessoa, nome, documento, papeis)
    VALUES (p_empresa, 'PJ', 'Receita Federal do Brasil', '00394460005887', '{fornecedor}') RETURNING id INTO v_rfb;
  END IF;
  INSERT INTO tributos_guias (empresa_id, tributo, pessoa_id, dia_vencimento)
  VALUES (p_empresa, 'inss', v_rfb, 20), (p_empresa, 'irrf', v_rfb, 20), (p_empresa, 'csll', v_rfb, 20),
         (p_empresa, 'pis', v_rfb, 20), (p_empresa, 'cofins', v_rfb, 20), (p_empresa, 'iss', NULL, 10)
  ON CONFLICT (empresa_id, tributo) DO NOTHING;
END;
$$;

SELECT semear_contabilidade(id) FROM empresas;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Estoque (v27): a entrada pela nota vale sem os tributos a recuperar
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION documentos_entrada_estoque() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
BEGIN
  IF NEW.status IN ('aprovada', 'lancada') AND OLD.status NOT IN ('aprovada', 'lancada', 'cancelada') THEN
    FOR r IN
      WITH it AS (
        SELECT i.id, i.produto_id, i.quantidade, i.fiscal, i.tributos_contas,
               round(NEW.valor_total * i.valor_total / nullif(sum(i.valor_total) OVER (), 0), 2) AS v,
               row_number() OVER (ORDER BY i.valor_total DESC, i.id) AS ordem
          FROM documento_entrada_itens i WHERE i.documento_id = NEW.id
      )
      SELECT y.id, y.produto_id, y.quantidade, y.valor - tributos_recuperar_item(y.fiscal, y.tributos_contas, y.valor) AS valor
        FROM (SELECT it.id, it.produto_id, it.quantidade, it.fiscal, it.tributos_contas,
                     coalesce(it.v + CASE WHEN it.ordem = 1 THEN NEW.valor_total - sum(it.v) OVER () ELSE 0 END, 0) AS valor
                FROM it) y ORDER BY y.id
    LOOP
      IF r.produto_id IS NOT NULL THEN
        PERFORM estoque_lancar(NEW.empresa_id, r.produto_id, NEW.data_entrada, 'nota', r.quantidade, r.valor, NEW.id, r.id, NULL, NULL);
      END IF;
    END LOOP;
  ELSIF NEW.status = 'cancelada' AND OLD.status IN ('aprovada', 'lancada') THEN
    FOR r IN SELECT m.* FROM estoque_movimentos m WHERE m.documento_id = NEW.id AND m.tipo = 'nota' ORDER BY m.id LOOP
      PERFORM estoque_lancar(NEW.empresa_id, r.produto_id, greatest(current_date, r.data), 'estorno_nota', -r.quantidade, NULL,
                             NEW.id, r.documento_item_id, NULL, 'Nota cancelada');
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Contabilização da nota com os tributos a recuperar
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION eventos_contabeis(p_emp bigint)
RETURNS TABLE (origem text, origem_id bigint, chave text, data date, historico text,
               conta_id bigint, centro_custo_id bigint, debito numeric, credito numeric, falta text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH
  rg AS (SELECT chave AS k, conta_id AS c FROM regras_contabeis WHERE empresa_id = p_emp),
  r AS (SELECT
    (SELECT c FROM rg WHERE k = 'patrimonio') AS patrimonio, (SELECT c FROM rg WHERE k = 'fornecedores') AS fornecedores,
    (SELECT c FROM rg WHERE k = 'retencoes') AS retencoes, (SELECT c FROM rg WHERE k = 'contas_receber') AS contas_receber,
    (SELECT c FROM rg WHERE k = 'receita_receber') AS receita_receber, (SELECT c FROM rg WHERE k = 'despesa_sem_nota') AS despesa_sem_nota,
    (SELECT c FROM rg WHERE k = 'dizimo') AS dizimo, (SELECT c FROM rg WHERE k = 'oferta') AS oferta,
    (SELECT c FROM rg WHERE k = 'campanha') AS campanha, (SELECT c FROM rg WHERE k = 'entrada_avulsa') AS entrada_avulsa,
    (SELECT c FROM rg WHERE k = 'saida_avulsa') AS saida_avulsa, (SELECT c FROM rg WHERE k = 'despesas_financeiras') AS desp_fin,
    (SELECT c FROM rg WHERE k = 'receitas_financeiras') AS rec_fin,
    (SELECT c FROM rg WHERE k = 'ret_inss') AS ret_inss, (SELECT c FROM rg WHERE k = 'ret_irrf') AS ret_irrf,
    (SELECT c FROM rg WHERE k = 'ret_csll') AS ret_csll, (SELECT c FROM rg WHERE k = 'ret_iss') AS ret_iss,
    (SELECT c FROM rg WHERE k = 'ret_pis') AS ret_pis, (SELECT c FROM rg WHERE k = 'ret_cofins') AS ret_cofins,
    (SELECT c FROM rg WHERE k = 'estoque') AS estoque, (SELECT c FROM rg WHERE k = 'vendas') AS vendas,
    (SELECT c FROM rg WHERE k = 'cmv') AS cmv, (SELECT c FROM rg WHERE k = 'ajuste_estoque') AS ajuste_estoque,
    (SELECT c FROM rg WHERE k = 'quebra_caixa') AS quebra_caixa),
  cx AS (SELECT id, nome, conta_contabil_id AS conta FROM contas_caixa WHERE empresa_id = p_emp),
  -- notas: débito de cada item proporcional ao total da nota (frete, seguro, IPI etc. entram no custo dos itens);
  -- a sobra de centavos vai para o maior item
  nota AS (
    SELECT d.id, d.data_emissao, d.valor_total, d.tipo, d.numero, pe.nome AS fornecedor,
           (SELECT coalesce(sum(t.valor), 0) FROM titulos_financeiros t WHERE t.documento_id = d.id) AS liquido,
           retencao_nota(d.fiscal, 'inss') AS r_inss, retencao_nota(d.fiscal, 'irrf') AS r_irrf,
           retencao_nota(d.fiscal, 'csll') AS r_csll, retencao_nota(d.fiscal, 'iss') AS r_iss,
           retencao_nota(d.fiscal, 'pis') AS r_pis, retencao_nota(d.fiscal, 'cofins') AS r_cofins
      FROM documentos_entrada d LEFT JOIN pessoas pe ON pe.id = d.fornecedor_id
     WHERE d.empresa_id = p_emp AND d.status IN ('aprovada', 'lancada')
  ),
  itens AS (
    SELECT n.id AS doc, i.id AS item, i.conta_id, i.centro_custo_id, i.produto_id, i.fiscal, i.tributos_contas,
           round(n.valor_total * i.valor_total / nullif(sum(i.valor_total) OVER (PARTITION BY n.id), 0), 2) AS v,
           row_number() OVER (PARTITION BY n.id ORDER BY i.valor_total DESC, i.id) AS ordem
      FROM nota n JOIN documento_entrada_itens i ON i.documento_id = n.id
  ),
  itens_aj0 AS (
    SELECT it.*, it.v + CASE WHEN it.ordem = 1 THEN n.valor_total - sum(it.v) OVER (PARTITION BY it.doc) ELSE 0 END AS valor
      FROM itens it JOIN nota n ON n.id = it.doc
  ),
  -- tributos a recuperar (v28): saem do custo do item e vão para as contas do tipo contábil
  itens_aj AS (
    SELECT a.*, tributos_recuperar_item(a.fiscal, a.tributos_contas, a.valor) AS recuperar FROM itens_aj0 a
  ),
  recuperar AS (
    SELECT a.doc, t.k AS tributo, pc.id AS conta, (a.fiscal ->> t.k)::numeric AS v
      FROM itens_aj a
      CROSS JOIN LATERAL jsonb_each(a.tributos_contas) AS t(k, conta)
      LEFT JOIN plano_contas pc ON pc.id = (t.conta #>> '{}')::bigint AND pc.empresa_id = p_emp
     WHERE a.recuperar > 0 AND coalesce((a.fiscal ->> t.k)::numeric, 0) > 0
  ),
  ev AS (
    -- saldo inicial das contas caixa
    SELECT 'abertura'::text AS origem, c.id AS origem_id, 'abertura:' || c.saldo_inicial || ':' || c.data_saldo_inicial AS chave,
           c.data_saldo_inicial AS data, 'Saldo inicial — ' || c.nome AS historico,
           c.conta_contabil_id AS conta_id, NULL::bigint AS centro, greatest(c.saldo_inicial, 0) AS debito, greatest(-c.saldo_inicial, 0) AS credito,
           'conta contábil da conta caixa "' || c.nome || '"' AS falta
      FROM contas_caixa c WHERE c.empresa_id = p_emp AND c.saldo_inicial <> 0
    UNION ALL
    SELECT 'abertura', c.id, 'abertura:' || c.saldo_inicial || ':' || c.data_saldo_inicial, c.data_saldo_inicial, 'Saldo inicial — ' || c.nome,
           r.patrimonio, NULL, greatest(-c.saldo_inicial, 0), greatest(c.saldo_inicial, 0), 'regra "Patrimônio social"'
      FROM contas_caixa c, r WHERE c.empresa_id = p_emp AND c.saldo_inicial <> 0
    UNION ALL
    -- nota aprovada
    SELECT 'nota', a.doc, 'normal', n.data_emissao, upper(n.tipo) || ' ' || n.numero || coalesce(' — ' || n.fornecedor, ''),
           -- item ligado a produto com estoque (v27) vai para o Estoque
           CASE WHEN a.produto_id IS NOT NULL THEN r.estoque ELSE a.conta_id END,
           CASE WHEN a.produto_id IS NOT NULL THEN NULL ELSE a.centro_custo_id END, a.valor - a.recuperar, 0,
           CASE WHEN a.produto_id IS NOT NULL THEN 'regra "Estoque de mercadorias"' ELSE 'conta contábil dos itens da nota (tipo contábil)' END
      FROM itens_aj a JOIN nota n ON n.id = a.doc CROSS JOIN r WHERE a.valor > 0
    UNION ALL
    SELECT 'nota', x.doc, 'normal', n.data_emissao, upper(n.tipo) || ' ' || n.numero || coalesce(' — ' || n.fornecedor, ''),
           x.conta, NULL, x.v, 0, 'conta do ' || upper(x.tributo) || ' a recuperar (tipo contábil do item)'
      FROM recuperar x JOIN nota n ON n.id = x.doc
    UNION ALL
    SELECT 'nota', n.id, 'normal', n.data_emissao, upper(n.tipo) || ' ' || n.numero || coalesce(' — ' || n.fornecedor, ''),
           r.fornecedores, NULL, 0, n.liquido, 'regra "Fornecedores a pagar"'
      FROM nota n, r WHERE n.liquido > 0 AND EXISTS (SELECT 1 FROM itens_aj a WHERE a.doc = n.id AND a.valor > 0)
    UNION ALL
    -- retenções: cada tributo na sua conta (v26); o que sobrar (outras retenções) vai para "Outras retenções a recolher"
    SELECT 'nota', n.id, 'normal', n.data_emissao, upper(n.tipo) || ' ' || n.numero || coalesce(' — ' || n.fornecedor, ''),
           x.conta, NULL, 0, x.v, x.falta
      FROM nota n CROSS JOIN r
      CROSS JOIN LATERAL (VALUES
        (r.ret_inss, n.r_inss, 'regra "INSS retido a recolher"'),
        (r.ret_irrf, n.r_irrf, 'regra "IRRF retido a recolher"'),
        (r.ret_csll, n.r_csll, 'regra "CSLL retida a recolher"'),
        (r.ret_iss, n.r_iss, 'regra "ISS retido a recolher"'),
        (r.ret_pis, n.r_pis, 'regra "PIS retido a recolher"'),
        (r.ret_cofins, n.r_cofins, 'regra "COFINS retida a recolher"'),
        (r.retencoes, n.valor_total - n.liquido - n.r_inss - n.r_irrf - n.r_csll - n.r_iss - n.r_pis - n.r_cofins, 'regra "Outras retenções a recolher"')
      ) AS x(conta, v, falta)
     WHERE x.v > 0 AND EXISTS (SELECT 1 FROM itens_aj a WHERE a.doc = n.id AND a.valor > 0)
    UNION ALL
    -- contas a pagar sem nota (contas fixas e lançamentos avulsos) e contas a receber, na emissão
    SELECT CASE t.natureza WHEN 'pagar' THEN 'titulo_pagar' ELSE 'titulo_receber' END, t.id, 'normal', t.emissao,
           t.descricao || CASE WHEN t.total_parcelas > 1 THEN ' — parcela ' || t.parcela || '/' || t.total_parcelas ELSE '' END || coalesce(' — ' || pe.nome, ''),
           CASE t.natureza WHEN 'pagar' THEN r.despesa_sem_nota ELSE r.contas_receber END, t.centro_custo_id, t.valor, 0,
           CASE t.natureza WHEN 'pagar' THEN 'regra "Contas a pagar sem nota"' ELSE 'regra "Contas a receber"' END
      FROM titulos_financeiros t LEFT JOIN pessoas pe ON pe.id = t.pessoa_id, r
     WHERE t.empresa_id = p_emp AND t.documento_id IS NULL AND t.status <> 'cancelado' AND t.tributo_retido IS NULL
    UNION ALL
    SELECT CASE t.natureza WHEN 'pagar' THEN 'titulo_pagar' ELSE 'titulo_receber' END, t.id, 'normal', t.emissao,
           t.descricao || CASE WHEN t.total_parcelas > 1 THEN ' — parcela ' || t.parcela || '/' || t.total_parcelas ELSE '' END || coalesce(' — ' || pe.nome, ''),
           CASE t.natureza WHEN 'pagar' THEN r.fornecedores ELSE r.receita_receber END, NULL, 0, t.valor,
           CASE t.natureza WHEN 'pagar' THEN 'regra "Fornecedores a pagar"' ELSE 'regra "Receita de contas a receber"' END
      FROM titulos_financeiros t LEFT JOIN pessoas pe ON pe.id = t.pessoa_id, r
     WHERE t.empresa_id = p_emp AND t.documento_id IS NULL AND t.status <> 'cancelado' AND t.tributo_retido IS NULL
    UNION ALL
    -- pagamentos e recebimentos (baixa). Pagamento de migração (antes da v8, sem conta caixa) sai do patrimônio.
    SELECT 'pagamento', p.id, 'normal', p.data_pagamento,
           CASE t.natureza WHEN 'pagar' THEN 'Pagamento — ' ELSE 'Recebimento — ' END || t.descricao
             || CASE WHEN t.total_parcelas > 1 THEN ' — parcela ' || t.parcela || '/' || t.total_parcelas ELSE '' END || coalesce(' — ' || pe.nome, ''),
           x.conta, x.centro, x.d, x.c, x.falta
      FROM pagamentos p
      JOIN titulos_financeiros t ON t.id = p.titulo_id
      LEFT JOIN pessoas pe ON pe.id = t.pessoa_id
      LEFT JOIN cx ON cx.id = p.conta_caixa_id
      CROSS JOIN r
      CROSS JOIN LATERAL (VALUES
        -- pagar
        -- guia de tributo retido (v26) baixa a obrigação do tributo; o resto baixa Fornecedores
        (t.natureza = 'pagar',
         CASE t.tributo_retido WHEN 'inss' THEN r.ret_inss WHEN 'irrf' THEN r.ret_irrf WHEN 'csll' THEN r.ret_csll WHEN 'iss' THEN r.ret_iss
           WHEN 'pis' THEN r.ret_pis WHEN 'cofins' THEN r.ret_cofins ELSE r.fornecedores END,
         NULL::bigint, p.valor_principal, 0::numeric,
         CASE t.tributo_retido WHEN 'inss' THEN 'regra "INSS retido a recolher"' WHEN 'irrf' THEN 'regra "IRRF retido a recolher"'
           WHEN 'csll' THEN 'regra "CSLL retida a recolher"' WHEN 'iss' THEN 'regra "ISS retido a recolher"'
           WHEN 'pis' THEN 'regra "PIS retido a recolher"' WHEN 'cofins' THEN 'regra "COFINS retida a recolher"' ELSE 'regra "Fornecedores a pagar"' END),
        (t.natureza = 'pagar', r.desp_fin, t.centro_custo_id, p.juros + p.multa, 0::numeric, 'regra "Despesas financeiras"'),
        (t.natureza = 'pagar', r.rec_fin, NULL::bigint, 0::numeric, p.desconto, 'regra "Receitas financeiras"'),
        (t.natureza = 'pagar', CASE WHEN p.conta_caixa_id IS NULL THEN r.patrimonio ELSE cx.conta END, NULL::bigint, 0::numeric, p.valor_pago,
           CASE WHEN p.conta_caixa_id IS NULL THEN 'regra "Patrimônio social"' ELSE 'conta contábil da conta caixa "' || cx.nome || '"' END),
        -- receber
        (t.natureza = 'receber', cx.conta, NULL::bigint, p.valor_pago, 0::numeric, 'conta contábil da conta caixa "' || cx.nome || '"'),
        (t.natureza = 'receber', r.desp_fin, t.centro_custo_id, p.desconto, 0::numeric, 'regra "Despesas financeiras"'),
        (t.natureza = 'receber', r.contas_receber, NULL::bigint, 0::numeric, p.valor_principal, 'regra "Contas a receber"'),
        (t.natureza = 'receber', r.rec_fin, NULL::bigint, 0::numeric, p.juros + p.multa, 'regra "Receitas financeiras"')
      ) AS x(usa, conta, centro, d, c, falta)
     WHERE p.empresa_id = p_emp AND NOT p.estornado AND x.usa AND x.d + x.c > 0
    UNION ALL
    -- dízimos, ofertas e campanhas
    SELECT 'entrada', e.id, 'normal', e.data,
           CASE e.tipo WHEN 'dizimo' THEN 'Dízimo' WHEN 'oferta' THEN 'Oferta' WHEN 'campanha' THEN 'Campanha' ELSE 'Entrada' END
             || coalesce(' — ' || ca.nome, '') || coalesce(' — ' || pe.nome, ''),
           x.conta, x.centro, x.d, x.c, x.falta
      FROM entradas e
      LEFT JOIN campanhas ca ON ca.id = e.campanha_id
      LEFT JOIN pessoas pe ON pe.id = e.pessoa_id
      LEFT JOIN cx ON cx.id = e.conta_caixa_id
      CROSS JOIN r
      CROSS JOIN LATERAL (VALUES
        (cx.conta, NULL::bigint, e.valor, 0::numeric, 'conta contábil da conta caixa "' || cx.nome || '"'),
        (CASE e.tipo WHEN 'dizimo' THEN r.dizimo WHEN 'oferta' THEN r.oferta WHEN 'campanha' THEN r.campanha ELSE r.entrada_avulsa END,
         e.centro_custo_id, 0::numeric, e.valor,
         CASE e.tipo WHEN 'dizimo' THEN 'regra "Dízimos"' WHEN 'oferta' THEN 'regra "Ofertas"' WHEN 'campanha' THEN 'regra "Campanhas"' ELSE 'regra "Entradas avulsas"' END)
      ) AS x(conta, centro, d, c, falta)
     WHERE e.empresa_id = p_emp AND NOT e.estornado
    UNION ALL
    -- movimentos de caixa
    SELECT 'movimento', m.id, 'normal', m.data,
           CASE m.tipo WHEN 'transferencia' THEN 'Transferência — ' WHEN 'saida' THEN 'Saída avulsa — ' ELSE 'Entrada avulsa — ' END || m.descricao,
           x.conta, x.centro, x.d, x.c, x.falta
      FROM movimentos_caixa m
      LEFT JOIN cx o ON o.id = m.conta_origem_id
      LEFT JOIN cx d ON d.id = m.conta_destino_id
      CROSS JOIN r
      CROSS JOIN LATERAL (VALUES
        (m.tipo IN ('transferencia', 'entrada'), d.conta, NULL::bigint, m.valor, 0::numeric, 'conta contábil da conta caixa "' || d.nome || '"'),
        (m.tipo IN ('transferencia', 'saida'), o.conta, NULL::bigint, 0::numeric, m.valor, 'conta contábil da conta caixa "' || o.nome || '"'),
        (m.tipo = 'saida', r.saida_avulsa, m.centro_custo_id, m.valor, 0::numeric, 'regra "Saídas avulsas"'),
        (m.tipo = 'entrada', r.entrada_avulsa, m.centro_custo_id, 0::numeric, m.valor, 'regra "Entradas avulsas"')
      ) AS x(usa, conta, centro, d, c, falta)
     WHERE m.empresa_id = p_emp AND NOT m.estornado AND x.usa
    UNION ALL
    -- frente de loja (v27): no fechamento do caixa, as vendas por forma (D conta caixa, C Vendas) e a diferença do dinheiro (Quebra de caixa)
    SELECT 'caixa_pdv', k.id, 'normal', k.data, 'Frente de loja — ' || pv.nome || ' — caixa ' || k.id || ' de ' || to_char(k.data, 'DD/MM/YYYY'),
           x.conta, x.centro, x.d, x.c, x.falta
      FROM caixas_pdv_lancamentos l
      JOIN caixas_pdv k ON k.id = l.caixa_id
      JOIN pontos_venda pv ON pv.id = k.ponto_venda_id
      LEFT JOIN cx ON cx.id = l.conta_caixa_id
      CROSS JOIN r
      CROSS JOIN LATERAL (VALUES
        (cx.conta, NULL::bigint, greatest(l.valor, 0), greatest(-l.valor, 0), 'conta contábil da conta caixa "' || cx.nome || '"'),
        (CASE l.tipo WHEN 'venda' THEN r.vendas ELSE r.quebra_caixa END, pv.centro_custo_id, greatest(-l.valor, 0), greatest(l.valor, 0),
         CASE l.tipo WHEN 'venda' THEN 'regra "Vendas"' ELSE 'regra "Quebra de caixa"' END)
      ) AS x(conta, centro, d, c, falta)
     WHERE l.empresa_id = p_emp
    UNION ALL
    -- estoque (v27): custo da venda (D CMV, C Estoque), venda cancelada (o contrário), ajustes e a diferença de custo
    -- quando uma nota com produto é cancelada (a nota sai pelo valor de entrada; o estoque, pelo custo médio)
    SELECT 'estoque', m.id, 'normal', m.data,
           CASE m.tipo WHEN 'venda' THEN 'Custo da venda — ' WHEN 'estorno_venda' THEN 'Venda cancelada — ' WHEN 'ajuste' THEN 'Ajuste de estoque — '
             ELSE 'Nota cancelada (diferença de custo) — ' END || pr.nome,
           x.conta, x.centro, x.d, x.c, x.falta
      FROM estoque_movimentos m
      JOIN produtos pr ON pr.id = m.produto_id
      LEFT JOIN vendas vd ON vd.id = m.venda_id
      LEFT JOIN caixas_pdv k ON k.id = vd.caixa_id
      LEFT JOIN pontos_venda pv ON pv.id = k.ponto_venda_id
      LEFT JOIN LATERAL (SELECT o.valor FROM estoque_movimentos o
                          WHERE m.tipo = 'estorno_nota' AND o.tipo = 'nota' AND o.documento_item_id = m.documento_item_id LIMIT 1) orig ON true
      CROSS JOIN r
      CROSS JOIN LATERAL (SELECT CASE m.tipo WHEN 'estorno_nota' THEN coalesce(orig.valor, 0) + m.valor ELSE m.valor END AS v,
                                 m.tipo IN ('venda', 'estorno_venda') AS de_venda) s
      CROSS JOIN LATERAL (VALUES
        (r.estoque, NULL::bigint, greatest(s.v, 0), greatest(-s.v, 0), 'regra "Estoque de mercadorias"'),
        (CASE WHEN s.de_venda THEN r.cmv ELSE r.ajuste_estoque END, CASE WHEN s.de_venda THEN pv.centro_custo_id END,
         greatest(-s.v, 0), greatest(s.v, 0),
         CASE WHEN s.de_venda THEN 'regra "Custo das mercadorias vendidas"' ELSE 'regra "Perdas e ajustes de estoque"' END)
      ) AS x(conta, centro, d, c, falta)
     WHERE m.empresa_id = p_emp AND m.tipo <> 'nota'
  )
  SELECT origem, origem_id, chave, data, historico, conta_id, centro, debito, credito,
         CASE WHEN conta_id IS NULL THEN falta END
    FROM ev
   WHERE debito + credito > 0;
$$;

REVOKE EXECUTE ON FUNCTION tributos_recuperar_item(jsonb, jsonb, numeric) FROM anon;
