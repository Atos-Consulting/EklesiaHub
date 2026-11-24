import { supabase } from "./supabase";

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

// Perfil do usuário logado: { nome, email, nivel, ativo, empresa_id, empresa_nome, empresa_ativa, plataforma_admin }
// ou null se a conta existe mas ainda não tem perfil.
export async function getPerfil() {
  const { data, error } = await supabase.rpc("meu_perfil");
  if (error) throw error;
  return data ?? null;
}

export async function signIn(email, senha) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Troca a senha do próprio usuário logado.
export async function alterarMinhaSenha(novaSenha) {
  const { error } = await supabase.auth.updateUser({ password: novaSenha });
  if (error) throw error;
}

export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return data.subscription;
}
