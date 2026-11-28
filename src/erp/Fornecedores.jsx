import { useMemo, useState } from "react";
import { Header, Pill } from "../ui";
import { inp } from "../estilos";
import Icone from "./Icone";
import PessoaModal from "./PessoaModal";
import ThOrdenavel from "./ThOrdenavel";
import { useOrdenacao } from "./useOrdenacao";
import { mascararDocumento } from "./format";

const COLUNAS = {
  nome: (p) => p.nome,
  documento: (p) => p.documento,
  tipo: (p) => (p.tipo_pessoa === "PF" ? "CPF" : "CNPJ"),
  contato: (p) => [p.telefone, p.email].filter(Boolean).join(" · "),
  situacao: (p) => (p.ativo ? "Ativo" : "Inativo"),
};

export default function Fornecedores({ cadastros, podeEditar, onCadastrosMudaram }) {
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState(null); // null | "novo" | pessoa

  const fornecedores = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const digitos = termo.replace(/\W/g, "");
    return cadastros.pessoas
      .filter((p) => p.papeis.includes("fornecedor"))
      .filter((p) => !termo || p.nome.toLowerCase().includes(termo) || (digitos && (p.documento || "").toLowerCase().includes(digitos)));
  }, [cadastros.pessoas, busca]);

  const ordenacao = useOrdenacao(fornecedores, COLUNAS, { chave: "nome", dir: "asc" });

  async function aoSalvar() {
    setEditando(null);
    await onCadastrosMudaram();
  }

  return (
    <div>
      <div className="page-header">
        <Header title="Fornecedores" subtitle="Empresas e pessoas que emitem as notas de entrada." />
        {podeEditar && (
          <button className="btn btn-primary" onClick={() => setEditando("novo")}><Icone nome="mais" tamanho={16} traco={2.2} /> Novo fornecedor</button>
        )}
      </div>

      <div className="card">
        <div className="toolbar">
          <label style={{ flex: "1 1 260px", maxWidth: 380 }}>Buscar
            <input placeholder="Nome ou CPF/CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} style={inp} />
          </label>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <ThOrdenavel chave="nome" ordenacao={ordenacao}>Nome</ThOrdenavel>
                <ThOrdenavel chave="tipo" ordenacao={ordenacao}>Tipo</ThOrdenavel>
                <ThOrdenavel chave="documento" ordenacao={ordenacao}>CPF / CNPJ</ThOrdenavel>
                <ThOrdenavel chave="contato" ordenacao={ordenacao}>Contato</ThOrdenavel>
                <ThOrdenavel chave="situacao" ordenacao={ordenacao}>Situação</ThOrdenavel>
                {podeEditar && <th />}
              </tr>
            </thead>
            <tbody>
              {fornecedores.length === 0 && <tr><td className="vazio" colSpan={podeEditar ? 6 : 5}>Nenhum fornecedor encontrado.</td></tr>}
              {ordenacao.ordenadas.map((p) => (
                <tr key={p.id}>
                  <td className="truncate" style={{ fontWeight: 550 }}>{p.nome}</td>
                  <td>{p.tipo_pessoa === "PF" ? "Pessoa física" : "Empresa"}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{mascararDocumento(p.tipo_pessoa, p.documento || "") || "—"}</td>
                  <td className="muted">{[p.telefone, p.email].filter(Boolean).join(" · ") || "—"}</td>
                  <td><Pill tone={p.ativo ? "ok" : "neutral"}>{p.ativo ? "Ativo" : "Inativo"}</Pill></td>
                  {podeEditar && <td style={{ textAlign: "right" }}><button className="btn btn-ghost btn-sm" onClick={() => setEditando(p)}>Editar</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {fornecedores.length > 0 && <div className="table-footer"><span>{fornecedores.length} fornecedor(es)</span></div>}
      </div>

      {editando && (
        <PessoaModal
          inicial={editando === "novo" ? null : editando}
          formas={cadastros.formas}
          onSalvo={aoSalvar}
          onFechar={() => setEditando(null)}
        />
      )}
    </div>
  );
}
