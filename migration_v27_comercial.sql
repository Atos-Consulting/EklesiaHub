-- ═════════════════════════════════════════════════════════════════════
-- EklesiaHub — migration v27: Comercial (frente de loja, produtos e estoque)
-- ═════════════════════════════════════════════════════════════════════
--  • Locais de venda (pontos_venda: Cafeteria, Livraria, Bazar...), cadastro do Administrador em
--    Parâmetros → Comercial. Cada local tem a conta caixa do dinheiro e, se quiser, outra para PIX,
--    cartões e transferências (conta_eletronica_id), e um centro de custo opcional.
--  • Acesso por usuário (pontos_venda_usuarios), no cadastro do usuário: em cada local, "abre e fecha o
--    caixa" (também vende e cancela venda) e/ou "vende". O Administrador da igreja pode tudo. Gravado só
--    por salvar_acessos_pdv (Administrador e Supervisor; Supervisor não mexe em Administrador).
--  • Caixa do frente de loja (caixas_pdv): quem pode abrir escolhe o local e o dia e informa o troco;
--    um caixa aberto por local; vários vendedores vendem no mesmo caixa. Cada venda guarda o vendedor;
--    o caixa guarda quem abriu e quem fechou.
--  • Venda (vendas, venda_itens, venda_pagamentos) por registrar_venda: produto do cadastro (preço do
--    cadastro) ou item avulso (bazar), desconto, uma ou mais formas de pagamento (sem boleto), troco do
--    dinheiro. Cancelar (cancelar_venda) só com o caixa aberto, por quem abre e fecha o caixa, com motivo.
--  • Fechamento (fechar_caixa_pdv): conta o dinheiro da gaveta; as vendas por forma de pagamento entram
--    na conta caixa do local (caixas_pdv_lancamentos, que entram no extrato_caixa) e a diferença do
--    dinheiro (sobra ou falta, com explicação) também. Fechado, o caixa não reabre.
--  • Produtos (produtos) com estoque opcional por produto. Estoque em estoque_movimentos (imutável, custo
--    médio): entrada pela nota de entrada aprovada (item ligado ao produto; custo = rateio do total da
--    nota, como na contabilidade), saída na venda, volta no cancelamento, e ajustes (Supervisor+).
--    Venda não deixa o estoque negativo.
--  • Contabilidade: vendas (D conta caixa, C Vendas) no fechamento do caixa; custo da venda (D CMV,
--    C Estoque); item de nota ligado a produto debita Estoque; ajustes contra "Perdas e ajustes de
--    estoque"; diferença de caixa em "Quebra de caixa". Regras novas: estoque, vendas, cmv,
--    ajuste_estoque, quebra_caixa (contas do plano padrão 1.1.03, 4.2.01, 5.4 e 5.6).
--  • Caixa do frente de loja aberto impede conciliar a conta (Fechamento do dia) e fechar o mês.
-- Rodar depois da v26.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Locais de venda e acesso dos usuários
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE pontos_venda (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id          bigint NOT NULL DEFAULT minha_empresa_id() REFERENCES empresas(id),
  nome                text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 80),
  conta_caixa_id      bigint NOT NULL,   -- dinheiro
  conta_eletronica_id bigint,            -- PIX, cartões, transferência, cheque...; nula = a mesma do dinheiro
  centro_custo_id     bigint,
  ativo               boolean NOT NULL DEFAULT true,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pontos_venda_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT pontos_venda_empresa_nome_uq UNIQUE (empresa_id, nome),
  CONSTRAINT pontos_venda_caixa_fk FOREIGN KEY (conta_caixa_id, empresa_id) REFERENCES contas_caixa (id, empresa_id),
  CONSTRAINT pontos_venda_eletronica_fk FOREIGN KEY (conta_eletronica_id, empresa_id) REFERENCES contas_caixa (id, empresa_id),
  CONSTRAINT pontos_venda_centro_fk FOREIGN KEY (centro_custo_id, empresa_id) REFERENCES centros_custo (id, empresa_id)
);
CREATE TRIGGER pontos_venda_log_trg AFTER INSERT OR UPDATE OR DELETE ON pontos_venda
  FOR EACH ROW EXECUTE FUNCTION registrar_log();
ALTER TABLE pontos_venda ENABLE ROW LEVEL SECURITY;
CREATE POLICY pontos_venda_select ON pontos_venda FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY pontos_venda_write ON pontos_venda FOR ALL TO authenticated
  USING (empresa_id = minha_empresa_id() AND tem_nivel('administrador'))
  WITH CHECK (empresa_id = minha_empresa_id() AND tem_nivel('administrador'));
REVOKE ALL ON pontos_venda FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON pontos_venda TO authenticated;

CREATE TABLE pontos_venda_usuarios (
  empresa_id     bigint NOT NULL REFERENCES empresas(id),
  ponto_venda_id bigint NOT NULL,
  user_id        uuid NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  pode_abrir     boolean NOT NULL DEFAULT false,  -- abre e fecha o caixa, cancela venda (e vende)
  pode_vender    boolean NOT NULL DEFAULT true,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ponto_venda_id, user_id),
  CONSTRAINT pontos_venda_usuarios_ponto_fk FOREIGN KEY (ponto_venda_id, empresa_id) REFERENCES pontos_venda (id, empresa_id) ON DELETE CASCADE,
  CONSTRAINT pontos_venda_usuarios_algum_ck CHECK (pode_abrir OR pode_vender)
);
CREATE INDEX pontos_venda_usuarios_user_idx ON pontos_venda_usuarios (user_id);
CREATE TRIGGER pontos_venda_usuarios_log_trg AFTER INSERT OR UPDATE OR DELETE ON pontos_venda_usuarios
  FOR EACH ROW EXECUTE FUNCTION registrar_log();
ALTER TABLE pontos_venda_usuarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY pontos_venda_usuarios_select ON pontos_venda_usuarios FOR SELECT TO authenticated
  USING (empresa_id = minha_empresa_id() AND (user_id = auth.uid() OR tem_nivel('administrador', 'supervisor')));
REVOKE ALL ON pontos_venda_usuarios FROM anon, authenticated;
GRANT SELECT ON pontos_venda_usuarios TO authenticated;

-- O usuário pode 'abrir' (abrir/fechar o caixa e cancelar venda) ou 'vender' neste local?
CREATE FUNCTION pdv_pode(p_ponto bigint, p_acao text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM pontos_venda p WHERE p.id = p_ponto AND p.empresa_id = minha_empresa_id())
     AND (tem_nivel('administrador')
          OR EXISTS (SELECT 1 FROM pontos_venda_usuarios a
                      WHERE a.ponto_venda_id = p_ponto AND a.user_id = auth.uid() AND a.empresa_id = minha_empresa_id()
                        AND CASE p_acao WHEN 'abrir' THEN a.pode_abrir ELSE a.pode_abrir OR a.pode_vender END));
$$;

