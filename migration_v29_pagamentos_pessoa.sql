-- ═════════════════════════════════════════════════════════════════════
-- EklesiaHub — migration v29: cartão, dados de pagamento da pessoa e conta a pagar avulsa
-- ═════════════════════════════════════════════════════════════════════
--  • Cartão de crédito/débito ganha dados no lançamento: bandeira, 4 últimos dígitos, parcelas no
--    cartão e autorização/NSU (o número inteiro do cartão nunca é guardado). atualizar_titulo grava.
--  • Dados de pagamento no cadastro da pessoa (fornecedor/cliente): forma preferida, PIX e conta
--    bancária. Lançamento novo da pessoa (nota, conta fixa, avulso) sem forma recebe a preferida, e
--    lançamento PIX/transferência sem dados recebe os da pessoa (gatilho titulos_dados_da_pessoa).
--  • criar_contas_pagar: conta a pagar lançada à mão (sem nota), em uma ou mais parcelas, igual à
--    conta a receber. Contabiliza pela regra "Contas a pagar sem nota" (já existente desde a v25).
-- Rodar depois da v28.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Cartão nos lançamentos
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE titulos_financeiros
  ADD COLUMN cartao_bandeira    text CHECK (cartao_bandeira IS NULL OR cartao_bandeira IN ('visa', 'mastercard', 'elo', 'amex', 'hipercard', 'outra')),
  ADD COLUMN cartao_final       text CHECK (cartao_final IS NULL OR cartao_final ~ '^[0-9]{4}$'),
  ADD COLUMN cartao_parcelas    smallint CHECK (cartao_parcelas IS NULL OR cartao_parcelas BETWEEN 1 AND 99),
  ADD COLUMN cartao_autorizacao text CHECK (cartao_autorizacao IS NULL OR length(cartao_autorizacao) <= 40);

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
  v_bandeira text := nullif(p_dados->>'cartao_bandeira', '');                                          -- v29
  v_final text := nullif(regexp_replace(coalesce(p_dados->>'cartao_final', ''), '\D', '', 'g'), '');   -- v29
  v_cparc integer;
  v_aut   text := nullif(btrim(coalesce(p_dados->>'cartao_autorizacao', '')), '');                     -- v29
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
  IF v_bandeira IS NOT NULL AND v_bandeira NOT IN ('visa', 'mastercard', 'elo', 'amex', 'hipercard', 'outra') THEN
    RAISE EXCEPTION 'Bandeira do cartão inválida.';
  END IF;
  IF v_final IS NOT NULL AND length(v_final) <> 4 THEN
    RAISE EXCEPTION 'Informe só os 4 últimos dígitos do cartão.';
  END IF;
  BEGIN
    v_cparc := nullif(p_dados->>'cartao_parcelas', '')::integer;
  EXCEPTION WHEN others THEN RAISE EXCEPTION 'Número de parcelas no cartão inválido.';
  END;
  IF v_cparc IS NOT NULL AND v_cparc NOT BETWEEN 1 AND 99 THEN RAISE EXCEPTION 'As parcelas no cartão vão de 1 a 99.'; END IF;
  IF length(v_aut) > 40 THEN RAISE EXCEPTION 'A autorização/NSU pode ter no máximo 40 caracteres.'; END IF;

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
    cartao_bandeira = v_bandeira,
    cartao_final    = v_final,
    cartao_parcelas = v_cparc,
    cartao_autorizacao = v_aut,
    observacao      = nullif(btrim(coalesce(p_dados->>'observacao', '')), '')
  WHERE id = p_titulo AND empresa_id = minha_empresa_id() AND status = 'aberto';
  IF NOT FOUND THEN RAISE EXCEPTION 'Só é possível alterar lançamentos em aberto.'; END IF;
END;
$$;

