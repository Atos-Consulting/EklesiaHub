import { soDigitos } from "./format";

// Endereço e contato da igreja: usados no cadastro de Igrejas (plataforma) e em Parâmetros → Dados da igreja.
export const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];
export const ENDERECO_VAZIO = { cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", telefone: "", email: "" };
export const mascararCep = (v) => { const d = soDigitos(v).slice(0, 8); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };
export const enderecoDe = (e) => Object.fromEntries(Object.keys(ENDERECO_VAZIO).map((k) => [k, k === "cep" ? mascararCep(e?.[k] || "") : e?.[k] ?? ""]));
export function errosEndereco(f) {
  const erros = {};
  if (f.cep && soDigitos(f.cep).length !== 8) erros.cep = "O CEP tem 8 números";
  if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) erros.email = "E-mail inválido";
  return erros;
}
