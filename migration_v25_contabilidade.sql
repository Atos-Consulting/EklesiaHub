-- ═════════════════════════════════════════════════════════════════════
-- EklesiaHub — migration v25: contabilidade (partidas dobradas, regime de competência)
-- ═════════════════════════════════════════════════════════════════════
--  • lancamentos_contabeis + partidas_contabeis: o diário. Imutável (sem UPDATE/DELETE); erro se corrige
--    com estorno. Cada lançamento fecha débito = crédito (gatilho adiado).
--  • contabilizar(): gera sozinho os lançamentos do que já existe no sistema, inclusive o histórico, e
--    estorna os que deixaram de valer (nota cancelada, pagamento/entrada/movimento estornado, título
--    cancelado, saldo inicial alterado). É idempotente: a tela chama ao abrir o módulo Contábil.
--      Saldo inicial da conta caixa   D conta caixa            C Patrimônio social
--      Nota aprovada (emissão)        D conta de cada item     C Fornecedores (líquido) + Retenções
--      Conta a pagar sem nota         D Despesas sem nota      C Fornecedores
--      Conta a receber (emissão)      D Contas a receber       C Receita de contas a receber
--      Pagamento                      D Fornecedores (+ juros/multa em Despesas financeiras)
--                                     C conta caixa (+ desconto em Receitas financeiras)
--      Recebimento                    D conta caixa (+ desconto em Despesas financeiras)
--                                     C Contas a receber (+ juros/multa em Receitas financeiras)
--      Dízimo / oferta / campanha     D conta caixa            C receita do tipo
--      Transferência                  D conta destino          C conta origem
--      Saída avulsa                   D Saídas avulsas         C conta caixa
--      Entrada avulsa                 D conta caixa            C Entradas avulsas
--    Os nomes à direita são regras (regras_contabeis, Parâmetros → Contábil → Regras de contabilização).
--    Faltou uma conta (regra, conta do item, conta contábil da conta caixa): o evento fica pendente
--    (pendencias_contabeis) e entra quando a conta for informada.
--  • Mês fechado (v24): o lançamento automático de um evento com data no período fechado entra no 1º dia
--    depois dele (data_competencia guarda a data original); o manual não aceita data no período fechado.
--  • lancar_contabil (manual) e estornar_lancamento: Supervisor ou Administrador. Todos consultam.
--  • balancete(de, ate): saldo anterior, débitos e créditos por conta analítica (base de razão,
--    balancete, DRE e balanço na tela).
--  • Contas novas no plano (só se o código não existir): 1.1.04 Contas a receber, 4.3 Outras receitas,
--    4.4 Receitas financeiras, 5.5 Despesas financeiras, 5.6 Outras despesas.
-- Rodar depois da v24.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Regras de contabilização
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE regras_contabeis (
  empresa_id    bigint NOT NULL REFERENCES empresas(id),
  chave         text NOT NULL CHECK (chave IN ('patrimonio', 'fornecedores', 'retencoes', 'contas_receber', 'receita_receber',
                  'despesa_sem_nota', 'dizimo', 'oferta', 'campanha', 'entrada_avulsa', 'saida_avulsa',
                  'despesas_financeiras', 'receitas_financeiras')),
  conta_id      bigint NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, chave),
  CONSTRAINT regras_contabeis_conta_fk FOREIGN KEY (conta_id, empresa_id) REFERENCES plano_contas (id, empresa_id)
);
CREATE TRIGGER regras_contabeis_log_trg AFTER INSERT OR UPDATE OR DELETE ON regras_contabeis
  FOR EACH ROW EXECUTE FUNCTION registrar_log();

-- A conta da regra precisa ser analítica, ativa e da natureza esperada.
CREATE FUNCTION regras_contabeis_valida() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  c plano_contas%ROWTYPE;
  v_nat text := CASE
    WHEN NEW.chave IN ('fornecedores', 'retencoes') THEN 'passivo'
    WHEN NEW.chave = 'contas_receber' THEN 'ativo'
    WHEN NEW.chave = 'patrimonio' THEN 'patrimonio_social'
    WHEN NEW.chave IN ('receita_receber', 'dizimo', 'oferta', 'campanha', 'entrada_avulsa', 'receitas_financeiras') THEN 'receita'
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
CREATE TRIGGER regras_contabeis_valida_trg BEFORE INSERT OR UPDATE ON regras_contabeis
  FOR EACH ROW EXECUTE FUNCTION regras_contabeis_valida();

