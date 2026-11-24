import { useEffect, useRef } from "react";
import Icone from "./Icone";

// Janelas abertas, da mais antiga para a mais recente. Só a última (a que está por cima) reage ao Esc,
// para que fechar um cadastro aberto sobre a nota não feche a nota junto e perca o que foi digitado.
const abertas = [];

// Modal genérico do ERP. `fecharFora=false` evita perder um formulário longo por clique acidental.
export default function Modal({ titulo, extra, largura = 520, onFechar, fecharFora = true, nivel = 100, children, rodape }) {
  const fecharRef = useRef(onFechar);
  useEffect(() => { fecharRef.current = onFechar; });

  useEffect(() => {
    const id = Symbol("modal");
    abertas.push(id);
    function aoTeclar(e) {
      if (e.key === "Escape" && abertas[abertas.length - 1] === id) fecharRef.current();
    }
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      abertas.splice(abertas.indexOf(id), 1);
    };
  }, []);

  return (
    <div className="modal-overlay" style={{ zIndex: nivel }}
      onMouseDown={(e) => { if (fecharFora && e.target === e.currentTarget) onFechar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo} style={{ maxWidth: largura }}>
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <h2 className="modal-title">{titulo}</h2>
            {extra}
          </div>
          <button className="icon-btn" onClick={onFechar} aria-label="Fechar"><Icone nome="fechar" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {rodape && <div className="modal-footer">{rodape}</div>}
      </div>
    </div>
  );
}
