-- Migration v9 — EklesiaHub ERP: administrador da plataforma troca de empresa
--
-- Pré-requisito: migration_v8_financeiro.sql.  Rode UMA vez, no SQL Editor.
--
-- O que muda:
--  O administrador da plataforma pode escolher em qual empresa está trabalhando (clicando no nome da empresa,
--  no menu). Enquanto estiver nela, age como Administrador daquela empresa: vê e lança tudo dela.
--  A empresa "de origem" do perfil (profiles.empresa_id) NÃO muda — a troca fica em profiles.empresa_atual_id.
--  Assim, a regra "toda empresa tem ao menos um Administrador ativo" e a lista de usuários de cada empresa
--  continuam iguais. Todas as regras de acesso (RLS) usam minha_empresa_id(), que passa a devolver a empresa atual.
--  Isso substitui a regra antiga de que o administrador da plataforma não via os dados das empresas.

ALTER TABLE profiles ADD COLUMN empresa_atual_id bigint REFERENCES empresas(id);

-- Empresa em que o usuário está trabalhando agora (só o administrador da plataforma pode estar fora da sua).
CREATE OR REPLACE FUNCTION minha_empresa_id() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id FROM profiles p
    JOIN empresas e ON e.id = CASE WHEN p.plataforma_admin AND p.empresa_atual_id IS NOT NULL
                                   THEN p.empresa_atual_id ELSE p.empresa_id END
   WHERE p.user_id = auth.uid() AND p.ativo AND e.ativo
$$;

-- Fora da empresa de origem, o administrador da plataforma age como Administrador.
CREATE OR REPLACE FUNCTION meu_nivel() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN p.plataforma_admin AND p.empresa_atual_id IS NOT NULL AND p.empresa_atual_id IS DISTINCT FROM p.empresa_id
              THEN 'administrador' ELSE p.nivel END
    FROM profiles p
    JOIN empresas e ON e.id = CASE WHEN p.plataforma_admin AND p.empresa_atual_id IS NOT NULL
                                   THEN p.empresa_atual_id ELSE p.empresa_id END
   WHERE p.user_id = auth.uid() AND p.ativo AND e.ativo
$$;

-- Perfil para a tela: empresa e nível já são os da empresa atual.
CREATE OR REPLACE FUNCTION meu_perfil() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'user_id', p.user_id, 'nome', p.nome, 'email', p.email, 'ativo', p.ativo,
    'nivel', CASE WHEN p.plataforma_admin AND p.empresa_atual_id IS NOT NULL AND p.empresa_atual_id IS DISTINCT FROM p.empresa_id
                  THEN 'administrador' ELSE p.nivel END,
    'empresa_id', e.id, 'empresa_nome', coalesce(nullif(e.nome_fantasia, ''), e.razao_social),
    'empresa_ativa', e.ativo, 'empresa_origem_id', p.empresa_id, 'plataforma_admin', p.plataforma_admin)
  FROM profiles p
  LEFT JOIN empresas e ON e.id = CASE WHEN p.plataforma_admin AND p.empresa_atual_id IS NOT NULL
                                      THEN p.empresa_atual_id ELSE p.empresa_id END
  WHERE p.user_id = auth.uid()
$$;

-- Troca a empresa de trabalho (só o administrador da plataforma). Voltar à de origem limpa a escolha.
CREATE FUNCTION trocar_empresa(p_empresa bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT sou_plataforma_admin() THEN
    RAISE EXCEPTION 'Somente o administrador da plataforma pode trocar de empresa.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM empresas WHERE id = p_empresa AND ativo) THEN
    RAISE EXCEPTION 'Empresa inexistente ou inativa.';
  END IF;
  UPDATE profiles
     SET empresa_atual_id = CASE WHEN p_empresa = empresa_id THEN NULL ELSE p_empresa END
   WHERE user_id = auth.uid();
END;
$$;

-- Mesma função da v5, agora: não desativa a empresa em que se está trabalhando, e quem estava "dentro"
-- de uma empresa que foi desativada volta para a sua de origem.
CREATE OR REPLACE FUNCTION atualizar_empresa(p_id bigint, p_razao_social text, p_nome_fantasia text, p_cnpj text, p_ativo boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT sou_plataforma_admin() THEN
    RAISE EXCEPTION 'Somente o administrador da plataforma pode alterar empresas.' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_razao_social, ''))) = 0 THEN RAISE EXCEPTION 'Informe a razão social.'; END IF;
  IF NOT p_ativo AND (p_id = minha_empresa_id() OR p_id = (SELECT empresa_id FROM profiles WHERE user_id = auth.uid())) THEN
    RAISE EXCEPTION 'Você não pode desativar a empresa em que está trabalhando.';
  END IF;

  UPDATE empresas
     SET razao_social = btrim(p_razao_social), nome_fantasia = nullif(btrim(coalesce(p_nome_fantasia, '')), ''),
         cnpj = nullif(upper(regexp_replace(coalesce(p_cnpj, ''), '[^0-9A-Za-z]', '', 'g')), ''), ativo = p_ativo
   WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empresa não encontrada.'; END IF;
  IF NOT p_ativo THEN
    UPDATE profiles SET empresa_atual_id = NULL WHERE empresa_atual_id = p_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION trocar_empresa(bigint) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION trocar_empresa(bigint) TO authenticated;
