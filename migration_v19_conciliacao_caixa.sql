-- ═════════════════════════════════════════════════════════════════════
-- EklesiaHub — migration v19: conciliação de caixa
-- ═════════════════════════════════════════════════════════════════════
-- O tesoureiro confere o saldo de uma conta caixa num dia com o extrato do banco (ou a contagem do
-- cofre) e marca a conta como conciliada até aquele dia (Financeiro → Caixa → Conciliação).
--  • Só concilia se bater: o saldo informado tem de ser igual a saldo_caixa_ate(conta, dia).
--  • A data de uma conciliação nova vem depois da última conciliação ativa da conta.
--  • Período conciliado fica travado: nada é lançado nem estornado com data até o dia conciliado
--    naquela conta (entradas, pagamentos/recebimentos, movimentos), e o saldo inicial da conta
--    não muda. Para corrigir, o Administrador desfaz a última conciliação, com motivo.
-- conciliar_caixa: Supervisor ou Administrador. desfazer_conciliacao: só Administrador.
-- Rodar depois da v18.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Conciliações
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE conciliacoes_caixa (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id          bigint NOT NULL REFERENCES empresas(id),
  conta_caixa_id      bigint NOT NULL,
  data                date NOT NULL,
  saldo               numeric(15,2) NOT NULL,
  observacao          text CHECK (observacao IS NULL OR length(observacao) <= 300),
  conciliado_por      uuid,
  conciliado_por_nome text,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  desfeita            boolean NOT NULL DEFAULT false,
  desfeita_por        uuid,
  desfeita_por_nome   text,
  desfeita_em         timestamptz,
  motivo_desfazer     text,
  CONSTRAINT conciliacoes_caixa_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT conciliacoes_caixa_conta_fk FOREIGN KEY (conta_caixa_id, empresa_id) REFERENCES contas_caixa (id, empresa_id),
  CONSTRAINT conciliacoes_caixa_desfeita_ck CHECK (NOT desfeita OR length(btrim(coalesce(motivo_desfazer, ''))) >= 5)
);
CREATE UNIQUE INDEX conciliacoes_caixa_ativa_uq ON conciliacoes_caixa (conta_caixa_id, data) WHERE NOT desfeita;
CREATE INDEX conciliacoes_caixa_conta_idx ON conciliacoes_caixa (conta_caixa_id, data DESC) WHERE NOT desfeita;

CREATE TRIGGER conciliacoes_caixa_log_trg AFTER INSERT OR UPDATE OR DELETE ON conciliacoes_caixa
  FOR EACH ROW EXECUTE FUNCTION registrar_log();

ALTER TABLE conciliacoes_caixa ENABLE ROW LEVEL SECURITY;
CREATE POLICY conciliacoes_caixa_select ON conciliacoes_caixa FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
REVOKE ALL ON conciliacoes_caixa FROM anon;
REVOKE INSERT, UPDATE, DELETE ON conciliacoes_caixa FROM authenticated;
GRANT SELECT ON conciliacoes_caixa TO authenticated;

-- Último dia conciliado da conta (nulo se nunca foi conciliada). Uso interno (gatilhos e RPCs).
CREATE FUNCTION ultimo_dia_conciliado(p_conta bigint) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT max(data) FROM conciliacoes_caixa WHERE conta_caixa_id = p_conta AND NOT desfeita;
$$;
-- Versão para a tela: só enxerga contas da igreja do usuário.
CREATE FUNCTION conciliado_ate(p_conta bigint) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT max(data) FROM conciliacoes_caixa WHERE conta_caixa_id = p_conta AND empresa_id = minha_empresa_id() AND NOT desfeita;
$$;
CREATE FUNCTION moeda_br(v numeric) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'R$ ' || replace(to_char(v, 'FM999999999990.00'), '.', ',');
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Trava do período conciliado
-- ─────────────────────────────────────────────────────────────────────

