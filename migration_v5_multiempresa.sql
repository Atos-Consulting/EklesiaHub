-- Migration v5 — EklesiaHub ERP: multiempresa, níveis de acesso, parâmetros e gestão de usuários
--
-- Pré-requisito: migration_v4_erp.sql.  Rode UMA vez, no SQL Editor, ANTES de abrir o sistema novo.
--
-- O que muda:
--  1. EMPRESAS: o sistema atende várias empresas. Cada empresa só enxerga os próprios dados —
--     isso é imposto pelo banco (RLS + chaves estrangeiras compostas), não pela tela.
--     Os dados que já existem passam para uma empresa inicial chamada "Minha Igreja"
--     (renomeie depois na aba Empresas).
--  2. NÍVEIS: Administrador, Supervisor e Usuário substituem os perfis antigos
--     (admin/financeiro/contador/comercial/kids). Conversão dos usuários existentes:
--        admin -> Administrador (e Administrador da PLATAFORMA)   financeiro/contador -> Supervisor
--        comercial -> Usuário                                      kids -> SEM acesso (precisa ser liberado)
--  3. ADMINISTRADOR DA PLATAFORMA: é quem cria empresas (e o primeiro administrador de cada uma).
--     Não enxerga os dados de negócio das empresas. Para dar essa permissão a alguém:
--        UPDATE profiles SET plataforma_admin = true WHERE email = 'pessoa@exemplo.com';
--  4. PARÂMETROS por empresa (primeiro: tamanho máximo do número da nota, por tipo).
--  5. GESTÃO DE USUÁRIOS dentro do sistema (funções criar_usuario, atualizar_usuario, ...).
--  6. MÓDULO KIDS ARQUIVADO: fecha o acesso às tabelas/views/função do Kids (os dados continuam lá).
--
-- Quem pode o quê nas notas:  Usuário = lança/edita rascunhos e cadastra fornecedores;
--   Supervisor = tudo isso + aprova e cancela;  Administrador = tudo + Usuários, Parâmetros e plano de contas.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Empresas e perfis
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE empresas (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  razao_social  text NOT NULL CHECK (length(btrim(razao_social)) > 0),
  nome_fantasia text,
  cnpj          text CHECK (cnpj IS NULL OR cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX empresas_cnpj_uq ON empresas (cnpj) WHERE cnpj IS NOT NULL;
CREATE TRIGGER empresas_atualizado BEFORE UPDATE ON empresas
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

-- Empresa inicial: dona de tudo o que já foi cadastrado até aqui.
INSERT INTO empresas (razao_social) VALUES ('Minha Igreja');

ALTER TABLE profiles
  ADD COLUMN empresa_id       bigint REFERENCES empresas(id),
  ADD COLUMN nivel            text CHECK (nivel IN ('administrador', 'supervisor', 'usuario')),
  ADD COLUMN nome             text,
  ADD COLUMN email            text,
  ADD COLUMN ativo            boolean NOT NULL DEFAULT true,
  ADD COLUMN plataforma_admin boolean NOT NULL DEFAULT false;

UPDATE profiles p
   SET email = lower(u.email),
       nome  = coalesce(nullif(btrim(u.raw_user_meta_data->>'nome'), ''), split_part(u.email, '@', 1))
  FROM auth.users u WHERE u.id = p.user_id;

UPDATE profiles
   SET empresa_id = (SELECT min(id) FROM empresas),
       nivel = CASE papel WHEN 'admin' THEN 'administrador'
                          WHEN 'financeiro' THEN 'supervisor'
                          WHEN 'contador' THEN 'supervisor'
                          WHEN 'comercial' THEN 'usuario' END
 WHERE papel IN ('admin', 'financeiro', 'contador', 'comercial');

UPDATE profiles SET plataforma_admin = true WHERE papel = 'admin';

-- Sem empresa <=> sem nível <=> sem acesso.
ALTER TABLE profiles ADD CONSTRAINT profiles_empresa_nivel_ck CHECK ((empresa_id IS NULL) = (nivel IS NULL));

-- ─────────────────────────────────────────────────────────────────────
-- 2. Funções de identidade (SECURITY DEFINER: leem o perfil sem depender de RLS)
-- ─────────────────────────────────────────────────────────────────────

-- Empresa do usuário logado; NULL se não tiver acesso (sem empresa, usuário inativo ou empresa inativa).
CREATE FUNCTION minha_empresa_id() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.empresa_id FROM profiles p JOIN empresas e ON e.id = p.empresa_id
   WHERE p.user_id = auth.uid() AND p.ativo AND e.ativo
$$;

CREATE FUNCTION meu_nivel() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.nivel FROM profiles p JOIN empresas e ON e.id = p.empresa_id
   WHERE p.user_id = auth.uid() AND p.ativo AND e.ativo
$$;

CREATE FUNCTION tem_nivel(VARIADIC niveis text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(meu_nivel() = ANY (niveis), false)
$$;

CREATE FUNCTION sou_plataforma_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT p.plataforma_admin AND p.ativo FROM profiles p WHERE p.user_id = auth.uid()), false)
$$;

-- Dados do usuário logado para a tela (um único JSON).
CREATE FUNCTION meu_perfil() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'user_id', p.user_id, 'nome', p.nome, 'email', p.email, 'nivel', p.nivel, 'ativo', p.ativo,
    'empresa_id', p.empresa_id, 'empresa_nome', coalesce(nullif(e.nome_fantasia, ''), e.razao_social),
    'empresa_ativa', e.ativo, 'plataforma_admin', p.plataforma_admin)
  FROM profiles p LEFT JOIN empresas e ON e.id = p.empresa_id
  WHERE p.user_id = auth.uid()
