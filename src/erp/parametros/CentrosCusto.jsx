import { useMemo, useState } from "react";
import { lbl, inp, msgErro } from "../../estilos";
import ThOrdenavel from "../ThOrdenavel";
import { useOrdenacao } from "../useOrdenacao";
import { salvarCentroCusto, mensagemErro } from "../db";
import { CabecalhoAba, FormModal, CampoAtivo, Situacao, BotaoEditar } from "./comum";

const COLUNAS = { nome: (c) => c.nome, situacao: (c) => (c.ativo ? "Ativo" : "Inativo") };

export default function CentrosCusto({ cadastros, onCadastrosMudaram }) {
  const [editando, setEditando] = useState(null); // null | "novo" | centro
  const [busca, setBusca] = useState("");
  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return cadastros.centros.filter((c) => !t || c.nome.toLowerCase().includes(t));
  }, [cadastros.centros, busca]);
  const ordenacao = useOrdenacao(filtrados, COLUNAS, { chave: "nome", dir: "asc" });

  return (
    <>
      <CabecalhoAba titulo="Centros de custo" acaoRotulo="Novo centro de custo" onAcao={() => setEditando("novo")}
        descricao="Áreas da igreja às quais as despesas são atribuídas (ex.: Louvor, Kids, Manutenção). Aparecem nas notas de entrada, no cabeçalho e em cada item." />
      <div className="toolbar">
        <label style={{ flex: "1 1 240px", maxWidth: 340 }}>Buscar
          <input placeholder="Nome do centro de custo" value={busca} onChange={(e) => setBusca(e.target.value)} style={inp} />
        </label>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <ThOrdenavel chave="nome" ordenacao={ordenacao}>Nome</ThOrdenavel>
            <ThOrdenavel chave="situacao" ordenacao={ordenacao}>Situação</ThOrdenavel>
            <th className="acoes"><span className="sr-only">Ações</span></th>
          </tr></thead>
          <tbody>
            {ordenacao.ordenadas.length === 0 && <tr><td className="vazio" colSpan={3}>Nenhum centro de custo encontrado.</td></tr>}
            {ordenacao.ordenadas.map((c) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 550 }}>{c.nome}</td>
                <td><Situacao ativo={c.ativo} /></td>
                <td className="acoes"><BotaoEditar rotulo={c.nome} onClick={() => setEditando(c)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editando && <CentroForm centro={editando === "novo" ? null : editando} onFechar={() => setEditando(null)}
        onSalvo={async () => { setEditando(null); await onCadastrosMudaram(); }} />}
    </>
  );
}

function CentroForm({ centro, onFechar, onSalvo }) {
  const [nome, setNome] = useState(centro?.nome ?? "");
  const [ativo, setAtivo] = useState(centro?.ativo ?? true);
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar() {
    setTentou(true);
    setErro("");
    if (!nome.trim()) return;
    setSalvando(true);
    try { await salvarCentroCusto(centro?.id ?? null, { nome, ativo }); await onSalvo(); }
    catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }

  return (
    <FormModal titulo={centro ? "Editar centro de custo" : "Novo centro de custo"} largura={460} onFechar={onFechar} onSalvar={salvar} salvando={salvando} erro={erro}>
      <label style={{ ...lbl, marginTop: 4 }} htmlFor="cc-nome">Nome *</label>
      <input id="cc-nome" autoFocus style={{ ...inp, ...(tentou && !nome.trim() ? { borderColor: "var(--danger)" } : {}) }} value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} />
      {tentou && !nome.trim() && <div style={msgErro}>Informe o nome</div>}
      <CampoAtivo ativo={ativo} onChange={setAtivo} dica="inativos não aparecem para novos lançamentos" />
    </FormModal>
  );
}
