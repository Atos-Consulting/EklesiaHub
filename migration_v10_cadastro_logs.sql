-- Migration v10 — EklesiaHub ERP: dados da igreja, dados de pagamento dos lançamentos, parâmetro de
-- contabilidade, administrador da plataforma sem igreja própria e LOG de criação/alteração/exclusão
--
-- Pré-requisito: migration_v9_trocar_empresa.sql.  Rode UMA vez, no SQL Editor.
--
-- O que muda:
--  1. IGREJA (empresas): endereço, telefone e e-mail. O Administrador da igreja edita em Parâmetros → Dados da igreja.
--  2. LANÇAMENTOS (contas a pagar): dados para pagar — forma, linha digitável do boleto, chave PIX, banco/agência/conta
--     e observação. Editáveis enquanto o lançamento está em aberto (Supervisor e Administrador).
--  3. PARÂMETRO "contabilidade.ativa" (true/false; sem registro = ativa).
--  4. O ADMINISTRADOR DA PLATAFORMA não pertence a nenhuma igreja: o perfil dele fica sem igreja de origem e ele
--     trabalha sempre na igreja escolhida no menu (a que estava usando continua escolhida).
--  5. LOGS: toda criação, alteração e exclusão nas tabelas do sistema fica registrada (quem, quando, o que mudou).
--     Ninguém altera nem apaga o log. O Administrador da igreja consulta em Sistema → Logs.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Dados cadastrais da igreja
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE empresas
  ADD COLUMN cep         text CHECK (cep IS NULL OR cep ~ '^[0-9]{8}$'),
  ADD COLUMN logradouro  text,
  ADD COLUMN numero      text,
  ADD COLUMN complemento text,
  ADD COLUMN bairro      text,
  ADD COLUMN cidade      text,
  ADD COLUMN uf          text CHECK (uf IS NULL OR uf ~ '^[A-Z]{2}$'),
  ADD COLUMN telefone    text,
  ADD COLUMN email       text CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- O Administrador da igreja atual atualiza nome fantasia, endereço e contatos (razão social e CNPJ continuam
-- com o administrador da plataforma, na tela Igrejas).
CREATE FUNCTION atualizar_dados_empresa(p_dados jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp bigint := minha_empresa_id();
  txt  text;
  campo text;
BEGIN
  IF v_emp IS NULL OR NOT tem_nivel('administrador') THEN
    RAISE EXCEPTION 'Somente o Administrador da igreja pode alterar os dados cadastrais.' USING ERRCODE = '42501';
  END IF;
  FOREACH campo IN ARRAY ARRAY['nome_fantasia', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'telefone'] LOOP
    txt := btrim(coalesce(p_dados->>campo, ''));
    IF length(txt) > 120 THEN RAISE EXCEPTION 'O campo % passou de 120 caracteres.', campo; END IF;
  END LOOP;

  UPDATE empresas SET
    nome_fantasia = nullif(btrim(coalesce(p_dados->>'nome_fantasia', '')), ''),
    cep           = nullif(regexp_replace(coalesce(p_dados->>'cep', ''), '\D', '', 'g'), ''),
    logradouro    = nullif(btrim(coalesce(p_dados->>'logradouro', '')), ''),
    numero        = nullif(btrim(coalesce(p_dados->>'numero', '')), ''),
    complemento   = nullif(btrim(coalesce(p_dados->>'complemento', '')), ''),
    bairro        = nullif(btrim(coalesce(p_dados->>'bairro', '')), ''),
    cidade        = nullif(btrim(coalesce(p_dados->>'cidade', '')), ''),
    uf            = nullif(upper(btrim(coalesce(p_dados->>'uf', ''))), ''),
    telefone      = nullif(btrim(coalesce(p_dados->>'telefone', '')), ''),
    email         = nullif(lower(btrim(coalesce(p_dados->>'email', ''))), ''),
    atualizado_em = now()
  WHERE id = v_emp;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Dados de pagamento dos lançamentos
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE titulos_financeiros
  ADD COLUMN linha_digitavel text CHECK (linha_digitavel IS NULL OR linha_digitavel ~ '^[0-9]{44,48}$'),
  ADD COLUMN pix_chave       text CHECK (pix_chave IS NULL OR length(pix_chave) <= 77),
  ADD COLUMN banco           text CHECK (banco IS NULL OR length(banco) <= 60),
  ADD COLUMN agencia         text CHECK (agencia IS NULL OR length(agencia) <= 20),
  ADD COLUMN conta           text CHECK (conta IS NULL OR length(conta) <= 30),
  ADD COLUMN observacao      text CHECK (observacao IS NULL OR length(observacao) <= 500);

-- Edita vencimento e dados de pagamento de um lançamento em aberto.
CREATE FUNCTION atualizar_titulo(p_titulo bigint, p_dados jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_forma text := nullif(p_dados->>'forma_pagamento', '');
  v_linha text := nullif(regexp_replace(coalesce(p_dados->>'linha_digitavel', ''), '\D', '', 'g'), '');
  v_venc  date := nullif(p_dados->>'vencimento', '')::date;
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

  UPDATE titulos_financeiros SET
    vencimento      = v_venc,
    forma_pagamento = v_forma,
    linha_digitavel = v_linha,
    pix_chave       = nullif(btrim(coalesce(p_dados->>'pix_chave', '')), ''),
    banco           = nullif(btrim(coalesce(p_dados->>'banco', '')), ''),
    agencia         = nullif(btrim(coalesce(p_dados->>'agencia', '')), ''),
    conta           = nullif(btrim(coalesce(p_dados->>'conta', '')), ''),
    observacao      = nullif(btrim(coalesce(p_dados->>'observacao', '')), '')
  WHERE id = p_titulo AND empresa_id = minha_empresa_id() AND status = 'aberto';
  IF NOT FOUND THEN RAISE EXCEPTION 'Só é possível alterar lançamentos em aberto.'; END IF;
END;
$$;

-- A lista de contas a pagar passa a trazer os dados de pagamento (colunas novas no fim).
CREATE OR REPLACE VIEW titulos_pagar WITH (security_invoker = true) AS
SELECT t.id, t.empresa_id, t.documento_id, t.pessoa_id, t.descricao, t.parcela, t.total_parcelas, t.emissao,
       t.vencimento, t.valor, t.forma_pagamento, t.conta_caixa_id, t.centro_custo_id, t.status, t.cancelado_em,
       t.motivo_cancelamento, t.criado_em,
       pe.nome AS fornecedor_nome, pe.documento AS fornecedor_documento, pe.tipo_pessoa AS fornecedor_tipo,
       d.tipo AS documento_tipo, d.numero AS documento_numero, d.serie AS documento_serie,
       pg.id AS pagamento_id, pg.data_pagamento, pg.valor_pago, pg.juros, pg.multa, pg.desconto,
       pg.conta_caixa_id AS pagamento_conta_caixa_id, pg.origem AS pagamento_origem,
       t.linha_digitavel, t.pix_chave, t.banco, t.agencia, t.conta, t.observacao,
       pg.observacao AS pagamento_observacao
  FROM titulos_financeiros t
  JOIN pessoas pe ON pe.id = t.pessoa_id
  LEFT JOIN documentos_entrada d ON d.id = t.documento_id
  LEFT JOIN pagamentos pg ON pg.titulo_id = t.id AND NOT pg.estornado
 WHERE t.natureza = 'pagar';

-- ─────────────────────────────────────────────────────────────────────
-- 3. Parâmetro "usa contabilidade"
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION parametros_valida() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE tipo text;
BEGIN
  IF NEW.chave LIKE 'nota.numero_tamanho.%' THEN
    tipo := substr(NEW.chave, length('nota.numero_tamanho.') + 1);
    IF tipo NOT IN ('nfe', 'nfse', 'recibo', 'fatura', 'outro') THEN
      RAISE EXCEPTION 'Tipo de nota desconhecido: %', tipo;
    END IF;
    IF NEW.valor !~ '^[0-9]{1,2}$' OR NEW.valor::int < 1 OR NEW.valor::int > 30 THEN
      RAISE EXCEPTION 'O tamanho do número deve ser um número inteiro entre 1 e 30.';
    END IF;
  ELSIF NEW.chave = 'contabilidade.ativa' THEN
    IF NEW.valor NOT IN ('true', 'false') THEN
      RAISE EXCEPTION 'O parâmetro "usar contabilidade" aceita apenas true ou false.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Parâmetro desconhecido: %', NEW.chave;
  END IF;
  NEW.atualizado_em := now();
  NEW.atualizado_por := auth.uid();
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Administrador da plataforma sem igreja de origem
-- ─────────────────────────────────────────────────────────────────────

UPDATE profiles
   SET empresa_atual_id = coalesce(empresa_atual_id, empresa_id), empresa_id = NULL, nivel = NULL
 WHERE plataforma_admin AND empresa_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Logs
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE logs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id   bigint REFERENCES empresas(id),
  tabela       text NOT NULL,
  registro_id  text,
  acao         text NOT NULL CHECK (acao IN ('criou', 'alterou', 'excluiu')),
  usuario_id   uuid,
  usuario_nome text,
  descricao    text,   -- identificação legível do registro (nome, número, descrição...)
  alteracoes   jsonb,  -- alteração: {campo: {de, para}}; criação/exclusão: os dados do registro
  criado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX logs_empresa_data_idx ON logs (empresa_id, criado_em DESC);

CREATE FUNCTION registrar_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  novo  jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  velho jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  base  jsonb;
  ignorar text[] := ARRAY['atualizado_em', 'criado_em', 'empresa_atual_id', 'atualizado_por'];
  diff  jsonb := '{}'::jsonb;
  k     text;
  v_nome text;
BEGIN
  base := coalesce(novo, velho);
  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(novo) LOOP
      IF NOT (k = ANY (ignorar)) AND (novo -> k) IS DISTINCT FROM (velho -> k) THEN
        diff := diff || jsonb_build_object(k, jsonb_build_object('de', velho -> k, 'para', novo -> k));
      END IF;
    END LOOP;
    IF diff = '{}'::jsonb THEN RETURN NULL; END IF;  -- nada mudou de verdade
  ELSE
    diff := base - ignorar;
  END IF;

  SELECT coalesce(nullif(nome, ''), email) INTO v_nome FROM profiles WHERE user_id = auth.uid();
  INSERT INTO logs (empresa_id, tabela, registro_id, acao, usuario_id, usuario_nome, descricao, alteracoes)
  VALUES (
    CASE WHEN TG_TABLE_NAME = 'empresas' THEN (base ->> 'id')::bigint ELSE (base ->> 'empresa_id')::bigint END,
    TG_TABLE_NAME,
    coalesce(base ->> 'id', base ->> 'user_id', base ->> 'chave'),
    CASE TG_OP WHEN 'INSERT' THEN 'criou' WHEN 'UPDATE' THEN 'alterou' ELSE 'excluiu' END,
    auth.uid(), v_nome,
    left(coalesce(base ->> 'nome', base ->> 'razao_social', base ->> 'descricao', base ->> 'nome_arquivo',
                  base ->> 'chave', base ->> 'email',
                  CASE WHEN base ? 'numero' THEN 'Nº ' || (base ->> 'numero') END), 200),
    diff);
  RETURN NULL;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['empresas', 'profiles', 'pessoas', 'documentos_entrada', 'documento_anexos', 'plano_contas',
                           'centros_custo', 'tipos_contabeis', 'contas_caixa', 'condicoes_pagamento', 'parametros',
                           'titulos_financeiros', 'pagamentos'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION registrar_log()',
                   t || '_log_trg', t);
  END LOOP;
END;
$$;

-- Só leitura, pelo Administrador da igreja em que está trabalhando. Ninguém grava, altera ou apaga pelo navegador.
REVOKE ALL ON logs FROM anon;
REVOKE INSERT, UPDATE, DELETE ON logs FROM authenticated;
GRANT SELECT ON logs TO authenticated;
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY logs_select ON logs FOR SELECT TO authenticated
  USING (empresa_id = minha_empresa_id() AND tem_nivel('administrador'));

REVOKE EXECUTE ON FUNCTION registrar_log() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION atualizar_dados_empresa(jsonb), atualizar_titulo(bigint, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION atualizar_dados_empresa(jsonb), atualizar_titulo(bigint, jsonb) TO authenticated;
