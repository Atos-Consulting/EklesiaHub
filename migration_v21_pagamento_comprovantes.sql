-- ═════════════════════════════════════════════════════════════════════
-- EklesiaHub — migration v21: dados de pagamento, comprovantes e fechamento do dia
-- ═════════════════════════════════════════════════════════════════════
--  • Dados de pagamento completos por forma: PIX ganha o tipo da chave; transferência ganha tipo de
--    conta, titular e CPF/CNPJ do titular; cheque ganha o número. atualizar_titulo grava tudo.
--  • Cada pagamento/recebimento guarda a forma usada (vem do lançamento na hora da baixa). O
--    extrato_caixa passa a trazer a forma (entradas e pagamentos), para o fechamento do dia por forma.
--  • Comprovantes (PDF, PNG, JPG até 10 MB) anexados a pagamentos/recebimentos e a movimentos de
--    caixa, no bucket privado "comprovantes" (<empresa>/<arquivo>). Anexar e remover: Supervisor+.
--    O comprovante não mexe em saldo, então pode ser anexado mesmo com o período conciliado.
--  • Fechamento do dia: a conciliação guarda a contagem de cédulas e moedas (opcional); com contagem,
--    o saldo informado tem de ser a soma contada.
-- Rodar depois da v20.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Dados de pagamento dos lançamentos
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE titulos_financeiros
  ADD COLUMN pix_tipo          text CHECK (pix_tipo IS NULL OR pix_tipo IN ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria')),
  ADD COLUMN tipo_conta        text CHECK (tipo_conta IS NULL OR tipo_conta IN ('corrente', 'poupanca', 'pagamento')),
  ADD COLUMN titular           text CHECK (titular IS NULL OR length(titular) <= 120),
  ADD COLUMN titular_documento text CHECK (titular_documento IS NULL OR titular_documento ~ '^([0-9]{11}|[0-9A-Z]{14})$'),
  ADD COLUMN cheque_numero     text CHECK (cheque_numero IS NULL OR length(cheque_numero) <= 20);

CREATE OR REPLACE FUNCTION atualizar_titulo(p_titulo bigint, p_dados jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_forma text := nullif(p_dados->>'forma_pagamento', '');
  v_forma_id bigint := nullif(p_dados->>'forma_pagamento_id', '')::bigint; -- v18: cadastro de formas
  v_linha text := nullif(regexp_replace(coalesce(p_dados->>'linha_digitavel', ''), '\D', '', 'g'), '');
  v_venc  date := nullif(p_dados->>'vencimento', '')::date;
  v_pix_tipo text := nullif(p_dados->>'pix_tipo', '');
  v_tipo_conta text := nullif(p_dados->>'tipo_conta', '');
  v_doc   text := nullif(upper(regexp_replace(coalesce(p_dados->>'titular_documento', ''), '[^0-9A-Za-z]', '', 'g')), '');
BEGIN
  IF NOT tem_nivel('administrador', 'supervisor') THEN
    RAISE EXCEPTION 'Somente Supervisor ou Administrador pode alterar lançamentos.' USING ERRCODE = '42501';
  END IF;
  IF v_venc IS NULL THEN RAISE EXCEPTION 'Informe o vencimento.'; END IF;
  IF v_forma IS NOT NULL AND v_forma NOT IN ('dinheiro', 'pix', 'boleto', 'transferencia', 'cartao_credito',
                                             'cartao_debito', 'cheque', 'outro') THEN
    RAISE EXCEPTION 'Forma de pagamento inválida.';
  END IF;
  IF v_linha IS NOT NULL AND length(v_linha) NOT BETWEEN 44 AND 48 THEN
    RAISE EXCEPTION 'A linha digitável / código de barras deve ter de 44 a 48 números (tem %).', length(v_linha);
  END IF;
  IF v_pix_tipo IS NOT NULL AND v_pix_tipo NOT IN ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria') THEN
    RAISE EXCEPTION 'Tipo de chave PIX inválido.';
  END IF;
  IF v_tipo_conta IS NOT NULL AND v_tipo_conta NOT IN ('corrente', 'poupanca', 'pagamento') THEN
    RAISE EXCEPTION 'Tipo de conta inválido.';
  END IF;
  IF v_doc IS NOT NULL AND v_doc !~ '^([0-9]{11}|[0-9A-Z]{14})$' THEN
    RAISE EXCEPTION 'O CPF/CNPJ do titular deve ter 11 (CPF) ou 14 (CNPJ) caracteres.';
  END IF;

  UPDATE titulos_financeiros SET
    vencimento      = v_venc,
    forma_pagamento = CASE WHEN v_forma_id IS NULL THEN v_forma END, -- com o id, o gatilho preenche o comportamento
    forma_pagamento_id = v_forma_id,
    linha_digitavel = v_linha,
    pix_chave       = nullif(btrim(coalesce(p_dados->>'pix_chave', '')), ''),
    pix_tipo        = v_pix_tipo,
    banco           = nullif(btrim(coalesce(p_dados->>'banco', '')), ''),
    agencia         = nullif(btrim(coalesce(p_dados->>'agencia', '')), ''),
    conta           = nullif(btrim(coalesce(p_dados->>'conta', '')), ''),
    tipo_conta      = v_tipo_conta,
    titular         = nullif(btrim(coalesce(p_dados->>'titular', '')), ''),
    titular_documento = v_doc,
    cheque_numero   = nullif(btrim(coalesce(p_dados->>'cheque_numero', '')), ''),
    observacao      = nullif(btrim(coalesce(p_dados->>'observacao', '')), '')
  WHERE id = p_titulo AND empresa_id = minha_empresa_id() AND status = 'aberto';
  IF NOT FOUND THEN RAISE EXCEPTION 'Só é possível alterar lançamentos em aberto.'; END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Forma usada em cada pagamento/recebimento
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE pagamentos ADD COLUMN forma_pagamento_id bigint;
ALTER TABLE pagamentos ADD CONSTRAINT pagamentos_forma_fk FOREIGN KEY (forma_pagamento_id, empresa_id) REFERENCES formas_pagamento (id, empresa_id);

-- Na baixa, a forma vem do lançamento (a tela grava a forma escolhida no lançamento antes de pagar).
CREATE FUNCTION pagamentos_forma() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.forma_pagamento_id IS NULL THEN
    SELECT forma_pagamento_id INTO NEW.forma_pagamento_id FROM titulos_financeiros WHERE id = NEW.titulo_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER pagamentos_forma_trg BEFORE INSERT ON pagamentos
  FOR EACH ROW EXECUTE FUNCTION pagamentos_forma();

-- Pagamentos antigos: a forma atual do lançamento. Sem gatilhos (trava de conciliação, imutabilidade e log).
ALTER TABLE pagamentos DISABLE TRIGGER USER;
UPDATE pagamentos p SET forma_pagamento_id = t.forma_pagamento_id
  FROM titulos_financeiros t WHERE t.id = p.titulo_id AND t.forma_pagamento_id IS NOT NULL;
ALTER TABLE pagamentos ENABLE TRIGGER USER;

-- Extrato com a forma (entradas e pagamentos; movimentos ficam sem). Coluna nova no fim: as views
-- que dependem (contas_caixa_saldo) continuam iguais.
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
) x
JOIN contas_caixa c ON c.id = x.conta_caixa_id
WHERE x.data >= c.data_saldo_inicial;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Comprovantes
-- ─────────────────────────────────────────────────────────────────────

-- Para as FKs compostas (id, empresa_id) dos comprovantes.
ALTER TABLE pagamentos ADD CONSTRAINT pagamentos_id_empresa_uq UNIQUE (id, empresa_id);
ALTER TABLE movimentos_caixa ADD CONSTRAINT movimentos_caixa_id_empresa_uq UNIQUE (id, empresa_id);

CREATE TABLE comprovantes (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id    bigint NOT NULL DEFAULT minha_empresa_id() REFERENCES empresas(id),
  pagamento_id  bigint,
  movimento_id  bigint,
  caminho       text NOT NULL UNIQUE,  -- objeto no bucket "comprovantes": <empresa_id>/<uuid>-<nome>
  nome_arquivo  text NOT NULL CHECK (length(nome_arquivo) BETWEEN 1 AND 200),
  tipo_mime     text NOT NULL CHECK (tipo_mime IN ('application/pdf', 'image/png', 'image/jpeg')),
  tamanho       bigint NOT NULL CHECK (tamanho > 0 AND tamanho <= 10485760),
  enviado_por   uuid DEFAULT auth.uid(),
  enviado_por_nome text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comprovantes_um_ck CHECK ((pagamento_id IS NULL) <> (movimento_id IS NULL)),
  CONSTRAINT comprovantes_caminho_ck CHECK (split_part(caminho, '/', 1) = empresa_id::text),
  CONSTRAINT comprovantes_pagamento_fk FOREIGN KEY (pagamento_id, empresa_id) REFERENCES pagamentos (id, empresa_id),
  CONSTRAINT comprovantes_movimento_fk FOREIGN KEY (movimento_id, empresa_id) REFERENCES movimentos_caixa (id, empresa_id)
);
CREATE INDEX comprovantes_pagamento_idx ON comprovantes (pagamento_id) WHERE pagamento_id IS NOT NULL;
CREATE INDEX comprovantes_movimento_idx ON comprovantes (movimento_id) WHERE movimento_id IS NOT NULL;

CREATE FUNCTION comprovantes_regras() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.enviado_por := auth.uid();
  NEW.enviado_por_nome := (SELECT coalesce(nullif(btrim(nome), ''), email) FROM profiles WHERE user_id = auth.uid());
  NEW.criado_em := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER comprovantes_regras_trg BEFORE INSERT ON comprovantes
  FOR EACH ROW EXECUTE FUNCTION comprovantes_regras();
CREATE TRIGGER comprovantes_log_trg AFTER INSERT OR UPDATE OR DELETE ON comprovantes
  FOR EACH ROW EXECUTE FUNCTION registrar_log();

ALTER TABLE comprovantes ENABLE ROW LEVEL SECURITY;
CREATE POLICY comprovantes_select ON comprovantes FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY comprovantes_insert ON comprovantes FOR INSERT TO authenticated
  WITH CHECK (empresa_id = minha_empresa_id() AND tem_nivel('administrador', 'supervisor'));
CREATE POLICY comprovantes_delete ON comprovantes FOR DELETE TO authenticated
  USING (empresa_id = minha_empresa_id() AND tem_nivel('administrador', 'supervisor'));
REVOKE ALL ON comprovantes FROM anon;
REVOKE UPDATE ON comprovantes FROM authenticated;
GRANT SELECT, INSERT, DELETE ON comprovantes TO authenticated;

-- Storage: bucket privado. O arquivo fica na pasta da igreja (<empresa_id>/...): só a própria igreja lê;
-- enviar e apagar, Supervisor+; apagar só depois de apagar a linha em comprovantes.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('comprovantes', 'comprovantes', false, 10485760, ARRAY['application/pdf', 'image/png', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY comprovantes_obj_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'comprovantes' AND (storage.foldername(name))[1] = minha_empresa_id()::text);
CREATE POLICY comprovantes_obj_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'comprovantes' AND (storage.foldername(name))[1] = minha_empresa_id()::text
              AND tem_nivel('administrador', 'supervisor'));
CREATE POLICY comprovantes_obj_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'comprovantes' AND (storage.foldername(name))[1] = minha_empresa_id()::text
         AND tem_nivel('administrador', 'supervisor')
         AND NOT EXISTS (SELECT 1 FROM comprovantes c WHERE c.caminho = objects.name));