-- Troca os acessos de um usuário aos locais de venda: [{ ponto_venda_id, pode_abrir, pode_vender }].
CREATE FUNCTION salvar_acessos_pdv(p_user uuid, p_acessos jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp   bigint := minha_empresa_id();
  v_nivel text;
  v_lista jsonb := coalesce(p_acessos, '[]'::jsonb);
BEGIN
  IF v_emp IS NULL OR NOT tem_nivel('administrador', 'supervisor') THEN
    RAISE EXCEPTION 'Só o Administrador ou o Supervisor altera os acessos ao frente de loja.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(v_lista) <> 'array' THEN RAISE EXCEPTION 'Acessos inválidos.'; END IF;
  SELECT nivel INTO v_nivel FROM profiles WHERE user_id = p_user AND empresa_id = v_emp;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuário não encontrado nesta igreja.'; END IF;
  IF v_nivel = 'administrador' AND NOT tem_nivel('administrador') THEN
    RAISE EXCEPTION 'Supervisor não altera os acessos de um Administrador.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_lista) AS a(ponto_venda_id bigint)
              WHERE NOT EXISTS (SELECT 1 FROM pontos_venda p WHERE p.id = a.ponto_venda_id AND p.empresa_id = v_emp)) THEN
    RAISE EXCEPTION 'Local de venda não encontrado.';
  END IF;

  DELETE FROM pontos_venda_usuarios u
   WHERE u.empresa_id = v_emp AND u.user_id = p_user
     AND NOT EXISTS (SELECT 1 FROM jsonb_to_recordset(v_lista) AS a(ponto_venda_id bigint, pode_abrir boolean, pode_vender boolean)
                      WHERE a.ponto_venda_id = u.ponto_venda_id AND (coalesce(a.pode_abrir, false) OR coalesce(a.pode_vender, false)));
  INSERT INTO pontos_venda_usuarios (empresa_id, ponto_venda_id, user_id, pode_abrir, pode_vender)
  SELECT v_emp, a.ponto_venda_id, p_user, coalesce(a.pode_abrir, false), coalesce(a.pode_vender, false) OR coalesce(a.pode_abrir, false)
    FROM jsonb_to_recordset(v_lista) AS a(ponto_venda_id bigint, pode_abrir boolean, pode_vender boolean)
   WHERE coalesce(a.pode_abrir, false) OR coalesce(a.pode_vender, false)
  ON CONFLICT (ponto_venda_id, user_id) DO UPDATE
     SET pode_abrir = EXCLUDED.pode_abrir, pode_vender = EXCLUDED.pode_vender, atualizado_em = now()
   WHERE (pontos_venda_usuarios.pode_abrir, pontos_venda_usuarios.pode_vender) IS DISTINCT FROM (EXCLUDED.pode_abrir, EXCLUDED.pode_vender);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Produtos e estoque
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE produtos (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id       bigint NOT NULL DEFAULT minha_empresa_id() REFERENCES empresas(id),
  nome             text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 120),
  codigo           text CHECK (codigo IS NULL OR length(btrim(codigo)) BETWEEN 1 AND 60),  -- código de barras ou interno
  categoria        text CHECK (categoria IS NULL OR length(categoria) <= 60),
  unidade          text NOT NULL DEFAULT 'UN' CHECK (length(btrim(unidade)) BETWEEN 1 AND 6),
  preco            numeric(15,2) NOT NULL CHECK (preco >= 0),
  controla_estoque boolean NOT NULL DEFAULT false,
  estoque_minimo   numeric(15,4) CHECK (estoque_minimo IS NULL OR estoque_minimo >= 0),
  pontos_venda     bigint[] NOT NULL DEFAULT '{}',  -- onde é vendido; vazio = em todos os locais
  ativo            boolean NOT NULL DEFAULT true,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT produtos_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT produtos_empresa_codigo_uq UNIQUE (empresa_id, codigo)
);
CREATE INDEX produtos_empresa_nome_idx ON produtos (empresa_id, nome);

CREATE TABLE estoque_movimentos (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id        bigint NOT NULL REFERENCES empresas(id),
  produto_id        bigint NOT NULL,
  data              date NOT NULL,
  tipo              text NOT NULL CHECK (tipo IN ('nota', 'estorno_nota', 'venda', 'estorno_venda', 'ajuste')),
  quantidade        numeric(15,4) NOT NULL CHECK (quantidade <> 0),  -- + entra, − sai
  valor             numeric(15,2) NOT NULL,                          -- custo, com o sinal da quantidade
  documento_id      bigint,
  documento_item_id bigint,
  venda_id          bigint,
  motivo            text CHECK (motivo IS NULL OR length(motivo) <= 300),
  criado_por        uuid DEFAULT auth.uid(),
  criado_por_nome   text,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estoque_movimentos_produto_fk FOREIGN KEY (produto_id, empresa_id) REFERENCES produtos (id, empresa_id),
  CONSTRAINT estoque_movimentos_documento_fk FOREIGN KEY (documento_id, empresa_id) REFERENCES documentos_entrada (id, empresa_id)
);
CREATE INDEX estoque_movimentos_produto_idx ON estoque_movimentos (produto_id, data);
CREATE INDEX estoque_movimentos_venda_idx ON estoque_movimentos (venda_id) WHERE venda_id IS NOT NULL;
CREATE INDEX estoque_movimentos_item_idx ON estoque_movimentos (documento_item_id) WHERE documento_item_id IS NOT NULL;

-- Registros do comercial que não mudam: erro se corrige com estorno ou ajuste.
CREATE FUNCTION comercial_imutavel() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Este registro do comercial não pode ser alterado nem excluído: corrija com estorno, cancelamento ou ajuste.';
END;
$$;
CREATE TRIGGER estoque_movimentos_imutavel BEFORE UPDATE OR DELETE ON estoque_movimentos
  FOR EACH ROW EXECUTE FUNCTION comercial_imutavel();

CREATE VIEW produtos_estoque WITH (security_invoker = true) AS
SELECT p.*,
       coalesce(s.qtd, 0) AS estoque,
       coalesce(s.valor, 0) AS valor_estoque,
       CASE WHEN coalesce(s.qtd, 0) > 0 THEN round(s.valor / s.qtd, 4) END AS custo_medio
  FROM produtos p
  LEFT JOIN (SELECT produto_id, sum(quantidade) AS qtd, sum(valor) AS valor FROM estoque_movimentos GROUP BY produto_id) s
    ON s.produto_id = p.id;

CREATE FUNCTION produtos_regras() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_qtd numeric;
  v_val numeric;
BEGIN
  NEW.nome := btrim(NEW.nome);
  NEW.codigo := nullif(btrim(coalesce(NEW.codigo, '')), '');
  NEW.categoria := nullif(btrim(coalesce(NEW.categoria, '')), '');
  NEW.unidade := upper(btrim(NEW.unidade));
  NEW.pontos_venda := coalesce((SELECT array_agg(DISTINCT x ORDER BY x) FROM unnest(NEW.pontos_venda) AS x), '{}');
  IF EXISTS (SELECT 1 FROM unnest(NEW.pontos_venda) AS x
              WHERE NOT EXISTS (SELECT 1 FROM pontos_venda p WHERE p.id = x AND p.empresa_id = NEW.empresa_id)) THEN
    RAISE EXCEPTION 'Local de venda não encontrado.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.empresa_id <> OLD.empresa_id THEN RAISE EXCEPTION 'O produto não muda de igreja.'; END IF;
    IF OLD.controla_estoque AND NOT NEW.controla_estoque THEN
      SELECT coalesce(sum(quantidade), 0), coalesce(sum(valor), 0) INTO v_qtd, v_val FROM estoque_movimentos WHERE produto_id = OLD.id;
      IF v_qtd <> 0 OR v_val <> 0 THEN
        RAISE EXCEPTION 'O produto "%" ainda tem estoque: zere com um ajuste antes de deixar de controlar.', OLD.nome;
      END IF;
    END IF;
  END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER produtos_regras_trg BEFORE INSERT OR UPDATE ON produtos FOR EACH ROW EXECUTE FUNCTION produtos_regras();
CREATE TRIGGER produtos_log_trg AFTER INSERT OR UPDATE OR DELETE ON produtos FOR EACH ROW EXECUTE FUNCTION registrar_log();

