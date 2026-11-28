-- ═════════════════════════════════════════════════════════════════════
-- EklesiaHub — migration v26: tributos retidos (conta por tributo, guias a recolher e relatório)
-- ═════════════════════════════════════════════════════════════════════
--  • Nota ganha PIS e COFINS retidos (fiscal: pis_retido, cofins_retido), que também saem do valor pago
--    ao fornecedor (nota_retencoes).
--  • Cada retenção vai para a sua conta de passivo: INSS, IRRF, CSLL, PIS, COFINS e ISS retidos (regras
--    ret_*); "outras retenções" continua na regra retencoes. Contas novas no plano (se o código não
--    existir): 2.1.03 a 2.1.08.
--  • Guias a recolher: as retenções de cada tributo, somadas por mês de emissão da nota (competência), viram
--    uma conta a pagar ao órgão (titulos_financeiros.tributo_retido), recalculada sozinha quando uma nota é
--    aprovada ou cancelada (recalcular_guia). Já paga e chegou retenção nova: sai uma guia complementar.
--    Órgão e dia de vencimento (no mês seguinte) por tributo em tributos_guias (Parâmetros → Contábil →
--    Regras de contabilização, Administrador). Padrão: Receita Federal, dia 20, para os federais;
--    ISS dia 10, sem órgão até a igreja escolher a prefeitura (sem órgão, a guia não é gerada).
--  • A guia não gera despesa (a obrigação nasceu na nota): o pagamento baixa a conta do tributo contra o
--    caixa. Guia não se cancela nem muda de valor à mão: corrige-se a nota.
--  • retencoes_mes(mes): as retenções das notas do mês, por tributo (relatório para DCTFWeb / EFD-Reinf).
-- Rodar depois da v25.

-- ─────────────────────────────────────────────────────────────────────
-- 1. PIS e COFINS retidos na nota
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
                   'pis_aliquota', 'pis', 'cofins_aliquota', 'cofins', 'iss_aliquota', 'iss', 'inss', 'irrf', 'csll'];
    strs  := ARRAY['ncm', 'cfop', 'unidade', 'cst'];
    bools := ARRAY[]::text[];
  ELSE
    nums  := ARRAY['icms_base', 'icms', 'icms_st_base', 'icms_st', 'ipi_base', 'ipi', 'pis_base', 'pis', 'cofins_base',
                   'cofins', 'iss_base', 'iss_aliquota', 'iss', 'inss', 'irrf', 'csll', 'pis_retido', 'cofins_retido',
                   'outras_retencoes', 'total_tributos'];
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

-- Total retido (sai do valor pago ao fornecedor). A tela repete em centavosRetencoes() (financeiro.js).
CREATE OR REPLACE FUNCTION nota_retencoes(f jsonb) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce((f->>'inss')::numeric, 0) + coalesce((f->>'irrf')::numeric, 0) + coalesce((f->>'csll')::numeric, 0)
       + coalesce((f->>'pis_retido')::numeric, 0) + coalesce((f->>'cofins_retido')::numeric, 0)
       + coalesce((f->>'outras_retencoes')::numeric, 0)
       + CASE WHEN coalesce((f->>'iss_retido')::boolean, false) THEN coalesce((f->>'iss')::numeric, 0) ELSE 0 END
$$;

-- Valor de um tributo retido na nota. ISS só conta se for retido pelo tomador.
CREATE FUNCTION retencao_nota(f jsonb, p_tributo text) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_tributo
    WHEN 'iss' THEN CASE WHEN coalesce((f->>'iss_retido')::boolean, false) THEN coalesce((f->>'iss')::numeric, 0) ELSE 0 END
    WHEN 'pis' THEN coalesce((f->>'pis_retido')::numeric, 0)
    WHEN 'cofins' THEN coalesce((f->>'cofins_retido')::numeric, 0)
    ELSE coalesce((f->>p_tributo)::numeric, 0) END
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Regras e contas por tributo
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE regras_contabeis DROP CONSTRAINT regras_contabeis_chave_check;
ALTER TABLE regras_contabeis ADD CONSTRAINT regras_contabeis_chave_check CHECK (chave IN ('patrimonio', 'fornecedores', 'retencoes',
  'contas_receber', 'receita_receber', 'despesa_sem_nota', 'dizimo', 'oferta', 'campanha', 'entrada_avulsa', 'saida_avulsa',
  'despesas_financeiras', 'receitas_financeiras', 'ret_inss', 'ret_irrf', 'ret_csll', 'ret_pis', 'ret_cofins', 'ret_iss'));

