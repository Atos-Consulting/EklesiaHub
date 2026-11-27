-- ═════════════════════════════════════════════════════════════════════
-- EklesiaHub — migration v22: logo e cores da igreja
-- ═════════════════════════════════════════════════════════════════════
--  • Identidade visual (Parâmetros → Dados da igreja, Administrador): logo (PNG, JPG ou WebP até 2 MB,
--    bucket público "identidade", pasta <empresa_id>/), cor principal e cor do menu lateral (#rrggbb).
--    atualizar_identidade_empresa grava; meu_perfil devolve, e o sistema aplica ao abrir.
-- Rodar depois da v21.

ALTER TABLE empresas
  ADD COLUMN logo_caminho text CHECK (logo_caminho IS NULL OR (length(logo_caminho) <= 200 AND split_part(logo_caminho, '/', 1) = id::text)),
  ADD COLUMN cor_primaria text CHECK (cor_primaria IS NULL OR cor_primaria ~ '^#[0-9a-f]{6}$'),
  ADD COLUMN cor_menu     text CHECK (cor_menu IS NULL OR cor_menu ~ '^#[0-9a-f]{6}$');

-- ─────────────────────────────────────────────────────────────────────
-- 1. Identidade visual
-- ─────────────────────────────────────────────────────────────────────

-- p_logo: caminho no bucket "identidade" (nulo = sem logo); cores em #rrggbb (nulo = padrão do sistema).
CREATE FUNCTION atualizar_identidade_empresa(p_logo text, p_cor_primaria text, p_cor_menu text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp bigint := minha_empresa_id();
  v_logo text := nullif(btrim(coalesce(p_logo, '')), '');
  v_pri  text := nullif(lower(btrim(coalesce(p_cor_primaria, ''))), '');
  v_menu text := nullif(lower(btrim(coalesce(p_cor_menu, ''))), '');
BEGIN
  IF v_emp IS NULL OR NOT tem_nivel('administrador') THEN
    RAISE EXCEPTION 'Somente o Administrador da igreja pode alterar a identidade visual.' USING ERRCODE = '42501';
  END IF;
  IF v_logo IS NOT NULL AND split_part(v_logo, '/', 1) <> v_emp::text THEN RAISE EXCEPTION 'Logo inválida.'; END IF;
  IF v_pri IS NOT NULL AND v_pri !~ '^#[0-9a-f]{6}$' THEN RAISE EXCEPTION 'Cor principal inválida (use #rrggbb).'; END IF;
  IF v_menu IS NOT NULL AND v_menu !~ '^#[0-9a-f]{6}$' THEN RAISE EXCEPTION 'Cor do menu inválida (use #rrggbb).'; END IF;
  UPDATE empresas SET logo_caminho = v_logo, cor_primaria = v_pri, cor_menu = v_menu, atualizado_em = now() WHERE id = v_emp;
END;
$$;

-- Bucket público (a logo aparece no menu e nos documentos impressos); só o Administrador da igreja
-- envia e apaga, e só na pasta da própria igreja. SVG fica de fora (pode carregar script).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('identidade', 'identidade', true, 2097152, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY identidade_obj_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'identidade' AND (storage.foldername(name))[1] = minha_empresa_id()::text);
CREATE POLICY identidade_obj_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'identidade' AND (storage.foldername(name))[1] = minha_empresa_id()::text AND tem_nivel('administrador'));
CREATE POLICY identidade_obj_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'identidade' AND (storage.foldername(name))[1] = minha_empresa_id()::text AND tem_nivel('administrador')
         AND NOT EXISTS (SELECT 1 FROM empresas e WHERE e.logo_caminho = objects.name));

-- ─────────────────────────────────────────────────────────────────────
-- 2. meu_perfil devolve a identidade da igreja em uso
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION meu_perfil() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'user_id', p.user_id, 'nome', p.nome, 'email', p.email, 'ativo', p.ativo,
    'nivel', CASE WHEN p.plataforma_admin AND p.empresa_atual_id IS NOT NULL AND p.empresa_atual_id IS DISTINCT FROM p.empresa_id
                  THEN 'administrador' ELSE p.nivel END,
    'empresa_id', e.id, 'empresa_nome', coalesce(nullif(e.nome_fantasia, ''), e.razao_social),
    'empresa_ativa', e.ativo, 'empresa_origem_id', p.empresa_id, 'plataforma_admin', p.plataforma_admin,
    'empresa_logo', e.logo_caminho, 'cor_primaria', e.cor_primaria, 'cor_menu', e.cor_menu)
  FROM profiles p
  LEFT JOIN empresas e ON e.id = CASE WHEN p.plataforma_admin AND p.empresa_atual_id IS NOT NULL
                                      THEN p.empresa_atual_id ELSE p.empresa_id END
  WHERE p.user_id = auth.uid()
$$;

REVOKE EXECUTE ON FUNCTION atualizar_identidade_empresa(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION atualizar_identidade_empresa(text, text, text) TO authenticated;
