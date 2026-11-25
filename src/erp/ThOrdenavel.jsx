import Icone from "./Icone";

// Cabeçalho de coluna clicável: ordena a tabela por esta coluna (clique de novo inverte).
export default function ThOrdenavel({ chave, ordenacao, className = "", children }) {
  const ativo = ordenacao.estado?.chave === chave;
  const dir = ativo ? ordenacao.estado.dir : null;
  return (
    <th className={className} aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}>
      <button type="button" className={`th-ord${ativo ? " ativo" : ""}`} onClick={() => ordenacao.alternar(chave)}
        title={ativo ? (dir === "asc" ? "Ordem crescente — clique para inverter" : "Ordem decrescente — clique para inverter") : "Clique para ordenar"}>
        <span>{children}</span>
        <Icone nome={dir === "asc" ? "ordemCima" : dir === "desc" ? "ordemBaixo" : "ordem"} tamanho={13} traco={2.2} />
      </button>
    </th>
  );
}