$$;

REVOKE EXECUTE ON FUNCTION minha_empresa_id(), meu_nivel(), tem_nivel(text[]), sou_plataforma_admin(), meu_perfil() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION minha_empresa_id(), meu_nivel(), tem_nivel(text[]), sou_plataforma_admin(), meu_perfil() TO authenticated;

-- Toda conta nova nasce SEM acesso (sem empresa e sem nível). Só as funções de gestão liberam.
CREATE OR REPLACE FUNCTION handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles (user_id, email, nome)
  VALUES (NEW.id, lower(NEW.email),
          coalesce(nullif(btrim(NEW.raw_user_meta_data->>'nome'), ''), split_part(NEW.email, '@', 1)))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Todas as tabelas do ERP passam a pertencer a uma empresa
--    A chave estrangeira COMPOSTA (id, empresa_id) impede, no banco, qualquer referência entre empresas.
-- ─────────────────────────────────────────────────────────────────────

-- Remove as policies da v4 (baseadas em papéis) antes de trocar as regras.
DROP POLICY IF EXISTS profiles_select ON profiles;
DROP POLICY IF EXISTS profiles_update ON profiles;
DROP POLICY IF EXISTS pessoas_select ON pessoas;
DROP POLICY IF EXISTS pessoas_insert ON pessoas;
DROP POLICY IF EXISTS pessoas_update ON pessoas;
DROP POLICY IF EXISTS plano_contas_select ON plano_contas;
DROP POLICY IF EXISTS plano_contas_write ON plano_contas;
DROP POLICY IF EXISTS centros_custo_select ON centros_custo;
DROP POLICY IF EXISTS centros_custo_write ON centros_custo;
DROP POLICY IF EXISTS fundos_select ON fundos;
DROP POLICY IF EXISTS fundos_write ON fundos;
DROP POLICY IF EXISTS documentos_select ON documentos_entrada;
DROP POLICY IF EXISTS documentos_insert ON documentos_entrada;
DROP POLICY IF EXISTS documentos_update ON documentos_entrada;
DROP POLICY IF EXISTS documentos_delete ON documentos_entrada;
DROP POLICY IF EXISTS itens_select ON documento_entrada_itens;
DROP POLICY IF EXISTS itens_write ON documento_entrada_itens;
DROP POLICY IF EXISTS anexos_select ON documento_anexos;
DROP POLICY IF EXISTS anexos_insert ON documento_anexos;
DROP POLICY IF EXISTS anexos_delete ON documento_anexos;
DROP POLICY IF EXISTS notas_anexos_select ON storage.objects;
DROP POLICY IF EXISTS notas_anexos_insert ON storage.objects;
DROP POLICY IF EXISTS notas_anexos_delete ON storage.objects;

-- Durante a conversão dos dados existentes, as regras de imutabilidade das notas precisam ficar
-- desligadas (senão uma nota já aprovada impediria o preenchimento de empresa_id). Religadas logo abaixo.
ALTER TABLE documentos_entrada      DISABLE TRIGGER USER;
ALTER TABLE documento_entrada_itens DISABLE TRIGGER USER;

-- pessoas
ALTER TABLE pessoas ADD COLUMN empresa_id bigint REFERENCES empresas(id);
UPDATE pessoas SET empresa_id = (SELECT min(id) FROM empresas);
ALTER TABLE pessoas ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE pessoas ALTER COLUMN empresa_id SET DEFAULT minha_empresa_id();
ALTER TABLE pessoas ADD CONSTRAINT pessoas_id_empresa_uq UNIQUE (id, empresa_id);
DROP INDEX pessoas_documento_uq;
CREATE UNIQUE INDEX pessoas_documento_uq ON pessoas (empresa_id, documento) WHERE documento IS NOT NULL;

