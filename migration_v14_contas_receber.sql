-- ═════════════════════════════════════════════════════════════════════
-- EklesiaHub — migration v14: contas a receber
-- ═════════════════════════════════════════════════════════════════════
-- Contas a receber usam as mesmas tabelas das contas a pagar (titulos_financeiros com natureza 'receber'
-- e pagamentos como registro do recebimento), para o extrato, o estorno e os logs valerem para as duas.
-- 1. natureza passa a aceitar 'receber'.
-- 2. criar_contas_receber: lança uma conta (aluguel do espaço, evento, repasse...) em uma ou mais parcelas,
--    com vencimento mensal ou a cada N dias. Valor informado pode ser o total ou o de cada parcela.
-- 3. receber_titulo (baixa: o valor entra na conta caixa) e cancelar_titulo_receber (só em aberto).
--    pagar_titulo passa a recusar título a receber. estornar_pagamento e atualizar_titulo valem para os dois.
-- 4. View titulos_receber (mesmas colunas de titulos_pagar: fornecedor_* = pessoa que deve à igreja).
-- 5. extrato_caixa: recebimento soma, pagamento subtrai.
-- Registrar, receber e cancelar: Supervisor ou Administrador. Rodar depois da v13.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Natureza
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE titulos_financeiros DROP CONSTRAINT titulos_financeiros_natureza_check;
ALTER TABLE titulos_financeiros ADD CONSTRAINT titulos_financeiros_natureza_check CHECK (natureza IN ('pagar', 'receber'));
-- Título a receber não nasce de nota de entrada.
ALTER TABLE titulos_financeiros ADD CONSTRAINT titulos_financeiros_receber_sem_nota_ck
  CHECK (natureza = 'pagar' OR documento_id IS NULL);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Lançar conta a receber
-- ─────────────────────────────────────────────────────────────────────
-- p_dados: {pessoa_id, descricao, emissao?, valor, valor_por: 'total'|'parcela', parcelas, primeiro_vencimento,
--           periodicidade: 'mensal'|'dias', intervalo_dias?, forma_pagamento?, conta_caixa_id?, centro_custo_id?, observacao?}
-- Valor total: divide em centavos e a sobra vai para a 1ª parcela (mesma regra das notas).
-- Mensal: mesmo dia nos meses seguintes (dia 31 vira o último dia dos meses mais curtos).
CREATE FUNCTION criar_contas_receber(p_dados jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa  bigint := minha_empresa_id();
  v_pessoa   bigint := nullif(p_dados->>'pessoa_id', '')::bigint;
  v_desc     text := nullif(btrim(coalesce(p_dados->>'descricao', '')), '');
  v_obs      text := nullif(btrim(coalesce(p_dados->>'observacao', '')), '');
  v_forma    text := nullif(p_dados->>'forma_pagamento', '');
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
                                     valor, forma_pagamento, conta_caixa_id, centro_custo_id, observacao)
    VALUES (v_empresa, 'receber', v_pessoa, v_desc, i, v_parcelas, v_emissao,
            CASE WHEN v_period = 'mensal' THEN (v_venc1 + make_interval(months => i - 1))::date
                 ELSE v_venc1 + (i - 1) * v_interv END,
            (v_base + CASE WHEN i = 1 THEN v_resto ELSE 0 END) / 100.0,
            v_forma, v_caixa, v_centro, v_obs);
  END LOOP;
  RETURN v_parcelas;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Receber, cancelar e pagar (só a pagar)
-- ─────────────────────────────────────────────────────────────────────

