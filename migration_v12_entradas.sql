-- ═════════════════════════════════════════════════════════════════════
-- EklesiaHub — migration v12: entradas do Financeiro (dízimos, ofertas e campanhas)
-- ═════════════════════════════════════════════════════════════════════
-- 1. campanhas: arrecadações com finalidade (ex.: reforma, missões), com meta e período opcionais.
-- 2. entradas: dízimo, oferta, campanha ou outra entrada, sempre numa conta caixa; pessoa opcional.
--    A entrada é imutável: errou, estorna (com motivo) e lança de novo. Só funções do banco gravam.
-- 3. O saldo da conta caixa passa a somar as entradas não estornadas (contas_caixa_saldo).
-- 4. Logs (gatilho registrar_log da v10) nas duas tabelas novas.
-- Registrar e estornar: Supervisor ou Administrador (as mesmas pessoas que pagam contas).
-- Campanhas: cadastro do Administrador, em Parâmetros → Financeiro. Rodar depois da v11.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Campanhas
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE campanhas (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id    bigint NOT NULL DEFAULT minha_empresa_id() REFERENCES empresas(id),
  nome          text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 80),
  descricao     text CHECK (length(descricao) <= 300),
  meta          numeric(15,2) CHECK (meta > 0),
  data_inicio   date,
  data_fim      date,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campanhas_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT campanhas_empresa_nome_uq UNIQUE (empresa_id, nome),
  CONSTRAINT campanhas_periodo_ck CHECK (data_fim IS NULL OR data_inicio IS NULL OR data_fim >= data_inicio)
);
CREATE TRIGGER campanhas_atualizado BEFORE UPDATE ON campanhas
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

-- ─────────────────────────────────────────────────────────────────────
-- 2. Entradas
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE entradas (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id          bigint NOT NULL REFERENCES empresas(id),
  tipo                text NOT NULL CHECK (tipo IN ('dizimo', 'oferta', 'campanha', 'outra')),
  data                date NOT NULL,
  valor               numeric(15,2) NOT NULL CHECK (valor > 0),
  conta_caixa_id      bigint NOT NULL,
  forma_pagamento     text NOT NULL CHECK (forma_pagamento IN ('dinheiro', 'pix', 'transferencia', 'cartao_credito',
                                                              'cartao_debito', 'cheque', 'outro')),
  pessoa_id           bigint,
  campanha_id         bigint,
  centro_custo_id     bigint,
  descricao           text CHECK (length(descricao) <= 200),
  registrado_por      uuid,
  registrado_por_nome text,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  estornado           boolean NOT NULL DEFAULT false,
  estornado_por       uuid,
  estornado_em        timestamptz,
  motivo_estorno      text,
  CONSTRAINT entradas_campanha_ck CHECK ((tipo = 'campanha') = (campanha_id IS NOT NULL)),
  CONSTRAINT entradas_caixa_fk FOREIGN KEY (conta_caixa_id, empresa_id) REFERENCES contas_caixa (id, empresa_id),
  CONSTRAINT entradas_pessoa_fk FOREIGN KEY (pessoa_id, empresa_id) REFERENCES pessoas (id, empresa_id),
  CONSTRAINT entradas_campanha_fk FOREIGN KEY (campanha_id, empresa_id) REFERENCES campanhas (id, empresa_id),
  CONSTRAINT entradas_centro_fk FOREIGN KEY (centro_custo_id, empresa_id) REFERENCES centros_custo (id, empresa_id)
);
CREATE INDEX entradas_empresa_data_idx ON entradas (empresa_id, data DESC);
CREATE INDEX entradas_caixa_idx ON entradas (conta_caixa_id, data) WHERE NOT estornado;
CREATE INDEX entradas_campanha_idx ON entradas (campanha_id) WHERE campanha_id IS NOT NULL AND NOT estornado;
CREATE INDEX entradas_pessoa_idx ON entradas (pessoa_id) WHERE pessoa_id IS NOT NULL;