ALTER TABLE regras_contabeis ENABLE ROW LEVEL SECURITY;
CREATE POLICY regras_contabeis_select ON regras_contabeis FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY regras_contabeis_write ON regras_contabeis FOR ALL TO authenticated
  USING (empresa_id = minha_empresa_id() AND tem_nivel('administrador'))
  WITH CHECK (empresa_id = minha_empresa_id() AND tem_nivel('administrador'));
REVOKE ALL ON regras_contabeis FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON regras_contabeis TO authenticated;
ALTER TABLE regras_contabeis ALTER COLUMN empresa_id SET DEFAULT minha_empresa_id();

CREATE FUNCTION conta_regra(p_empresa bigint, p_chave text) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT conta_id FROM regras_contabeis WHERE empresa_id = p_empresa AND chave = p_chave;
$$;

-- Contas que faltam no plano semeado (só cria se o código não existir e o pai existir e for sintético)
-- e as regras padrão (só onde a conta do código existir).
CREATE FUNCTION semear_contabilidade(p_empresa bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('1.1.04', 'Contas a receber', 'ativo', '1.1'), ('4.3', 'Outras receitas', 'receita', '4'),
      ('4.4', 'Receitas financeiras', 'receita', '4'), ('5.5', 'Despesas financeiras', 'despesa', '5'),
      ('5.6', 'Outras despesas', 'despesa', '5')) AS v(codigo, nome, natureza, pai)
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
                 ('despesas_financeiras', '5.5'), ('receitas_financeiras', '4.4')) AS v(chave, codigo)
    JOIN plano_contas c ON c.empresa_id = p_empresa AND c.codigo = v.codigo AND c.analitica AND c.ativo
   WHERE c.natureza = CASE
           WHEN v.chave IN ('fornecedores', 'retencoes') THEN 'passivo' WHEN v.chave = 'contas_receber' THEN 'ativo'
           WHEN v.chave = 'patrimonio' THEN 'patrimonio_social'
           WHEN v.chave IN ('receita_receber', 'dizimo', 'oferta', 'campanha', 'entrada_avulsa', 'receitas_financeiras') THEN 'receita'
           ELSE 'despesa' END
  ON CONFLICT (empresa_id, chave) DO NOTHING;
END;
$$;
REVOKE EXECUTE ON FUNCTION semear_contabilidade(bigint), conta_regra(bigint, text) FROM PUBLIC, anon, authenticated;

