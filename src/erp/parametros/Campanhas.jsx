import { useMemo, useState } from "react";
import { lbl, inp, msgErro } from "../../estilos";
import ThOrdenavel from "../ThOrdenavel";
import { useOrdenacao } from "../useOrdenacao";
import { salvarCampanha, mensagemErro } from "../db";
import { formatarMoeda, formatarData, lerNumero, numeroParaCampo } from "../format";
import { CabecalhoAba, FormModal, CampoAtivo, Situacao, BotaoEditar } from "./comum";

const COLUNAS = {
  nome: (c) => c.nome,
  periodo: (c) => c.data_inicio || "",
  meta: (c) => (c.meta === null ? -1 : Number(c.meta)),
  arrecadado: (c) => Number(c.arrecadado),
  situacao: (c) => (c.ativo ? "Ativo" : "Inativo"),
};

function periodo(c) {
  if (c.data_inicio && c.data_fim) return `${formatarData(c.data_inicio)} a ${formatarData(c.data_fim)}`;
  if (c.data_inicio) return `desde ${formatarData(c.data_inicio)}`;
  if (c.data_fim) return `até ${formatarData(c.data_fim)}`;
  return "—";
}

// Barra de progresso da meta (só quando a campanha tem meta).
function Progresso({ c }) {
  if (c.meta === null) return null;
  const pct = Math.min(100, Math.round((Number(c.arrecadado) / Number(c.meta)) * 100));
  return (
    <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6 }} title={`${pct}% da meta`}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--surface-2)", overflow: "hidden", minWidth: 60 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: pct >= 100 ? "var(--ok-text)" : "var(--primary)" }} />
      </div>
      <span className="muted" style={{ fontSize: 11.5 }}>{pct}%</span>
    </div>
  );
}