ALTER TABLE produtos ENABLE ROW LEVEL SECURITY;
CREATE POLICY produtos_select ON produtos FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY produtos_write ON produtos FOR ALL TO authenticated
  USING (empresa_id = minha_empresa_id() AND tem_nivel('administrador', 'supervisor'))
  WITH CHECK (empresa_id = minha_empresa_id() AND tem_nivel('administrador', 'supervisor'));
REVOKE ALL ON produtos FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON produtos TO authenticated;

ALTER TABLE estoque_movimentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY estoque_movimentos_select ON estoque_movimentos FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
REVOKE ALL ON estoque_movimentos FROM anon, authenticated;
GRANT SELECT ON estoque_movimentos TO authenticated;
REVOKE ALL ON produtos_estoque FROM anon;
GRANT SELECT ON produtos_estoque TO authenticated;

-- Lança um movimento de estoque (só as funções do banco chamam). Saída sem valor sai pelo custo médio;
-- a que zera o estoque leva o valor que sobrou. Devolve o valor gravado.
CREATE FUNCTION estoque_lancar(p_emp bigint, p_produto bigint, p_data date, p_tipo text, p_qtd numeric, p_valor numeric,
                               p_documento bigint, p_item bigint, p_venda bigint, p_motivo text) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pr      produtos%ROWTYPE;
  v_qtd   numeric;
  v_val   numeric;
  v_valor numeric;
BEGIN
  SELECT * INTO pr FROM produtos WHERE id = p_produto AND empresa_id = p_emp FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;
  SELECT coalesce(sum(quantidade), 0), coalesce(sum(valor), 0) INTO v_qtd, v_val FROM estoque_movimentos WHERE produto_id = p_produto;
  IF p_qtd < 0 AND v_qtd + p_qtd < 0 THEN
    RAISE EXCEPTION 'Estoque insuficiente de "%": há % %, precisa de %.', pr.nome, trim_scale(v_qtd), pr.unidade, trim_scale(-p_qtd);
  END IF;
  v_valor := CASE
    WHEN p_valor IS NOT NULL THEN p_valor
    WHEN p_qtd < 0 AND v_qtd + p_qtd = 0 THEN -v_val
    WHEN p_qtd < 0 THEN round(v_val * p_qtd / v_qtd, 2)
    ELSE 0 END;
  INSERT INTO estoque_movimentos (empresa_id, produto_id, data, tipo, quantidade, valor, documento_id, documento_item_id, venda_id,
                                  motivo, criado_por, criado_por_nome)
  VALUES (p_emp, p_produto, p_data, p_tipo, p_qtd, v_valor, p_documento, p_item, p_venda, p_motivo, auth.uid(),
          (SELECT coalesce(nullif(btrim(nome), ''), email) FROM profiles WHERE user_id = auth.uid()));
  RETURN v_valor;
END;
$$;

-- Ajuste de estoque (Supervisor+): entrada sem nota (doação, sobra no inventário) com custo unitário,
-- ou saída (perda, quebra, uso interno) pelo custo médio. p_quantidade com sinal.
CREATE FUNCTION ajustar_estoque(p_produto bigint, p_data date, p_quantidade numeric, p_custo_unitario numeric, p_motivo text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp bigint := minha_empresa_id();
  pr    produtos%ROWTYPE;
  v_qtd numeric := round(p_quantidade, 4);
BEGIN
  IF v_emp IS NULL OR NOT tem_nivel('administrador', 'supervisor') THEN
    RAISE EXCEPTION 'Só o Supervisor ou o Administrador ajusta o estoque.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO pr FROM produtos WHERE id = p_produto AND empresa_id = v_emp;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;
  IF NOT pr.controla_estoque THEN RAISE EXCEPTION 'O produto "%" não controla estoque.', pr.nome; END IF;
  IF v_qtd IS NULL OR v_qtd = 0 THEN RAISE EXCEPTION 'Informe a quantidade (positiva entra, negativa sai).'; END IF;
  IF p_data IS NULL OR p_data > current_date THEN RAISE EXCEPTION 'Informe a data do ajuste (até hoje).'; END IF;
  IF length(btrim(coalesce(p_motivo, ''))) < 3 THEN RAISE EXCEPTION 'Informe o motivo do ajuste.'; END IF;
  IF v_qtd > 0 AND (p_custo_unitario IS NULL OR p_custo_unitario < 0) THEN
    RAISE EXCEPTION 'Informe o custo unitário da entrada (pode ser zero, se foi doação).';
  END IF;
  IF fechado_ate_empresa(v_emp) IS NOT NULL AND p_data <= fechado_ate_empresa(v_emp) THEN
    RAISE EXCEPTION 'O mês de % está fechado: use uma data depois de %.', to_char(fechado_ate_empresa(v_emp), 'MM/YYYY'), to_char(fechado_ate_empresa(v_emp), 'DD/MM/YYYY');
  END IF;
  PERFORM estoque_lancar(v_emp, p_produto, p_data, 'ajuste', v_qtd,
                         CASE WHEN v_qtd > 0 THEN round(v_qtd * p_custo_unitario, 2) END, NULL, NULL, NULL, btrim(p_motivo));
  RETURN (SELECT max(id) FROM estoque_movimentos WHERE produto_id = p_produto);
END;
$$;

-- Itens da nota de entrada ligados a produto com estoque.
ALTER TABLE documento_entrada_itens ADD COLUMN produto_id bigint;
ALTER TABLE documento_entrada_itens ADD CONSTRAINT documento_entrada_itens_produto_fk
  FOREIGN KEY (produto_id, empresa_id) REFERENCES produtos (id, empresa_id);
ALTER TABLE estoque_movimentos ADD CONSTRAINT estoque_movimentos_item_fk
  FOREIGN KEY (documento_item_id) REFERENCES documento_entrada_itens (id);

CREATE FUNCTION documento_entrada_itens_produto() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.produto_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM produtos WHERE id = NEW.produto_id AND empresa_id = NEW.empresa_id AND controla_estoque) THEN
    RAISE EXCEPTION 'Só produto que controla estoque pode ser ligado a um item da nota.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER documento_entrada_itens_produto_trg BEFORE INSERT OR UPDATE OF produto_id ON documento_entrada_itens
  FOR EACH ROW EXECUTE FUNCTION documento_entrada_itens_produto();

-- Nota aprovada: entrada no estoque (custo = parte do item no total da nota, igual à contabilização).
-- Nota cancelada: os produtos saem de novo pelo custo médio (a diferença de custo vai para a contabilidade).
CREATE FUNCTION documentos_entrada_estoque() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
BEGIN
  IF NEW.status IN ('aprovada', 'lancada') AND OLD.status NOT IN ('aprovada', 'lancada', 'cancelada') THEN
    FOR r IN
      WITH it AS (
        SELECT i.id, i.produto_id, i.quantidade,
               round(NEW.valor_total * i.valor_total / nullif(sum(i.valor_total) OVER (), 0), 2) AS v,
               row_number() OVER (ORDER BY i.valor_total DESC, i.id) AS ordem
          FROM documento_entrada_itens i WHERE i.documento_id = NEW.id
      )
      SELECT it.id, it.produto_id, it.quantidade,
             coalesce(it.v + CASE WHEN it.ordem = 1 THEN NEW.valor_total - sum(it.v) OVER () ELSE 0 END, 0) AS valor
        FROM it ORDER BY it.id
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
CREATE TRIGGER documentos_entrada_estoque_trg AFTER UPDATE OF status ON documentos_entrada
  FOR EACH ROW EXECUTE FUNCTION documentos_entrada_estoque();