-- Igreja nova também recebe (semear_financeiro é chamada por semear_empresa, depois do plano de contas).
CREATE OR REPLACE FUNCTION semear_financeiro(p_empresa bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM semear_formas_pagamento(p_empresa); -- v18: antes das condições, que apontam para as formas
  INSERT INTO condicoes_pagamento (empresa_id, nome, tipo, forma_pagamento, parcelas, dias_primeira, intervalo_dias)
  VALUES (p_empresa, 'À vista', 'a_vista', 'dinheiro', 1, 0, 30),
         (p_empresa, '30 dias', 'parcelado', 'boleto', 1, 30, 30),
         (p_empresa, '30/60/90 dias', 'parcelado', 'boleto', 3, 30, 30)
  ON CONFLICT (empresa_id, nome) DO NOTHING;
  PERFORM semear_contabilidade(p_empresa); -- v25
END;
$$;

SELECT semear_contabilidade(id) FROM empresas;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Diário
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE lancamentos_contabeis (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id        bigint NOT NULL REFERENCES empresas(id),
  data              date NOT NULL,
  data_competencia  date NOT NULL,
  historico         text NOT NULL CHECK (length(btrim(historico)) BETWEEN 1 AND 300),
  -- manual | abertura | nota | titulo_pagar | titulo_receber | pagamento | entrada | movimento
  origem            text NOT NULL CHECK (origem IN ('manual', 'abertura', 'nota', 'titulo_pagar', 'titulo_receber', 'pagamento', 'entrada', 'movimento')),
  origem_id         bigint,
  chave             text,          -- identifica o evento automático (origem + origem_id + chave = único)
  estorno_de        bigint REFERENCES lancamentos_contabeis(id),
  motivo_estorno    text,
  criado_por        uuid,
  criado_por_nome   text,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lancamentos_contabeis_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT lancamentos_contabeis_origem_ck CHECK ((origem = 'manual') = (origem_id IS NULL AND chave IS NULL))
);
-- Um evento automático tem no máximo um lançamento ativo (não estornado); contabilizar() garante, sob trava.
CREATE INDEX lancamentos_contabeis_evento_idx ON lancamentos_contabeis (empresa_id, origem, origem_id, chave) WHERE estorno_de IS NULL AND origem <> 'manual';
CREATE UNIQUE INDEX lancamentos_contabeis_estorno_uq ON lancamentos_contabeis (estorno_de) WHERE estorno_de IS NOT NULL;
CREATE INDEX lancamentos_contabeis_data_idx ON lancamentos_contabeis (empresa_id, data);

CREATE TABLE partidas_contabeis (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id      bigint NOT NULL REFERENCES empresas(id),
  lancamento_id   bigint NOT NULL,
  conta_id        bigint NOT NULL,
  centro_custo_id bigint,
  debito          numeric(15,2) NOT NULL DEFAULT 0 CHECK (debito >= 0),
  credito         numeric(15,2) NOT NULL DEFAULT 0 CHECK (credito >= 0),
  CHECK ((debito > 0) <> (credito > 0)),
  CONSTRAINT partidas_contabeis_lanc_fk FOREIGN KEY (lancamento_id, empresa_id) REFERENCES lancamentos_contabeis (id, empresa_id),
  CONSTRAINT partidas_contabeis_conta_fk FOREIGN KEY (conta_id, empresa_id) REFERENCES plano_contas (id, empresa_id),
  CONSTRAINT partidas_contabeis_centro_fk FOREIGN KEY (centro_custo_id, empresa_id) REFERENCES centros_custo (id, empresa_id)
);
CREATE INDEX partidas_contabeis_lanc_idx ON partidas_contabeis (lancamento_id);
CREATE INDEX partidas_contabeis_conta_idx ON partidas_contabeis (empresa_id, conta_id);

-- Débito = crédito em cada lançamento (conferido no fim da transação) e ao menos duas partidas.
CREATE FUNCTION partidas_contabeis_balanco() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_d numeric; v_c numeric; v_n integer;
BEGIN
  SELECT coalesce(sum(debito), 0), coalesce(sum(credito), 0), count(*) INTO v_d, v_c, v_n
    FROM partidas_contabeis WHERE lancamento_id = NEW.lancamento_id;
  IF v_d <> v_c THEN RAISE EXCEPTION 'Lançamento contábil desbalanceado: débitos % e créditos %.', v_d, v_c; END IF;
  IF v_n < 2 THEN RAISE EXCEPTION 'Um lançamento contábil precisa de ao menos duas partidas.'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER partidas_contabeis_balanco_trg AFTER INSERT ON partidas_contabeis
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION partidas_contabeis_balanco();

-- O diário não se altera nem se apaga (correção = estorno).
CREATE FUNCTION diario_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Lançamentos contábeis não podem ser alterados nem excluídos. Para corrigir, estorne.';
END;
$$;
CREATE TRIGGER lancamentos_contabeis_imutavel BEFORE UPDATE OR DELETE ON lancamentos_contabeis FOR EACH ROW EXECUTE FUNCTION diario_imutavel();
CREATE TRIGGER partidas_contabeis_imutavel BEFORE UPDATE OR DELETE ON partidas_contabeis FOR EACH ROW EXECUTE FUNCTION diario_imutavel();

ALTER TABLE lancamentos_contabeis ENABLE ROW LEVEL SECURITY;
ALTER TABLE partidas_contabeis ENABLE ROW LEVEL SECURITY;
CREATE POLICY lancamentos_contabeis_select ON lancamentos_contabeis FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY partidas_contabeis_select ON partidas_contabeis FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
REVOKE ALL ON lancamentos_contabeis, partidas_contabeis FROM anon;
REVOKE INSERT, UPDATE, DELETE ON lancamentos_contabeis, partidas_contabeis FROM authenticated;
GRANT SELECT ON lancamentos_contabeis, partidas_contabeis TO authenticated;

-- Conta com partidas não vira sintética nem muda de natureza; conta de regra não é desativada.
CREATE FUNCTION plano_contas_uso_contabil() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NOT NEW.analitica AND OLD.analitica OR NEW.natureza <> OLD.natureza)
     AND EXISTS (SELECT 1 FROM partidas_contabeis WHERE conta_id = OLD.id) THEN
    RAISE EXCEPTION 'A conta % - % já tem lançamentos contábeis: não pode virar sintética nem mudar de natureza.', OLD.codigo, OLD.nome;
  END IF;
  IF OLD.ativo AND NOT NEW.ativo AND EXISTS (SELECT 1 FROM regras_contabeis WHERE conta_id = OLD.id) THEN
    RAISE EXCEPTION 'A conta % - % é usada nas regras de contabilização. Troque a regra antes de desativar.', OLD.codigo, OLD.nome;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER plano_contas_uso_contabil_trg BEFORE UPDATE ON plano_contas FOR EACH ROW EXECUTE FUNCTION plano_contas_uso_contabil();

