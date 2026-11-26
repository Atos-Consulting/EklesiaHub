import { useEffect, useState } from "react";
import { mensagemErro } from "./db";

// Carrega do banco quando a chave muda; enquanto não chega, devolve o resultado anterior (a tela não pisca).
export function useCarga(chave, carregar) {
  const [r, setR] = useState({ chave: null, dados: null, erro: "" });
  useEffect(() => {
    if (!chave) return undefined;
    let ativo = true;
    carregar().then((d) => { if (ativo) setR({ chave, dados: d, erro: "" }); })
      .catch((e) => { if (ativo) setR({ chave, dados: null, erro: mensagemErro(e) }); });
    return () => { ativo = false; };
  }, [chave]); // eslint-disable-line react-hooks/exhaustive-deps -- `carregar` muda junto com a chave
  return { dados: r.dados, erro: r.erro, carregando: r.chave !== chave };
}