-- plano_contas
ALTER TABLE plano_contas ADD COLUMN empresa_id bigint REFERENCES empresas(id);
UPDATE plano_contas SET empresa_id = (SELECT min(id) FROM empresas);
ALTER TABLE plano_contas ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE plano_contas ALTER COLUMN empresa_id SET DEFAULT minha_empresa_id();
ALTER TABLE plano_contas ADD CONSTRAINT plano_contas_id_empresa_uq UNIQUE (id, empresa_id);
ALTER TABLE plano_contas DROP CONSTRAINT plano_contas_codigo_key;
ALTER TABLE plano_contas ADD CONSTRAINT plano_contas_empresa_codigo_uq UNIQUE (empresa_id, codigo);
ALTER TABLE plano_contas DROP CONSTRAINT plano_contas_pai_id_fkey;
ALTER TABLE plano_contas ADD CONSTRAINT plano_contas_pai_fk
  FOREIGN KEY (pai_id, empresa_id) REFERENCES plano_contas (id, empresa_id);

-- centros_custo
ALTER TABLE centros_custo ADD COLUMN empresa_id bigint REFERENCES empresas(id);
UPDATE centros_custo SET empresa_id = (SELECT min(id) FROM empresas);
ALTER TABLE centros_custo ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE centros_custo ALTER COLUMN empresa_id SET DEFAULT minha_empresa_id();
ALTER TABLE centros_custo ADD CONSTRAINT centros_custo_id_empresa_uq UNIQUE (id, empresa_id);
ALTER TABLE centros_custo DROP CONSTRAINT centros_custo_nome_key;
ALTER TABLE centros_custo ADD CONSTRAINT centros_custo_empresa_nome_uq UNIQUE (empresa_id, nome);

-- fundos
ALTER TABLE fundos ADD COLUMN empresa_id bigint REFERENCES empresas(id);
UPDATE fundos SET empresa_id = (SELECT min(id) FROM empresas);
ALTER TABLE fundos ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE fundos ALTER COLUMN empresa_id SET DEFAULT minha_empresa_id();
ALTER TABLE fundos ADD CONSTRAINT fundos_id_empresa_uq UNIQUE (id, empresa_id);
ALTER TABLE fundos DROP CONSTRAINT fundos_nome_key;
ALTER TABLE fundos ADD CONSTRAINT fundos_empresa_nome_uq UNIQUE (empresa_id, nome);

-- documentos_entrada
ALTER TABLE documentos_entrada ADD COLUMN empresa_id bigint REFERENCES empresas(id);
UPDATE documentos_entrada SET empresa_id = (SELECT min(id) FROM empresas);
ALTER TABLE documentos_entrada ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE documentos_entrada ALTER COLUMN empresa_id SET DEFAULT minha_empresa_id();
ALTER TABLE documentos_entrada ADD CONSTRAINT documentos_entrada_id_empresa_uq UNIQUE (id, empresa_id);
ALTER TABLE documentos_entrada DROP CONSTRAINT documentos_entrada_fornecedor_id_fkey;
ALTER TABLE documentos_entrada DROP CONSTRAINT documentos_entrada_centro_custo_id_fkey;
ALTER TABLE documentos_entrada DROP CONSTRAINT documentos_entrada_fundo_id_fkey;
ALTER TABLE documentos_entrada ADD CONSTRAINT documentos_entrada_fornecedor_fk
  FOREIGN KEY (fornecedor_id, empresa_id) REFERENCES pessoas (id, empresa_id);
ALTER TABLE documentos_entrada ADD CONSTRAINT documentos_entrada_centro_fk
  FOREIGN KEY (centro_custo_id, empresa_id) REFERENCES centros_custo (id, empresa_id);
ALTER TABLE documentos_entrada ADD CONSTRAINT documentos_entrada_fundo_fk
  FOREIGN KEY (fundo_id, empresa_id) REFERENCES fundos (id, empresa_id);
-- A mesma chave de NF-e pode existir em empresas diferentes sem que uma "descubra" a outra.
DROP INDEX documentos_entrada_chave_uq;
CREATE UNIQUE INDEX documentos_entrada_chave_uq
  ON documentos_entrada (empresa_id, chave_acesso) WHERE chave_acesso IS NOT NULL AND status <> 'cancelada';

-- documento_entrada_itens
ALTER TABLE documento_entrada_itens ADD COLUMN empresa_id bigint REFERENCES empresas(id);
UPDATE documento_entrada_itens SET empresa_id = (SELECT min(id) FROM empresas);
ALTER TABLE documento_entrada_itens ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE documento_entrada_itens ALTER COLUMN empresa_id SET DEFAULT minha_empresa_id();
ALTER TABLE documento_entrada_itens DROP CONSTRAINT documento_entrada_itens_documento_id_fkey;
ALTER TABLE documento_entrada_itens DROP CONSTRAINT documento_entrada_itens_conta_id_fkey;
ALTER TABLE documento_entrada_itens DROP CONSTRAINT documento_entrada_itens_centro_custo_id_fkey;
ALTER TABLE documento_entrada_itens ADD CONSTRAINT documento_entrada_itens_documento_fk
  FOREIGN KEY (documento_id, empresa_id) REFERENCES documentos_entrada (id, empresa_id) ON DELETE CASCADE;
ALTER TABLE documento_entrada_itens ADD CONSTRAINT documento_entrada_itens_conta_fk
  FOREIGN KEY (conta_id, empresa_id) REFERENCES plano_contas (id, empresa_id);