-- ─────────────────────────────────────────────────────────────────────
-- 3. Eventos automáticos
-- ─────────────────────────────────────────────────────────────────────

-- Todos os eventos que deveriam estar no diário hoje, com as partidas. conta_id nulo = falta conta (falta diz qual).
CREATE FUNCTION eventos_contabeis(p_emp bigint)
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
    (SELECT c FROM rg WHERE k = 'receitas_financeiras') AS rec_fin),
  cx AS (SELECT id, nome, conta_contabil_id AS conta FROM contas_caixa WHERE empresa_id = p_emp),
  -- notas: débito de cada item proporcional ao total da nota (frete, seguro, IPI etc. entram no custo dos itens);
  -- a sobra de centavos vai para o maior item
  nota AS (
    SELECT d.id, d.data_emissao, d.valor_total, d.tipo, d.numero, pe.nome AS fornecedor,
           (SELECT coalesce(sum(t.valor), 0) FROM titulos_financeiros t WHERE t.documento_id = d.id) AS liquido
      FROM documentos_entrada d LEFT JOIN pessoas pe ON pe.id = d.fornecedor_id
     WHERE d.empresa_id = p_emp AND d.status IN ('aprovada', 'lancada')
  ),
  itens AS (
    SELECT n.id AS doc, i.id AS item, i.conta_id, i.centro_custo_id,
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
           a.conta_id, a.centro_custo_id, a.valor, 0, 'conta contábil dos itens da nota (tipo contábil)'
      FROM itens_aj a JOIN nota n ON n.id = a.doc WHERE a.valor > 0
    UNION ALL
    SELECT 'nota', n.id, 'normal', n.data_emissao, upper(n.tipo) || ' ' || n.numero || coalesce(' — ' || n.fornecedor, ''),
           r.fornecedores, NULL, 0, n.liquido, 'regra "Fornecedores a pagar"'
      FROM nota n, r WHERE n.liquido > 0 AND EXISTS (SELECT 1 FROM itens_aj a WHERE a.doc = n.id AND a.valor > 0)
    UNION ALL
    SELECT 'nota', n.id, 'normal', n.data_emissao, upper(n.tipo) || ' ' || n.numero || coalesce(' — ' || n.fornecedor, ''),
           r.retencoes, NULL, 0, n.valor_total - n.liquido, 'regra "Retenções a recolher"'
      FROM nota n, r WHERE n.valor_total - n.liquido > 0 AND EXISTS (SELECT 1 FROM itens_aj a WHERE a.doc = n.id AND a.valor > 0)
    UNION ALL
    -- contas a pagar sem nota (contas fixas e lançamentos avulsos) e contas a receber, na emissão
    SELECT CASE t.natureza WHEN 'pagar' THEN 'titulo_pagar' ELSE 'titulo_receber' END, t.id, 'normal', t.emissao,
           t.descricao || CASE WHEN t.total_parcelas > 1 THEN ' — parcela ' || t.parcela || '/' || t.total_parcelas ELSE '' END || coalesce(' — ' || pe.nome, ''),
           CASE t.natureza WHEN 'pagar' THEN r.despesa_sem_nota ELSE r.contas_receber END, t.centro_custo_id, t.valor, 0,
           CASE t.natureza WHEN 'pagar' THEN 'regra "Contas a pagar sem nota"' ELSE 'regra "Contas a receber"' END
      FROM titulos_financeiros t LEFT JOIN pessoas pe ON pe.id = t.pessoa_id, r
     WHERE t.empresa_id = p_emp AND t.documento_id IS NULL AND t.status <> 'cancelado'
    UNION ALL
    SELECT CASE t.natureza WHEN 'pagar' THEN 'titulo_pagar' ELSE 'titulo_receber' END, t.id, 'normal', t.emissao,
           t.descricao || CASE WHEN t.total_parcelas > 1 THEN ' — parcela ' || t.parcela || '/' || t.total_parcelas ELSE '' END || coalesce(' — ' || pe.nome, ''),
           CASE t.natureza WHEN 'pagar' THEN r.fornecedores ELSE r.receita_receber END, NULL, 0, t.valor,
           CASE t.natureza WHEN 'pagar' THEN 'regra "Fornecedores a pagar"' ELSE 'regra "Receita de contas a receber"' END
      FROM titulos_financeiros t LEFT JOIN pessoas pe ON pe.id = t.pessoa_id, r
     WHERE t.empresa_id = p_emp AND t.documento_id IS NULL AND t.status <> 'cancelado'
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
        (t.natureza = 'pagar', r.fornecedores, NULL::bigint, p.valor_principal, 0::numeric, 'regra "Fornecedores a pagar"'),
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
  )
  SELECT origem, origem_id, chave, data, historico, conta_id, centro, debito, credito,
         CASE WHEN conta_id IS NULL THEN falta END
    FROM ev
   WHERE debito + credito > 0;