export default function Campanhas({ cadastros, onCadastrosMudaram }) {
  const [editando, setEditando] = useState(null);
  const [busca, setBusca] = useState("");
  const lista = useMemo(() => cadastros.campanhas || [], [cadastros.campanhas]);
  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return lista.filter((c) => !t || c.nome.toLowerCase().includes(t));
  }, [lista, busca]);
  const ordenacao = useOrdenacao(filtradas, COLUNAS, { chave: "nome", dir: "asc" });

  return (
    <>
      <CabecalhoAba titulo="Campanhas" acaoRotulo="Nova campanha" onAcao={() => setEditando("novo")}
        descricao="Arrecadações com uma finalidade (reforma, missões, evento). As entradas do tipo Campanha, em Financeiro → Dízimos e ofertas, somam no arrecadado. A meta e o período são opcionais. Campanha que já recebeu entradas não é excluída: desative quando terminar." />
      <div className="toolbar">
        <label style={{ flex: "1 1 240px", maxWidth: 340 }}>Buscar
          <input placeholder="Nome da campanha" value={busca} onChange={(e) => setBusca(e.target.value)} style={inp} />
        </label>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <ThOrdenavel chave="nome" ordenacao={ordenacao}>Campanha</ThOrdenavel>
            <ThOrdenavel chave="periodo" ordenacao={ordenacao}>Período</ThOrdenavel>
            <ThOrdenavel chave="meta" ordenacao={ordenacao} className="num">Meta</ThOrdenavel>
            <ThOrdenavel chave="arrecadado" ordenacao={ordenacao} className="num">Arrecadado</ThOrdenavel>
            <ThOrdenavel chave="situacao" ordenacao={ordenacao}>Situação</ThOrdenavel>
            <th className="acoes"><span className="sr-only">Ações</span></th>
          </tr></thead>
          <tbody>
            {ordenacao.ordenadas.length === 0 && <tr><td className="vazio" colSpan={6}>{lista.length ? "Nenhuma campanha encontrada." : "Nenhuma campanha cadastrada."}</td></tr>}
            {ordenacao.ordenadas.map((c) => (
              <tr key={c.id} style={!c.ativo ? { color: "var(--faint)" } : undefined}>
                <td style={{ fontWeight: 550 }}>{c.nome}{c.descricao && <div className="muted truncate" style={{ fontSize: 12, fontWeight: 400, maxWidth: 320 }}>{c.descricao}</div>}</td>
                <td>{periodo(c)}</td>
                <td className="num">{c.meta === null ? "—" : formatarMoeda(c.meta)}</td>
                <td className="num" style={{ minWidth: 130 }}>{formatarMoeda(c.arrecadado)}<div className="muted" style={{ fontSize: 11.5 }}>{c.qtd_entradas} entrada(s)</div><Progresso c={c} /></td>
                <td><Situacao ativo={c.ativo} /></td>
                <td className="acoes"><BotaoEditar rotulo={c.nome} onClick={() => setEditando(c)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtradas.length > 0 && <div className="table-footer"><span>{filtradas.length} campanha(s)</span></div>}
      {editando && <CampanhaForm campanha={editando === "novo" ? null : editando} onFechar={() => setEditando(null)}
        onSalvo={async () => { setEditando(null); await onCadastrosMudaram(); }} />}
    </>
  );
}

function CampanhaForm({ campanha, onFechar, onSalvo }) {
  const [f, setF] = useState({
    nome: campanha?.nome ?? "", descricao: campanha?.descricao ?? "",
    meta: campanha?.meta ? numeroParaCampo(Number(campanha.meta)) : "",
    dataInicio: campanha?.data_inicio ?? "", dataFim: campanha?.data_fim ?? "", ativo: campanha?.ativo ?? true,
  });
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const meta = f.meta.trim() ? lerNumero(f.meta) : null;

  const erros = {};
  if (!f.nome.trim()) erros.nome = "Informe o nome da campanha";
  if (meta !== null && !(meta > 0)) erros.meta = "Meta precisa ser maior que zero (ou deixe em branco)";
  if (f.dataInicio && f.dataFim && f.dataFim < f.dataInicio) erros.dataFim = "O fim não pode ser antes do início";
  const borda = (k) => (tentou && erros[k] ? { borderColor: "var(--danger)" } : {});

  async function salvar() {
    setTentou(true);
    setErro("");
    if (Object.keys(erros).length) return;
    setSalvando(true);
    try { await onSalvo(await salvarCampanha(campanha?.id ?? null, { ...f, meta })); }
    catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }

  return (
    <FormModal titulo={campanha ? "Editar campanha" : "Nova campanha"} largura={560} onFechar={onFechar} onSalvar={salvar} salvando={salvando} erro={erro}>
      <label style={{ ...lbl, marginTop: 4 }} htmlFor="ca-nome">Nome *</label>
      <input id="ca-nome" autoFocus maxLength={80} style={{ ...inp, ...borda("nome") }} value={f.nome} onChange={set("nome")} placeholder="Ex.: Reforma do templo" />
      {tentou && erros.nome && <div style={msgErro}>{erros.nome}</div>}

      <label style={lbl} htmlFor="ca-desc">Descrição</label>
      <input id="ca-desc" maxLength={300} style={inp} value={f.descricao} onChange={set("descricao")} placeholder="Para que é o dinheiro arrecadado" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0 12px" }}>
        <div>
          <label style={lbl} htmlFor="ca-meta">Meta (R$)</label>
          <input id="ca-meta" inputMode="decimal" placeholder="opcional" style={{ ...inp, textAlign: "right", ...borda("meta") }} value={f.meta} onChange={set("meta")} />
          {tentou && erros.meta && <div style={msgErro}>{erros.meta}</div>}
        </div>
        <div>
          <label style={lbl} htmlFor="ca-ini">Início</label>
          <input id="ca-ini" type="date" style={inp} value={f.dataInicio} onChange={set("dataInicio")} />
        </div>
        <div>
          <label style={lbl} htmlFor="ca-fim">Fim</label>
          <input id="ca-fim" type="date" style={{ ...inp, ...borda("dataFim") }} value={f.dataFim} onChange={set("dataFim")} />
          {tentou && erros.dataFim && <div style={msgErro}>{erros.dataFim}</div>}
        </div>
      </div>
      <CampoAtivo ativo={f.ativo} onChange={(v) => setF((p) => ({ ...p, ativo: v }))} dica="campanhas inativas não recebem novas entradas" />
    </FormModal>
  );
}
