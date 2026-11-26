import { useMemo, useState } from "react";
import { lbl, inp, msgErro } from "../../estilos";
import ThOrdenavel from "../ThOrdenavel";
import { useOrdenacao } from "../useOrdenacao";
import { salvarFormaPagamento, mensagemErro } from "../db";
import { COMPORTAMENTOS_FORMA } from "../financeiro";
import { CabecalhoAba, FormModal, CampoAtivo, Situacao, BotaoEditar } from "./comum";

// O que cada comportamento faz na tela (ajuda ao cadastrar).
const DICA_COMPORTAMENTO = {
  boleto: "pede a linha digitável ou o código de barras",
  pix: "pede a chave PIX",
  transferencia: "pede banco, agência e conta",
};

const COLUNAS = {
  nome: (f) => f.nome,
  tipo: (f) => COMPORTAMENTOS_FORMA[f.tipo],
  situacao: (f) => (f.ativo ? "Ativo" : "Inativo"),
};

export default function FormasPagamento({ cadastros, onCadastrosMudaram }) {
  const [editando, setEditando] = useState(null);
  const [busca, setBusca] = useState("");
  const lista = useMemo(() => cadastros.formas || [], [cadastros.formas]);
  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return lista.filter((f) => !t || f.nome.toLowerCase().includes(t));
  }, [lista, busca]);
  const ordenacao = useOrdenacao(filtradas, COLUNAS, { chave: "nome", dir: "asc" });

  return (
    <>
      <CabecalhoAba titulo="Formas de pagamento" acaoRotulo="Nova forma" onAcao={() => setEditando("novo")}
        descricao="As opções de forma de pagamento e de recebimento usadas nas condições de pagamento, nos lançamentos a pagar e a receber e nos dízimos e ofertas. O comportamento define o que a tela pede (boleto pede a linha digitável, PIX pede a chave, transferência pede os dados bancários). Forma já usada não é excluída: desative quando não for mais usar." />
      <div className="toolbar">
        <label style={{ flex: "1 1 240px", maxWidth: 340 }}>Buscar
          <input placeholder="Nome da forma" value={busca} onChange={(e) => setBusca(e.target.value)} style={inp} />
        </label>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <ThOrdenavel chave="nome" ordenacao={ordenacao}>Forma</ThOrdenavel>
            <ThOrdenavel chave="tipo" ordenacao={ordenacao}>Comportamento</ThOrdenavel>
            <ThOrdenavel chave="situacao" ordenacao={ordenacao}>Situação</ThOrdenavel>
            <th className="acoes"><span className="sr-only">Ações</span></th>
          </tr></thead>
          <tbody>
            {ordenacao.ordenadas.length === 0 && <tr><td className="vazio" colSpan={4}>{lista.length ? "Nenhuma forma encontrada." : "Nenhuma forma cadastrada."}</td></tr>}
            {ordenacao.ordenadas.map((f) => (
              <tr key={f.id} style={!f.ativo ? { color: "var(--faint)" } : undefined}>
                <td style={{ fontWeight: 550 }}>{f.nome}</td>
                <td>{COMPORTAMENTOS_FORMA[f.tipo]}{DICA_COMPORTAMENTO[f.tipo] && <div className="muted" style={{ fontSize: 12 }}>{DICA_COMPORTAMENTO[f.tipo]}</div>}</td>
                <td><Situacao ativo={f.ativo} /></td>
                <td className="acoes"><BotaoEditar rotulo={f.nome} onClick={() => setEditando(f)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtradas.length > 0 && <div className="table-footer"><span>{filtradas.length} forma(s)</span></div>}
      {editando && <FormaForm forma={editando === "novo" ? null : editando} onFechar={() => setEditando(null)}
        onSalvo={async () => { setEditando(null); await onCadastrosMudaram(); }} />}
    </>
  );
}

function FormaForm({ forma, onFechar, onSalvo }) {
  const [f, setF] = useState({ nome: forma?.nome ?? "", tipo: forma?.tipo ?? "", ativo: forma?.ativo ?? true });
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const erros = {};
  if (!f.nome.trim()) erros.nome = "Informe o nome da forma";
  if (!f.tipo) erros.tipo = "Escolha o comportamento";
  const borda = (k) => (tentou && erros[k] ? { borderColor: "var(--danger)" } : {});

  async function salvar() {
    setTentou(true);
    setErro("");
    if (Object.keys(erros).length) return;
    setSalvando(true);
    try { await onSalvo(await salvarFormaPagamento(forma?.id ?? null, f)); }
    catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }

  return (
    <FormModal titulo={forma ? "Editar forma de pagamento" : "Nova forma de pagamento"} largura={500} onFechar={onFechar} onSalvar={salvar} salvando={salvando} erro={erro}>
      <label style={{ ...lbl, marginTop: 4 }} htmlFor="fp-nome">Nome *</label>
      <input id="fp-nome" autoFocus maxLength={60} style={{ ...inp, ...borda("nome") }} value={f.nome} onChange={set("nome")} placeholder="Ex.: Cartão Sicredi" />
      {tentou && erros.nome && <div style={msgErro}>{erros.nome}</div>}

      <label style={lbl} htmlFor="fp-tipo">Comportamento *</label>
      <select id="fp-tipo" style={{ ...inp, ...borda("tipo") }} value={f.tipo} onChange={set("tipo")}>
        <option value="">— Selecione —</option>
        {Object.entries(COMPORTAMENTOS_FORMA).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
      </select>
      {tentou && erros.tipo && <div style={msgErro}>{erros.tipo}</div>}
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        {f.tipo && DICA_COMPORTAMENTO[f.tipo] ? `Ao usar esta forma, a tela ${DICA_COMPORTAMENTO[f.tipo]}.` : "Define o que a tela pede ao usar esta forma."}
        {forma && " Depois de usada, o comportamento não muda."}
        {f.tipo === "boleto" && " Boleto não aparece nos dízimos e ofertas."}
      </div>
      <CampoAtivo ativo={f.ativo} onChange={(v) => setF((p) => ({ ...p, ativo: v }))} dica="formas inativas não aparecem em lançamentos novos" />
    </FormModal>
  );
}
