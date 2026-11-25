-- Migration v7 — EklesiaHub ERP: gestão de usuários por nível e documento obrigatório nas pessoas
--
-- Pré-requisito: migration_v6_parametros_fiscal.sql.  Rode UMA vez, no SQL Editor.
--
-- O que muda:
--  1. SUPERVISOR (coordenador) passa a ver e gerir usuários da PRÓPRIA empresa, mas só do seu nível para baixo:
--     pode criar/editar/redefinir senha de Supervisor e Usuário; nunca de Administrador, e não pode promover ninguém a Administrador.
--     O Administrador continua podendo tudo na sua empresa; o administrador da plataforma, em qualquer empresa.
--  2. PESSOAS (fornecedores etc.): o CPF/CNPJ passa a ser obrigatório em cadastros novos ou alterados (a unicidade
--     por empresa já existia). Cadastros antigos sem documento não são rejeitados até serem editados.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Quem pode gerir usuários de determinado nível numa empresa
-- ─────────────────────────────────────────────────────────────────────

CREATE FUNCTION pode_gerir_nivel(p_empresa bigint, p_nivel text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT sou_plataforma_admin()
      OR (p_empresa = minha_empresa_id()
          AND (tem_nivel('administrador')
               OR (tem_nivel('supervisor') AND p_nivel IN ('supervisor', 'usuario'))))
$$;
REVOKE EXECUTE ON FUNCTION pode_gerir_nivel(bigint, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION pode_gerir_nivel(bigint, text) TO authenticated;

-- Supervisor também enxerga os perfis da própria empresa (para listar a equipe).
DROP POLICY profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR sou_plataforma_admin()
         OR (tem_nivel('administrador', 'supervisor') AND empresa_id = minha_empresa_id()));

-- ─────────────────────────────────────────────────────────────────────
-- 2. Funções de gestão com a regra "do seu nível para baixo"
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION criar_usuario(p_empresa_id bigint, p_email text, p_senha text, p_nome text, p_nivel text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_id uuid;
BEGIN
  IF p_nivel NOT IN ('administrador', 'supervisor', 'usuario') THEN
    RAISE EXCEPTION 'Nível inválido.';
  END IF;
  IF NOT pode_gerir_nivel(p_empresa_id, p_nivel) THEN
    RAISE EXCEPTION 'Você só pode criar usuários do seu nível ou de um nível abaixo.' USING ERRCODE = '42501';
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

CREATE OR REPLACE FUNCTION atualizar_usuario(p_user_id uuid, p_nome text, p_nivel text, p_ativo boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE alvo profiles%ROWTYPE;
BEGIN
  SELECT * INTO alvo FROM profiles WHERE user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuário não encontrado.'; END IF;
  IF alvo.nivel IS NULL THEN RAISE EXCEPTION 'Este usuário não pertence a nenhuma empresa.'; END IF;
  IF p_nivel NOT IN ('administrador', 'supervisor', 'usuario') THEN RAISE EXCEPTION 'Nível inválido.'; END IF;
  -- precisa poder gerir o nível ATUAL do alvo e também o nível NOVO
  IF NOT (pode_gerir_nivel(alvo.empresa_id, alvo.nivel) AND pode_gerir_nivel(alvo.empresa_id, p_nivel)) THEN
    RAISE EXCEPTION 'Você só pode alterar usuários do seu nível ou de um nível abaixo.' USING ERRCODE = '42501';
  END IF;
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

CREATE OR REPLACE FUNCTION redefinir_senha_usuario(p_user_id uuid, p_senha text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE alvo profiles%ROWTYPE;
BEGIN
  SELECT * INTO alvo FROM profiles WHERE user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuário não encontrado.'; END IF;
  IF NOT pode_gerir_nivel(alvo.empresa_id, alvo.nivel) THEN
    RAISE EXCEPTION 'Você só pode alterar usuários do seu nível ou de um nível abaixo.' USING ERRCODE = '42501';
  END IF;
  IF length(coalesce(p_senha, '')) < 8 THEN RAISE EXCEPTION 'A senha deve ter pelo menos 8 caracteres.'; END IF;

  UPDATE auth.users SET encrypted_password = crypt(p_senha, gen_salt('bf')), updated_at = now() WHERE id = p_user_id;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;  -- força novo login com a nova senha
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. CPF/CNPJ obrigatório (chave do cadastro; único por empresa pelo índice pessoas_documento_uq)
--    NOT VALID: vale para cadastros novos e alterados, sem barrar os antigos que estejam sem documento.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE pessoas ADD CONSTRAINT pessoas_documento_obrigatorio CHECK (documento IS NOT NULL) NOT VALID;