-- p_dados: {tipo, data, valor, conta_caixa_id, forma_pagamento, pessoa_id?, campanha_id?, centro_custo_id?, descricao?}
CREATE FUNCTION registrar_entrada(p_dados jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa  bigint := minha_empresa_id();
  v_tipo     text := p_dados->>'tipo';
  v_data     date;
  v_valor    numeric;
  v_caixa    bigint := nullif(p_dados->>'conta_caixa_id', '')::bigint;
  v_forma    text := nullif(p_dados->>'forma_pagamento', '');
  v_pessoa   bigint := nullif(p_dados->>'pessoa_id', '')::bigint;
  v_campanha bigint := nullif(p_dados->>'campanha_id', '')::bigint;
  v_centro   bigint := nullif(p_dados->>'centro_custo_id', '')::bigint;
  v_desc     text := nullif(btrim(coalesce(p_dados->>'descricao', '')), '');
  cx         contas_caixa%ROWTYPE;
  v_id       bigint;
BEGIN
  IF NOT tem_nivel('administrador', 'supervisor') THEN
    RAISE EXCEPTION 'Somente Supervisor ou Administrador pode registrar entradas.';
  END IF;
  IF v_tipo IS NULL OR v_tipo NOT IN ('dizimo', 'oferta', 'campanha', 'outra') THEN
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
  IF v_forma IS NULL THEN RAISE EXCEPTION 'Informe a forma de recebimento.'; END IF;
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

  INSERT INTO entradas (empresa_id, tipo, data, valor, conta_caixa_id, forma_pagamento, pessoa_id, campanha_id,
                        centro_custo_id, descricao, registrado_por, registrado_por_nome)
  VALUES (v_empresa, v_tipo, v_data, v_valor, v_caixa, v_forma, v_pessoa, v_campanha, v_centro, v_desc, auth.uid(),
          (SELECT coalesce(nullif(btrim(nome), ''), email) FROM profiles WHERE user_id = auth.uid()))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION estornar_entrada(p_entrada bigint, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e entradas%ROWTYPE;
BEGIN
  IF NOT tem_nivel('administrador', 'supervisor') THEN
    RAISE EXCEPTION 'Somente Supervisor ou Administrador pode estornar entradas.';
  END IF;
  IF length(btrim(coalesce(p_motivo, ''))) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo do estorno (mínimo de 5 caracteres).';
  END IF;
  IF length(btrim(p_motivo)) > 300 THEN
    RAISE EXCEPTION 'O motivo pode ter no máximo 300 caracteres.';
  END IF;
  SELECT * INTO e FROM entradas WHERE id = p_entrada AND empresa_id = minha_empresa_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entrada não encontrada.'; END IF;
  IF e.estornado THEN RAISE EXCEPTION 'Esta entrada já foi estornada.'; END IF;
  UPDATE entradas SET estornado = true, estornado_por = auth.uid(), estornado_em = now(), motivo_estorno = btrim(p_motivo)
   WHERE id = e.id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Saldo da conta caixa: saldo inicial + entradas − pagamentos (colunas novas no fim)
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW contas_caixa_saldo WITH (security_invoker = true) AS
SELECT c.id, c.empresa_id, c.nome, c.banco, c.agencia, c.numero_conta, c.saldo_inicial, c.data_saldo_inicial,
       c.conta_contabil_id, c.ativo,
       coalesce(s.saidas, 0)::numeric(15,2)                                        AS total_saidas,
       (c.saldo_inicial + coalesce(e.entradas, 0) - coalesce(s.saidas, 0))::numeric(15,2) AS saldo_atual,
       coalesce(s.qtd, 0)::int                                                      AS qtd_pagamentos,
       coalesce(e.entradas, 0)::numeric(15,2)                                      AS total_entradas,
       coalesce(e.qtd, 0)::int                                                      AS qtd_entradas
  FROM contas_caixa c
  LEFT JOIN LATERAL (
    SELECT sum(p.valor_pago) AS saidas, count(*) AS qtd
      FROM pagamentos p
     WHERE p.conta_caixa_id = c.id AND NOT p.estornado AND p.data_pagamento >= c.data_saldo_inicial
  ) s ON true
  LEFT JOIN LATERAL (
    SELECT sum(en.valor) AS entradas, count(*) AS qtd
      FROM entradas en
     WHERE en.conta_caixa_id = c.id AND NOT en.estornado AND en.data >= c.data_saldo_inicial
  ) e ON true;

-- Listas para as telas (respeitam a RLS de cada tabela).
CREATE VIEW entradas_lista WITH (security_invoker = true) AS
SELECT en.id, en.empresa_id, en.tipo, en.data, en.valor, en.conta_caixa_id, en.forma_pagamento, en.pessoa_id,
       en.campanha_id, en.centro_custo_id, en.descricao, en.registrado_por_nome, en.criado_em,
       en.estornado, en.estornado_em, en.motivo_estorno,
       pe.nome AS pessoa_nome, ca.nome AS campanha_nome, cx.nome AS conta_caixa_nome, cc.nome AS centro_custo_nome
  FROM entradas en
  LEFT JOIN pessoas pe ON pe.id = en.pessoa_id
  LEFT JOIN campanhas ca ON ca.id = en.campanha_id
  JOIN contas_caixa cx ON cx.id = en.conta_caixa_id
  LEFT JOIN centros_custo cc ON cc.id = en.centro_custo_id;

CREATE VIEW campanhas_saldo WITH (security_invoker = true) AS
SELECT ca.*, coalesce(t.total, 0)::numeric(15,2) AS arrecadado, coalesce(t.qtd, 0)::int AS qtd_entradas
  FROM campanhas ca
  LEFT JOIN LATERAL (
    SELECT sum(valor) AS total, count(*) AS qtd FROM entradas WHERE campanha_id = ca.id AND NOT estornado
  ) t ON true;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Logs
-- ─────────────────────────────────────────────────────────────────────

CREATE TRIGGER campanhas_log_trg AFTER INSERT OR UPDATE OR DELETE ON campanhas
  FOR EACH ROW EXECUTE FUNCTION registrar_log();
CREATE TRIGGER entradas_log_trg AFTER INSERT OR UPDATE OR DELETE ON entradas
  FOR EACH ROW EXECUTE FUNCTION registrar_log();

-- ─────────────────────────────────────────────────────────────────────
-- 5. RLS e permissões
-- ─────────────────────────────────────────────────────────────────────

REVOKE ALL ON campanhas, entradas, entradas_lista, campanhas_saldo FROM anon;
REVOKE INSERT, UPDATE, DELETE ON entradas FROM authenticated;
GRANT SELECT ON entradas, entradas_lista, campanhas_saldo, contas_caixa_saldo TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON campanhas TO authenticated;

ALTER TABLE campanhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE entradas  ENABLE ROW LEVEL SECURITY;

CREATE POLICY campanhas_select ON campanhas FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY campanhas_write ON campanhas FOR ALL TO authenticated
  USING (empresa_id = minha_empresa_id() AND tem_nivel('administrador'))
  WITH CHECK (empresa_id = minha_empresa_id() AND tem_nivel('administrador'));
CREATE POLICY entradas_select ON entradas FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());

REVOKE EXECUTE ON FUNCTION registrar_entrada(jsonb), estornar_entrada(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION registrar_entrada(jsonb), estornar_entrada(bigint, text) TO authenticated;