ALTER TABLE documento_entrada_itens ADD CONSTRAINT documento_entrada_itens_centro_fk
  FOREIGN KEY (centro_custo_id, empresa_id) REFERENCES centros_custo (id, empresa_id);

-- documento_anexos
ALTER TABLE documento_anexos ADD COLUMN empresa_id bigint REFERENCES empresas(id);
UPDATE documento_anexos SET empresa_id = (SELECT min(id) FROM empresas);
ALTER TABLE documento_anexos ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE documento_anexos ALTER COLUMN empresa_id SET DEFAULT minha_empresa_id();
ALTER TABLE documento_anexos DROP CONSTRAINT documento_anexos_documento_id_fkey;
ALTER TABLE documento_anexos ADD CONSTRAINT documento_anexos_documento_fk
  FOREIGN KEY (documento_id, empresa_id) REFERENCES documentos_entrada (id, empresa_id) ON DELETE CASCADE;

-- Conversão concluída: religa as regras das notas.
ALTER TABLE documentos_entrada      ENABLE TRIGGER USER;
ALTER TABLE documento_entrada_itens ENABLE TRIGGER USER;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Parâmetros por empresa
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE parametros (
  empresa_id    bigint NOT NULL DEFAULT minha_empresa_id() REFERENCES empresas(id) ON DELETE CASCADE,
  chave         text NOT NULL,
  valor         text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid DEFAULT auth.uid(),
  PRIMARY KEY (empresa_id, chave)
);

-- Parâmetros conhecidos (para criar um novo, acrescente a regra aqui e o catálogo em src/erp/catalogoParametros.js):
--   nota.numero_tamanho.<tipo>  -> tamanho máximo (1 a 30 caracteres) do número da nota daquele tipo.
CREATE FUNCTION parametros_valida() RETURNS trigger
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
  ELSE
    RAISE EXCEPTION 'Parâmetro desconhecido: %', NEW.chave;
  END IF;
  NEW.atualizado_em := now();
  NEW.atualizado_por := auth.uid();
  RETURN NEW;
END;
$$;
CREATE TRIGGER parametros_valida_trg BEFORE INSERT OR UPDATE ON parametros
  FOR EACH ROW EXECUTE FUNCTION parametros_valida();

-- Tamanho máximo do número da nota (parâmetro da empresa ou padrão).
-- Os padrões abaixo devem ser iguais aos de src/erp/catalogoParametros.js.
CREATE FUNCTION tamanho_numero_nota(p_empresa bigint, p_tipo text) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT valor::int FROM parametros WHERE empresa_id = p_empresa AND chave = 'nota.numero_tamanho.' || p_tipo),
    CASE p_tipo WHEN 'nfe' THEN 9 WHEN 'nfse' THEN 15 WHEN 'recibo' THEN 10 WHEN 'fatura' THEN 10 ELSE 20 END)
