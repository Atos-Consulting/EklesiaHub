-- ═════════════════════════════════════════════════════════════════════
-- EklesiaHub — migration v23: orçamento anual (despesas por centro de custo e receitas por tipo)
-- ═════════════════════════════════════════════════════════════════════
--  • orcamentos: um valor por mês (12) para cada centro de custo (despesa) ou tipo de receita
--    (dízimos, ofertas, campanhas, recebimentos, outras) de um ano. Na tela, digita-se o valor do ano
--    e o sistema divide por 12; quem quiser ajusta mês a mês. Só o Administrador grava
--    (salvar_orcamento); todos da igreja consultam.
--  • orcamento_realizado(ano): o que entrou e saiu de verdade (pelo extrato_caixa, regime de caixa, como
--    o Relatório do mês) e o que está em aberto (títulos com vencimento no ano), por mês. Pagamento de
--    nota se divide pelos centros de custo dos itens, na proporção do valor de cada item.
--  • O orçamento só avisa: nada é bloqueado quando um centro passa do previsto.
-- Rodar depois da v22.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Orçamento
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE orcamentos (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id          bigint NOT NULL REFERENCES empresas(id),
  ano                 integer NOT NULL CHECK (ano BETWEEN 2000 AND 2100),
  natureza            text NOT NULL CHECK (natureza IN ('despesa', 'receita')),
  centro_custo_id     bigint,
  categoria           text CHECK (categoria IN ('dizimo', 'oferta', 'campanha', 'recebimento', 'outras')),
  valores             numeric(15,2)[] NOT NULL,
  atualizado_por_nome text,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orcamentos_centro_fk FOREIGN KEY (centro_custo_id, empresa_id) REFERENCES centros_custo (id, empresa_id),
  CONSTRAINT orcamentos_chave_ck CHECK (
    (natureza = 'despesa' AND centro_custo_id IS NOT NULL AND categoria IS NULL)
    OR (natureza = 'receita' AND centro_custo_id IS NULL AND categoria IS NOT NULL)),
  CONSTRAINT orcamentos_valores_ck CHECK (
    cardinality(valores) = 12 AND array_position(valores, NULL) IS NULL AND 0 <= ALL (valores) AND 1000000000 > ALL (valores))
);
CREATE UNIQUE INDEX orcamentos_despesa_uq ON orcamentos (empresa_id, ano, centro_custo_id) WHERE natureza = 'despesa';
CREATE UNIQUE INDEX orcamentos_receita_uq ON orcamentos (empresa_id, ano, categoria) WHERE natureza = 'receita';

CREATE TRIGGER orcamentos_atualizado BEFORE UPDATE ON orcamentos
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
CREATE TRIGGER orcamentos_log_trg AFTER INSERT OR UPDATE OR DELETE ON orcamentos
  FOR EACH ROW EXECUTE FUNCTION registrar_log();

ALTER TABLE orcamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY orcamentos_select ON orcamentos FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
REVOKE ALL ON orcamentos FROM anon;
REVOKE INSERT, UPDATE, DELETE ON orcamentos FROM authenticated;
GRANT SELECT ON orcamentos TO authenticated;

