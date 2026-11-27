-- ═════════════════════════════════════════════════════════════════════
-- EklesiaHub — migration v24: fechamento do mês
-- ═════════════════════════════════════════════════════════════════════
-- Financeiro → Caixa → Fechamento do mês. O tesoureiro confere e fecha o mês inteiro, de uma vez.
--  • Para fechar: o mês já terminou, é o mês seguinte ao último fechado (o primeiro fechamento pode ser
--    qualquer mês) e todas as contas caixa estão com o Fechamento do dia (conciliação) em dia: nenhum
--    lançamento da conta, até o fim do mês, depois do último dia conciliado.
--  • Ao fechar, guarda um resumo (saldos de cada conta, entradas, saídas, transferências) e trava o
--    período: nada que mexa em saldo é lançado nem estornado com data até o fim do mês, em nenhuma conta
--    (inclusive contas novas), o saldo inicial de conta não volta para dentro do período e nenhuma
--    conciliação do período é desfeita.
--  • Notas em rascunho, saídas sem centro de custo e contas vencidas em aberto só geram aviso (tela).
--  • fechar_mes: Supervisor ou Administrador. reabrir_mes: só Administrador, com motivo, e só o mais recente.
-- Rodar depois da v23.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Fechamentos
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE fechamentos_mes (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id         bigint NOT NULL REFERENCES empresas(id),
  mes                date NOT NULL CHECK (extract(day FROM mes) = 1),
  resumo             jsonb NOT NULL,
  observacao         text CHECK (observacao IS NULL OR length(observacao) <= 500),
  fechado_por        uuid,
  fechado_por_nome   text,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  reaberto           boolean NOT NULL DEFAULT false,
  reaberto_por       uuid,
  reaberto_por_nome  text,
  reaberto_em        timestamptz,
  motivo_reabertura  text,
  CONSTRAINT fechamentos_mes_reaberto_ck CHECK (NOT reaberto OR length(btrim(coalesce(motivo_reabertura, ''))) >= 5)
);
CREATE UNIQUE INDEX fechamentos_mes_ativo_uq ON fechamentos_mes (empresa_id, mes) WHERE NOT reaberto;

CREATE TRIGGER fechamentos_mes_log_trg AFTER INSERT OR UPDATE OR DELETE ON fechamentos_mes
  FOR EACH ROW EXECUTE FUNCTION registrar_log();

ALTER TABLE fechamentos_mes ENABLE ROW LEVEL SECURITY;
CREATE POLICY fechamentos_mes_select ON fechamentos_mes FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
REVOKE ALL ON fechamentos_mes FROM anon;
REVOKE INSERT, UPDATE, DELETE ON fechamentos_mes FROM authenticated;
GRANT SELECT ON fechamentos_mes TO authenticated;

-- Último dia do último mês fechado da igreja (nulo se nenhum). Uso interno.
CREATE FUNCTION fechado_ate_empresa(p_empresa bigint) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (max(mes) + interval '1 month' - interval '1 day')::date FROM fechamentos_mes WHERE empresa_id = p_empresa AND NOT reaberto;
$$;
-- Versão para a tela.
CREATE FUNCTION mes_fechado_ate() RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT fechado_ate_empresa(minha_empresa_id());
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Trava do período fechado
-- ─────────────────────────────────────────────────────────────────────

-- A trava de conciliação (v19) roda em entradas, pagamentos e movimentos: passa a conferir também o mês fechado.
CREATE OR REPLACE FUNCTION conferir_conciliacao(p_conta bigint, p_data date) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ate date;
  v_fim date;
BEGIN
  IF p_conta IS NULL OR p_data IS NULL THEN RETURN; END IF;
  v_fim := fechado_ate_empresa((SELECT empresa_id FROM contas_caixa WHERE id = p_conta));
  IF v_fim IS NOT NULL AND p_data <= v_fim THEN
    RAISE EXCEPTION 'O mês de % está fechado: não é possível lançar nem estornar com data até %. Para corrigir, um Administrador reabre o mês.',
      to_char(date_trunc('month', v_fim), 'MM/YYYY'), to_char(v_fim, 'DD/MM/YYYY');
  END IF;
  v_ate := ultimo_dia_conciliado(p_conta);
  IF v_ate IS NOT NULL AND p_data <= v_ate THEN
    RAISE EXCEPTION 'A conta "%" está conciliada até %: não é possível lançar nem estornar com data até esse dia. Para corrigir, um Administrador desfaz a conciliação.',
      (SELECT nome FROM contas_caixa WHERE id = p_conta), to_char(v_ate, 'DD/MM/YYYY');
  END IF;