CREATE OR REPLACE FUNCTION regras_contabeis_valida() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  c plano_contas%ROWTYPE;
  v_nat text := CASE
    WHEN NEW.chave IN ('fornecedores', 'retencoes', 'ret_inss', 'ret_irrf', 'ret_csll', 'ret_pis', 'ret_cofins', 'ret_iss') THEN 'passivo'
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

CREATE TABLE tributos_guias (
  empresa_id     bigint NOT NULL DEFAULT minha_empresa_id() REFERENCES empresas(id),
  tributo        text NOT NULL CHECK (tributo IN ('inss', 'irrf', 'csll', 'pis', 'cofins', 'iss')),
  pessoa_id      bigint,
  dia_vencimento integer NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, tributo),
  CONSTRAINT tributos_guias_pessoa_fk FOREIGN KEY (pessoa_id, empresa_id) REFERENCES pessoas (id, empresa_id)
);
CREATE TRIGGER tributos_guias_log_trg AFTER INSERT OR UPDATE OR DELETE ON tributos_guias
  FOR EACH ROW EXECUTE FUNCTION registrar_log();
ALTER TABLE tributos_guias ENABLE ROW LEVEL SECURITY;
CREATE POLICY tributos_guias_select ON tributos_guias FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY tributos_guias_write ON tributos_guias FOR ALL TO authenticated
  USING (empresa_id = minha_empresa_id() AND tem_nivel('administrador'))
  WITH CHECK (empresa_id = minha_empresa_id() AND tem_nivel('administrador'));
REVOKE ALL ON tributos_guias FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON tributos_guias TO authenticated;

ALTER TABLE titulos_financeiros
  ADD COLUMN tributo_retido text CHECK (tributo_retido IN ('inss', 'irrf', 'csll', 'pis', 'cofins', 'iss')),
  ADD CONSTRAINT titulos_financeiros_guia_ck CHECK (tributo_retido IS NULL OR (natureza = 'pagar' AND documento_id IS NULL AND conta_fixa_id IS NULL AND competencia IS NOT NULL));
CREATE INDEX titulos_financeiros_guia_idx ON titulos_financeiros (empresa_id, tributo_retido, competencia) WHERE tributo_retido IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Guias a recolher
-- ─────────────────────────────────────────────────────────────────────

