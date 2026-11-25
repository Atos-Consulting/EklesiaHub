-- ═════════════════════════════════════════════════════════════════════
-- EklesiaHub — migration v13: movimentos de caixa e extrato por conta
-- ═════════════════════════════════════════════════════════════════════
-- 1. movimentos_caixa: transferência entre contas caixa, saída avulsa (sem nota: tarifa, despesa miúda)
--    e entrada avulsa (rendimento, devolução, ajuste; contribuições ficam em Dízimos e ofertas).
--    Imutável: errou, estorna (com motivo) e lança de novo. Só funções do banco gravam (Supervisor+).
-- 2. extrato_caixa: tudo o que mexe no saldo de cada conta (entradas, pagamentos e movimentos),
--    com valor positivo (entra) ou negativo (sai). Estornados e datas antes do saldo inicial ficam fora.
-- 3. contas_caixa_saldo passa a ser calculada pelo extrato: total_entradas e total_saidas agora incluem
--    os movimentos (mesmas colunas e na mesma ordem da v12).
-- 4. saldo_caixa_ate(conta, data): saldo ao fim de um dia (saldo anterior do extrato).
-- Rodar depois da v12.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Movimentos de caixa
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE movimentos_caixa (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id          bigint NOT NULL REFERENCES empresas(id),
  tipo                text NOT NULL CHECK (tipo IN ('transferencia', 'saida', 'entrada')),
  data                date NOT NULL,
  valor               numeric(15,2) NOT NULL CHECK (valor > 0),
  conta_origem_id     bigint,   -- de onde sai (transferência e saída)
  conta_destino_id    bigint,   -- para onde vai (transferência e entrada)
  descricao           text NOT NULL CHECK (length(btrim(descricao)) BETWEEN 1 AND 200),
  centro_custo_id     bigint,
  registrado_por      uuid,
  registrado_por_nome text,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  estornado           boolean NOT NULL DEFAULT false,
  estornado_por       uuid,
  estornado_em        timestamptz,
  motivo_estorno      text,
  CONSTRAINT movimentos_caixa_contas_ck CHECK (
    (tipo = 'transferencia' AND conta_origem_id IS NOT NULL AND conta_destino_id IS NOT NULL AND conta_origem_id <> conta_destino_id)
    OR (tipo = 'saida' AND conta_origem_id IS NOT NULL AND conta_destino_id IS NULL)
    OR (tipo = 'entrada' AND conta_destino_id IS NOT NULL AND conta_origem_id IS NULL)),
  CONSTRAINT movimentos_caixa_origem_fk FOREIGN KEY (conta_origem_id, empresa_id) REFERENCES contas_caixa (id, empresa_id),
  CONSTRAINT movimentos_caixa_destino_fk FOREIGN KEY (conta_destino_id, empresa_id) REFERENCES contas_caixa (id, empresa_id),
  CONSTRAINT movimentos_caixa_centro_fk FOREIGN KEY (centro_custo_id, empresa_id) REFERENCES centros_custo (id, empresa_id)
);
CREATE INDEX movimentos_caixa_origem_idx ON movimentos_caixa (conta_origem_id, data) WHERE NOT estornado;
CREATE INDEX movimentos_caixa_destino_idx ON movimentos_caixa (conta_destino_id, data) WHERE NOT estornado;
CREATE INDEX movimentos_caixa_empresa_idx ON movimentos_caixa (empresa_id, data DESC);