CREATE FUNCTION receber_titulo(p_titulo bigint, p_conta_caixa bigint, p_data date, p_juros numeric, p_multa numeric,
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
    RAISE EXCEPTION 'Somente Supervisor ou Administrador pode registrar recebimentos.';
  END IF;
  SELECT * INTO t FROM titulos_financeiros WHERE id = p_titulo AND empresa_id = minha_empresa_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Título não encontrado.'; END IF;
  IF t.natureza <> 'receber' THEN RAISE EXCEPTION 'Este título é uma conta a pagar.'; END IF;
  IF t.status <> 'aberto' THEN
    RAISE EXCEPTION 'Este título não está em aberto (situação: %).', t.status;
  END IF;
  SELECT * INTO cx FROM contas_caixa WHERE id = p_conta_caixa AND empresa_id = t.empresa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Informe a conta caixa que recebeu o valor.'; END IF;
  IF NOT cx.ativo THEN RAISE EXCEPTION 'A conta caixa "%" está inativa.', cx.nome; END IF;
  IF p_data IS NULL THEN RAISE EXCEPTION 'Informe a data do recebimento.'; END IF;
  IF p_data > current_date + 1 THEN RAISE EXCEPTION 'A data do recebimento não pode ser futura.'; END IF;
  IF p_data < cx.data_saldo_inicial THEN
    RAISE EXCEPTION 'A data é anterior ao saldo inicial da conta caixa "%" (%).', cx.nome, to_char(cx.data_saldo_inicial, 'DD/MM/YYYY');
  END IF;
  IF v_juros < 0 OR v_multa < 0 OR v_desc < 0 THEN RAISE EXCEPTION 'Juros, multa e desconto não podem ser negativos.'; END IF;
  IF t.valor + v_juros + v_multa - v_desc <= 0 THEN
    RAISE EXCEPTION 'O desconto não pode ser igual ou maior que o valor a receber.';
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

CREATE FUNCTION cancelar_titulo_receber(p_titulo bigint, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t titulos_financeiros%ROWTYPE;
BEGIN
  IF NOT tem_nivel('administrador', 'supervisor') THEN
    RAISE EXCEPTION 'Somente Supervisor ou Administrador pode cancelar contas a receber.';
  END IF;
  IF length(btrim(coalesce(p_motivo, ''))) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento (mínimo de 5 caracteres).';
  END IF;
  IF length(btrim(p_motivo)) > 300 THEN RAISE EXCEPTION 'O motivo pode ter no máximo 300 caracteres.'; END IF;
  SELECT * INTO t FROM titulos_financeiros WHERE id = p_titulo AND empresa_id = minha_empresa_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Título não encontrado.'; END IF;
  IF t.natureza <> 'receber' THEN
    RAISE EXCEPTION 'Conta a pagar é cancelada pela nota de entrada que a gerou.';
  END IF;
  IF t.status <> 'aberto' THEN
    RAISE EXCEPTION 'Só é possível cancelar parcelas em aberto (situação: %). Se já foi recebida, estorne o recebimento antes.', t.status;
  END IF;
  UPDATE titulos_financeiros SET status = 'cancelado', cancelado_em = now(), motivo_cancelamento = btrim(p_motivo)
   WHERE id = t.id;
END;
$$;

-- Igual à v8, recusando título a receber.
CREATE OR REPLACE FUNCTION pagar_titulo(p_titulo bigint, p_conta_caixa bigint, p_data date, p_juros numeric, p_multa numeric,
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
  IF t.natureza <> 'pagar' THEN RAISE EXCEPTION 'Este título é uma conta a receber.'; END IF;
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

-- ─────────────────────────────────────────────────────────────────────
-- 4. Lista das contas a receber (mesmas colunas de titulos_pagar)
-- ─────────────────────────────────────────────────────────────────────

CREATE VIEW titulos_receber WITH (security_invoker = true) AS
SELECT t.id, t.empresa_id, t.documento_id, t.pessoa_id, t.descricao, t.parcela, t.total_parcelas, t.emissao,
       t.vencimento, t.valor, t.forma_pagamento, t.conta_caixa_id, t.centro_custo_id, t.status, t.cancelado_em,
       t.motivo_cancelamento, t.criado_em,
       pe.nome AS fornecedor_nome, pe.documento AS fornecedor_documento, pe.tipo_pessoa AS fornecedor_tipo,
       NULL::text AS documento_tipo, NULL::text AS documento_numero, NULL::text AS documento_serie,
       pg.id AS pagamento_id, pg.data_pagamento, pg.valor_pago, pg.juros, pg.multa, pg.desconto,
       pg.conta_caixa_id AS pagamento_conta_caixa_id, pg.origem AS pagamento_origem,
       t.linha_digitavel, t.pix_chave, t.banco, t.agencia, t.conta, t.observacao,
       pg.observacao AS pagamento_observacao
  FROM titulos_financeiros t
  JOIN pessoas pe ON pe.id = t.pessoa_id
  LEFT JOIN pagamentos pg ON pg.titulo_id = t.id AND NOT pg.estornado
 WHERE t.natureza = 'receber';

-- ─────────────────────────────────────────────────────────────────────
-- 5. Extrato: recebimento soma, pagamento subtrai (resto igual à v13)
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW extrato_caixa WITH (security_invoker = true) AS
SELECT x.* FROM (
  SELECT e.empresa_id, e.conta_caixa_id, e.data, 'entrada'::text AS origem, e.id AS ref_id, e.tipo AS subtipo,
         concat_ws(' · ', CASE e.tipo WHEN 'dizimo' THEN 'Dízimo' WHEN 'oferta' THEN 'Oferta' WHEN 'campanha' THEN 'Campanha' ELSE 'Outra entrada' END,
                   ca.nome, pe.nome, e.descricao) AS descricao,
         e.valor AS valor, e.criado_em
    FROM entradas e
    LEFT JOIN pessoas pe ON pe.id = e.pessoa_id
    LEFT JOIN campanhas ca ON ca.id = e.campanha_id
   WHERE NOT e.estornado
  UNION ALL
  SELECT p.empresa_id, p.conta_caixa_id, p.data_pagamento, CASE t.natureza WHEN 'receber' THEN 'recebimento' ELSE 'pagamento' END,
         p.id, p.origem,
         concat_ws(' · ', t.descricao || ' — parcela ' || t.parcela || '/' || t.total_parcelas, pe.nome),
         CASE t.natureza WHEN 'receber' THEN p.valor_pago ELSE -p.valor_pago END, p.criado_em
    FROM pagamentos p
    JOIN titulos_financeiros t ON t.id = p.titulo_id
    LEFT JOIN pessoas pe ON pe.id = t.pessoa_id
   WHERE NOT p.estornado AND p.conta_caixa_id IS NOT NULL
  UNION ALL
  SELECT m.empresa_id, m.conta_origem_id, m.data, CASE m.tipo WHEN 'transferencia' THEN 'transferencia_saida' ELSE 'saida' END,
         m.id, m.tipo,
         CASE m.tipo WHEN 'transferencia' THEN 'Transferência para ' || d.nome || ' · ' || m.descricao ELSE m.descricao END,
         -m.valor, m.criado_em
    FROM movimentos_caixa m
    LEFT JOIN contas_caixa d ON d.id = m.conta_destino_id
   WHERE NOT m.estornado AND m.conta_origem_id IS NOT NULL
  UNION ALL
  SELECT m.empresa_id, m.conta_destino_id, m.data, CASE m.tipo WHEN 'transferencia' THEN 'transferencia_entrada' ELSE 'entrada_avulsa' END,
         m.id, m.tipo,
         CASE m.tipo WHEN 'transferencia' THEN 'Transferência de ' || o.nome || ' · ' || m.descricao ELSE m.descricao END,
         m.valor, m.criado_em
    FROM movimentos_caixa m
    LEFT JOIN contas_caixa o ON o.id = m.conta_origem_id
   WHERE NOT m.estornado AND m.conta_destino_id IS NOT NULL
) x
JOIN contas_caixa c ON c.id = x.conta_caixa_id
WHERE x.data >= c.data_saldo_inicial;

-- ─────────────────────────────────────────────────────────────────────
-- 6. Permissões
-- ─────────────────────────────────────────────────────────────────────

REVOKE ALL ON titulos_receber FROM anon;
GRANT SELECT ON titulos_receber, extrato_caixa TO authenticated;
REVOKE EXECUTE ON FUNCTION criar_contas_receber(jsonb), receber_titulo(bigint, bigint, date, numeric, numeric, numeric, text),
  cancelar_titulo_receber(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION criar_contas_receber(jsonb), receber_titulo(bigint, bigint, date, numeric, numeric, numeric, text),
  cancelar_titulo_receber(bigint, text) TO authenticated;