-- Ajusta a guia de um tributo numa competência: devido (retenções das notas aprovadas) − pago − outras guias
-- em aberto. Cria, muda o valor ou cancela a guia em aberto mais recente.
CREATE FUNCTION recalcular_guia(p_emp bigint, p_tributo text, p_comp date) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g        tributos_guias%ROWTYPE;
  v_comp   date := date_trunc('month', p_comp)::date;
  v_prox   date := (date_trunc('month', p_comp) + interval '1 month')::date;
  v_dev    numeric;
  v_pago   numeric;
  v_outras numeric;
  v_falta  numeric;
  t        titulos_financeiros%ROWTYPE;
  v_nome   text := CASE p_tributo WHEN 'inss' THEN 'INSS retido' WHEN 'irrf' THEN 'IRRF retido' WHEN 'csll' THEN 'CSLL retida'
                    WHEN 'pis' THEN 'PIS retido' WHEN 'cofins' THEN 'COFINS retida' ELSE 'ISS retido' END;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('guia:' || p_emp || ':' || p_tributo || ':' || v_comp, 0));
  PERFORM set_config('eklesia.guia', '1', true);
  SELECT coalesce(sum(retencao_nota(fiscal, p_tributo)), 0) INTO v_dev FROM documentos_entrada
   WHERE empresa_id = p_emp AND status IN ('aprovada', 'lancada') AND date_trunc('month', data_emissao) = v_comp;
  SELECT coalesce(sum(valor), 0) INTO v_pago FROM titulos_financeiros
   WHERE empresa_id = p_emp AND tributo_retido = p_tributo AND competencia = v_comp AND status = 'pago';
  SELECT * INTO t FROM titulos_financeiros
   WHERE empresa_id = p_emp AND tributo_retido = p_tributo AND competencia = v_comp AND status = 'aberto'
   ORDER BY id DESC LIMIT 1;
  SELECT coalesce(sum(valor), 0) INTO v_outras FROM titulos_financeiros
   WHERE empresa_id = p_emp AND tributo_retido = p_tributo AND competencia = v_comp AND status = 'aberto' AND id IS DISTINCT FROM t.id;
  v_falta := v_dev - v_pago - v_outras;

  IF v_falta > 0 THEN
    IF t.id IS NOT NULL THEN
      IF t.valor <> v_falta THEN UPDATE titulos_financeiros SET valor = v_falta WHERE id = t.id; END IF;
    ELSE
      SELECT * INTO g FROM tributos_guias WHERE empresa_id = p_emp AND tributo = p_tributo;
      IF g.pessoa_id IS NULL THEN RETURN; END IF; -- sem órgão: a guia sai quando a igreja escolher
      INSERT INTO titulos_financeiros (empresa_id, natureza, pessoa_id, descricao, parcela, total_parcelas, emissao, vencimento, valor,
                                       competencia, tributo_retido)
      VALUES (p_emp, 'pagar', g.pessoa_id,
              v_nome || ' — competência ' || to_char(v_comp, 'MM/YYYY') || CASE WHEN v_pago > 0 THEN ' (complementar)' ELSE '' END,
              1, 1, current_date,
              make_date(extract(year FROM v_prox)::int, extract(month FROM v_prox)::int,
                        least(g.dia_vencimento, extract(day FROM v_prox + interval '1 month' - interval '1 day')::int)),
              v_falta, v_comp, p_tributo);
    END IF;
  ELSIF t.id IS NOT NULL THEN
    UPDATE titulos_financeiros SET status = 'cancelado', cancelado_em = now(),
           motivo_cancelamento = 'Retenções da competência canceladas ou já recolhidas'
     WHERE id = t.id;
  END IF;
END;
$$;

-- Guia não se cancela nem muda de valor à mão (só recalcular_guia).
CREATE FUNCTION titulos_guia_protege() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.tributo_retido IS NOT NULL AND coalesce(current_setting('eklesia.guia', true), '') <> '1'
     AND (NEW.valor <> OLD.valor OR (NEW.status = 'cancelado' AND OLD.status <> 'cancelado')) THEN
    RAISE EXCEPTION 'A guia de tributo retido é calculada pelas notas: para mudar, cancele ou corrija a nota de entrada.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER titulos_guia_protege_trg BEFORE UPDATE OF valor, status ON titulos_financeiros
  FOR EACH ROW EXECUTE FUNCTION titulos_guia_protege();

-- Nota aprovada ou cancelada: refaz as guias da competência da nota.
CREATE FUNCTION documentos_entrada_guias() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_t text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND (NEW.status IN ('aprovada', 'lancada', 'cancelada') OR OLD.status IN ('aprovada', 'lancada'))
     AND nota_retencoes(NEW.fiscal) > 0 THEN
    FOREACH v_t IN ARRAY ARRAY['inss', 'irrf', 'csll', 'pis', 'cofins', 'iss'] LOOP
      IF retencao_nota(NEW.fiscal, v_t) > 0 THEN PERFORM recalcular_guia(NEW.empresa_id, v_t, NEW.data_emissao); END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER documentos_entrada_guias_trg AFTER UPDATE OF status ON documentos_entrada
  FOR EACH ROW EXECUTE FUNCTION documentos_entrada_guias();

