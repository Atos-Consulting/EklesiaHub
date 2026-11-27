import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// Imprime só o conteúdo passado (comprovante, informe...), mesmo que a tela esteja com um modal aberto.
// Monta o conteúdo numa área própria no fim do <body>, abre a impressão do navegador e chama onFim ao terminar.
// O CSS (index.css, "Documentos para imprimir") esconde todo o resto enquanto body tem a classe com-impressao.
export default function Impressao({ children, onFim }) {
  const fimRef = useRef(onFim);
  useEffect(() => { fimRef.current = onFim; });
  useEffect(() => {
    document.body.classList.add("com-impressao");
    const terminar = () => { document.body.classList.remove("com-impressao"); fimRef.current?.(); };
    window.addEventListener("afterprint", terminar, { once: true });
    const t = setTimeout(() => window.print(), 80); // deixa o navegador desenhar o documento antes
    return () => { clearTimeout(t); window.removeEventListener("afterprint", terminar); document.body.classList.remove("com-impressao"); };
  }, []);
  return createPortal(<div id="area-impressao">{children}</div>, document.body);
}