$$;

-- Data em que a fonte deixou de valer (cancelamento/estorno), para datar o estorno automático.
CREATE FUNCTION data_baixa_fonte(p_origem text, p_id bigint) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE p_origem
    WHEN 'nota' THEN (SELECT cancelado_em::date FROM documentos_entrada WHERE id = p_id)
    WHEN 'titulo_pagar' THEN (SELECT cancelado_em::date FROM titulos_financeiros WHERE id = p_id)
    WHEN 'titulo_receber' THEN (SELECT cancelado_em::date FROM titulos_financeiros WHERE id = p_id)
    WHEN 'pagamento' THEN (SELECT estornado_em::date FROM pagamentos WHERE id = p_id)
    WHEN 'entrada' THEN (SELECT estornado_em::date FROM entradas WHERE id = p_id)
    WHEN 'movimento' THEN (SELECT estornado_em::date FROM movimentos_caixa WHERE id = p_id)
  END;
$$;

-- Gera o que falta no diário e estorna o que deixou de valer. Devolve quantos lançamentos entraram.
CREATE FUNCTION contabilizar() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp   bigint := minha_empresa_id();
  v_fim   date;
  v_min   date;
  v_nome  text := (SELECT coalesce(nullif(btrim(nome), ''), email) FROM profiles WHERE user_id = auth.uid());
  v_n     integer := 0;
  e       record;
  l       record;
  v_id    bigint;
  v_data  date;