CREATE FUNCTION conferir_conciliacao(p_conta bigint, p_data date) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ate date;
BEGIN
  IF p_conta IS NULL OR p_data IS NULL THEN RETURN; END IF;
  v_ate := ultimo_dia_conciliado(p_conta);
  IF v_ate IS NOT NULL AND p_data <= v_ate THEN
    RAISE EXCEPTION 'A conta "%" está conciliada até %: não é possível lançar nem estornar com data até esse dia. Para corrigir, um Administrador desfaz a conciliação.',
      (SELECT nome FROM contas_caixa WHERE id = p_conta), to_char(v_ate, 'DD/MM/YYYY');
  END IF;
END;
$$;

CREATE FUNCTION entradas_conciliacao() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN PERFORM conferir_conciliacao(OLD.conta_caixa_id, OLD.data); END IF;
  PERFORM conferir_conciliacao(NEW.conta_caixa_id, NEW.data);
  RETURN NEW;
END;
$$;
CREATE TRIGGER entradas_conciliacao_trg BEFORE INSERT OR UPDATE ON entradas
  FOR EACH ROW EXECUTE FUNCTION entradas_conciliacao();

CREATE FUNCTION pagamentos_conciliacao() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN PERFORM conferir_conciliacao(OLD.conta_caixa_id, OLD.data_pagamento); END IF;
  PERFORM conferir_conciliacao(NEW.conta_caixa_id, NEW.data_pagamento);
  RETURN NEW;
END;
$$;
CREATE TRIGGER pagamentos_conciliacao_trg BEFORE INSERT OR UPDATE ON pagamentos
  FOR EACH ROW EXECUTE FUNCTION pagamentos_conciliacao();

CREATE FUNCTION movimentos_conciliacao() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    PERFORM conferir_conciliacao(OLD.conta_origem_id, OLD.data);
    PERFORM conferir_conciliacao(OLD.conta_destino_id, OLD.data);
  END IF;
  PERFORM conferir_conciliacao(NEW.conta_origem_id, NEW.data);
  PERFORM conferir_conciliacao(NEW.conta_destino_id, NEW.data);
  RETURN NEW;
END;
$$;
CREATE TRIGGER movimentos_caixa_conciliacao_trg BEFORE INSERT OR UPDATE ON movimentos_caixa
  FOR EACH ROW EXECUTE FUNCTION movimentos_conciliacao();

-- Saldo inicial e data do saldo inicial mudam todo o histórico: travados depois da 1ª conciliação.
CREATE FUNCTION contas_caixa_conciliacao() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.saldo_inicial IS DISTINCT FROM OLD.saldo_inicial OR NEW.data_saldo_inicial IS DISTINCT FROM OLD.data_saldo_inicial)
     AND ultimo_dia_conciliado(OLD.id) IS NOT NULL THEN
    RAISE EXCEPTION 'A conta "%" já foi conciliada: o saldo inicial e a data do saldo inicial não podem mudar. Para corrigir, desfaça as conciliações.', OLD.nome;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER contas_caixa_conciliacao_trg BEFORE UPDATE OF saldo_inicial, data_saldo_inicial ON contas_caixa
  FOR EACH ROW EXECUTE FUNCTION contas_caixa_conciliacao();

-- ─────────────────────────────────────────────────────────────────────
-- 3. Conciliar e desfazer
-- ─────────────────────────────────────────────────────────────────────