-- ─────────────────────────────────────────────────────────────────────
-- 3. Caixa do frente de loja e vendas
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE caixas_pdv (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id          bigint NOT NULL REFERENCES empresas(id),
  ponto_venda_id      bigint NOT NULL,
  data                date NOT NULL,
  status              text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'fechado')),
  conta_caixa_id      bigint NOT NULL,  -- as contas do local na abertura
  conta_eletronica_id bigint,
  troco_inicial       numeric(15,2) NOT NULL DEFAULT 0 CHECK (troco_inicial >= 0),
  observacao_abertura text CHECK (observacao_abertura IS NULL OR length(observacao_abertura) <= 300),
  aberto_por          uuid,
  aberto_por_nome     text,
  aberto_em           timestamptz NOT NULL DEFAULT now(),
  fechado_por         uuid,
  fechado_por_nome    text,
  fechado_em          timestamptz,
  dinheiro_contado    numeric(15,2) CHECK (dinheiro_contado IS NULL OR dinheiro_contado >= 0),
  diferenca           numeric(15,2),
  observacao          text CHECK (observacao IS NULL OR length(observacao) <= 500),
  CONSTRAINT caixas_pdv_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT caixas_pdv_ponto_fk FOREIGN KEY (ponto_venda_id, empresa_id) REFERENCES pontos_venda (id, empresa_id),
  CONSTRAINT caixas_pdv_caixa_fk FOREIGN KEY (conta_caixa_id, empresa_id) REFERENCES contas_caixa (id, empresa_id),
  CONSTRAINT caixas_pdv_eletronica_fk FOREIGN KEY (conta_eletronica_id, empresa_id) REFERENCES contas_caixa (id, empresa_id),
  CONSTRAINT caixas_pdv_fechado_ck CHECK ((status = 'fechado') = (fechado_em IS NOT NULL))
);
CREATE UNIQUE INDEX caixas_pdv_aberto_uq ON caixas_pdv (ponto_venda_id) WHERE status = 'aberto';
CREATE INDEX caixas_pdv_empresa_data_idx ON caixas_pdv (empresa_id, data);

CREATE TABLE vendas (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id          bigint NOT NULL REFERENCES empresas(id),
  caixa_id            bigint NOT NULL,
  numero              integer NOT NULL,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  vendedor            uuid,
  vendedor_nome       text,
  pessoa_id           bigint,
  subtotal            numeric(15,2) NOT NULL CHECK (subtotal > 0),
  desconto            numeric(15,2) NOT NULL DEFAULT 0 CHECK (desconto >= 0),
  total               numeric(15,2) NOT NULL CHECK (total > 0),
  observacao          text CHECK (observacao IS NULL OR length(observacao) <= 300),
  status              text NOT NULL DEFAULT 'concluida' CHECK (status IN ('concluida', 'cancelada')),
  cancelada_por       uuid,
  cancelada_por_nome  text,
  cancelada_em        timestamptz,
  motivo_cancelamento text,
  CONSTRAINT vendas_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT vendas_caixa_numero_uq UNIQUE (caixa_id, numero),
  CONSTRAINT vendas_caixa_fk FOREIGN KEY (caixa_id, empresa_id) REFERENCES caixas_pdv (id, empresa_id),
  CONSTRAINT vendas_pessoa_fk FOREIGN KEY (pessoa_id, empresa_id) REFERENCES pessoas (id, empresa_id),
  CONSTRAINT vendas_total_ck CHECK (total = subtotal - desconto)
);

CREATE TABLE venda_itens (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id     bigint NOT NULL REFERENCES empresas(id),
  venda_id       bigint NOT NULL,
  produto_id     bigint,           -- nulo = item avulso (bazar)
  descricao      text NOT NULL CHECK (length(btrim(descricao)) BETWEEN 1 AND 120),
  quantidade     numeric(15,4) NOT NULL CHECK (quantidade > 0),
  preco_unitario numeric(15,2) NOT NULL CHECK (preco_unitario >= 0),
  total          numeric(15,2) NOT NULL CHECK (total >= 0),
  CONSTRAINT venda_itens_venda_fk FOREIGN KEY (venda_id, empresa_id) REFERENCES vendas (id, empresa_id),
  CONSTRAINT venda_itens_produto_fk FOREIGN KEY (produto_id, empresa_id) REFERENCES produtos (id, empresa_id)
);
CREATE INDEX venda_itens_venda_idx ON venda_itens (venda_id);
CREATE INDEX venda_itens_produto_idx ON venda_itens (produto_id) WHERE produto_id IS NOT NULL;

CREATE TABLE venda_pagamentos (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id         bigint NOT NULL REFERENCES empresas(id),
  venda_id           bigint NOT NULL,
  forma_pagamento_id bigint NOT NULL,
  valor              numeric(15,2) NOT NULL CHECK (valor > 0),
  valor_recebido     numeric(15,2),  -- dinheiro: quanto o cliente entregou (troco = recebido − valor)
  CONSTRAINT venda_pagamentos_venda_fk FOREIGN KEY (venda_id, empresa_id) REFERENCES vendas (id, empresa_id),
  CONSTRAINT venda_pagamentos_forma_fk FOREIGN KEY (forma_pagamento_id, empresa_id) REFERENCES formas_pagamento (id, empresa_id),
  CONSTRAINT venda_pagamentos_recebido_ck CHECK (valor_recebido IS NULL OR valor_recebido >= valor)
);
CREATE INDEX venda_pagamentos_venda_idx ON venda_pagamentos (venda_id);

ALTER TABLE estoque_movimentos ADD CONSTRAINT estoque_movimentos_venda_fk
  FOREIGN KEY (venda_id, empresa_id) REFERENCES vendas (id, empresa_id);

-- O que o fechamento do caixa lança nas contas caixa (entra no extrato_caixa).
CREATE TABLE caixas_pdv_lancamentos (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id         bigint NOT NULL REFERENCES empresas(id),
  caixa_id           bigint NOT NULL,
  conta_caixa_id     bigint NOT NULL,
  data               date NOT NULL,
  tipo               text NOT NULL CHECK (tipo IN ('venda', 'diferenca')),
  forma_pagamento_id bigint,
  valor              numeric(15,2) NOT NULL CHECK (valor <> 0),
  criado_em          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT caixas_pdv_lancamentos_caixa_fk FOREIGN KEY (caixa_id, empresa_id) REFERENCES caixas_pdv (id, empresa_id),
  CONSTRAINT caixas_pdv_lancamentos_conta_fk FOREIGN KEY (conta_caixa_id, empresa_id) REFERENCES contas_caixa (id, empresa_id),
  CONSTRAINT caixas_pdv_lancamentos_forma_fk FOREIGN KEY (forma_pagamento_id, empresa_id) REFERENCES formas_pagamento (id, empresa_id),
  CONSTRAINT caixas_pdv_lancamentos_venda_ck CHECK (tipo = 'diferenca' OR (valor > 0 AND forma_pagamento_id IS NOT NULL))
);
CREATE INDEX caixas_pdv_lancamentos_caixa_idx ON caixas_pdv_lancamentos (caixa_id);
CREATE INDEX caixas_pdv_lancamentos_conta_idx ON caixas_pdv_lancamentos (conta_caixa_id, data);

CREATE TRIGGER venda_itens_imutavel BEFORE UPDATE OR DELETE ON venda_itens FOR EACH ROW EXECUTE FUNCTION comercial_imutavel();
CREATE TRIGGER venda_pagamentos_imutavel BEFORE UPDATE OR DELETE ON venda_pagamentos FOR EACH ROW EXECUTE FUNCTION comercial_imutavel();
CREATE TRIGGER caixas_pdv_lancamentos_imutavel BEFORE UPDATE OR DELETE ON caixas_pdv_lancamentos FOR EACH ROW EXECUTE FUNCTION comercial_imutavel();

