-- ═════════════════════════════════════════════════════════════════════
-- EklesiaHub — migration v20: contas fixas mensais
-- ═════════════════════════════════════════════════════════════════════
-- Despesas e receitas que se repetem todo mês sem nota (aluguel, prebenda, internet, aluguel do
-- salão recebido): cadastradas uma vez em Financeiro → Lançamentos → Contas fixas (Supervisor+).
--  • gerar_contas_fixas() cria o título de cada mês (competência) desde o início da conta fixa até o
--    mês que vem, sem duplicar (único por conta fixa + competência). A tela chama ao abrir Lançamentos;
--    qualquer nível pode disparar, porque só gera o que o cadastro já define.
--  • O título sai com a pessoa, valor, forma, conta caixa e centro da conta fixa; vencimento no dia
--    escolhido (ou no último dia do mês, se o mês for mais curto).
--  • Alterar ou desativar a conta fixa vale para os meses ainda não gerados.
--  • cancelar_titulo_receber passa a cancelar também conta a pagar sem nota.
-- Rodar depois da v19.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Cadastro
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE contas_fixas (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id         bigint NOT NULL DEFAULT minha_empresa_id() REFERENCES empresas(id),
  natureza           text NOT NULL CHECK (natureza IN ('pagar', 'receber')),
  descricao          text NOT NULL CHECK (length(btrim(descricao)) BETWEEN 1 AND 120),
  pessoa_id          bigint NOT NULL,
  valor              numeric(15,2) NOT NULL CHECK (valor > 0),
  dia_vencimento     integer NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
  inicio             date NOT NULL CHECK (extract(day FROM inicio) = 1),
  fim                date CHECK (fim IS NULL OR extract(day FROM fim) = 1),
  forma_pagamento_id bigint,
  conta_caixa_id     bigint,
  centro_custo_id    bigint,
  observacao         text CHECK (observacao IS NULL OR length(observacao) <= 500),
  gerado_ate         date,  -- última competência (1º dia do mês) já gerada
  ativo              boolean NOT NULL DEFAULT true,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contas_fixas_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT contas_fixas_periodo_ck CHECK (fim IS NULL OR fim >= inicio),
  CONSTRAINT contas_fixas_centro_ck CHECK (natureza = 'receber' OR centro_custo_id IS NOT NULL),
  CONSTRAINT contas_fixas_pessoa_fk FOREIGN KEY (pessoa_id, empresa_id) REFERENCES pessoas (id, empresa_id),
  CONSTRAINT contas_fixas_forma_fk FOREIGN KEY (forma_pagamento_id, empresa_id) REFERENCES formas_pagamento (id, empresa_id),
  CONSTRAINT contas_fixas_caixa_fk FOREIGN KEY (conta_caixa_id, empresa_id) REFERENCES contas_caixa (id, empresa_id),
  CONSTRAINT contas_fixas_centro_fk FOREIGN KEY (centro_custo_id, empresa_id) REFERENCES centros_custo (id, empresa_id)
);
CREATE TRIGGER contas_fixas_atualizado BEFORE UPDATE ON contas_fixas
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
CREATE TRIGGER contas_fixas_log_trg AFTER INSERT OR UPDATE OR DELETE ON contas_fixas
  FOR EACH ROW EXECUTE FUNCTION registrar_log();

-- gerado_ate é do sistema: a tela não mexe (nem o "salvar" do cadastro).
CREATE FUNCTION contas_fixas_regras() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.gerado_ate := NULL;
  ELSIF NEW.gerado_ate IS DISTINCT FROM OLD.gerado_ate AND current_setting('eklesia.gerando_fixas', true) IS DISTINCT FROM 'sim' THEN
    NEW.gerado_ate := OLD.gerado_ate;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.natureza IS DISTINCT FROM OLD.natureza AND OLD.gerado_ate IS NOT NULL THEN
    RAISE EXCEPTION 'Esta conta fixa já gerou lançamentos: não dá para trocar entre pagar e receber. Desative e cadastre outra.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER contas_fixas_regras_trg BEFORE INSERT OR UPDATE ON contas_fixas
  FOR EACH ROW EXECUTE FUNCTION contas_fixas_regras();

