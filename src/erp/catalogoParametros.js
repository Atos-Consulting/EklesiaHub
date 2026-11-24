// Catálogo de parâmetros da empresa (valores guardados na tabela `parametros`).
// Para criar um parâmetro novo: acrescente a regra em migration (função parametros_valida) e descreva aqui.

// Tamanho máximo do número da nota, por tipo. Os padrões devem ser iguais aos da função
// tamanho_numero_nota() no banco (migration_v5_multiempresa.sql).
export const TAMANHO_NUMERO_PADRAO = { nfe: 9, nfse: 15, recibo: 10, fatura: 10, outro: 20 };
export const TAMANHO_NUMERO_MIN = 1;
export const TAMANHO_NUMERO_MAX = 30;

export const chaveTamanhoNumero = (tipo) => `nota.numero_tamanho.${tipo}`;

// `parametros` é um objeto { chave: valor } como devolvido por fetchCadastros().
export function tamanhoNumero(parametros, tipo) {
  const v = Number(parametros?.[chaveTamanhoNumero(tipo)]);
  return Number.isInteger(v) && v >= TAMANHO_NUMERO_MIN && v <= TAMANHO_NUMERO_MAX ? v : (TAMANHO_NUMERO_PADRAO[tipo] ?? 20);
}