$$;
REVOKE EXECUTE ON FUNCTION tamanho_numero_nota(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION tamanho_numero_nota(bigint, text) TO authenticated;

-- Só valida quando o número ou o tipo mudam (mudar o parâmetro não "quebra" notas já lançadas).
CREATE FUNCTION documentos_entrada_numero() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE max_len int;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.numero IS DISTINCT FROM OLD.numero OR NEW.tipo IS DISTINCT FROM OLD.tipo THEN
    max_len := tamanho_numero_nota(NEW.empresa_id, NEW.tipo);
    IF length(NEW.numero) > max_len THEN
      RAISE EXCEPTION 'O número deste tipo de nota pode ter no máximo % caracteres (definido em Parâmetros).', max_len;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER documentos_entrada_numero_trg BEFORE INSERT OR UPDATE ON documentos_entrada
  FOR EACH ROW EXECUTE FUNCTION documentos_entrada_numero();

-- Aprovar e cancelar notas exige Supervisor ou Administrador (mesma função da v4 + a checagem de nível).
CREATE OR REPLACE FUNCTION documentos_entrada_regras() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  soma numeric(15,2);
  qtd  integer;
  ignorar text[] := ARRAY['status', 'motivo_cancelamento', 'cancelado_por', 'cancelado_em',
                          'aprovado_por', 'aprovado_em', 'atualizado_em'];
BEGIN
  IF NEW.status = 'lancada' THEN
    RAISE EXCEPTION 'Status "lancada" ainda não está disponível (depende do módulo Contábil).';
  END IF;

  IF OLD.status IN ('cancelada', 'lancada') THEN
    RAISE EXCEPTION 'Nota % não pode mais ser alterada.', OLD.status;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('aprovada', 'cancelada')
     AND NOT tem_nivel('administrador', 'supervisor') THEN
    RAISE EXCEPTION 'Somente Supervisor ou Administrador pode aprovar ou cancelar notas.';
  END IF;

  IF OLD.status = 'aprovada' THEN
    IF NEW.status <> 'cancelada' THEN
      RAISE EXCEPTION 'Nota aprovada é imutável; só pode ser cancelada (com motivo).';
    END IF;
    IF (to_jsonb(NEW) - ignorar) IS DISTINCT FROM (to_jsonb(OLD) - ignorar) THEN
      RAISE EXCEPTION 'Ao cancelar uma nota aprovada, nenhum outro campo pode ser alterado.';
    END IF;
  END IF;

  IF OLD.status = 'rascunho' AND NEW.status = 'aprovada' THEN
    SELECT coalesce(sum(valor_total), 0), count(*) INTO soma, qtd
      FROM documento_entrada_itens WHERE documento_id = NEW.id;
    IF qtd = 0 THEN
      RAISE EXCEPTION 'A nota precisa ter ao menos um item para ser aprovada.';
    END IF;
    IF soma <> NEW.valor_total THEN
      RAISE EXCEPTION 'A soma dos itens (%) é diferente do valor total da nota (%).', soma, NEW.valor_total;
    END IF;
    NEW.aprovado_por := auth.uid();
    NEW.aprovado_em  := now();
  END IF;

  IF NEW.status = 'cancelada' AND OLD.status <> 'cancelada' THEN
    NEW.cancelado_por := auth.uid();
    NEW.cancelado_em  := now();
  END IF;

  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Dados padrão de uma empresa nova (centros de custo, fundo, plano de contas de EXEMPLO)
-- ─────────────────────────────────────────────────────────────────────

CREATE FUNCTION semear_empresa(p_empresa bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO centros_custo (empresa_id, nome)
  SELECT p_empresa, n FROM unnest(ARRAY['Administração', 'Kids', 'Louvor', 'Missões', 'Manutenção', 'Livraria e Bazar']) AS n;

  INSERT INTO fundos (empresa_id, nome, restrito) VALUES (p_empresa, 'Geral', false);

  INSERT INTO plano_contas (empresa_id, codigo, nome, natureza, analitica)
  SELECT p_empresa, v.codigo, v.nome, v.natureza, v.analitica FROM (VALUES
    ('1', 'ATIVO', 'ativo', false), ('1.1', 'Ativo Circulante', 'ativo', false),
    ('1.1.01', 'Caixa', 'ativo', true), ('1.1.02', 'Bancos conta movimento', 'ativo', true),
    ('1.1.03', 'Estoques (livraria e bazar)', 'ativo', true), ('1.2', 'Ativo Não Circulante', 'ativo', false),
    ('1.2.01', 'Imobilizado', 'ativo', true), ('2', 'PASSIVO', 'passivo', false),
    ('2.1', 'Passivo Circulante', 'passivo', false), ('2.1.01', 'Fornecedores a pagar', 'passivo', true),
    ('2.1.02', 'Obrigações trabalhistas e tributárias', 'passivo', true),
    ('3', 'PATRIMÔNIO SOCIAL', 'patrimonio_social', false), ('3.1', 'Patrimônio Social', 'patrimonio_social', true),
    ('3.2', 'Superávit/Déficit do exercício', 'patrimonio_social', true),
    ('4', 'RECEITAS', 'receita', false), ('4.1', 'Contribuições', 'receita', false),
    ('4.1.01', 'Dízimos', 'receita', true), ('4.1.02', 'Ofertas', 'receita', true),
    ('4.1.03', 'Campanhas e doações', 'receita', true), ('4.2', 'Receitas comerciais', 'receita', false),
    ('4.2.01', 'Vendas livraria e bazar', 'receita', true), ('5', 'DESPESAS', 'despesa', false),
    ('5.1', 'Despesas administrativas', 'despesa', false), ('5.1.01', 'Água, luz e telefone', 'despesa', true),
    ('5.1.02', 'Material de escritório e limpeza', 'despesa', true), ('5.1.03', 'Serviços de terceiros', 'despesa', true),
    ('5.1.04', 'Manutenção e reparos', 'despesa', true), ('5.2', 'Despesas com pessoal', 'despesa', false),
    ('5.2.01', 'Prebendas e salários', 'despesa', true), ('5.3', 'Despesas ministeriais', 'despesa', false),
    ('5.3.01', 'Eventos e ministérios', 'despesa', true), ('5.3.02', 'Missões e ação social', 'despesa', true),
    ('5.4', 'Custo das mercadorias vendidas', 'despesa', true)
  ) AS v(codigo, nome, natureza, analitica);

  UPDATE plano_contas c SET pai_id = p.id
    FROM plano_contas p
   WHERE c.empresa_id = p_empresa AND p.empresa_id = p_empresa
     AND c.codigo LIKE '%.%' AND p.codigo = regexp_replace(c.codigo, '\.[^.]+$', '');
END;
$$;
REVOKE EXECUTE ON FUNCTION semear_empresa(bigint) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 6. Gestão de usuários e empresas (funções com checagem de permissão por dentro)
--    Escrevem direto na área de autenticação do Supabase; por isso nunca são liberadas para anon.
-- ─────────────────────────────────────────────────────────────────────

-- Interna: cria a conta de login (e-mail + senha). Não é chamável pelo app.
CREATE FUNCTION _criar_usuario_auth(p_email text, p_senha text, p_nome text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_email text := lower(btrim(coalesce(p_email, '')));
BEGIN
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'E-mail inválido.';
  END IF;
  IF length(coalesce(p_senha, '')) < 8 THEN
    RAISE EXCEPTION 'A senha deve ter pelo menos 8 caracteres.';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email) THEN
    RAISE EXCEPTION 'Já existe um usuário com este e-mail.';
  END IF;

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    crypt(p_senha, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('nome', btrim(coalesce(p_nome, ''))), now(), now(),
    '', '', '', ''
  );

  INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES (gen_random_uuid(), v_id, v_id::text,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', now(), now(), now());

  RETURN v_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION _criar_usuario_auth(text, text, text) FROM PUBLIC, anon, authenticated;

-- Administrador cria usuários da PRÓPRIA empresa; o administrador da plataforma cria em qualquer uma.
CREATE FUNCTION criar_usuario(p_empresa_id bigint, p_email text, p_senha text, p_nome text, p_nivel text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (sou_plataforma_admin() OR (tem_nivel('administrador') AND p_empresa_id = minha_empresa_id())) THEN
    RAISE EXCEPTION 'Sem permissão para criar usuários.' USING ERRCODE = '42501';
  END IF;
  IF p_nivel NOT IN ('administrador', 'supervisor', 'usuario') THEN
    RAISE EXCEPTION 'Nível inválido.';
  END IF;
  IF length(btrim(coalesce(p_nome, ''))) = 0 THEN
    RAISE EXCEPTION 'Informe o nome do usuário.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM empresas WHERE id = p_empresa_id AND ativo) THEN
    RAISE EXCEPTION 'Empresa inexistente ou inativa.';
  END IF;

  v_id := _criar_usuario_auth(p_email, p_senha, p_nome);
  UPDATE profiles
     SET empresa_id = p_empresa_id, nivel = p_nivel, nome = btrim(p_nome),
         email = lower(btrim(p_email)), ativo = true
   WHERE user_id = v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION atualizar_usuario(p_user_id uuid, p_nome text, p_nivel text, p_ativo boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE alvo profiles%ROWTYPE;
BEGIN
  SELECT * INTO alvo FROM profiles WHERE user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuário não encontrado.'; END IF;
  IF NOT (sou_plataforma_admin() OR (tem_nivel('administrador') AND alvo.empresa_id = minha_empresa_id())) THEN
    RAISE EXCEPTION 'Sem permissão para alterar este usuário.' USING ERRCODE = '42501';
  END IF;
  IF alvo.nivel IS NULL THEN RAISE EXCEPTION 'Este usuário não pertence a nenhuma empresa.'; END IF;
  IF p_nivel NOT IN ('administrador', 'supervisor', 'usuario') THEN RAISE EXCEPTION 'Nível inválido.'; END IF;
  IF length(btrim(coalesce(p_nome, ''))) = 0 THEN RAISE EXCEPTION 'Informe o nome do usuário.'; END IF;
  IF alvo.user_id = auth.uid() AND (p_nivel IS DISTINCT FROM alvo.nivel OR p_ativo IS DISTINCT FROM alvo.ativo) THEN
    RAISE EXCEPTION 'Você não pode alterar o seu próprio nível ou situação.';
  END IF;
  IF alvo.nivel = 'administrador' AND alvo.ativo AND (p_nivel <> 'administrador' OR NOT p_ativo)
     AND NOT EXISTS (SELECT 1 FROM profiles
                      WHERE empresa_id = alvo.empresa_id AND nivel = 'administrador' AND ativo AND user_id <> alvo.user_id) THEN
    RAISE EXCEPTION 'A empresa precisa ter ao menos um Administrador ativo.';
  END IF;

  UPDATE profiles SET nome = btrim(p_nome), nivel = p_nivel, ativo = p_ativo WHERE user_id = p_user_id;
  IF NOT p_ativo THEN DELETE FROM auth.sessions WHERE user_id = p_user_id; END IF;
END;
$$;

CREATE FUNCTION redefinir_senha_usuario(p_user_id uuid, p_senha text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE alvo profiles%ROWTYPE;
BEGIN
  SELECT * INTO alvo FROM profiles WHERE user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuário não encontrado.'; END IF;
  IF NOT (sou_plataforma_admin() OR (tem_nivel('administrador') AND alvo.empresa_id = minha_empresa_id())) THEN
    RAISE EXCEPTION 'Sem permissão para alterar este usuário.' USING ERRCODE = '42501';
  END IF;
  IF length(coalesce(p_senha, '')) < 8 THEN RAISE EXCEPTION 'A senha deve ter pelo menos 8 caracteres.'; END IF;

  UPDATE auth.users SET encrypted_password = crypt(p_senha, gen_salt('bf')), updated_at = now() WHERE id = p_user_id;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;  -- força novo login com a nova senha
END;
$$;

-- Só o administrador da plataforma cria empresas; já cria o primeiro Administrador dela e os dados padrão.
CREATE FUNCTION criar_empresa(p_razao_social text, p_nome_fantasia text, p_cnpj text,
                              p_admin_nome text, p_admin_email text, p_admin_senha text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_empresa bigint;
  v_user uuid;
BEGIN
  IF NOT sou_plataforma_admin() THEN
    RAISE EXCEPTION 'Somente o administrador da plataforma pode criar empresas.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_razao_social, ''))) = 0 THEN RAISE EXCEPTION 'Informe a razão social.'; END IF;
  IF length(btrim(coalesce(p_admin_nome, ''))) = 0 THEN RAISE EXCEPTION 'Informe o nome do administrador.'; END IF;

  INSERT INTO empresas (razao_social, nome_fantasia, cnpj)
  VALUES (btrim(p_razao_social), nullif(btrim(coalesce(p_nome_fantasia, '')), ''),
          nullif(upper(regexp_replace(coalesce(p_cnpj, ''), '[^0-9A-Za-z]', '', 'g')), ''))
  RETURNING id INTO v_empresa;

  PERFORM semear_empresa(v_empresa);

  v_user := _criar_usuario_auth(p_admin_email, p_admin_senha, p_admin_nome);
  UPDATE profiles
     SET empresa_id = v_empresa, nivel = 'administrador', nome = btrim(p_admin_nome),
         email = lower(btrim(p_admin_email)), ativo = true
   WHERE user_id = v_user;

  RETURN v_empresa;
END;
$$;

CREATE FUNCTION atualizar_empresa(p_id bigint, p_razao_social text, p_nome_fantasia text, p_cnpj text, p_ativo boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT sou_plataforma_admin() THEN
    RAISE EXCEPTION 'Somente o administrador da plataforma pode alterar empresas.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_razao_social, ''))) = 0 THEN RAISE EXCEPTION 'Informe a razão social.'; END IF;
  IF NOT p_ativo AND p_id = (SELECT empresa_id FROM profiles WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Você não pode desativar a empresa em que está trabalhando.';
  END IF;

  UPDATE empresas
     SET razao_social = btrim(p_razao_social), nome_fantasia = nullif(btrim(coalesce(p_nome_fantasia, '')), ''),
         cnpj = nullif(upper(regexp_replace(coalesce(p_cnpj, ''), '[^0-9A-Za-z]', '', 'g')), ''), ativo = p_ativo
   WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empresa não encontrada.'; END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION criar_usuario(bigint, text, text, text, text), atualizar_usuario(uuid, text, text, boolean),
  redefinir_senha_usuario(uuid, text), criar_empresa(text, text, text, text, text, text),
  atualizar_empresa(bigint, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION criar_usuario(bigint, text, text, text, text), atualizar_usuario(uuid, text, text, boolean),
  redefinir_senha_usuario(uuid, text), criar_empresa(text, text, text, text, text, text),
  atualizar_empresa(bigint, text, text, text, boolean) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 7. RLS: cada empresa só enxerga e altera o que é seu
-- ─────────────────────────────────────────────────────────────────────

REVOKE ALL ON empresas, parametros FROM anon;
ALTER TABLE empresas   ENABLE ROW LEVEL SECURITY;
ALTER TABLE parametros ENABLE ROW LEVEL SECURITY;

-- Empresas: cada usuário vê a sua; o administrador da plataforma vê todas. Alterações só pelas funções acima.
CREATE POLICY empresas_select ON empresas FOR SELECT TO authenticated
  USING (id = minha_empresa_id() OR sou_plataforma_admin());

-- Perfis: o próprio; o administrador vê os da sua empresa; a plataforma vê todos. Alterações só pelas funções.
CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR sou_plataforma_admin()
         OR (tem_nivel('administrador') AND empresa_id = minha_empresa_id()));

CREATE POLICY pessoas_select ON pessoas FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY pessoas_insert ON pessoas FOR INSERT TO authenticated WITH CHECK (empresa_id = minha_empresa_id());
CREATE POLICY pessoas_update ON pessoas FOR UPDATE TO authenticated
  USING (empresa_id = minha_empresa_id()) WITH CHECK (empresa_id = minha_empresa_id());

-- Plano de contas, centros de custo e fundos: todos leem; só o Administrador altera.
CREATE POLICY plano_contas_select ON plano_contas FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY plano_contas_write ON plano_contas FOR ALL TO authenticated
  USING (empresa_id = minha_empresa_id() AND tem_nivel('administrador'))
  WITH CHECK (empresa_id = minha_empresa_id() AND tem_nivel('administrador'));
CREATE POLICY centros_custo_select ON centros_custo FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY centros_custo_write ON centros_custo FOR ALL TO authenticated
  USING (empresa_id = minha_empresa_id() AND tem_nivel('administrador'))
  WITH CHECK (empresa_id = minha_empresa_id() AND tem_nivel('administrador'));
CREATE POLICY fundos_select ON fundos FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY fundos_write ON fundos FOR ALL TO authenticated
  USING (empresa_id = minha_empresa_id() AND tem_nivel('administrador'))
  WITH CHECK (empresa_id = minha_empresa_id() AND tem_nivel('administrador'));

-- Parâmetros: todos da empresa leem (o formulário da nota precisa); só o Administrador altera.
CREATE POLICY parametros_select ON parametros FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY parametros_write ON parametros FOR ALL TO authenticated
  USING (empresa_id = minha_empresa_id() AND tem_nivel('administrador'))
  WITH CHECK (empresa_id = minha_empresa_id() AND tem_nivel('administrador'));

-- Notas: qualquer nível lança/edita rascunhos (aprovar/cancelar exige Supervisor+, no gatilho).
CREATE POLICY documentos_select ON documentos_entrada FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY documentos_insert ON documentos_entrada FOR INSERT TO authenticated WITH CHECK (empresa_id = minha_empresa_id());
CREATE POLICY documentos_update ON documentos_entrada FOR UPDATE TO authenticated
  USING (empresa_id = minha_empresa_id()) WITH CHECK (empresa_id = minha_empresa_id());
CREATE POLICY documentos_delete ON documentos_entrada FOR DELETE TO authenticated
  USING (empresa_id = minha_empresa_id() AND status = 'rascunho');

CREATE POLICY itens_all ON documento_entrada_itens FOR ALL TO authenticated
  USING (empresa_id = minha_empresa_id()) WITH CHECK (empresa_id = minha_empresa_id());

CREATE POLICY anexos_select ON documento_anexos FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY anexos_insert ON documento_anexos FOR INSERT TO authenticated
  WITH CHECK (empresa_id = minha_empresa_id()
    AND EXISTS (SELECT 1 FROM documentos_entrada d WHERE d.id = documento_id AND d.status IN ('rascunho', 'aprovada')));
CREATE POLICY anexos_delete ON documento_anexos FOR DELETE TO authenticated
  USING (empresa_id = minha_empresa_id()
    AND EXISTS (SELECT 1 FROM documentos_entrada d WHERE d.id = documento_id AND d.status = 'rascunho'));

-- Storage: o arquivo só é visível/gravável se a nota correspondente for da MINHA empresa
-- (a subconsulta passa pela RLS de quem chamou, então notas de outras empresas "não existem").
CREATE POLICY notas_anexos_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'notas-anexos'
    AND EXISTS (SELECT 1 FROM documento_anexos a WHERE a.caminho = objects.name));

CREATE POLICY notas_anexos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'notas-anexos'
    AND EXISTS (SELECT 1 FROM documentos_entrada d
                 WHERE d.id::text = (storage.foldername(name))[1] AND d.status IN ('rascunho', 'aprovada')));

CREATE POLICY notas_anexos_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'notas-anexos'
    AND EXISTS (SELECT 1 FROM documentos_entrada d WHERE d.id::text = (storage.foldername(name))[1])
    AND NOT EXISTS (SELECT 1 FROM documento_anexos a JOIN documentos_entrada d ON d.id = a.documento_id
                     WHERE a.caminho = objects.name AND d.status <> 'rascunho'));

-- ─────────────────────────────────────────────────────────────────────
-- 8. Papéis antigos saem de cena
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE profiles DROP COLUMN papel;
DROP FUNCTION tem_papel(text[]);
DROP FUNCTION meu_papel();

-- ─────────────────────────────────────────────────────────────────────
-- 9. Módulo Kids arquivado: fecha o acesso (as tabelas e os dados continuam no banco).
--    Antes, qualquer usuário logado lia as crianças e qualquer pessoa na internet via nome/turma
--    pelas views públicas. Como não há mais telas do Kids, isso deixa de fazer sentido.
--    Para REATIVAR o Kids no futuro, devolva as policies/grants (veja migration_v3.sql) com
--    isolamento por empresa.
-- ─────────────────────────────────────────────────────────────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['criancas', 'responsaveis', 'crianca_responsavel', 'professores', 'salas', 'aulas', 'aula_professor']
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'equipe_all_' || t, t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'publico_select_' || t, t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (sou_plataforma_admin()) WITH CHECK (sou_plataforma_admin())',
                     'kids_somente_plataforma_' || t, t);
    END IF;
  END LOOP;
  IF to_regclass('public.criancas_publico') IS NOT NULL THEN
    REVOKE ALL ON public.criancas_publico FROM anon, authenticated;
  END IF;
  IF to_regclass('public.responsaveis_publico') IS NOT NULL THEN
    REVOKE ALL ON public.responsaveis_publico FROM anon, authenticated;
  END IF;
  IF to_regprocedure('public.checkin_crianca(integer,text,text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.checkin_crianca(integer, text, text) FROM PUBLIC, anon, authenticated;
  END IF;
END;
$$;