ALTER TABLE contas_fixas ENABLE ROW LEVEL SECURITY;
CREATE POLICY contas_fixas_select ON contas_fixas FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY contas_fixas_write ON contas_fixas FOR ALL TO authenticated
  USING (empresa_id = minha_empresa_id() AND tem_nivel('administrador', 'supervisor'))
  WITH CHECK (empresa_id = minha_empresa_id() AND tem_nivel('administrador', 'supervisor'));
REVOKE ALL ON contas_fixas FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON contas_fixas TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Títulos ligados à conta fixa
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE titulos_financeiros
  ADD COLUMN conta_fixa_id bigint,
  ADD COLUMN competencia   date,
  ADD CONSTRAINT titulos_financeiros_conta_fixa_fk FOREIGN KEY (conta_fixa_id, empresa_id) REFERENCES contas_fixas (id, empresa_id),
  ADD CONSTRAINT titulos_financeiros_competencia_uq UNIQUE (conta_fixa_id, competencia),
  ADD CONSTRAINT titulos_financeiros_fixa_sem_nota_ck CHECK (conta_fixa_id IS NULL OR documento_id IS NULL);

-- Gera os títulos das contas fixas da igreja até o mês que vem. Devolve quantos criou.
CREATE FUNCTION gerar_contas_fixas() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa bigint := minha_empresa_id();
  v_limite  date := (date_trunc('month', current_date) + interval '1 month')::date;
  f         contas_fixas%ROWTYPE;
  v_mes     date;
  v_ate     date;
  v_forma   bigint;
  v_qtd     integer := 0;
  v_n       integer;
BEGIN
  IF v_empresa IS NULL OR NOT tem_nivel('administrador', 'supervisor', 'usuario') THEN
    RAISE EXCEPTION 'Sem acesso a esta igreja.';
  END IF;
  PERFORM set_config('eklesia.gerando_fixas', 'sim', true);
  FOR f IN SELECT * FROM contas_fixas WHERE empresa_id = v_empresa AND ativo ORDER BY id FOR UPDATE LOOP
    v_mes := CASE WHEN f.gerado_ate IS NULL THEN f.inicio ELSE (f.gerado_ate + interval '1 month')::date END;
    v_ate := least(v_limite, coalesce(f.fim, v_limite));
    -- forma inativa não entra no título novo (o gatilho recusaria)
    SELECT id INTO v_forma FROM formas_pagamento WHERE id = f.forma_pagamento_id AND ativo;
    WHILE v_mes <= v_ate LOOP
      INSERT INTO titulos_financeiros (empresa_id, natureza, documento_id, pessoa_id, descricao, parcela, total_parcelas,
                                       emissao, vencimento, valor, forma_pagamento_id, conta_caixa_id, centro_custo_id,
                                       observacao, conta_fixa_id, competencia)
      VALUES (v_empresa, f.natureza, NULL, f.pessoa_id, f.descricao || ' — ' || to_char(v_mes, 'MM/YYYY'), 1, 1,
              v_mes, v_mes + (least(f.dia_vencimento, extract(day FROM (v_mes + interval '1 month' - interval '1 day'))::int) - 1),
              f.valor, v_forma, f.conta_caixa_id, f.centro_custo_id, f.observacao, f.id, v_mes)
      ON CONFLICT (conta_fixa_id, competencia) DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_qtd := v_qtd + v_n;
      UPDATE contas_fixas SET gerado_ate = v_mes WHERE id = f.id;
      v_mes := (v_mes + interval '1 month')::date;
    END LOOP;
  END LOOP;
  PERFORM set_config('eklesia.gerando_fixas', '', true);
  RETURN v_qtd;