END;
$$;

-- Conta nova ou saldo inicial não podem cair dentro do período fechado (mudariam os saldos já fechados).
CREATE FUNCTION contas_caixa_fechamento() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fim date := fechado_ate_empresa(NEW.empresa_id);
BEGIN
  IF v_fim IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.data_saldo_inicial <= v_fim THEN
    RAISE EXCEPTION 'O mês de % está fechado: a data do saldo inicial precisa ser depois de %.',
      to_char(date_trunc('month', v_fim), 'MM/YYYY'), to_char(v_fim, 'DD/MM/YYYY');
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.saldo_inicial IS DISTINCT FROM OLD.saldo_inicial OR NEW.data_saldo_inicial IS DISTINCT FROM OLD.data_saldo_inicial)
     AND least(OLD.data_saldo_inicial, NEW.data_saldo_inicial) <= v_fim THEN
    RAISE EXCEPTION 'O mês de % está fechado: o saldo inicial da conta "%" não pode mudar. Para corrigir, um Administrador reabre o mês.',
      to_char(date_trunc('month', v_fim), 'MM/YYYY'), OLD.nome;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER contas_caixa_fechamento_trg BEFORE INSERT OR UPDATE OF saldo_inicial, data_saldo_inicial ON contas_caixa
  FOR EACH ROW EXECUTE FUNCTION contas_caixa_fechamento();

-- Conciliação de um dia dentro do período fechado não é desfeita.
CREATE FUNCTION conciliacoes_caixa_fechamento() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fim date := fechado_ate_empresa(OLD.empresa_id);
BEGIN
  IF NEW.desfeita AND NOT OLD.desfeita AND v_fim IS NOT NULL AND OLD.data <= v_fim THEN
    RAISE EXCEPTION 'O mês de % está fechado: a conciliação de % não pode ser desfeita. Um Administrador precisa reabrir o mês antes.',
      to_char(date_trunc('month', v_fim), 'MM/YYYY'), to_char(OLD.data, 'DD/MM/YYYY');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER conciliacoes_caixa_fechamento_trg BEFORE UPDATE OF desfeita ON conciliacoes_caixa
  FOR EACH ROW EXECUTE FUNCTION conciliacoes_caixa_fechamento();

-- ─────────────────────────────────────────────────────────────────────
-- 3. Conferir, fechar e reabrir
-- ─────────────────────────────────────────────────────────────────────