-- Lançamento na conta caixa respeita a conciliação (v19) e o mês fechado (v24).
CREATE FUNCTION caixas_pdv_lancamentos_conciliacao() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM conferir_conciliacao(NEW.conta_caixa_id, NEW.data);
  RETURN NEW;
END;
$$;
CREATE TRIGGER caixas_pdv_lancamentos_conciliacao_trg BEFORE INSERT ON caixas_pdv_lancamentos
  FOR EACH ROW EXECUTE FUNCTION caixas_pdv_lancamentos_conciliacao();

CREATE TRIGGER caixas_pdv_log_trg AFTER INSERT OR UPDATE OR DELETE ON caixas_pdv FOR EACH ROW EXECUTE FUNCTION registrar_log();
CREATE TRIGGER vendas_log_trg AFTER INSERT OR UPDATE OR DELETE ON vendas FOR EACH ROW EXECUTE FUNCTION registrar_log();

ALTER TABLE caixas_pdv ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE venda_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE venda_pagamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE caixas_pdv_lancamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY caixas_pdv_select ON caixas_pdv FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY vendas_select ON vendas FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY venda_itens_select ON venda_itens FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY venda_pagamentos_select ON venda_pagamentos FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY caixas_pdv_lancamentos_select ON caixas_pdv_lancamentos FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
REVOKE ALL ON caixas_pdv, vendas, venda_itens, venda_pagamentos, caixas_pdv_lancamentos FROM anon, authenticated;
GRANT SELECT ON caixas_pdv, vendas, venda_itens, venda_pagamentos, caixas_pdv_lancamentos TO authenticated;

