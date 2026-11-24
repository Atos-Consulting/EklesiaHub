import Icone from "./Icone";

export default function Marca({ tamanho = 36 }) {
  return (
    <div className="brand-mark" style={{ width: tamanho, height: tamanho }}>
      <Icone nome="cruz" tamanho={Math.round(tamanho * 0.55)} traco={2.4} />
    </div>
  );
}