CREATE FUNCTION conciliar_caixa(p_conta bigint, p_data date, p_saldo numeric, p_observacao text DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa bigint := minha_empresa_id();
  cx        contas_caixa%ROWTYPE;
  v_ultima  date;
  v_sistema numeric(15,2);
  v_saldo   numeric(15,2) := round(p_saldo, 2);
  v_id      bigint;
BEGIN
  IF NOT tem_nivel('administrador', 'supervisor') THEN
    RAISE EXCEPTION 'Somente Supervisor ou Administrador pode conciliar o caixa.';
  END IF;
  SELECT * INTO cx FROM contas_caixa WHERE id = p_conta AND empresa_id = v_empresa FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta caixa não encontrada.'; END IF;
  IF p_data IS NULL THEN RAISE EXCEPTION 'Informe o dia da conciliação.'; END IF;
  IF p_data > current_date THEN RAISE EXCEPTION 'Não é possível conciliar um dia futuro.'; END IF;
  IF p_data < cx.data_saldo_inicial THEN
    RAISE EXCEPTION 'O dia é anterior ao saldo inicial da conta "%" (%).', cx.nome, to_char(cx.data_saldo_inicial, 'DD/MM/YYYY');
  END IF;
  IF v_saldo IS NULL THEN RAISE EXCEPTION 'Informe o saldo do extrato.'; END IF;
  IF length(p_observacao) > 300 THEN RAISE EXCEPTION 'A observação pode ter no máximo 300 caracteres.'; END IF;
  v_ultima := ultimo_dia_conciliado(p_conta);
  IF v_ultima IS NOT NULL AND p_data <= v_ultima THEN
    RAISE EXCEPTION 'A conta "%" já está conciliada até %. Escolha um dia depois desse.', cx.nome, to_char(v_ultima, 'DD/MM/YYYY');
  END IF;
  v_sistema := saldo_caixa_ate(p_conta, p_data);
  IF v_sistema <> v_saldo THEN
    RAISE EXCEPTION 'O saldo informado (%) não bate com o saldo do sistema em % (%). Diferença: %.',
      moeda_br(v_saldo), to_char(p_data, 'DD/MM/YYYY'), moeda_br(v_sistema), moeda_br(v_saldo - v_sistema);
  END IF;

  INSERT INTO conciliacoes_caixa (empresa_id, conta_caixa_id, data, saldo, observacao, conciliado_por, conciliado_por_nome)
  VALUES (v_empresa, p_conta, p_data, v_saldo, nullif(btrim(coalesce(p_observacao, '')), ''), auth.uid(),
          (SELECT coalesce(nullif(btrim(nome), ''), email) FROM profiles WHERE user_id = auth.uid()))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Desfaz a conciliação mais recente (ativa) da conta, liberando o período desde a anterior.
CREATE FUNCTION desfazer_conciliacao(p_conciliacao bigint, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c conciliacoes_caixa%ROWTYPE;
BEGIN
  IF NOT tem_nivel('administrador') THEN
    RAISE EXCEPTION 'Somente o Administrador pode desfazer uma conciliação.';
  END IF;
  IF length(btrim(coalesce(p_motivo, ''))) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo (mínimo de 5 caracteres).';
  END IF;
  IF length(btrim(p_motivo)) > 300 THEN RAISE EXCEPTION 'O motivo pode ter no máximo 300 caracteres.'; END IF;
  SELECT * INTO c FROM conciliacoes_caixa WHERE id = p_conciliacao AND empresa_id = minha_empresa_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conciliação não encontrada.'; END IF;
  IF c.desfeita THEN RAISE EXCEPTION 'Esta conciliação já foi desfeita.'; END IF;
  IF c.data < ultimo_dia_conciliado(c.conta_caixa_id) THEN
    RAISE EXCEPTION 'Só é possível desfazer a conciliação mais recente da conta. Desfaça antes a de %.',
      to_char(ultimo_dia_conciliado(c.conta_caixa_id), 'DD/MM/YYYY');
  END IF;
  UPDATE conciliacoes_caixa SET desfeita = true, desfeita_por = auth.uid(), desfeita_em = now(), motivo_desfazer = btrim(p_motivo),
         desfeita_por_nome = (SELECT coalesce(nullif(btrim(nome), ''), email) FROM profiles WHERE user_id = auth.uid())
   WHERE id = c.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION conciliado_ate(bigint), ultimo_dia_conciliado(bigint), conferir_conciliacao(bigint, date),
  conciliar_caixa(bigint, date, numeric, text), desfazer_conciliacao(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION conciliado_ate(bigint), conciliar_caixa(bigint, date, numeric, text), desfazer_conciliacao(bigint, text) TO authenticated;