-- ─────────────────────────────────────────────────────────────────────
-- 4. Views com os campos novos (colunas novas sempre no fim)
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
       t.conta_fixa_id, t.competencia,
       t.pix_tipo, t.tipo_conta, t.titular, t.titular_documento, t.cheque_numero,
       pg.forma_pagamento_id AS pagamento_forma_id,
       (SELECT count(*) FROM comprovantes c WHERE c.pagamento_id = pg.id)::int AS qtd_comprovantes
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
       t.conta_fixa_id, t.competencia,
       t.pix_tipo, t.tipo_conta, t.titular, t.titular_documento, t.cheque_numero,
       pg.forma_pagamento_id AS pagamento_forma_id,
       (SELECT count(*) FROM comprovantes c WHERE c.pagamento_id = pg.id)::int AS qtd_comprovantes
  FROM titulos_financeiros t
  JOIN pessoas pe ON pe.id = t.pessoa_id
  LEFT JOIN formas_pagamento fp ON fp.id = t.forma_pagamento_id
  LEFT JOIN pagamentos pg ON pg.titulo_id = t.id AND NOT pg.estornado
 WHERE t.natureza = 'receber';

CREATE OR REPLACE VIEW pagamentos_lista WITH (security_invoker = true) AS
SELECT p.id, p.empresa_id, p.titulo_id, p.conta_caixa_id, p.data_pagamento, p.valor_principal, p.juros, p.multa,
       p.desconto, p.valor_pago, p.origem, p.observacao, p.criado_em, p.estornado, p.estornado_em, p.motivo_estorno,
       t.descricao, t.parcela, t.total_parcelas, t.vencimento, t.documento_id, pe.nome AS fornecedor_nome,
       cx.nome AS conta_caixa_nome,
       p.forma_pagamento_id, fp.nome AS forma_pagamento_nome,
       (SELECT count(*) FROM comprovantes c WHERE c.pagamento_id = p.id)::int AS qtd_comprovantes
  FROM pagamentos p
  JOIN titulos_financeiros t ON t.id = p.titulo_id
  JOIN pessoas pe ON pe.id = t.pessoa_id
  LEFT JOIN contas_caixa cx ON cx.id = p.conta_caixa_id
  LEFT JOIN formas_pagamento fp ON fp.id = p.forma_pagamento_id;

