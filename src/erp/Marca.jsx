import Icone from "./Icone";

// Marca no topo do menu: a logo da igreja (v22) ou, sem logo, a cruz nas cores do sistema.
export default function Marca({ tamanho = 36, logo }) {
  if (logo) return <img className="brand-logo" src={logo} alt="" width={tamanho} height={tamanho} />;
  return (
    <div className="brand-mark" style={{ width: tamanho, height: tamanho }}>
      <Icone nome="cruz" tamanho={Math.round(tamanho * 0.55)} traco={2.4} />
    </div>
  );
}