-- p_dados: {tipo, data, valor, conta_origem_id?, conta_destino_id?, descricao, centro_custo_id?}
CREATE FUNCTION registrar_movimento(p_dados jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa bigint := minha_empresa_id();
  v_tipo    text := p_dados->>'tipo';
  v_data    date;
  v_valor   numeric;
  v_origem  bigint := nullif(p_dados->>'conta_origem_id', '')::bigint;
  v_destino bigint := nullif(p_dados->>'conta_destino_id', '')::bigint;
  v_centro  bigint := nullif(p_dados->>'centro_custo_id', '')::bigint;
  v_desc    text := nullif(btrim(coalesce(p_dados->>'descricao', '')), '');
  cx        contas_caixa%ROWTYPE;
  v_id      bigint;
BEGIN
  IF NOT tem_nivel('administrador', 'supervisor') THEN
    RAISE EXCEPTION 'Somente Supervisor ou Administrador pode registrar movimentos de caixa.';
  END IF;
  IF v_tipo IS NULL OR v_tipo NOT IN ('transferencia', 'saida', 'entrada') THEN
    RAISE EXCEPTION 'Tipo de movimento inválido.';
  END IF;
  BEGIN
    v_data := (p_dados->>'data')::date;
    v_valor := round((p_dados->>'valor')::numeric, 2);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Data ou valor inválido.';
  END;
  IF v_data IS NULL THEN RAISE EXCEPTION 'Informe a data do movimento.'; END IF;
  IF v_data > current_date THEN RAISE EXCEPTION 'A data do movimento não pode ser futura.'; END IF;
  IF v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'O valor precisa ser maior que zero.'; END IF;
  IF v_valor > 9999999999999 THEN RAISE EXCEPTION 'Valor alto demais.'; END IF;
  IF v_desc IS NULL THEN RAISE EXCEPTION 'Informe a descrição do movimento.'; END IF;
  IF length(v_desc) > 200 THEN RAISE EXCEPTION 'A descrição pode ter no máximo 200 caracteres.'; END IF;

  -- Cada tipo usa só as contas que fazem sentido para ele.
  IF v_tipo = 'saida' THEN v_destino := NULL; END IF;
  IF v_tipo = 'entrada' THEN v_origem := NULL; END IF;
  IF v_tipo IN ('transferencia', 'saida') AND v_origem IS NULL THEN RAISE EXCEPTION 'Informe a conta de onde sai o valor.'; END IF;
  IF v_tipo IN ('transferencia', 'entrada') AND v_destino IS NULL THEN RAISE EXCEPTION 'Informe a conta que recebe o valor.'; END IF;
  IF v_tipo = 'transferencia' AND v_origem = v_destino THEN RAISE EXCEPTION 'A conta de origem e a de destino precisam ser diferentes.'; END IF;

  FOR cx IN SELECT * FROM contas_caixa WHERE id IN (v_origem, v_destino) AND empresa_id = v_empresa LOOP
    IF NOT cx.ativo THEN RAISE EXCEPTION 'A conta caixa "%" está inativa.', cx.nome; END IF;
    IF v_data < cx.data_saldo_inicial THEN
      RAISE EXCEPTION 'A data é anterior ao saldo inicial da conta caixa "%" (%).', cx.nome, to_char(cx.data_saldo_inicial, 'DD/MM/YYYY');
    END IF;
  END LOOP;
  IF (v_origem IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contas_caixa WHERE id = v_origem AND empresa_id = v_empresa))
     OR (v_destino IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contas_caixa WHERE id = v_destino AND empresa_id = v_empresa)) THEN
    RAISE EXCEPTION 'Conta caixa não encontrada.';
  END IF;
  IF v_centro IS NOT NULL AND NOT EXISTS (SELECT 1 FROM centros_custo WHERE id = v_centro AND empresa_id = v_empresa AND ativo) THEN
    RAISE EXCEPTION 'Centro de custo não encontrado ou inativo.';
  END IF;

  INSERT INTO movimentos_caixa (empresa_id, tipo, data, valor, conta_origem_id, conta_destino_id, descricao, centro_custo_id,
                                registrado_por, registrado_por_nome)
  VALUES (v_empresa, v_tipo, v_data, v_valor, v_origem, v_destino, v_desc, v_centro, auth.uid(),
          (SELECT coalesce(nullif(btrim(nome), ''), email) FROM profiles WHERE user_id = auth.uid()))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION estornar_movimento(p_movimento bigint, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m movimentos_caixa%ROWTYPE;
BEGIN
  IF NOT tem_nivel('administrador', 'supervisor') THEN
    RAISE EXCEPTION 'Somente Supervisor ou Administrador pode estornar movimentos de caixa.';
  END IF;
  IF length(btrim(coalesce(p_motivo, ''))) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo do estorno (mínimo de 5 caracteres).';
  END IF;
  IF length(btrim(p_motivo)) > 300 THEN
    RAISE EXCEPTION 'O motivo pode ter no máximo 300 caracteres.';
  END IF;
  SELECT * INTO m FROM movimentos_caixa WHERE id = p_movimento AND empresa_id = minha_empresa_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Movimento não encontrado.'; END IF;
  IF m.estornado THEN RAISE EXCEPTION 'Este movimento já foi estornado.'; END IF;
  UPDATE movimentos_caixa SET estornado = true, estornado_por = auth.uid(), estornado_em = now(), motivo_estorno = btrim(p_motivo)
   WHERE id = m.id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Extrato: uma linha por lançamento que mexe no saldo de uma conta
-- ─────────────────────────────────────────────────────────────────────
-- origem: entrada (dízimo/oferta…), pagamento (conta a pagar), transferencia_saida, transferencia_entrada,
--         saida (saída avulsa), entrada_avulsa. ref_id = id na tabela de origem.

CREATE VIEW extrato_caixa WITH (security_invoker = true) AS
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
  SELECT p.empresa_id, p.conta_caixa_id, p.data_pagamento, 'pagamento', p.id, p.origem,
         concat_ws(' · ', t.descricao || ' — parcela ' || t.parcela || '/' || t.total_parcelas, pe.nome),
         -p.valor_pago, p.criado_em
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
-- 3. Saldo da conta caixa pelo extrato (mesmas colunas da v12, na mesma ordem)
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW contas_caixa_saldo WITH (security_invoker = true) AS
SELECT c.id, c.empresa_id, c.nome, c.banco, c.agencia, c.numero_conta, c.saldo_inicial, c.data_saldo_inicial,
       c.conta_contabil_id, c.ativo,
       coalesce(s.saidas, 0)::numeric(15,2)                                        AS total_saidas,
       (c.saldo_inicial + coalesce(s.entradas, 0) - coalesce(s.saidas, 0))::numeric(15,2) AS saldo_atual,
       coalesce(s.qtd_pagamentos, 0)::int                                           AS qtd_pagamentos,
       coalesce(s.entradas, 0)::numeric(15,2)                                      AS total_entradas,
       coalesce(s.qtd_entradas, 0)::int                                             AS qtd_entradas
  FROM contas_caixa c
  LEFT JOIN LATERAL (
    SELECT sum(x.valor) FILTER (WHERE x.valor > 0)  AS entradas,
           -sum(x.valor) FILTER (WHERE x.valor < 0) AS saidas,
           count(*) FILTER (WHERE x.origem = 'pagamento') AS qtd_pagamentos,
           count(*) FILTER (WHERE x.origem = 'entrada')   AS qtd_entradas
      FROM extrato_caixa x
     WHERE x.conta_caixa_id = c.id
  ) s ON true;

-- Saldo ao fim do dia p_data (o "saldo anterior" do extrato é o do dia antes do período).
CREATE FUNCTION saldo_caixa_ate(p_conta bigint, p_data date) RETURNS numeric
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT (c.saldo_inicial + coalesce((SELECT sum(x.valor) FROM extrato_caixa x
                                       WHERE x.conta_caixa_id = c.id AND x.data <= p_data), 0))::numeric(15,2)
    FROM contas_caixa c
   WHERE c.id = p_conta AND c.empresa_id = minha_empresa_id();
$$;

-- Lista dos movimentos (inclusive estornados), para a tela.
CREATE VIEW movimentos_caixa_lista WITH (security_invoker = true) AS
SELECT m.id, m.empresa_id, m.tipo, m.data, m.valor, m.conta_origem_id, m.conta_destino_id, m.descricao, m.centro_custo_id,
       m.registrado_por_nome, m.criado_em, m.estornado, m.estornado_em, m.motivo_estorno,
       o.nome AS conta_origem_nome, d.nome AS conta_destino_nome, cc.nome AS centro_custo_nome
  FROM movimentos_caixa m
  LEFT JOIN contas_caixa o ON o.id = m.conta_origem_id
  LEFT JOIN contas_caixa d ON d.id = m.conta_destino_id
  LEFT JOIN centros_custo cc ON cc.id = m.centro_custo_id;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Logs, RLS e permissões
-- ─────────────────────────────────────────────────────────────────────

CREATE TRIGGER movimentos_caixa_log_trg AFTER INSERT OR UPDATE OR DELETE ON movimentos_caixa
  FOR EACH ROW EXECUTE FUNCTION registrar_log();

REVOKE ALL ON movimentos_caixa, movimentos_caixa_lista, extrato_caixa FROM anon;
REVOKE INSERT, UPDATE, DELETE ON movimentos_caixa FROM authenticated;
GRANT SELECT ON movimentos_caixa, movimentos_caixa_lista, extrato_caixa, contas_caixa_saldo TO authenticated;

ALTER TABLE movimentos_caixa ENABLE ROW LEVEL SECURITY;
CREATE POLICY movimentos_caixa_select ON movimentos_caixa FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());

REVOKE EXECUTE ON FUNCTION registrar_movimento(jsonb), estornar_movimento(bigint, text), saldo_caixa_ate(bigint, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION registrar_movimento(jsonb), estornar_movimento(bigint, text), saldo_caixa_ate(bigint, date) TO authenticated;