-- As views ganham as colunas novas no fim (CREATE OR REPLACE só aceita coluna nova depois das existentes).
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
       (SELECT count(*) FROM comprovantes c WHERE c.pagamento_id = pg.id)::int AS qtd_comprovantes,
       t.cartao_bandeira, t.cartao_final, t.cartao_parcelas, t.cartao_autorizacao, t.tributo_retido
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
       (SELECT count(*) FROM comprovantes c WHERE c.pagamento_id = pg.id)::int AS qtd_comprovantes,
       t.cartao_bandeira, t.cartao_final, t.cartao_parcelas, t.cartao_autorizacao, t.tributo_retido
  FROM titulos_financeiros t
  JOIN pessoas pe ON pe.id = t.pessoa_id
  LEFT JOIN formas_pagamento fp ON fp.id = t.forma_pagamento_id
  LEFT JOIN pagamentos pg ON pg.titulo_id = t.id AND NOT pg.estornado
 WHERE t.natureza = 'receber';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Dados de pagamento no cadastro da pessoa
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE pessoas
  ADD COLUMN forma_pagamento_id bigint,
  ADD COLUMN pix_tipo          text CHECK (pix_tipo IS NULL OR pix_tipo IN ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria')),
  ADD COLUMN pix_chave         text CHECK (pix_chave IS NULL OR length(pix_chave) <= 77),
  ADD COLUMN banco             text CHECK (banco IS NULL OR length(banco) <= 60),
  ADD COLUMN agencia           text CHECK (agencia IS NULL OR length(agencia) <= 20),
  ADD COLUMN conta             text CHECK (conta IS NULL OR length(conta) <= 30),
  ADD COLUMN tipo_conta        text CHECK (tipo_conta IS NULL OR tipo_conta IN ('corrente', 'poupanca', 'pagamento')),
  ADD COLUMN titular           text CHECK (titular IS NULL OR length(titular) <= 120),
  ADD COLUMN titular_documento text CHECK (titular_documento IS NULL OR titular_documento ~ '^([0-9]{11}|[0-9A-Z]{14})$');
-- Forma excluída (só as nunca usadas podem ser) some do cadastro da pessoa, sem barrar a exclusão.
ALTER TABLE pessoas ADD CONSTRAINT pessoas_forma_fk FOREIGN KEY (forma_pagamento_id, empresa_id)
  REFERENCES formas_pagamento (id, empresa_id) ON DELETE SET NULL (forma_pagamento_id);

-- Lançamento novo: sem forma, recebe a preferida da pessoa (se ativa); PIX/transferência sem chave nem
-- conta recebe os dados da pessoa. Roda antes de titulos_financeiros_forma_trg (ordem alfabética),
-- que completa a coluna antiga forma_pagamento a partir do id.
CREATE OR REPLACE FUNCTION titulos_dados_da_pessoa() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  p pessoas%ROWTYPE;
  v_tipo text;
BEGIN
  SELECT * INTO p FROM pessoas WHERE id = NEW.pessoa_id AND empresa_id = NEW.empresa_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.forma_pagamento_id IS NULL AND NEW.forma_pagamento IS NULL AND p.forma_pagamento_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM formas_pagamento f WHERE f.id = p.forma_pagamento_id AND f.ativo) THEN
    NEW.forma_pagamento_id := p.forma_pagamento_id;
  END IF;
  v_tipo := coalesce((SELECT f.tipo FROM formas_pagamento f WHERE f.id = NEW.forma_pagamento_id), NEW.forma_pagamento);
  IF v_tipo IN ('pix', 'transferencia') AND NEW.pix_chave IS NULL AND NEW.banco IS NULL AND NEW.conta IS NULL THEN
    NEW.pix_tipo := p.pix_tipo;
    NEW.pix_chave := p.pix_chave;
    NEW.banco := p.banco;
    NEW.agencia := p.agencia;
    NEW.conta := p.conta;
    NEW.tipo_conta := p.tipo_conta;
    NEW.titular := p.titular;
    NEW.titular_documento := p.titular_documento;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS titulos_financeiros_dados_pessoa_trg ON titulos_financeiros;
CREATE TRIGGER titulos_financeiros_dados_pessoa_trg BEFORE INSERT ON titulos_financeiros
  FOR EACH ROW EXECUTE FUNCTION titulos_dados_da_pessoa();

-- ─────────────────────────────────────────────────────────────────────
-- 3. Conta a pagar lançada à mão (sem nota), igual à conta a receber
-- ─────────────────────────────────────────────────────────────────────

-- Mesma regra e mesma divisão de parcelas de criar_contas_receber (v18), com natureza "pagar".
CREATE OR REPLACE FUNCTION criar_contas_pagar(p_dados jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa  bigint := minha_empresa_id();
  v_pessoa   bigint := nullif(p_dados->>'pessoa_id', '')::bigint;
  v_desc     text := nullif(btrim(coalesce(p_dados->>'descricao', '')), '');
  v_obs      text := nullif(btrim(coalesce(p_dados->>'observacao', '')), '');
  v_forma    text := nullif(p_dados->>'forma_pagamento', '');
  v_forma_id bigint := nullif(p_dados->>'forma_pagamento_id', '')::bigint; -- v18: cadastro de formas
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
    RAISE EXCEPTION 'Somente Supervisor ou Administrador pode lançar contas a pagar.';
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
    RAISE EXCEPTION 'Informe a quem a igreja vai pagar (cadastro ativo).';
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
    RAISE EXCEPTION 'Forma de pagamento inválida.';
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
                                     valor, forma_pagamento, forma_pagamento_id, conta_caixa_id, centro_custo_id, observacao)
    VALUES (v_empresa, 'pagar', v_pessoa, v_desc, i, v_parcelas, v_emissao,
            CASE WHEN v_period = 'mensal' THEN (v_venc1 + make_interval(months => i - 1))::date
                 ELSE v_venc1 + (i - 1) * v_interv END,
            (v_base + CASE WHEN i = 1 THEN v_resto ELSE 0 END) / 100.0,
            CASE WHEN v_forma_id IS NULL THEN v_forma END, v_forma_id, v_caixa, v_centro, v_obs);
  END LOOP;
  RETURN v_parcelas;
END;
$$;

REVOKE EXECUTE ON FUNCTION criar_contas_pagar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION criar_contas_pagar(jsonb) TO authenticated;