-- Grava o orçamento inteiro do ano. p_linhas: [{ natureza, centro_custo_id | categoria, valores: [12 números] }].
-- Linha que não vier (ou vier toda zerada) sai do orçamento.
CREATE FUNCTION salvar_orcamento(p_ano integer, p_linhas jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp   bigint := minha_empresa_id();
  v_nome  text := (SELECT coalesce(nullif(btrim(nome), ''), email) FROM profiles WHERE user_id = auth.uid());
  l       jsonb;
  v_nat   text;
  v_cc    bigint;
  v_cat   text;
  v_vals  numeric(15,2)[];
  v_ids   bigint[] := '{}';
  v_id    bigint;
BEGIN
  IF v_emp IS NULL OR NOT tem_nivel('administrador') THEN
    RAISE EXCEPTION 'Somente o Administrador da igreja pode alterar o orçamento.' USING ERRCODE = '42501';
  END IF;
  IF p_ano IS NULL OR p_ano NOT BETWEEN 2000 AND 2100 THEN RAISE EXCEPTION 'Ano inválido.'; END IF;
  IF jsonb_typeof(coalesce(p_linhas, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'Orçamento inválido.'; END IF;
  IF jsonb_array_length(coalesce(p_linhas, '[]'::jsonb)) > 500 THEN RAISE EXCEPTION 'Linhas demais no orçamento.'; END IF;

  FOR l IN SELECT * FROM jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) LOOP
    v_nat := l->>'natureza';
    IF v_nat IS NULL OR v_nat NOT IN ('despesa', 'receita') THEN RAISE EXCEPTION 'Linha do orçamento sem natureza válida.'; END IF;
    IF jsonb_typeof(l->'valores') <> 'array' OR jsonb_array_length(l->'valores') <> 12
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(l->'valores') v WHERE jsonb_typeof(v) <> 'number') THEN
      RAISE EXCEPTION 'Cada linha do orçamento precisa dos 12 meses.';
    END IF;
    SELECT array_agg(round((v #>> '{}')::numeric, 2) ORDER BY n) INTO v_vals FROM jsonb_array_elements(l->'valores') WITH ORDINALITY AS a(v, n);
    IF EXISTS (SELECT 1 FROM unnest(v_vals) x WHERE x < 0 OR x >= 1000000000) THEN
      RAISE EXCEPTION 'Valor do orçamento fora do limite (de 0 a 999.999.999,99).';
    END IF;
    IF v_nat = 'despesa' THEN
      v_cc := (l->>'centro_custo_id')::bigint; v_cat := NULL;
      IF v_cc IS NULL OR NOT EXISTS (SELECT 1 FROM centros_custo WHERE id = v_cc AND empresa_id = v_emp) THEN
        RAISE EXCEPTION 'Centro de custo do orçamento não encontrado.';
      END IF;
    ELSE
      v_cc := NULL; v_cat := l->>'categoria';
      IF v_cat IS NULL OR v_cat NOT IN ('dizimo', 'oferta', 'campanha', 'recebimento', 'outras') THEN
        RAISE EXCEPTION 'Tipo de receita do orçamento inválido.';
      END IF;
    END IF;
    IF (SELECT sum(x) FROM unnest(v_vals) x) = 0 THEN CONTINUE; END IF; -- zerada = fora do orçamento

    SELECT id INTO v_id FROM orcamentos
     WHERE empresa_id = v_emp AND ano = p_ano AND natureza = v_nat
       AND centro_custo_id IS NOT DISTINCT FROM v_cc AND categoria IS NOT DISTINCT FROM v_cat;
    IF v_id = ANY (v_ids) THEN RAISE EXCEPTION 'O mesmo centro de custo ou tipo de receita aparece duas vezes no orçamento.'; END IF;
    IF v_id IS NULL THEN
      INSERT INTO orcamentos (empresa_id, ano, natureza, centro_custo_id, categoria, valores, atualizado_por_nome)
      VALUES (v_emp, p_ano, v_nat, v_cc, v_cat, v_vals, v_nome) RETURNING id INTO v_id;
    ELSE
      UPDATE orcamentos SET valores = v_vals, atualizado_por_nome = v_nome WHERE id = v_id AND valores IS DISTINCT FROM v_vals;
    END IF;
    v_ids := v_ids || v_id;
  END LOOP;

  DELETE FROM orcamentos WHERE empresa_id = v_emp AND ano = p_ano AND NOT (id = ANY (v_ids));
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Realizado e em aberto
-- ─────────────────────────────────────────────────────────────────────

-- Por mês do ano: realizado (extrato_caixa, sem transferências) e em aberto (títulos com vencimento no ano).
-- Despesa: chave = centro de custo (nulo = sem centro). Receita: chave = categoria.
-- SECURITY INVOKER: as views e tabelas já filtram pela igreja do usuário (RLS).
CREATE FUNCTION orcamento_realizado(p_ano integer)
RETURNS TABLE (natureza text, centro_custo_id bigint, categoria text, mes integer, realizado numeric, aberto numeric)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH periodo AS (SELECT make_date(p_ano, 1, 1) AS de, make_date(p_ano, 12, 31) AS ate),
  -- peso de cada centro de custo dentro de cada nota (itens sem centro ficam com o centro do título)
  pesos AS (
    SELECT t.id AS titulo_id, coalesce(i.centro_custo_id, t.centro_custo_id) AS centro,
           sum(i.valor_total) / nullif(sum(sum(i.valor_total)) OVER (PARTITION BY t.id), 0) AS peso
      FROM titulos_financeiros t
      JOIN documento_entrada_itens i ON i.documento_id = t.documento_id
     WHERE t.natureza = 'pagar' AND t.documento_id IS NOT NULL
     GROUP BY t.id, coalesce(i.centro_custo_id, t.centro_custo_id)
  ),
  ext AS (
    SELECT x.* FROM extrato_caixa x, periodo
     WHERE x.data BETWEEN periodo.de AND periodo.ate
       AND x.origem NOT IN ('transferencia_saida', 'transferencia_entrada')
  ),
  -- despesas pagas: pagamentos (divididos pelos itens da nota) e saídas avulsas
  desp AS (
    SELECT coalesce(pw.centro, t.centro_custo_id) AS centro, x.data,
           round(-x.valor * coalesce(pw.peso, 1), 2) AS valor
      FROM ext x
      JOIN pagamentos p ON p.id = x.ref_id
      JOIN titulos_financeiros t ON t.id = p.titulo_id
      LEFT JOIN pesos pw ON pw.titulo_id = t.id
     WHERE x.origem = 'pagamento'
    UNION ALL
    SELECT m.centro_custo_id, x.data, -x.valor
      FROM ext x JOIN movimentos_caixa m ON m.id = x.ref_id
     WHERE x.origem = 'saida'
  ),
  rec AS (
    SELECT CASE x.origem
             WHEN 'entrada' THEN CASE WHEN x.subtipo IN ('dizimo', 'oferta', 'campanha') THEN x.subtipo ELSE 'outras' END
             WHEN 'recebimento' THEN 'recebimento'
             ELSE 'outras' END AS cat,
           x.data, x.valor
      FROM ext x
     WHERE x.origem IN ('entrada', 'recebimento', 'entrada_avulsa')
  ),
  ab_desp AS (
    SELECT coalesce(pw.centro, t.centro_custo_id) AS centro, t.vencimento AS data, round(t.valor * coalesce(pw.peso, 1), 2) AS valor
      FROM titulos_financeiros t
      LEFT JOIN pesos pw ON pw.titulo_id = t.id, periodo
     WHERE t.natureza = 'pagar' AND t.status = 'aberto' AND t.vencimento BETWEEN periodo.de AND periodo.ate
  ),
  ab_rec AS (
    SELECT t.vencimento AS data, t.valor
      FROM titulos_financeiros t, periodo
     WHERE t.natureza = 'receber' AND t.status = 'aberto' AND t.vencimento BETWEEN periodo.de AND periodo.ate
  ),
  tudo AS (
    SELECT 'despesa' AS natureza, centro, NULL::text AS cat, data, valor AS realizado, 0::numeric AS aberto FROM desp
    UNION ALL SELECT 'despesa', centro, NULL, data, 0, valor FROM ab_desp
    UNION ALL SELECT 'receita', NULL, cat, data, valor, 0 FROM rec
    UNION ALL SELECT 'receita', NULL, 'recebimento', data, 0, valor FROM ab_rec
  )
  SELECT natureza, centro, cat, extract(month FROM data)::integer, sum(realizado), sum(aberto)
    FROM tudo
   GROUP BY natureza, centro, cat, extract(month FROM data)::integer
$$;

REVOKE EXECUTE ON FUNCTION salvar_orcamento(integer, jsonb), orcamento_realizado(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION salvar_orcamento(integer, jsonb), orcamento_realizado(integer) TO authenticated;
