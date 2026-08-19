-- Migration v3 — EklesiaHub
-- Login da equipe (Supabase Auth) + RLS
--
-- Antes desta migration, qualquer pessoa com a chave anon (pública no bundle do
-- app) podia ler e escrever em todas as tabelas. A partir daqui:
--  - CRUD completo (criancas, responsaveis, professores, salas, aulas) exige
--    estar autenticado (equipe) — não há autocadastro, contas de equipe são
--    criadas manualmente pelo admin (Authentication > Users no painel do Supabase).
--  - O app dos Pais continua sem exigir login, mas só enxerga o mínimo
--    necessário para o check-in: nome/turma/status da criança (sem alergia,
--    data de nascimento ou foto) e nome/foto do responsável (sem CPF, telefone
--    ou e-mail), via views dedicadas.
--  - O check-in/check-out em si passa a usar uma função (SECURITY DEFINER) que
--    só altera status e sala_atual — não dá para reescrever outros campos da
--    criança sem estar autenticado.

ALTER TABLE criancas ENABLE ROW LEVEL SECURITY;
ALTER TABLE responsaveis ENABLE ROW LEVEL SECURITY;
ALTER TABLE crianca_responsavel ENABLE ROW LEVEL SECURITY;
ALTER TABLE professores ENABLE ROW LEVEL SECURITY;
ALTER TABLE salas ENABLE ROW LEVEL SECURITY;
ALTER TABLE aulas ENABLE ROW LEVEL SECURITY;
ALTER TABLE aula_professor ENABLE ROW LEVEL SECURITY;

-- Equipe autenticada: acesso total em todas as tabelas
CREATE POLICY "equipe_all_criancas" ON criancas FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "equipe_all_responsaveis" ON responsaveis FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "equipe_all_crianca_responsavel" ON crianca_responsavel FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "equipe_all_professores" ON professores FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "equipe_all_salas" ON salas FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "equipe_all_aulas" ON aulas FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "equipe_all_aula_professor" ON aula_professor FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- App dos Pais (sem login): o vínculo criança-responsável é só ids, sem dado pessoal
CREATE POLICY "publico_select_crianca_responsavel" ON crianca_responsavel FOR SELECT TO anon USING (true);

-- Views com o mínimo necessário para o check-in dos pais funcionar sem expor
-- CPF, telefone, e-mail, alergia, data de nascimento ou foto de todo mundo
-- para quem só tem a chave anon.
CREATE OR REPLACE VIEW criancas_publico AS
  SELECT id, codigo, nome, turma, status FROM criancas;

CREATE OR REPLACE VIEW responsaveis_publico AS
  SELECT id, nome, tipo AS filiacao, foto_url FROM responsaveis;

GRANT SELECT ON criancas_publico TO anon, authenticated;
GRANT SELECT ON responsaveis_publico TO anon, authenticated;

-- Check-in/check-out sem login: só altera status e sala_atual, nada mais.
CREATE OR REPLACE FUNCTION public.checkin_crianca(p_id INT, p_status TEXT, p_sala TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('presente', 'retirado', 'fora') THEN
    RAISE EXCEPTION 'status inválido: %', p_status;
  END IF;
  UPDATE criancas SET status = p_status, sala_atual = p_sala WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.checkin_crianca(INT, TEXT, TEXT) TO anon, authenticated;