END;
$$;
REVOKE EXECUTE ON FUNCTION gerar_contas_fixas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION gerar_contas_fixas() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Views e cancelamento
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW titulos_pagar WITH (security_invoker = true) AS
SELECT t.id, t.empresa_id, t.documento_id, t.pessoa_id, t.descricao, t.parcela, t.total_parcelas, t.emissao,
       t.vencimento, t.valor, t.forma_pagamento, t.conta_caixa_id, t.centro_custo_id, t.status, t.cancelado_em,
       t.motivo_cancelamento, t.criado_em,
       pe.nome AS fornecedor_nome, pe.documento AS fornecedor_documento, pe.tipo_pessoa AS fornecedor_tipo,
       d.tipo AS documento_tipo, d.numero AS documento_numero, d.serie AS documento_serie,
       pg.id AS pagamento_id, pg.data_pagamento, pg.valor_pago, pg.juros, pg.multa, pg.desconto,
       pg.conta_caixa_id AS pagamento_conta_caixa_id, pg.origem AS pagamento_origem,
       t.linha_digitavel, t.pix_chave, t.banco, t.agencia, t.conta, t.observacao,
       pg.observacao AS pagamento_observacao,
       t.forma_pagamento_id, fp.nome AS forma_pagamento_nome,
       t.conta_fixa_id, t.competencia
  FROM titulos_financeiros t
  JOIN pessoas pe ON pe.id = t.pessoa_id
  LEFT JOIN documentos_entrada d ON d.id = t.documento_id
  LEFT JOIN formas_pagamento fp ON fp.id = t.forma_pagamento_id
  LEFT JOIN pagamentos pg ON pg.titulo_id = t.id AND NOT pg.estornado
 WHERE t.natureza = 'pagar';

CREATE OR REPLACE VIEW titulos_receber WITH (security_invoker = true) AS
SELECT t.id, t.empresa_id, t.documento_id, t.pessoa_id, t.descricao, t.parcela, t.total_parcelas, t.emissao,
       t.vencimento, t.valor, t.forma_pagamento, t.conta_caixa_id, t.centro_custo_id, t.status, t.cancelado_em,
       t.motivo_cancelamento, t.criado_em,
       pe.nome AS fornecedor_nome, pe.documento AS fornecedor_documento, pe.tipo_pessoa AS fornecedor_tipo,
       NULL::text AS documento_tipo, NULL::text AS documento_numero, NULL::text AS documento_serie,
       pg.id AS pagamento_id, pg.data_pagamento, pg.valor_pago, pg.juros, pg.multa, pg.desconto,
       pg.conta_caixa_id AS pagamento_conta_caixa_id, pg.origem AS pagamento_origem,
       t.linha_digitavel, t.pix_chave, t.banco, t.agencia, t.conta, t.observacao,
       pg.observacao AS pagamento_observacao,
       t.forma_pagamento_id, fp.nome AS forma_pagamento_nome,
       t.conta_fixa_id, t.competencia
  FROM titulos_financeiros t
  JOIN pessoas pe ON pe.id = t.pessoa_id
  LEFT JOIN formas_pagamento fp ON fp.id = t.forma_pagamento_id
  LEFT JOIN pagamentos pg ON pg.titulo_id = t.id AND NOT pg.estornado
 WHERE t.natureza = 'receber';

CREATE OR REPLACE FUNCTION cancelar_titulo_receber(p_titulo bigint, p_motivo text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t titulos_financeiros%ROWTYPE;
BEGIN
  IF NOT tem_nivel('administrador', 'supervisor') THEN
    RAISE EXCEPTION 'Somente Supervisor ou Administrador pode cancelar parcelas.';
  END IF;
  IF length(btrim(coalesce(p_motivo, ''))) < 5 THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento (mínimo de 5 caracteres).';
  END IF;
  IF length(btrim(p_motivo)) > 300 THEN RAISE EXCEPTION 'O motivo pode ter no máximo 300 caracteres.'; END IF;
  SELECT * INTO t FROM titulos_financeiros WHERE id = p_titulo AND empresa_id = minha_empresa_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Título não encontrado.'; END IF;
  -- v20: vale para conta a receber e para conta a pagar sem nota (ex.: conta fixa).
  IF t.documento_id IS NOT NULL THEN
    RAISE EXCEPTION 'Conta a pagar de nota de entrada é cancelada pela nota que a gerou.';
  END IF;
  IF t.status <> 'aberto' THEN
    RAISE EXCEPTION 'Só é possível cancelar parcelas em aberto (situação: %). Se já foi paga ou recebida, estorne antes.', t.status;
  END IF;
  UPDATE titulos_financeiros SET status = 'cancelado', cancelado_em = now(), motivo_cancelamento = btrim(p_motivo)
   WHERE id = t.id;
END;
$$;
