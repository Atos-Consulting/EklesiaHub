import { useEffect, useState } from "react";
import { contabilizar, mensagemErro } from "../db";

// Antes de mostrar qualquer número, traz o diário em dia (contabilizar() é idempotente).
// Devolve { pronto, erro, gerados, versao } — `versao` muda a cada nova contabilização.
export function useContabilizar(gatilho = 0) {
  const [r, setR] = useState({ chave: null, erro: "", gerados: 0 });
  useEffect(() => {
    let ativo = true;
    contabilizar()
      .then((n) => { if (ativo) setR({ chave: gatilho, erro: "", gerados: n }); })
      .catch((e) => { if (ativo) setR({ chave: gatilho, erro: mensagemErro(e), gerados: 0 }); });
    return () => { ativo = false; };
  }, [gatilho]);
  return { pronto: r.chave === gatilho && !r.erro, erro: r.erro, gerados: r.gerados, versao: r.chave === gatilho ? gatilho : null };
}

export const periodoValido = (de, ate) => /^\d{4}-\d{2}-\d{2}$/.test(de ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(ate ?? "") && de <= ate;