CREATE OR REPLACE VIEW movimentos_caixa_lista WITH (security_invoker = true) AS
SELECT m.id, m.empresa_id, m.tipo, m.data, m.valor, m.conta_origem_id, m.conta_destino_id, m.descricao, m.centro_custo_id,
       m.registrado_por_nome, m.criado_em, m.estornado, m.estornado_em, m.motivo_estorno,
       o.nome AS conta_origem_nome, d.nome AS conta_destino_nome, cc.nome AS centro_custo_nome,
       (SELECT count(*) FROM comprovantes c WHERE c.movimento_id = m.id)::int AS qtd_comprovantes
  FROM movimentos_caixa m
  LEFT JOIN contas_caixa o ON o.id = m.conta_origem_id
  LEFT JOIN contas_caixa d ON d.id = m.conta_destino_id
  LEFT JOIN centros_custo cc ON cc.id = m.centro_custo_id;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Fechamento do dia: contagem de cédulas e moedas na conciliação
-- ─────────────────────────────────────────────────────────────────────

-- contagem = { "200": 3, "100": 5, ..., "0.05": 10 } (quantidade por cédula/moeda)
ALTER TABLE conciliacoes_caixa ADD COLUMN contagem jsonb;

DROP FUNCTION conciliar_caixa(bigint, date, numeric, text);
CREATE FUNCTION conciliar_caixa(p_conta bigint, p_data date, p_saldo numeric, p_observacao text DEFAULT NULL, p_contagem jsonb DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa bigint := minha_empresa_id();
  cx        contas_caixa%ROWTYPE;
  v_ultima  date;
  v_sistema numeric(15,2);
  v_saldo   numeric(15,2) := round(p_saldo, 2);
  v_contado numeric(15,2) := 0;
  v_contagem jsonb;
  k text;
  v text;
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

  -- Contagem (opcional): só cédulas e moedas do real, quantidades inteiras; o saldo é a soma contada.
  IF p_contagem IS NOT NULL AND p_contagem <> '{}'::jsonb THEN
    IF jsonb_typeof(p_contagem) <> 'object' THEN RAISE EXCEPTION 'Contagem inválida.'; END IF;
    v_contagem := '{}'::jsonb;
    FOR k, v IN SELECT * FROM jsonb_each_text(p_contagem) LOOP
      IF k NOT IN ('200', '100', '50', '20', '10', '5', '2', '1', '0.50', '0.25', '0.10', '0.05') THEN
        RAISE EXCEPTION 'Cédula ou moeda inválida na contagem: %.', k;
      END IF;
      IF v !~ '^[0-9]{1,6}$' THEN RAISE EXCEPTION 'Quantidade inválida na contagem (%: %).', k, v; END IF;
      IF v::int > 0 THEN
        v_contagem := v_contagem || jsonb_build_object(k, v::int);
        v_contado := v_contado + k::numeric * v::int;
      END IF;
    END LOOP;
    IF v_contado <> v_saldo THEN
      RAISE EXCEPTION 'O saldo informado (%) é diferente da soma da contagem (%).', moeda_br(v_saldo), moeda_br(v_contado);
    END IF;
  END IF;

  v_ultima := ultimo_dia_conciliado(p_conta);
  IF v_ultima IS NOT NULL AND p_data <= v_ultima THEN
    RAISE EXCEPTION 'A conta "%" já está conciliada até %. Escolha um dia depois desse.', cx.nome, to_char(v_ultima, 'DD/MM/YYYY');
  END IF;
  v_sistema := saldo_caixa_ate(p_conta, p_data);
  IF v_sistema <> v_saldo THEN
    RAISE EXCEPTION 'O saldo informado (%) não bate com o saldo do sistema em % (%). Diferença: %.',
      moeda_br(v_saldo), to_char(p_data, 'DD/MM/YYYY'), moeda_br(v_sistema), moeda_br(v_saldo - v_sistema);
  END IF;

  INSERT INTO conciliacoes_caixa (empresa_id, conta_caixa_id, data, saldo, observacao, conciliado_por, conciliado_por_nome, contagem)
  VALUES (v_empresa, p_conta, p_data, v_saldo, nullif(btrim(coalesce(p_observacao, '')), ''), auth.uid(),
          (SELECT coalesce(nullif(btrim(nome), ''), email) FROM profiles WHERE user_id = auth.uid()),
          nullif(v_contagem, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION conciliar_caixa(bigint, date, numeric, text, jsonb), pagamentos_forma(), comprovantes_regras() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION conciliar_caixa(bigint, date, numeric, text, jsonb) TO authenticated;