-- Abre o caixa de um local num dia, com o troco da gaveta.
CREATE FUNCTION abrir_caixa_pdv(p_ponto bigint, p_data date, p_troco numeric, p_observacao text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp bigint := minha_empresa_id();
  pv    pontos_venda%ROWTYPE;
  v_id  bigint;
BEGIN
  SELECT * INTO pv FROM pontos_venda WHERE id = p_ponto AND empresa_id = v_emp;
  IF NOT FOUND THEN RAISE EXCEPTION 'Local de venda não encontrado.'; END IF;
  IF NOT pdv_pode(p_ponto, 'abrir') THEN
    RAISE EXCEPTION 'Você não pode abrir o caixa de "%". Peça ao Administrador para liberar no seu cadastro de usuário.', pv.nome USING ERRCODE = '42501';
  END IF;
  IF NOT pv.ativo THEN RAISE EXCEPTION 'O local "%" está inativo.', pv.nome; END IF;
  IF p_data IS NULL OR p_data > current_date THEN RAISE EXCEPTION 'Escolha o dia do caixa (até hoje).'; END IF;
  IF coalesce(p_troco, 0) < 0 THEN RAISE EXCEPTION 'O troco não pode ser negativo.'; END IF;
  IF EXISTS (SELECT 1 FROM contas_caixa c WHERE c.id IN (pv.conta_caixa_id, pv.conta_eletronica_id) AND (NOT c.ativo OR p_data < c.data_saldo_inicial)) THEN
    RAISE EXCEPTION 'A conta caixa do local "%" está inativa ou começa depois deste dia.', pv.nome;
  END IF;
  PERFORM conferir_conciliacao(pv.conta_caixa_id, p_data);
  PERFORM conferir_conciliacao(pv.conta_eletronica_id, p_data);
  INSERT INTO caixas_pdv (empresa_id, ponto_venda_id, data, conta_caixa_id, conta_eletronica_id, troco_inicial, observacao_abertura,
                          aberto_por, aberto_por_nome)
  VALUES (v_emp, p_ponto, p_data, pv.conta_caixa_id, pv.conta_eletronica_id, round(coalesce(p_troco, 0), 2),
          nullif(btrim(coalesce(p_observacao, '')), ''), auth.uid(),
          (SELECT coalesce(nullif(btrim(nome), ''), email) FROM profiles WHERE user_id = auth.uid()))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Registra uma venda no caixa aberto.
--  p_itens: [{ produto_id, quantidade }] (preço e descrição do cadastro) ou [{ descricao, quantidade, preco_unitario }] (avulso)
--  p_pagamentos: [{ forma_pagamento_id, valor, valor_recebido }] — a soma dos valores é o total
CREATE FUNCTION registrar_venda(p_caixa bigint, p_itens jsonb, p_pagamentos jsonb, p_desconto numeric, p_pessoa bigint, p_observacao text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp      bigint := minha_empresa_id();
  k          caixas_pdv%ROWTYPE;
  i          record;
  pg         record;
  pr         produtos%ROWTYPE;
  f          formas_pagamento%ROWTYPE;
  v_id       bigint;
  v_numero   integer;
  v_subtotal numeric := 0;
  v_desconto numeric := round(coalesce(p_desconto, 0), 2);
  v_total    numeric;
  v_pago     numeric := 0;
  v_qtd      numeric;
  v_preco    numeric;
  v_desc     text;
  v_item     bigint;
BEGIN
  SELECT * INTO k FROM caixas_pdv WHERE id = p_caixa AND empresa_id = v_emp FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Caixa não encontrado.'; END IF;
  IF k.status <> 'aberto' THEN RAISE EXCEPTION 'Este caixa já foi fechado.'; END IF;
  IF NOT pdv_pode(k.ponto_venda_id, 'vender') THEN
    RAISE EXCEPTION 'Você não pode vender neste local. Peça ao Administrador para liberar no seu cadastro de usuário.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(coalesce(p_itens, 'null')) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN RAISE EXCEPTION 'Inclua ao menos um item na venda.'; END IF;
  IF jsonb_typeof(coalesce(p_pagamentos, 'null')) <> 'array' OR jsonb_array_length(p_pagamentos) = 0 THEN RAISE EXCEPTION 'Informe a forma de pagamento.'; END IF;
  IF v_desconto < 0 THEN RAISE EXCEPTION 'O desconto não pode ser negativo.'; END IF;

  SELECT coalesce(max(numero), 0) + 1 INTO v_numero FROM vendas WHERE caixa_id = k.id;
  -- primeiro a venda (o total é acertado no fim)
  INSERT INTO vendas (empresa_id, caixa_id, numero, vendedor, vendedor_nome, pessoa_id, subtotal, desconto, total, observacao)
  VALUES (v_emp, k.id, v_numero, auth.uid(), (SELECT coalesce(nullif(btrim(nome), ''), email) FROM profiles WHERE user_id = auth.uid()),
          p_pessoa, 1, 0, 1, nullif(btrim(coalesce(p_observacao, '')), ''))
  RETURNING id INTO v_id;

  FOR i IN SELECT * FROM jsonb_to_recordset(p_itens) AS x(produto_id bigint, descricao text, quantidade numeric, preco_unitario numeric) LOOP
    v_qtd := round(coalesce(i.quantidade, 0), 4);
    IF v_qtd <= 0 THEN RAISE EXCEPTION 'A quantidade de cada item precisa ser maior que zero.'; END IF;
    IF i.produto_id IS NOT NULL THEN
      SELECT * INTO pr FROM produtos WHERE id = i.produto_id AND empresa_id = v_emp;
      IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado.'; END IF;
      IF NOT pr.ativo THEN RAISE EXCEPTION 'O produto "%" está inativo.', pr.nome; END IF;
      IF cardinality(pr.pontos_venda) > 0 AND NOT k.ponto_venda_id = ANY (pr.pontos_venda) THEN
        RAISE EXCEPTION 'O produto "%" não é vendido neste local.', pr.nome;
      END IF;
      v_desc := pr.nome;
      v_preco := pr.preco;
    ELSE
      v_desc := btrim(coalesce(i.descricao, ''));
      v_preco := round(coalesce(i.preco_unitario, -1), 2);
      IF v_desc = '' THEN RAISE EXCEPTION 'Descreva o item avulso.'; END IF;
      IF v_preco <= 0 THEN RAISE EXCEPTION 'Informe o preço do item avulso "%".', v_desc; END IF;
    END IF;
    INSERT INTO venda_itens (empresa_id, venda_id, produto_id, descricao, quantidade, preco_unitario, total)
    VALUES (v_emp, v_id, i.produto_id, left(v_desc, 120), v_qtd, v_preco, round(v_qtd * v_preco, 2))
    RETURNING id INTO v_item;
    v_subtotal := v_subtotal + round(v_qtd * v_preco, 2);
    IF i.produto_id IS NOT NULL AND pr.controla_estoque THEN
      PERFORM estoque_lancar(v_emp, pr.id, k.data, 'venda', -v_qtd, NULL, NULL, NULL, v_id, NULL);
    END IF;
  END LOOP;

  IF v_subtotal <= 0 THEN RAISE EXCEPTION 'O total da venda precisa ser maior que zero.'; END IF;
  IF v_desconto >= v_subtotal THEN RAISE EXCEPTION 'O desconto precisa ser menor que o total dos itens.'; END IF;
  v_total := v_subtotal - v_desconto;

  FOR pg IN SELECT * FROM jsonb_to_recordset(p_pagamentos) AS x(forma_pagamento_id bigint, valor numeric, valor_recebido numeric) LOOP
    SELECT * INTO f FROM formas_pagamento WHERE id = pg.forma_pagamento_id AND empresa_id = v_emp;
    IF NOT FOUND THEN RAISE EXCEPTION 'Forma de pagamento não encontrada.'; END IF;
    IF NOT f.ativo THEN RAISE EXCEPTION 'A forma de pagamento "%" está inativa.', f.nome; END IF;
    IF f.tipo = 'boleto' THEN RAISE EXCEPTION 'Boleto não serve para venda no caixa.'; END IF;
    IF round(coalesce(pg.valor, 0), 2) <= 0 THEN RAISE EXCEPTION 'Informe o valor pago em "%".', f.nome; END IF;
    IF pg.valor_recebido IS NOT NULL AND f.tipo <> 'dinheiro' THEN RAISE EXCEPTION 'Troco só existe no dinheiro.'; END IF;
    INSERT INTO venda_pagamentos (empresa_id, venda_id, forma_pagamento_id, valor, valor_recebido)
    VALUES (v_emp, v_id, f.id, round(pg.valor, 2), round(pg.valor_recebido, 2));
    v_pago := v_pago + round(pg.valor, 2);
  END LOOP;
  IF v_pago <> v_total THEN
    RAISE EXCEPTION 'Os pagamentos (R$ %) não fecham com o total da venda (R$ %).', replace(to_char(v_pago, 'FM999999990.00'), '.', ','), replace(to_char(v_total, 'FM999999990.00'), '.', ',');
  END IF;

  UPDATE vendas SET subtotal = v_subtotal, desconto = v_desconto, total = v_total WHERE id = v_id;
  RETURN v_id;
END;
$$;

-- Cancela uma venda do caixa aberto: os produtos voltam ao estoque pelo mesmo custo.
CREATE FUNCTION cancelar_venda(p_venda bigint, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp bigint := minha_empresa_id();
  v     vendas%ROWTYPE;
  k     caixas_pdv%ROWTYPE;
  m     record;
BEGIN
  SELECT * INTO v FROM vendas WHERE id = p_venda AND empresa_id = v_emp FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venda não encontrada.'; END IF;
  SELECT * INTO k FROM caixas_pdv WHERE id = v.caixa_id FOR UPDATE;
  IF NOT pdv_pode(k.ponto_venda_id, 'abrir') THEN
    RAISE EXCEPTION 'Só quem abre e fecha o caixa deste local cancela venda.' USING ERRCODE = '42501';
  END IF;
  IF v.status = 'cancelada' THEN RAISE EXCEPTION 'Esta venda já foi cancelada.'; END IF;
  IF k.status <> 'aberto' THEN
    RAISE EXCEPTION 'O caixa desta venda já foi fechado: não dá mais para cancelar. Devolva o dinheiro com uma saída avulsa no Caixa e, se for o caso, ajuste o estoque.';
  END IF;
  IF length(btrim(coalesce(p_motivo, ''))) < 3 THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.'; END IF;
  UPDATE vendas SET status = 'cancelada', cancelada_por = auth.uid(), cancelada_em = now(), motivo_cancelamento = btrim(p_motivo),
         cancelada_por_nome = (SELECT coalesce(nullif(btrim(nome), ''), email) FROM profiles WHERE user_id = auth.uid())
   WHERE id = v.id;
  FOR m IN SELECT * FROM estoque_movimentos WHERE venda_id = v.id AND tipo = 'venda' ORDER BY id LOOP
    PERFORM estoque_lancar(v_emp, m.produto_id, m.data, 'estorno_venda', -m.quantidade, -m.valor, NULL, NULL, v.id, 'Venda cancelada');
  END LOOP;
END;
$$;

-- Resumo de um caixa: vendas, totais por forma de pagamento e o dinheiro esperado na gaveta.
CREATE FUNCTION resumo_caixa_pdv(p_caixa bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH k AS (SELECT * FROM caixas_pdv WHERE id = p_caixa),
  vd AS (SELECT v.* FROM vendas v JOIN k ON v.caixa_id = k.id),
  fp AS (
    SELECT f.id, f.nome, f.tipo AS comportamento, sum(p.valor) AS valor, count(DISTINCT p.venda_id) AS vendas,
           sum(CASE WHEN p.valor_recebido IS NOT NULL THEN p.valor_recebido - p.valor ELSE 0 END) AS troco
      FROM venda_pagamentos p JOIN vd ON vd.id = p.venda_id AND vd.status = 'concluida'
      JOIN formas_pagamento f ON f.id = p.forma_pagamento_id
     GROUP BY f.id, f.nome, f.tipo
  )
  SELECT jsonb_build_object(
    'vendas', (SELECT count(*) FROM vd WHERE status = 'concluida'),
    'canceladas', (SELECT count(*) FROM vd WHERE status = 'cancelada'),
    'itens', (SELECT coalesce(sum(i.quantidade), 0) FROM venda_itens i JOIN vd ON vd.id = i.venda_id AND vd.status = 'concluida'),
    'subtotal', (SELECT coalesce(sum(subtotal), 0) FROM vd WHERE status = 'concluida'),
    'desconto', (SELECT coalesce(sum(desconto), 0) FROM vd WHERE status = 'concluida'),
    'total', (SELECT coalesce(sum(total), 0) FROM vd WHERE status = 'concluida'),
    'formas', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'comportamento', comportamento, 'valor', valor,
                                                            'vendas', vendas) ORDER BY valor DESC), '[]'::jsonb) FROM fp),
    'troco_inicial', (SELECT troco_inicial FROM k),
    'dinheiro_vendas', (SELECT coalesce(sum(valor), 0) FROM fp WHERE comportamento = 'dinheiro'),
    'dinheiro_esperado', (SELECT troco_inicial FROM k) + (SELECT coalesce(sum(valor), 0) FROM fp WHERE comportamento = 'dinheiro')
  );
$$;

