import { useMemo, useState } from "react";
import { Pill } from "../../ui";
import { lbl, inp, msgErro } from "../../estilos";
import ThOrdenavel from "../ThOrdenavel";
import { useOrdenacao } from "../useOrdenacao";
import { salvarContaContabil, mensagemErro } from "../db";
import { CabecalhoAba, FormModal, CampoAtivo, Situacao, BotaoEditar } from "./comum";
import { NATUREZAS } from "./rotulos";

const COLUNAS = {
  codigo: (c) => c.codigo,
  nome: (c) => c.nome,
  natureza: (c) => NATUREZAS[c.natureza],
  tipo: (c) => (c.analitica ? "Analítica" : "Sintética"),
  situacao: (c) => (c.ativo ? "Ativo" : "Inativo"),
};

const nivel = (codigo) => codigo.split(".").length;

// Próximo código livre sob um pai (ou de 1º nível): 5.1 → 5.1.05; 5 → 5.5; sem pai → próximo inteiro.
function proximoCodigo(contas, pai) {
  const prefixo = pai ? `${pai.codigo}.` : "";
  const sufixos = contas
    .filter((c) => c.codigo.startsWith(prefixo) && c.codigo.slice(prefixo.length) !== "" && !c.codigo.slice(prefixo.length).includes("."))
    .map((c) => Number(c.codigo.slice(prefixo.length)))
    .filter(Number.isFinite);
  const prox = (sufixos.length ? Math.max(...sufixos) : 0) + 1;
  return `${prefixo}${pai && nivel(pai.codigo) >= 2 ? String(prox).padStart(2, "0") : prox}`;
}