BEGIN
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Sem igreja.' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('contabilizar:' || v_emp, 0));
  v_fim := fechado_ate_empresa(v_emp);
  v_min := CASE WHEN v_fim IS NULL THEN NULL ELSE v_fim + 1 END;

  CREATE TEMP TABLE IF NOT EXISTS _ev_contabil (origem text, origem_id bigint, chave text, data date, historico text,
    conta_id bigint, centro_custo_id bigint, debito numeric, credito numeric, falta text) ON COMMIT DROP;
  TRUNCATE _ev_contabil;
  INSERT INTO _ev_contabil SELECT * FROM eventos_contabeis(v_emp);

  -- 1. estorna o que está no diário e não vale mais
  FOR l IN
    SELECT lc.* FROM lancamentos_contabeis lc
     WHERE lc.empresa_id = v_emp AND lc.origem <> 'manual' AND lc.estorno_de IS NULL
       AND NOT EXISTS (SELECT 1 FROM lancamentos_contabeis x WHERE x.estorno_de = lc.id)
       AND NOT EXISTS (SELECT 1 FROM _ev_contabil ev WHERE ev.origem = lc.origem AND ev.origem_id = lc.origem_id AND ev.chave = lc.chave)
     ORDER BY lc.id
  LOOP
    v_data := coalesce(CASE WHEN l.origem = 'abertura' THEN l.data_competencia ELSE data_baixa_fonte(l.origem, l.origem_id) END, current_date);
    INSERT INTO lancamentos_contabeis (empresa_id, data, data_competencia, historico, origem, origem_id, chave, estorno_de, motivo_estorno, criado_por, criado_por_nome)
    VALUES (v_emp, greatest(v_data, coalesce(v_min, v_data)), v_data, left('Estorno — ' || l.historico, 300), l.origem, l.origem_id, l.chave, l.id,
            CASE l.origem WHEN 'nota' THEN 'Nota cancelada' WHEN 'abertura' THEN 'Saldo inicial alterado'
                          WHEN 'titulo_pagar' THEN 'Conta cancelada' WHEN 'titulo_receber' THEN 'Conta cancelada' ELSE 'Estornado no Financeiro' END,
            auth.uid(), v_nome)
    RETURNING id INTO v_id;
    INSERT INTO partidas_contabeis (empresa_id, lancamento_id, conta_id, centro_custo_id, debito, credito)
    SELECT v_emp, v_id, p.conta_id, p.centro_custo_id, p.credito, p.debito FROM partidas_contabeis p WHERE p.lancamento_id = l.id;
    v_n := v_n + 1;
  END LOOP;

  -- 2. lança os eventos completos que ainda não estão no diário
  FOR e IN
    SELECT ev.origem, ev.origem_id, ev.chave, min(ev.data) AS data, min(ev.historico) AS historico
      FROM _ev_contabil ev
     WHERE NOT EXISTS (SELECT 1 FROM lancamentos_contabeis lc
                        WHERE lc.empresa_id = v_emp AND lc.origem = ev.origem AND lc.origem_id = ev.origem_id AND lc.chave = ev.chave AND lc.estorno_de IS NULL
                          AND NOT EXISTS (SELECT 1 FROM lancamentos_contabeis x WHERE x.estorno_de = lc.id))
     GROUP BY ev.origem, ev.origem_id, ev.chave
    HAVING bool_and(ev.conta_id IS NOT NULL) AND sum(ev.debito) = sum(ev.credito) AND sum(ev.debito) > 0
     ORDER BY min(ev.data), ev.origem, ev.origem_id
  LOOP
    INSERT INTO lancamentos_contabeis (empresa_id, data, data_competencia, historico, origem, origem_id, chave, criado_por, criado_por_nome)
    VALUES (v_emp, greatest(e.data, coalesce(v_min, e.data)), e.data, left(e.historico, 300), e.origem, e.origem_id, e.chave, auth.uid(), v_nome)
    RETURNING id INTO v_id;
    INSERT INTO partidas_contabeis (empresa_id, lancamento_id, conta_id, centro_custo_id, debito, credito)
    SELECT v_emp, v_id, ev.conta_id, ev.centro_custo_id, sum(ev.debito), sum(ev.credito)
      FROM _ev_contabil ev
     WHERE ev.origem = e.origem AND ev.origem_id = e.origem_id AND ev.chave = e.chave
     GROUP BY ev.conta_id, ev.centro_custo_id, (ev.debito > 0)
    HAVING sum(ev.debito) + sum(ev.credito) > 0;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- Eventos que ainda não entraram no diário porque falta conta.