-- O que a tela mostra antes de fechar (e o que fechar_mes confere). p_mes: qualquer dia do mês.
-- Devolve: mes, fim, fechado (já fechado?), proximo (mês que pode ser fechado agora), terminou,
-- contas [{id, nome, ativo, conciliado_ate, ultimo_lancamento, pendente, saldo_anterior, entradas, saidas,
-- transferencias, saldo_final}], totais, e os avisos (rascunhos, sem_centro, vencidos).
CREATE FUNCTION conferir_fechamento_mes(p_mes date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp    bigint := minha_empresa_id();
  v_ini    date := date_trunc('month', p_mes)::date;
  v_fim    date := (date_trunc('month', p_mes) + interval '1 month' - interval '1 day')::date;
  v_ult    date;
  v_prox   date;
  v_contas jsonb;
BEGIN
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Sem igreja.' USING ERRCODE = '42501'; END IF;
  IF p_mes IS NULL THEN RAISE EXCEPTION 'Informe o mês.'; END IF;
  SELECT max(mes) INTO v_ult FROM fechamentos_mes WHERE empresa_id = v_emp AND NOT reaberto;
  v_prox := CASE WHEN v_ult IS NULL THEN NULL ELSE (v_ult + interval '1 month')::date END;

  WITH ext AS (
    SELECT x.conta_caixa_id, x.data, x.valor, x.origem FROM extrato_caixa x WHERE x.empresa_id = v_emp AND x.data <= v_fim
  ),
  cc AS (
    SELECT c.id, c.nome, c.ativo, c.saldo_inicial, c.data_saldo_inicial, ultimo_dia_conciliado(c.id) AS conc
      FROM contas_caixa c WHERE c.empresa_id = v_emp AND c.data_saldo_inicial <= v_fim -- conta aberta depois do mês fica de fora
  ),
  linhas AS (
    SELECT cc.id, cc.nome, cc.ativo, cc.conc,
           (SELECT max(e.data) FROM ext e WHERE e.conta_caixa_id = cc.id) AS ultimo,
           EXISTS (SELECT 1 FROM ext e WHERE e.conta_caixa_id = cc.id AND (cc.conc IS NULL OR e.data > cc.conc)) AS pendente,
           -- como saldo_caixa_ate() e o Relatório do mês: o saldo inicial conta desde o começo
           cc.saldo_inicial + coalesce((SELECT sum(e.valor) FROM ext e WHERE e.conta_caixa_id = cc.id AND e.data < v_ini), 0) AS anterior,
           coalesce((SELECT sum(e.valor) FROM ext e WHERE e.conta_caixa_id = cc.id AND e.data >= v_ini AND e.valor > 0
                       AND e.origem NOT IN ('transferencia_saida', 'transferencia_entrada')), 0) AS entradas,
           coalesce((SELECT -sum(e.valor) FROM ext e WHERE e.conta_caixa_id = cc.id AND e.data >= v_ini AND e.valor < 0
                       AND e.origem NOT IN ('transferencia_saida', 'transferencia_entrada')), 0) AS saidas,
           coalesce((SELECT sum(e.valor) FROM ext e WHERE e.conta_caixa_id = cc.id AND e.data >= v_ini
                       AND e.origem IN ('transferencia_saida', 'transferencia_entrada')), 0) AS transf,
           cc.saldo_inicial + coalesce((SELECT sum(e.valor) FROM ext e WHERE e.conta_caixa_id = cc.id), 0) AS final
      FROM cc
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'nome', nome, 'ativo', ativo, 'conciliado_ate', conc, 'ultimo_lancamento', ultimo, 'pendente', pendente,
           'saldo_anterior', round(anterior, 2), 'entradas', round(entradas, 2), 'saidas', round(saidas, 2),
           'transferencias', round(transf, 2), 'saldo_final', round(final, 2)) ORDER BY nome), '[]'::jsonb)
    INTO v_contas
    FROM linhas
   WHERE ativo OR pendente OR anterior <> 0 OR final <> 0 OR entradas <> 0 OR saidas <> 0 OR transf <> 0;

  RETURN jsonb_build_object(
    'mes', v_ini, 'fim', v_fim,
    'fechado', EXISTS (SELECT 1 FROM fechamentos_mes WHERE empresa_id = v_emp AND mes = v_ini AND NOT reaberto),
    'ultimo_fechado', v_ult, 'proximo', v_prox,
    'terminou', v_fim < current_date,
    'contas', v_contas,
    'totais', jsonb_build_object(
      'saldo_anterior', (SELECT coalesce(sum((c->>'saldo_anterior')::numeric), 0) FROM jsonb_array_elements(v_contas) c),
      'entradas', (SELECT coalesce(sum((c->>'entradas')::numeric), 0) FROM jsonb_array_elements(v_contas) c),
      'saidas', (SELECT coalesce(sum((c->>'saidas')::numeric), 0) FROM jsonb_array_elements(v_contas) c),
      'saldo_final', (SELECT coalesce(sum((c->>'saldo_final')::numeric), 0) FROM jsonb_array_elements(v_contas) c)),
    'rascunhos', (SELECT count(*) FROM documentos_entrada WHERE empresa_id = v_emp AND status = 'rascunho' AND data_emissao <= v_fim),
    'sem_centro', (
      SELECT jsonb_build_object('qtd', count(*), 'valor', coalesce(sum(v), 0)) FROM (
        SELECT m.valor AS v FROM movimentos_caixa m
         WHERE m.empresa_id = v_emp AND m.tipo = 'saida' AND NOT m.estornado AND m.centro_custo_id IS NULL AND m.data BETWEEN v_ini AND v_fim
        UNION ALL
        SELECT p.valor_pago FROM pagamentos p JOIN titulos_financeiros t ON t.id = p.titulo_id
         WHERE p.empresa_id = v_emp AND t.natureza = 'pagar' AND NOT p.estornado AND p.data_pagamento BETWEEN v_ini AND v_fim
           AND t.centro_custo_id IS NULL
           AND (t.documento_id IS NULL OR EXISTS (SELECT 1 FROM documento_entrada_itens i WHERE i.documento_id = t.documento_id AND i.centro_custo_id IS NULL))
      ) s),
    'vencidos', (
      SELECT jsonb_build_object('qtd', count(*), 'valor', coalesce(sum(valor), 0)) FROM titulos_financeiros
       WHERE empresa_id = v_emp AND natureza = 'pagar' AND status = 'aberto' AND vencimento <= v_fim)
  );