export default function PlanoContas({ cadastros, onCadastrosMudaram }) {
  const [editando, setEditando] = useState(null); // null | "novo" | conta
  const [filtros, setFiltros] = useState({ busca: "", natureza: "", situacao: "" });
  const filtradas = useMemo(() => {
    const t = filtros.busca.trim().toLowerCase();
    return cadastros.contas.filter((c) =>
      (!t || c.nome.toLowerCase().includes(t) || c.codigo.startsWith(t)) &&
      (!filtros.natureza || c.natureza === filtros.natureza) &&
      (!filtros.situacao || String(c.ativo) === filtros.situacao));
  }, [cadastros.contas, filtros]);
  const ordenacao = useOrdenacao(filtradas, COLUNAS, { chave: "codigo", dir: "asc" });
  const hierarquia = ordenacao.estado?.chave === "codigo" && ordenacao.estado.dir === "asc"; // recuo só na ordem natural
  const f = (k) => (e) => setFiltros((p) => ({ ...p, [k]: e.target.value }));
  const temFiltro = Object.values(filtros).some(Boolean);

  return (
    <>
      <CabecalhoAba titulo="Plano de contas" acaoRotulo="Nova conta" onAcao={() => setEditando("novo")}
        descricao="Estrutura contábil da igreja. Contas sintéticas agrupam; só as analíticas recebem lançamentos. Veja a aba Orientações contábeis para saber o que cada grupo significa." />
      <div className="toolbar">
        <label style={{ flex: "1 1 220px", maxWidth: 320 }}>Buscar
          <input placeholder="Código ou nome da conta" value={filtros.busca} onChange={f("busca")} style={inp} />
        </label>
        <label>Natureza
          <select value={filtros.natureza} onChange={f("natureza")} style={{ ...inp, width: 180 }}>
            <option value="">Todas</option>
            {Object.entries(NATUREZAS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
        </label>
        <label>Situação
          <select value={filtros.situacao} onChange={f("situacao")} style={{ ...inp, width: 130 }}>
            <option value="">Todas</option><option value="true">Ativas</option><option value="false">Inativas</option>
          </select>
        </label>
        {temFiltro && <button className="btn btn-ghost" onClick={() => setFiltros({ busca: "", natureza: "", situacao: "" })}>Limpar filtros</button>}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <ThOrdenavel chave="codigo" ordenacao={ordenacao}>Código</ThOrdenavel>
            <ThOrdenavel chave="nome" ordenacao={ordenacao}>Nome</ThOrdenavel>
            <ThOrdenavel chave="natureza" ordenacao={ordenacao}>Natureza</ThOrdenavel>
            <ThOrdenavel chave="tipo" ordenacao={ordenacao}>Tipo</ThOrdenavel>
            <ThOrdenavel chave="situacao" ordenacao={ordenacao}>Situação</ThOrdenavel>
            <th className="acoes"><span className="sr-only">Ações</span></th>
          </tr></thead>
          <tbody>
            {ordenacao.ordenadas.length === 0 && <tr><td className="vazio" colSpan={6}>Nenhuma conta encontrada.</td></tr>}
            {ordenacao.ordenadas.map((c) => (
              <tr key={c.id} style={!c.ativo ? { color: "var(--faint)" } : undefined}>
                <td style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{c.codigo}</td>
                <td style={{ fontWeight: c.analitica ? 450 : 650, paddingLeft: hierarquia ? 16 + (nivel(c.codigo) - 1) * 18 : undefined }}>{c.nome}</td>
                <td>{NATUREZAS[c.natureza]}</td>
                <td><Pill tone={c.analitica ? "neutral" : "warn"}>{c.analitica ? "Analítica" : "Sintética"}</Pill></td>
                <td><Situacao ativo={c.ativo} /></td>
                <td className="acoes"><BotaoEditar rotulo={`${c.codigo} ${c.nome}`} onClick={() => setEditando(c)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-footer"><span>{filtradas.length} de {cadastros.contas.length} conta(s)</span></div>
      {editando && <ContaForm conta={editando === "novo" ? null : editando} contas={cadastros.contas} onFechar={() => setEditando(null)}
        onSalvo={async () => { setEditando(null); await onCadastrosMudaram(); }} />}
    </>
  );
}

function ContaForm({ conta, contas, onFechar, onSalvo }) {
  const temFilhas = Boolean(conta) && contas.some((c) => c.pai_id === conta.id);
  const [f, setF] = useState({
    codigo: conta?.codigo ?? "", nome: conta?.nome ?? "", natureza: conta?.natureza ?? "despesa",
    analitica: conta?.analitica ?? true, paiId: conta?.pai_id ? String(conta.pai_id) : "", ativo: conta?.ativo ?? true,
  });
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [codigoSugerido, setCodigoSugerido] = useState(!conta); // enquanto não digitar, acompanha o pai escolhido

  const possiveisPais = contas.filter((c) => !c.analitica && c.ativo && c.id !== conta?.id);
  const pai = contas.find((c) => String(c.id) === f.paiId);
  const erros = {};
  if (!/^\d+(\.\d+)*$/.test(f.codigo.trim())) erros.codigo = "Use números separados por ponto (ex.: 5.1.05)";
  else if (!pai && f.codigo.includes(".")) erros.codigo = "Conta com ponto no código precisa de uma conta pai";
  else if (pai && !(f.codigo.startsWith(`${pai.codigo}.`) && !f.codigo.slice(pai.codigo.length + 1).includes(".") && f.codigo.length > pai.codigo.length + 1)) erros.codigo = `Deve começar com ${pai.codigo}. seguido de um novo nível`;
  if (!f.nome.trim()) erros.nome = "Informe o nome";

  function escolherPai(valor) {
    const novoPai = contas.find((c) => String(c.id) === valor);
    setF((p) => ({
      ...p, paiId: valor, natureza: novoPai ? novoPai.natureza : p.natureza,
      codigo: codigoSugerido ? proximoCodigo(contas, novoPai) : p.codigo,
    }));
  }

  async function salvar() {
    setTentou(true);
    setErro("");
    if (Object.keys(erros).length) return;
    setSalvando(true);
    try { await salvarContaContabil(conta?.id ?? null, f); await onSalvo(); }
    catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }

  const borda = (k) => (tentou && erros[k] ? { borderColor: "var(--danger)" } : {});
  return (
    <FormModal titulo={conta ? "Editar conta" : "Nova conta"} largura={560} onFechar={onFechar} onSalvar={salvar} salvando={salvando} erro={erro}>
      <label style={{ ...lbl, marginTop: 4 }} htmlFor="pc-pai">Conta pai (agrupadora)</label>
      <select id="pc-pai" style={inp} value={f.paiId} onChange={(e) => escolherPai(e.target.value)} disabled={temFilhas}>
        <option value="">— Nenhuma (conta de 1º nível) —</option>
        {possiveisPais.map((c) => <option key={c.id} value={c.id}>{c.codigo} — {c.nome}</option>)}
      </select>
      <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 12 }}>
        <div>
          <label style={lbl} htmlFor="pc-codigo">Código *</label>
          <input id="pc-codigo" style={{ ...inp, ...borda("codigo") }} value={f.codigo} disabled={temFilhas} inputMode="decimal"
            onChange={(e) => { setCodigoSugerido(false); setF((p) => ({ ...p, codigo: e.target.value.replace(/[^\d.]/g, "") })); }} />
        </div>
        <div>
          <label style={lbl} htmlFor="pc-nome">Nome *</label>
          <input id="pc-nome" style={{ ...inp, ...borda("nome") }} value={f.nome} maxLength={100} onChange={(e) => setF((p) => ({ ...p, nome: e.target.value }))} />
        </div>
      </div>
      {tentou && (erros.codigo || erros.nome) && <div style={msgErro}>{erros.codigo || erros.nome}</div>}
      {temFilhas && <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>Esta conta tem contas filhas: código, pai, natureza e tipo não podem mudar.</div>}

      <label style={lbl} htmlFor="pc-natureza">Natureza *</label>
      <select id="pc-natureza" style={inp} value={f.natureza} disabled={Boolean(pai) || temFilhas} onChange={(e) => setF((p) => ({ ...p, natureza: e.target.value }))}>
        {Object.entries(NATUREZAS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
      </select>
      {pai && <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>A natureza acompanha a da conta pai.</div>}

      <label style={lbl}>Tipo de conta *</label>
      <div style={{ display: "grid", gap: 8 }}>
        {[[true, "Analítica", "recebe lançamentos (é a que aparece nos tipos contábeis e nas contas caixa)"], [false, "Sintética", "só agrupa outras contas (ex.: 5.1 Despesas administrativas)"]].map(([valor, rotulo, dica]) => (
          <label key={rotulo} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13.5, color: "var(--text-2)" }}>
            <input type="radio" name="pc-tipo" checked={f.analitica === valor} disabled={temFilhas} onChange={() => setF((p) => ({ ...p, analitica: valor }))} style={{ marginTop: 3 }} />
            <span><strong style={{ color: "var(--text)" }}>{rotulo}</strong> — {dica}</span>
          </label>
        ))}
      </div>
      <CampoAtivo ativo={f.ativo} onChange={(v) => setF((p) => ({ ...p, ativo: v }))} dica="contas inativas não podem ser escolhidas em novos cadastros" />
    </FormModal>
  );
}