-- Órgão escolhido ou trocado: gera as guias que estavam esperando.
CREATE FUNCTION tributos_guias_recalcula() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c date;
BEGIN
  IF NEW.pessoa_id IS NULL THEN RETURN NULL; END IF;
  FOR c IN SELECT DISTINCT date_trunc('month', data_emissao)::date FROM documentos_entrada
            WHERE empresa_id = NEW.empresa_id AND status IN ('aprovada', 'lancada') AND retencao_nota(fiscal, NEW.tributo) > 0
  LOOP
    PERFORM recalcular_guia(NEW.empresa_id, NEW.tributo, c);
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE TRIGGER tributos_guias_recalcula_trg AFTER INSERT OR UPDATE OF pessoa_id ON tributos_guias
  FOR EACH ROW EXECUTE FUNCTION tributos_guias_recalcula();

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
                 ('ret_pis', '2.1.07'), ('ret_cofins', '2.1.08')) AS v(chave, codigo)
    JOIN plano_contas c ON c.empresa_id = p_empresa AND c.codigo = v.codigo AND c.analitica AND c.ativo
   WHERE c.natureza = CASE
    WHEN v.chave IN ('fornecedores', 'retencoes', 'ret_inss', 'ret_irrf', 'ret_csll', 'ret_pis', 'ret_cofins', 'ret_iss') THEN 'passivo'
    WHEN v.chave = 'contas_receber' THEN 'ativo'
    WHEN v.chave = 'patrimonio' THEN 'patrimonio_social'
    WHEN v.chave IN ('receita_receber', 'dizimo', 'oferta', 'campanha', 'entrada_avulsa', 'receitas_financeiras') THEN 'receita'
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

-- Igrejas que já existem: contas, regras, órgão padrão e as guias das notas já aprovadas.
SELECT semear_contabilidade(id) FROM empresas;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Relatório mensal de retenções
-- ─────────────────────────────────────────────────────────────────────

-- Notas aprovadas com emissão no mês e alguma retenção (SECURITY INVOKER: RLS da igreja).
CREATE FUNCTION retencoes_mes(p_mes date)
RETURNS TABLE (documento_id bigint, tipo text, numero text, serie text, data_emissao date, fornecedor_nome text, fornecedor_documento text,
               valor_total numeric, base_iss numeric, inss numeric, irrf numeric, csll numeric, pis numeric, cofins numeric, iss numeric, outras numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT d.id, d.tipo, d.numero, d.serie, d.data_emissao, pe.nome, pe.documento, d.valor_total,
         (d.fiscal->>'iss_base')::numeric,
         retencao_nota(d.fiscal, 'inss'), retencao_nota(d.fiscal, 'irrf'), retencao_nota(d.fiscal, 'csll'),
         retencao_nota(d.fiscal, 'pis'), retencao_nota(d.fiscal, 'cofins'), retencao_nota(d.fiscal, 'iss'),
         coalesce((d.fiscal->>'outras_retencoes')::numeric, 0)
    FROM documentos_entrada d
    LEFT JOIN pessoas pe ON pe.id = d.fornecedor_id
   WHERE d.status IN ('aprovada', 'lancada') AND date_trunc('month', d.data_emissao) = date_trunc('month', p_mes)
     AND nota_retencoes(d.fiscal) > 0
   ORDER BY d.data_emissao, d.id;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Contabilização (v25) com tributo por conta e guia baixando a obrigação
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
    (SELECT c FROM rg WHERE k = 'ret_pis') AS ret_pis, (SELECT c FROM rg WHERE k = 'ret_cofins') AS ret_cofins),
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
  )
  SELECT origem, origem_id, chave, data, historico, conta_id, centro, debito, credito,
         CASE WHEN conta_id IS NULL THEN falta END
    FROM ev
   WHERE debito + credito > 0;
$$;

REVOKE EXECUTE ON FUNCTION recalcular_guia(bigint, text, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION retencoes_mes(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION retencoes_mes(date) TO authenticated;