END;
$$;

CREATE FUNCTION fechar_mes(p_mes date, p_observacao text DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp  bigint := minha_empresa_id();
  v_ini  date := date_trunc('month', p_mes)::date;
  v_conf jsonb;
  v_pend text;
  v_id   bigint;
BEGIN
  IF v_emp IS NULL OR NOT tem_nivel('administrador', 'supervisor') THEN
    RAISE EXCEPTION 'Somente Supervisor ou Administrador pode fechar o mês.' USING ERRCODE = '42501';
  END IF;
  IF p_mes IS NULL THEN RAISE EXCEPTION 'Informe o mês.'; END IF;
  IF length(p_observacao) > 500 THEN RAISE EXCEPTION 'A observação pode ter no máximo 500 caracteres.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('fechar_mes:' || v_emp, 0)); -- dois fechamentos ao mesmo tempo
  v_conf := conferir_fechamento_mes(v_ini);
  IF (v_conf->>'fechado')::boolean THEN RAISE EXCEPTION 'O mês de % já está fechado.', to_char(v_ini, 'MM/YYYY'); END IF;
  IF NOT (v_conf->>'terminou')::boolean THEN RAISE EXCEPTION 'O mês de % ainda não terminou.', to_char(v_ini, 'MM/YYYY'); END IF;
  IF v_conf->>'proximo' IS NOT NULL AND (v_conf->>'proximo')::date <> v_ini THEN
    RAISE EXCEPTION 'Os meses fecham em ordem: o próximo a fechar é %.', to_char((v_conf->>'proximo')::date, 'MM/YYYY');
  END IF;
  SELECT string_agg(c->>'nome', ', ') INTO v_pend FROM jsonb_array_elements(v_conf->'contas') c WHERE (c->>'pendente')::boolean;
  IF v_pend IS NOT NULL THEN
    RAISE EXCEPTION 'Faça o Fechamento do dia até % destas contas antes de fechar o mês: %.', to_char((v_conf->>'fim')::date, 'DD/MM/YYYY'), v_pend;
  END IF;

  INSERT INTO fechamentos_mes (empresa_id, mes, resumo, observacao, fechado_por, fechado_por_nome)
  VALUES (v_emp, v_ini, jsonb_build_object('contas', v_conf->'contas', 'totais', v_conf->'totais'),
          nullif(btrim(coalesce(p_observacao, '')), ''), auth.uid(),
          (SELECT coalesce(nullif(btrim(nome), ''), email) FROM profiles WHERE user_id = auth.uid()))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION reabrir_mes(p_fechamento bigint, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  f fechamentos_mes%ROWTYPE;
BEGIN
  IF NOT tem_nivel('administrador') THEN
    RAISE EXCEPTION 'Somente o Administrador pode reabrir um mês.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo (mínimo de 5 caracteres).'; END IF;
  IF length(btrim(p_motivo)) > 300 THEN RAISE EXCEPTION 'O motivo pode ter no máximo 300 caracteres.'; END IF;
  SELECT * INTO f FROM fechamentos_mes WHERE id = p_fechamento AND empresa_id = minha_empresa_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fechamento não encontrado.'; END IF;
  IF f.reaberto THEN RAISE EXCEPTION 'Este mês já foi reaberto.'; END IF;
  IF EXISTS (SELECT 1 FROM fechamentos_mes WHERE empresa_id = f.empresa_id AND NOT reaberto AND mes > f.mes) THEN
    RAISE EXCEPTION 'Só é possível reabrir o último mês fechado. Reabra antes os meses seguintes.';
  END IF;
  UPDATE fechamentos_mes SET reaberto = true, reaberto_por = auth.uid(), reaberto_em = now(), motivo_reabertura = btrim(p_motivo),
         reaberto_por_nome = (SELECT coalesce(nullif(btrim(nome), ''), email) FROM profiles WHERE user_id = auth.uid())
   WHERE id = f.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION fechado_ate_empresa(bigint), mes_fechado_ate(), conferir_fechamento_mes(date),
  fechar_mes(date, text), reabrir_mes(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mes_fechado_ate(), conferir_fechamento_mes(date), fechar_mes(date, text), reabrir_mes(bigint, text) TO authenticated;