-- Fecha o caixa: conta o dinheiro; as vendas por forma entram na conta caixa do local e a diferença do dinheiro também.
CREATE FUNCTION fechar_caixa_pdv(p_caixa bigint, p_dinheiro_contado numeric, p_observacao text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp  bigint := minha_empresa_id();
  k      caixas_pdv%ROWTYPE;
  v_din  numeric;
  v_dif  numeric;
  v_obs  text := nullif(btrim(coalesce(p_observacao, '')), '');
BEGIN
  SELECT * INTO k FROM caixas_pdv WHERE id = p_caixa AND empresa_id = v_emp FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Caixa não encontrado.'; END IF;
  IF NOT pdv_pode(k.ponto_venda_id, 'abrir') THEN
    RAISE EXCEPTION 'Você não pode fechar o caixa deste local.' USING ERRCODE = '42501';
  END IF;
  IF k.status <> 'aberto' THEN RAISE EXCEPTION 'Este caixa já foi fechado.'; END IF;
  IF p_dinheiro_contado IS NULL OR p_dinheiro_contado < 0 THEN RAISE EXCEPTION 'Informe o dinheiro contado na gaveta (com o troco).'; END IF;

  SELECT coalesce(sum(p.valor), 0) INTO v_din
    FROM venda_pagamentos p JOIN vendas v ON v.id = p.venda_id JOIN formas_pagamento f ON f.id = p.forma_pagamento_id
   WHERE v.caixa_id = k.id AND v.status = 'concluida' AND f.tipo = 'dinheiro';
  v_dif := round(p_dinheiro_contado, 2) - (k.troco_inicial + v_din);
  IF v_dif <> 0 AND length(coalesce(v_obs, '')) < 3 THEN
    RAISE EXCEPTION 'O dinheiro contado tem diferença de R$ % (% esperado): explique na observação.',
      replace(to_char(v_dif, 'FM999999990.00'), '.', ','), replace(to_char(k.troco_inicial + v_din, 'FM999999990.00'), '.', ',');
  END IF;

  INSERT INTO caixas_pdv_lancamentos (empresa_id, caixa_id, conta_caixa_id, data, tipo, forma_pagamento_id, valor)
  SELECT v_emp, k.id, CASE WHEN f.tipo = 'dinheiro' THEN k.conta_caixa_id ELSE coalesce(k.conta_eletronica_id, k.conta_caixa_id) END,
         k.data, 'venda', f.id, sum(p.valor)
    FROM venda_pagamentos p JOIN vendas v ON v.id = p.venda_id JOIN formas_pagamento f ON f.id = p.forma_pagamento_id
   WHERE v.caixa_id = k.id AND v.status = 'concluida'
   GROUP BY f.id, f.tipo
  HAVING sum(p.valor) > 0
   ORDER BY f.id;
  IF v_dif <> 0 THEN
    INSERT INTO caixas_pdv_lancamentos (empresa_id, caixa_id, conta_caixa_id, data, tipo, valor)
    VALUES (v_emp, k.id, k.conta_caixa_id, k.data, 'diferenca', v_dif);
  END IF;

  UPDATE caixas_pdv SET status = 'fechado', fechado_por = auth.uid(), fechado_em = now(),
         fechado_por_nome = (SELECT coalesce(nullif(btrim(nome), ''), email) FROM profiles WHERE user_id = auth.uid()),
         dinheiro_contado = round(p_dinheiro_contado, 2), diferenca = v_dif, observacao = v_obs
   WHERE id = k.id;
END;
$$;

-- Caixa do frente de loja aberto impede conciliar a conta até o dia dele e fechar o mês dele.
CREATE FUNCTION conciliacoes_caixa_pdv() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record;
BEGIN
  SELECT k.data, pv.nome INTO c FROM caixas_pdv k JOIN pontos_venda pv ON pv.id = k.ponto_venda_id
   WHERE k.status = 'aberto' AND k.data <= NEW.data AND NEW.conta_caixa_id IN (k.conta_caixa_id, coalesce(k.conta_eletronica_id, k.conta_caixa_id))
   ORDER BY k.data LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'O caixa do frente de loja "%" de % ainda está aberto e lança nesta conta: feche-o antes de conciliar.', c.nome, to_char(c.data, 'DD/MM/YYYY');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER conciliacoes_caixa_pdv_trg BEFORE INSERT ON conciliacoes_caixa FOR EACH ROW EXECUTE FUNCTION conciliacoes_caixa_pdv();

CREATE FUNCTION fechamentos_mes_pdv() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c record;
BEGIN
  SELECT k.data, pv.nome INTO c FROM caixas_pdv k JOIN pontos_venda pv ON pv.id = k.ponto_venda_id
   WHERE k.empresa_id = NEW.empresa_id AND k.status = 'aberto' AND k.data < (NEW.mes + interval '1 month')::date
   ORDER BY k.data LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'O caixa do frente de loja "%" de % ainda está aberto: feche-o antes de fechar o mês.', c.nome, to_char(c.data, 'DD/MM/YYYY');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fechamentos_mes_pdv_trg BEFORE INSERT ON fechamentos_mes FOR EACH ROW EXECUTE FUNCTION fechamentos_mes_pdv();

-- ─────────────────────────────────────────────────────────────────────
-- 4. Extrato de caixa com as vendas do frente de loja
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW extrato_caixa WITH (security_invoker = true) AS
SELECT x.* FROM (
  SELECT e.empresa_id, e.conta_caixa_id, e.data, 'entrada'::text AS origem, e.id AS ref_id, e.tipo AS subtipo,
         concat_ws(' · ', CASE e.tipo WHEN 'dizimo' THEN 'Dízimo' WHEN 'oferta' THEN 'Oferta' WHEN 'campanha' THEN 'Campanha' ELSE 'Outra entrada' END,
                   ca.nome, pe.nome, e.descricao) AS descricao,
         e.valor AS valor, e.criado_em, e.forma_pagamento_id
    FROM entradas e
    LEFT JOIN pessoas pe ON pe.id = e.pessoa_id
    LEFT JOIN campanhas ca ON ca.id = e.campanha_id
   WHERE NOT e.estornado
  UNION ALL
  SELECT p.empresa_id, p.conta_caixa_id, p.data_pagamento, CASE t.natureza WHEN 'receber' THEN 'recebimento' ELSE 'pagamento' END,
         p.id, p.origem,
         concat_ws(' · ', t.descricao || ' — parcela ' || t.parcela || '/' || t.total_parcelas, pe.nome),
         CASE t.natureza WHEN 'receber' THEN p.valor_pago ELSE -p.valor_pago END, p.criado_em, p.forma_pagamento_id
    FROM pagamentos p
    JOIN titulos_financeiros t ON t.id = p.titulo_id
    LEFT JOIN pessoas pe ON pe.id = t.pessoa_id
   WHERE NOT p.estornado AND p.conta_caixa_id IS NOT NULL
  UNION ALL
  SELECT m.empresa_id, m.conta_origem_id, m.data, CASE m.tipo WHEN 'transferencia' THEN 'transferencia_saida' ELSE 'saida' END,
         m.id, m.tipo,
         CASE m.tipo WHEN 'transferencia' THEN 'Transferência para ' || d.nome || ' · ' || m.descricao ELSE m.descricao END,
         -m.valor, m.criado_em, NULL::bigint
    FROM movimentos_caixa m
    LEFT JOIN contas_caixa d ON d.id = m.conta_destino_id
   WHERE NOT m.estornado AND m.conta_origem_id IS NOT NULL
  UNION ALL
  SELECT m.empresa_id, m.conta_destino_id, m.data, CASE m.tipo WHEN 'transferencia' THEN 'transferencia_entrada' ELSE 'entrada_avulsa' END,
         m.id, m.tipo,
         CASE m.tipo WHEN 'transferencia' THEN 'Transferência de ' || o.nome || ' · ' || m.descricao ELSE m.descricao END,
         m.valor, m.criado_em, NULL::bigint
    FROM movimentos_caixa m
    LEFT JOIN contas_caixa o ON o.id = m.conta_origem_id
   WHERE NOT m.estornado AND m.conta_destino_id IS NOT NULL
  UNION ALL
  -- frente de loja (v27): no fechamento do caixa, as vendas por forma e a diferença do dinheiro
  SELECT l.empresa_id, l.conta_caixa_id, l.data, CASE l.tipo WHEN 'venda' THEN 'venda_pdv' ELSE 'diferenca_caixa' END,
         l.id, l.tipo,
         CASE l.tipo WHEN 'venda' THEN concat_ws(' · ', 'Vendas — ' || pv.nome, f.nome)
           ELSE CASE WHEN l.valor > 0 THEN 'Sobra de caixa — ' ELSE 'Falta de caixa — ' END || pv.nome END
           || ' · caixa ' || k.id,
         l.valor, l.criado_em, l.forma_pagamento_id
    FROM caixas_pdv_lancamentos l
    JOIN caixas_pdv k ON k.id = l.caixa_id
    JOIN pontos_venda pv ON pv.id = k.ponto_venda_id
    LEFT JOIN formas_pagamento f ON f.id = l.forma_pagamento_id
) x
JOIN contas_caixa c ON c.id = x.conta_caixa_id
WHERE x.data >= c.data_saldo_inicial;

REVOKE EXECUTE ON FUNCTION estoque_lancar(bigint, bigint, date, text, numeric, numeric, bigint, bigint, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION pdv_pode(bigint, text), salvar_acessos_pdv(uuid, jsonb), ajustar_estoque(bigint, date, numeric, numeric, text),
  abrir_caixa_pdv(bigint, date, numeric, text), registrar_venda(bigint, jsonb, jsonb, numeric, bigint, text), cancelar_venda(bigint, text),
  resumo_caixa_pdv(bigint), fechar_caixa_pdv(bigint, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pdv_pode(bigint, text), salvar_acessos_pdv(uuid, jsonb), ajustar_estoque(bigint, date, numeric, numeric, text),
  abrir_caixa_pdv(bigint, date, numeric, text), registrar_venda(bigint, jsonb, jsonb, numeric, bigint, text), cancelar_venda(bigint, text),
  resumo_caixa_pdv(bigint), fechar_caixa_pdv(bigint, numeric, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Regras de contabilização do comercial
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE regras_contabeis DROP CONSTRAINT regras_contabeis_chave_check;
ALTER TABLE regras_contabeis ADD CONSTRAINT regras_contabeis_chave_check CHECK (chave IN ('patrimonio', 'fornecedores', 'retencoes',
  'contas_receber', 'receita_receber', 'despesa_sem_nota', 'dizimo', 'oferta', 'campanha', 'entrada_avulsa', 'saida_avulsa',
  'despesas_financeiras', 'receitas_financeiras', 'ret_inss', 'ret_irrf', 'ret_csll', 'ret_pis', 'ret_cofins', 'ret_iss',
  'estoque', 'vendas', 'cmv', 'ajuste_estoque', 'quebra_caixa'));

CREATE OR REPLACE FUNCTION regras_contabeis_valida() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  c plano_contas%ROWTYPE;
  v_nat text := CASE
    WHEN NEW.chave IN ('fornecedores', 'retencoes', 'ret_inss', 'ret_irrf', 'ret_csll', 'ret_pis', 'ret_cofins', 'ret_iss') THEN 'passivo'
    WHEN NEW.chave IN ('contas_receber', 'estoque') THEN 'ativo'
    WHEN NEW.chave = 'patrimonio' THEN 'patrimonio_social'
    WHEN NEW.chave IN ('receita_receber', 'dizimo', 'oferta', 'campanha', 'entrada_avulsa', 'receitas_financeiras', 'vendas') THEN 'receita'
    ELSE 'despesa' END;
BEGIN
  SELECT * INTO c FROM plano_contas WHERE id = NEW.conta_id AND empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta contábil não encontrada.'; END IF;
  IF NOT c.analitica THEN RAISE EXCEPTION 'A conta % - % é sintética: escolha uma conta analítica.', c.codigo, c.nome; END IF;
  IF NOT c.ativo THEN RAISE EXCEPTION 'A conta % - % está inativa.', c.codigo, c.nome; END IF;
  IF c.natureza <> v_nat THEN
    RAISE EXCEPTION 'A conta % - % não serve para esta regra: escolha uma conta de %.', c.codigo, c.nome,
      CASE v_nat WHEN 'patrimonio_social' THEN 'patrimônio social' WHEN 'receita' THEN 'receita' WHEN 'despesa' THEN 'despesa' ELSE v_nat END;
  END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

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
      ('2.1.07', 'PIS retido a recolher', 'passivo', '2.1'), ('2.1.08', 'COFINS retida a recolher', 'passivo', '2.1')) AS v(codigo, nome, natureza, pai)
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

-- Igrejas que já existem: regras do comercial (as contas 1.1.03, 4.2.01, 5.4 e 5.6 vêm do plano padrão).
SELECT semear_contabilidade(id) FROM empresas;

-- ─────────────────────────────────────────────────────────────────────
-- 6. Contabilização: vendas, custo, estoque e quebra de caixa
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE lancamentos_contabeis DROP CONSTRAINT lancamentos_contabeis_origem_check;
ALTER TABLE lancamentos_contabeis ADD CONSTRAINT lancamentos_contabeis_origem_check CHECK (origem IN ('manual', 'abertura', 'nota',
  'titulo_pagar', 'titulo_receber', 'pagamento', 'entrada', 'movimento', 'caixa_pdv', 'estoque'));

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
    SELECT n.id AS doc, i.id AS item, i.conta_id, i.centro_custo_id, i.produto_id,
           round(n.valor_total * i.valor_total / nullif(sum(i.valor_total) OVER (PARTITION BY n.id), 0), 2) AS v,
           row_number() OVER (PARTITION BY n.id ORDER BY i.valor_total DESC, i.id) AS ordem
      FROM nota n JOIN documento_entrada_itens i ON i.documento_id = n.id
  ),
  itens_aj AS (
    SELECT it.*, it.v + CASE WHEN it.ordem = 1 THEN n.valor_total - sum(it.v) OVER (PARTITION BY it.doc) ELSE 0 END AS valor
      FROM itens it JOIN nota n ON n.id = it.doc
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
           CASE WHEN a.produto_id IS NOT NULL THEN NULL ELSE a.centro_custo_id END, a.valor, 0,
           CASE WHEN a.produto_id IS NOT NULL THEN 'regra "Estoque de mercadorias"' ELSE 'conta contábil dos itens da nota (tipo contábil)' END
      FROM itens_aj a JOIN nota n ON n.id = a.doc CROSS JOIN r WHERE a.valor > 0
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

-- ─────────────────────────────────────────────────────────────────────
-- 7. Orçamento (v23): vendas do frente de loja contam em "Outras receitas"
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION orcamento_realizado(p_ano integer)
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
     WHERE x.origem IN ('entrada', 'recebimento', 'entrada_avulsa', 'venda_pdv', 'diferenca_caixa')
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

-- ─────────────────────────────────────────────────────────────────────
-- 8. Nota de entrada grava o produto do item (igual à v11, mais produto_id)
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
                                       tipo_contabil_id, centro_custo_id, fiscal, produto_id)
  SELECT v_id, i.descricao, i.quantidade, i.valor_unitario, i.valor_total, i.tipo_contabil_id, i.centro_custo_id,
         coalesce(i.fiscal, '{}'::jsonb), i.produto_id
    FROM jsonb_to_recordset(v_itens) AS i(
      descricao text, quantidade numeric, valor_unitario numeric, valor_total numeric,
      tipo_contabil_id bigint, centro_custo_id bigint, fiscal jsonb, produto_id bigint);

  RETURN v_id;
END;
$$;
