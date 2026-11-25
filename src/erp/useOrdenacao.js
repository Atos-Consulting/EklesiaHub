import { useMemo, useState } from "react";

const colador = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
const vazio = (v) => v === null || v === undefined || v === "";

function comparar(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return colador.compare(String(a), String(b));
}

// Ordenação por clique no cabeçalho da coluna (usada em todas as tabelas do sistema).
//   linhas:  a lista de objetos
//   colunas: { chave: (linha) => valor } — definido FORA do componente (objeto constante)
//   padrao:  { chave, dir } inicial ou null
// Valores vazios ficam sempre no fim, qualquer que seja a direção.
export function useOrdenacao(linhas, colunas, padrao = null) {
  const [estado, setEstado] = useState(padrao);

  const ordenadas = useMemo(() => {
    const valor = estado && colunas[estado.chave];
    if (!valor) return linhas;
    const sinal = estado.dir === "desc" ? -1 : 1;
    return [...linhas].sort((x, y) => {
      const a = valor(x);
      const b = valor(y);
      if (vazio(a) || vazio(b)) return vazio(a) === vazio(b) ? 0 : vazio(a) ? 1 : -1;
      return sinal * comparar(a, b);
    });
  }, [linhas, colunas, estado]);

  const alternar = (chave) =>
    setEstado((e) => (e?.chave === chave ? { chave, dir: e.dir === "asc" ? "desc" : "asc" } : { chave, dir: "asc" }));

  return { ordenadas, estado, alternar };
}