CREATE FUNCTION pendencias_contabeis()
RETURNS TABLE (origem text, origem_id bigint, data date, historico text, valor numeric, faltas text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ev.origem, ev.origem_id, min(ev.data), min(ev.historico), sum(ev.debito), string_agg(DISTINCT ev.falta, '; ')
    FROM eventos_contabeis(minha_empresa_id()) ev
   WHERE NOT EXISTS (SELECT 1 FROM lancamentos_contabeis lc
                      WHERE lc.empresa_id = minha_empresa_id() AND lc.origem = ev.origem AND lc.origem_id = ev.origem_id
                        AND lc.chave = ev.chave AND lc.estorno_de IS NULL
                        AND NOT EXISTS (SELECT 1 FROM lancamentos_contabeis x WHERE x.estorno_de = lc.id))
   GROUP BY ev.origem, ev.origem_id, ev.chave
  HAVING bool_or(ev.conta_id IS NULL)
   ORDER BY min(ev.data), ev.origem, ev.origem_id;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Lançamento manual e estorno
-- ─────────────────────────────────────────────────────────────────────

-- p_partidas: [{ conta_id, centro_custo_id, debito, credito }]
CREATE FUNCTION lancar_contabil(p_data date, p_historico text, p_partidas jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp  bigint := minha_empresa_id();
  v_fim  date;
  v_id   bigint;
  p      jsonb;
  c      plano_contas%ROWTYPE;
  v_d    numeric(15,2);
  v_c    numeric(15,2);
  v_cc   bigint;
  v_td   numeric := 0;
  v_tc   numeric := 0;
BEGIN
  IF v_emp IS NULL OR NOT tem_nivel('administrador', 'supervisor') THEN
    RAISE EXCEPTION 'Somente Supervisor ou Administrador pode lançar na contabilidade.' USING ERRCODE = '42501';
  END IF;
  IF p_data IS NULL THEN RAISE EXCEPTION 'Informe a data.'; END IF;
  IF p_data > current_date THEN RAISE EXCEPTION 'A data não pode ser futura.'; END IF;
  v_fim := fechado_ate_empresa(v_emp);
  IF v_fim IS NOT NULL AND p_data <= v_fim THEN
    RAISE EXCEPTION 'O mês de % está fechado: lance com data depois de %.', to_char(date_trunc('month', v_fim), 'MM/YYYY'), to_char(v_fim, 'DD/MM/YYYY');
  END IF;
  IF length(btrim(coalesce(p_historico, ''))) < 3 THEN RAISE EXCEPTION 'Informe o histórico (mínimo de 3 caracteres).'; END IF;
  IF length(btrim(p_historico)) > 300 THEN RAISE EXCEPTION 'O histórico pode ter no máximo 300 caracteres.'; END IF;
  IF jsonb_typeof(p_partidas) <> 'array' OR jsonb_array_length(p_partidas) < 2 THEN
    RAISE EXCEPTION 'O lançamento precisa de ao menos duas partidas (um débito e um crédito).';
  END IF;
  IF jsonb_array_length(p_partidas) > 100 THEN RAISE EXCEPTION 'Partidas demais num lançamento.'; END IF;

  INSERT INTO lancamentos_contabeis (empresa_id, data, data_competencia, historico, origem, criado_por, criado_por_nome)
  VALUES (v_emp, p_data, p_data, btrim(p_historico), 'manual', auth.uid(),
          (SELECT coalesce(nullif(btrim(nome), ''), email) FROM profiles WHERE user_id = auth.uid()))
  RETURNING id INTO v_id;

  FOR p IN SELECT * FROM jsonb_array_elements(p_partidas) LOOP
    SELECT * INTO c FROM plano_contas WHERE id = (p->>'conta_id')::bigint AND empresa_id = v_emp;
    IF NOT FOUND THEN RAISE EXCEPTION 'Conta contábil não encontrada.'; END IF;
    IF NOT c.analitica THEN RAISE EXCEPTION 'A conta % - % é sintética: lance numa conta analítica.', c.codigo, c.nome; END IF;
    IF NOT c.ativo THEN RAISE EXCEPTION 'A conta % - % está inativa.', c.codigo, c.nome; END IF;
    v_d := round(coalesce(nullif(p->>'debito', '')::numeric, 0), 2);
    v_c := round(coalesce(nullif(p->>'credito', '')::numeric, 0), 2);
    IF v_d < 0 OR v_c < 0 OR (v_d > 0) = (v_c > 0) THEN
      RAISE EXCEPTION 'Cada partida tem débito ou crédito (só um dos dois, maior que zero).';
    END IF;
    v_cc := nullif(p->>'centro_custo_id', '')::bigint;
    IF v_cc IS NOT NULL AND NOT EXISTS (SELECT 1 FROM centros_custo WHERE id = v_cc AND empresa_id = v_emp) THEN
      RAISE EXCEPTION 'Centro de custo não encontrado.';
    END IF;
    INSERT INTO partidas_contabeis (empresa_id, lancamento_id, conta_id, centro_custo_id, debito, credito)
    VALUES (v_emp, v_id, c.id, v_cc, v_d, v_c);
    v_td := v_td + v_d; v_tc := v_tc + v_c;
  END LOOP;
  IF v_td <> v_tc THEN
    RAISE EXCEPTION 'Débitos (%) e créditos (%) precisam ser iguais.', moeda_br(v_td), moeda_br(v_tc);
  END IF;
  RETURN v_id;
END;
$$;

-- Estorna um lançamento manual (os automáticos se estornam sozinhos quando a origem é cancelada ou estornada).
CREATE FUNCTION estornar_lancamento(p_lancamento bigint, p_motivo text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp bigint := minha_empresa_id();
  l     lancamentos_contabeis%ROWTYPE;
  v_id  bigint;
  v_fim date;
BEGIN
  IF v_emp IS NULL OR NOT tem_nivel('administrador', 'supervisor') THEN
    RAISE EXCEPTION 'Somente Supervisor ou Administrador pode estornar lançamentos contábeis.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Informe o motivo (mínimo de 5 caracteres).'; END IF;
  IF length(btrim(p_motivo)) > 300 THEN RAISE EXCEPTION 'O motivo pode ter no máximo 300 caracteres.'; END IF;
  SELECT * INTO l FROM lancamentos_contabeis WHERE id = p_lancamento AND empresa_id = v_emp;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.'; END IF;
  IF l.origem <> 'manual' THEN
    RAISE EXCEPTION 'Lançamentos automáticos não se estornam aqui: cancele ou estorne a origem (nota, pagamento, entrada...) ou faça um lançamento manual de ajuste.';
  END IF;
  IF l.estorno_de IS NOT NULL THEN RAISE EXCEPTION 'Este lançamento já é um estorno.'; END IF;
  IF EXISTS (SELECT 1 FROM lancamentos_contabeis WHERE estorno_de = l.id) THEN RAISE EXCEPTION 'Este lançamento já foi estornado.'; END IF;
  v_fim := fechado_ate_empresa(v_emp);
  INSERT INTO lancamentos_contabeis (empresa_id, data, data_competencia, historico, origem, estorno_de, motivo_estorno, criado_por, criado_por_nome)
  VALUES (v_emp, current_date, current_date, left('Estorno — ' || l.historico, 300), 'manual', l.id, btrim(p_motivo), auth.uid(),
          (SELECT coalesce(nullif(btrim(nome), ''), email) FROM profiles WHERE user_id = auth.uid()))
  RETURNING id INTO v_id;
  INSERT INTO partidas_contabeis (empresa_id, lancamento_id, conta_id, centro_custo_id, debito, credito)
  SELECT v_emp, v_id, conta_id, centro_custo_id, credito, debito FROM partidas_contabeis WHERE lancamento_id = l.id;
  RETURN v_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Consultas
-- ─────────────────────────────────────────────────────────────────────

-- Diário para a tela: uma linha por partida, com o lançamento.
CREATE VIEW razao_contabil WITH (security_invoker = true) AS
SELECT p.id AS partida_id, l.id AS lancamento_id, l.empresa_id, l.data, l.data_competencia, l.historico, l.origem, l.origem_id,
       l.estorno_de, l.motivo_estorno, l.criado_por_nome, l.criado_em,
       EXISTS (SELECT 1 FROM lancamentos_contabeis x WHERE x.estorno_de = l.id) AS estornado,
       p.conta_id, pc.codigo AS conta_codigo, pc.nome AS conta_nome, pc.natureza AS conta_natureza,
       p.centro_custo_id, cc.nome AS centro_custo_nome, p.debito, p.credito
  FROM partidas_contabeis p
  JOIN lancamentos_contabeis l ON l.id = p.lancamento_id
  JOIN plano_contas pc ON pc.id = p.conta_id
  LEFT JOIN centros_custo cc ON cc.id = p.centro_custo_id;

-- Por conta analítica: débitos e créditos antes de p_de e entre p_de e p_ate (p_centro opcional).
CREATE FUNCTION balancete(p_de date, p_ate date, p_centro bigint DEFAULT NULL)
RETURNS TABLE (conta_id bigint, debito_anterior numeric, credito_anterior numeric, debito numeric, credito numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT p.conta_id,
         coalesce(sum(p.debito) FILTER (WHERE l.data < p_de), 0), coalesce(sum(p.credito) FILTER (WHERE l.data < p_de), 0),
         coalesce(sum(p.debito) FILTER (WHERE l.data >= p_de), 0), coalesce(sum(p.credito) FILTER (WHERE l.data >= p_de), 0)
    FROM partidas_contabeis p
    JOIN lancamentos_contabeis l ON l.id = p.lancamento_id
   WHERE l.data <= p_ate AND (p_centro IS NULL OR p.centro_custo_id = p_centro)
   GROUP BY p.conta_id;
$$;

REVOKE EXECUTE ON FUNCTION eventos_contabeis(bigint), data_baixa_fonte(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION contabilizar(), pendencias_contabeis(), lancar_contabil(date, text, jsonb),
  estornar_lancamento(bigint, text), balancete(date, date, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION contabilizar(), pendencias_contabeis(), lancar_contabil(date, text, jsonb),
  estornar_lancamento(bigint, text), balancete(date, date, bigint) TO authenticated;
