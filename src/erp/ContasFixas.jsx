import { useCallback, useEffect, useMemo, useState } from "react";
import { Header, Pill } from "../ui";
import { lbl, inp, msgErro } from "../estilos";
import Icone from "./Icone";
import Modal from "./Modal";
import ThOrdenavel from "./ThOrdenavel";
import { useOrdenacao } from "./useOrdenacao";
import PessoaModal from "./PessoaModal";
import FormaSelect from "./FormaSelect";
import { listarContasFixas, salvarContaFixa, gerarContasFixas, mensagemErro } from "./db";
import { formatarMoeda, formatarData, hojeISO, lerNumero, numeroParaCampo } from "./format";
import { nomeForma, somarMeses, vencimentoFixa } from "./financeiro";

// Financeiro → Lançamentos → Contas fixas (v20): despesas e receitas que se repetem todo mês sem nota.
// O banco gera o lançamento de cada mês até o mês que vem (gerar_contas_fixas), sem duplicar.

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesAno = (iso) => (iso ? `${MESES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(0, 4)}` : "");
const NATUREZAS = { pagar: "A pagar", receber: "A receber" };

const COLUNAS = {
  descricao: (f) => f.descricao,
  natureza: (f) => f.natureza,
  valor: (f) => Number(f.valor),
  dia: (f) => f.dia_vencimento,
  vigencia: (f) => f.inicio,
  situacao: (f) => (f.ativo ? 0 : 1),
};

export default function ContasFixas({ cadastros, podeEditar, onCadastrosMudaram }) {
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState({ natureza: "", situacao: "ativas", busca: "" });
  const [editando, setEditando] = useState(null);
  const [aviso, setAviso] = useState("");

  const recarregar = useCallback(() => listarContasFixas().then((d) => { setLista(d); setErro(""); }).catch((e) => setErro(mensagemErro(e))), []);
  useEffect(() => { recarregar(); }, [recarregar]);

  const filtradas = useMemo(() => {
    const t = filtro.busca.trim().toLowerCase();
    return (lista || []).filter((f) => (!filtro.natureza || f.natureza === filtro.natureza)
      && (filtro.situacao === "todas" || (filtro.situacao === "ativas") === f.ativo)
      && (!t || [f.descricao, f.pessoa?.nome].some((v) => (v || "").toLowerCase().includes(t))));
  }, [lista, filtro]);
  const ordenacao = useOrdenacao(filtradas, COLUNAS, { chave: "descricao", dir: "asc" });
  const ativas = (lista || []).filter((f) => f.ativo);
  const totalMes = (nat) => ativas.filter((f) => f.natureza === nat).reduce((a, f) => a + Number(f.valor), 0);
  const centroNome = (id) => cadastros.centros.find((c) => c.id === id)?.nome;

  async function aoSalvar(texto) {
    setEditando(null);
    let gerados = 0;
    try { gerados = await gerarContasFixas(); } catch { /* a geração roda de novo ao abrir Lançamentos */ }
    setAviso(gerados ? `${texto} ${gerados} lançamento(s) gerado(s) em Lançamentos.` : texto);
    await recarregar();
    await onCadastrosMudaram();
  }

  return (
    <div>
      <div className="page-header">
        <Header title="Contas fixas" subtitle="Despesas e receitas que se repetem todo mês sem nota fiscal: aluguel, prebenda, internet, plano de saúde, aluguel do salão recebido. Cadastre uma vez e o sistema gera o lançamento de cada mês (até o mês que vem) em A pagar ou A receber, para pagar ou receber normalmente. Mudanças valem para os meses ainda não gerados." />
        {podeEditar && <button className="btn btn-primary" onClick={() => { setAviso(""); setEditando("nova"); }}><Icone nome="mais" tamanho={16} traco={2.2} /> Nova conta fixa</button>}
      </div>

      <div className="stat-grid">
        <div className="card stat"><div><div className="stat-label">Fixas a pagar por mês</div><div className="stat-value">{formatarMoeda(totalMes("pagar"))}</div><div className="stat-sub">{ativas.filter((f) => f.natureza === "pagar").length} conta(s) ativa(s)</div></div><div className="stat-icon alerta"><Icone nome="carteira" tamanho={19} /></div></div>
        <div className="card stat"><div><div className="stat-label">Fixas a receber por mês</div><div className="stat-value">{formatarMoeda(totalMes("receber"))}</div><div className="stat-sub">{ativas.filter((f) => f.natureza === "receber").length} conta(s) ativa(s)</div></div><div className="stat-icon"><Icone nome="seta" tamanho={19} /></div></div>
      </div>

      {erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
      {aviso && <div className="alert alert-ok" role="status" style={{ marginBottom: 16 }}><Icone nome="check" tamanho={16} /><span>{aviso}</span></div>}

      <div className="card">
        <div className="toolbar">
          <label style={{ flex: "1 1 200px", maxWidth: 300 }}>Buscar
            <input placeholder="Descrição ou pessoa" value={filtro.busca} onChange={(e) => setFiltro((p) => ({ ...p, busca: e.target.value }))} style={inp} />
          </label>
          <label>Tipo
            <select value={filtro.natureza} onChange={(e) => setFiltro((p) => ({ ...p, natureza: e.target.value }))} style={{ ...inp, width: 150 }}>
              <option value="">Todas</option>
              {Object.entries(NATUREZAS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </select>
          </label>
          <label>Situação
            <select value={filtro.situacao} onChange={(e) => setFiltro((p) => ({ ...p, situacao: e.target.value }))} style={{ ...inp, width: 140 }}>
              <option value="ativas">Ativas</option><option value="inativas">Inativas</option><option value="todas">Todas</option>
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <ThOrdenavel chave="descricao" ordenacao={ordenacao}>Conta / pessoa</ThOrdenavel>
              <ThOrdenavel chave="natureza" ordenacao={ordenacao}>Tipo</ThOrdenavel>
              <ThOrdenavel chave="valor" ordenacao={ordenacao} className="num">Valor</ThOrdenavel>
              <ThOrdenavel chave="dia" ordenacao={ordenacao}>Vence</ThOrdenavel>
              <ThOrdenavel chave="vigencia" ordenacao={ordenacao}>Vigência</ThOrdenavel>
              <th>Gerado até</th>
              <ThOrdenavel chave="situacao" ordenacao={ordenacao}>Situação</ThOrdenavel>
              {podeEditar && <th className="acoes"><span className="sr-only">Ações</span></th>}
            </tr></thead>
            <tbody>
              {lista === null && !erro && <tr><td className="vazio" colSpan={8}>Carregando...</td></tr>}
              {lista && filtradas.length === 0 && <tr><td className="vazio" colSpan={8}>{lista.length ? "Nenhuma conta fixa com esses filtros." : "Nenhuma conta fixa cadastrada."}</td></tr>}
              {ordenacao.ordenadas.map((f) => (
                <tr key={f.id} style={!f.ativo ? { color: "var(--faint)" } : undefined}>
                  <td style={{ fontWeight: 550 }}>{f.descricao}
                    <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{[f.pessoa?.nome, nomeForma(cadastros.formas, f.forma_pagamento_id), centroNome(f.centro_custo_id)].filter(Boolean).join(" · ")}</div></td>
                  <td><Pill tone={f.natureza === "receber" ? "ok" : "neutral"}>{NATUREZAS[f.natureza]}</Pill></td>
                  <td className="num" style={{ fontWeight: 550 }}>{formatarMoeda(f.valor)}</td>
                  <td>dia {f.dia_vencimento}</td>
                  <td>{mesAno(f.inicio)}{f.fim ? ` a ${mesAno(f.fim)}` : " em diante"}</td>
                  <td>{f.gerado_ate ? mesAno(f.gerado_ate) : <span className="muted">—</span>}</td>
                  <td><Pill tone={f.ativo ? "ok" : "neutral"}>{f.ativo ? "Ativa" : "Inativa"}</Pill></td>
                  {podeEditar && <td className="acoes"><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAviso(""); setEditando(f); }}>Editar</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtradas.length > 0 && <div className="table-footer"><span>{filtradas.length} conta(s) fixa(s)</span></div>}
      </div>

      {editando && <ContaFixaForm conta={editando === "nova" ? null : editando} cadastros={cadastros} onFechar={() => setEditando(null)}
        onSalvo={(texto) => aoSalvar(texto)} onCadastrosMudaram={onCadastrosMudaram} />}
    </div>
  );
}

function ContaFixaForm({ conta, cadastros, onFechar, onSalvo, onCadastrosMudaram }) {
  const caixasAtivas = cadastros.caixas.filter((c) => c.ativo);
  const mesAtual = hojeISO().slice(0, 7);
  const [f, setF] = useState(() => ({
    natureza: conta?.natureza ?? "pagar", descricao: conta?.descricao ?? "", pessoaId: conta ? String(conta.pessoa_id) : "",
    valor: conta ? numeroParaCampo(Number(conta.valor)) : "", dia: String(conta?.dia_vencimento ?? 10),
    inicio: conta?.inicio?.slice(0, 7) ?? mesAtual, fim: conta?.fim?.slice(0, 7) ?? "",
    formaId: conta ? String(conta.forma_pagamento_id ?? "") : "", caixaId: conta ? String(conta.conta_caixa_id ?? "") : (caixasAtivas.length === 1 ? String(caixasAtivas[0].id) : ""),
    centroId: conta ? String(conta.centro_custo_id ?? "") : "", observacao: conta?.observacao ?? "", ativo: conta?.ativo ?? true,
  }));
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [novaPessoa, setNovaPessoa] = useState(false);
  const [pessoasExtras, setPessoasExtras] = useState([]);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const pagar = f.natureza === "pagar";
  const jaGerou = Boolean(conta?.gerado_ate);

  const pessoas = useMemo(() => [...cadastros.pessoas, ...pessoasExtras.filter((x) => !cadastros.pessoas.some((p) => p.id === x.id))]
    .filter((p) => p.ativo || String(p.id) === f.pessoaId).sort((a, b) => a.nome.localeCompare(b.nome)), [cadastros.pessoas, pessoasExtras, f.pessoaId]);

  const valor = lerNumero(f.valor);
  const dia = /^\d+$/.test(f.dia.trim()) ? Number(f.dia) : NaN;
  const erros = {};
  if (!f.descricao.trim()) erros.descricao = "Descreva a conta";
  if (!f.pessoaId) erros.pessoaId = pagar ? "Escolha a quem a igreja paga" : "Escolha de quem a igreja recebe";
  if (!(valor > 0)) erros.valor = "Informe um valor maior que zero";
  if (!(dia >= 1 && dia <= 31)) erros.dia = "Dia de 1 a 31";
  if (!f.inicio) erros.inicio = "Informe o mês inicial";
  if (f.fim && f.inicio && f.fim < f.inicio) erros.fim = "O mês final não pode ser antes do inicial";
  if (pagar && !f.centroId) erros.centroId = "Escolha o centro de custo";
  const borda = (k) => (tentou && erros[k] ? { borderColor: "var(--danger)" } : {});
  const msg = (k) => tentou && erros[k] && <div style={msgErro}>{erros[k]}</div>;

  // Prévia: próximos 3 vencimentos a partir do mês inicial (ou do próximo mês ainda não gerado).
  const previa = [];
  if (f.inicio && dia >= 1 && dia <= 31) {
    let comp = conta?.gerado_ate ? somarMeses(conta.gerado_ate, 1) : `${f.inicio}-01`;
    while (previa.length < 3 && (!f.fim || comp <= `${f.fim}-01`)) { previa.push(vencimentoFixa(comp, dia)); comp = somarMeses(comp, 1); }
  }

  async function salvar() {
    setTentou(true);
    setErro("");
    if (Object.keys(erros).length) return;
    setSalvando(true);
    try {
      await salvarContaFixa(conta?.id ?? null, { ...f, valor, dia });
      await onSalvo(conta ? "Conta fixa atualizada." : "Conta fixa cadastrada.");
    } catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }

  const grade = (min) => ({ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: "0 12px" });
  return (
    <Modal titulo={conta ? "Editar conta fixa" : "Nova conta fixa"} largura={680} fecharFora={false} onFechar={onFechar}
      rodape={<>
        <button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Cancelar</button>
        <button className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</button>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); salvar(); }} noValidate>
        <div className="abas" role="radiogroup" aria-label="Tipo" style={{ margin: "0 0 4px", padding: 0 }}>
          {Object.entries(NATUREZAS).map(([v, r]) => (
            <button key={v} type="button" role="radio" aria-checked={f.natureza === v} disabled={jaGerou && f.natureza !== v}
              className={`aba${f.natureza === v ? " ativa" : ""}`} onClick={() => setF((p) => ({ ...p, natureza: v }))}
              title={jaGerou && f.natureza !== v ? "Já gerou lançamentos: não dá para trocar" : undefined}>{r}</button>
          ))}
        </div>

        <label style={lbl} htmlFor="cf-desc">Descrição *</label>
        <input id="cf-desc" autoFocus maxLength={120} style={{ ...inp, ...borda("descricao") }} value={f.descricao} onChange={set("descricao")} placeholder={pagar ? "Ex.: aluguel do templo, prebenda pastoral, internet" : "Ex.: aluguel do salão social"} />
        {msg("descricao")}

        <label style={lbl} htmlFor="cf-pessoa">{pagar ? "Fornecedor / quem recebe *" : "Pagador / de quem a igreja recebe *"}</label>
        <div style={{ display: "flex", gap: 8 }}>
          <select id="cf-pessoa" style={{ ...inp, flex: 1, minWidth: 0, ...borda("pessoaId") }} value={f.pessoaId} onChange={set("pessoaId")}>
            <option value="">— Selecione —</option>
            {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
          <button type="button" className="btn btn-ghost" style={{ flex: "none" }} onClick={() => setNovaPessoa(true)}>+ Nova pessoa</button>
        </div>
        {msg("pessoaId")}

        <div style={grade(140)}>
          <div>
            <label style={lbl} htmlFor="cf-valor">Valor por mês *</label>
            <input id="cf-valor" inputMode="decimal" placeholder="0,00" style={{ ...inp, textAlign: "right", ...borda("valor") }} value={f.valor} onChange={set("valor")} />
            {msg("valor")}
          </div>
          <div>
            <label style={lbl} htmlFor="cf-dia">Dia do vencimento *</label>
            <input id="cf-dia" inputMode="numeric" style={{ ...inp, textAlign: "right", ...borda("dia") }} value={f.dia} onChange={set("dia")} />
            {msg("dia")}
          </div>
          <div>
            <label style={lbl} htmlFor="cf-ini">A partir de *</label>
            <input id="cf-ini" type="month" style={{ ...inp, ...borda("inicio") }} value={f.inicio} onChange={set("inicio")} disabled={jaGerou} title={jaGerou ? "Já gerou lançamentos" : undefined} />
            {msg("inicio")}
          </div>
          <div>
            <label style={lbl} htmlFor="cf-fim">Até (opcional)</label>
            <input id="cf-fim" type="month" style={{ ...inp, ...borda("fim") }} value={f.fim} onChange={set("fim")} />
            {msg("fim")}
          </div>
        </div>

        <div style={grade(170)}>
          <div>
            <label style={lbl} htmlFor="cf-forma">Forma de pagamento</label>
            <FormaSelect id="cf-forma" style={inp} formas={cadastros.formas} value={f.formaId} onChange={(v) => setF((p) => ({ ...p, formaId: v }))} vazio="— Não informada —" />
          </div>
          <div>
            <label style={lbl} htmlFor="cf-caixa">Conta caixa prevista</label>
            <select id="cf-caixa" style={inp} value={f.caixaId} onChange={set("caixaId")}>
              <option value="">— Escolher ao pagar —</option>
              {cadastros.caixas.filter((c) => c.ativo || String(c.id) === f.caixaId).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl} htmlFor="cf-centro">Centro de custo{pagar ? " *" : ""}</label>
            <select id="cf-centro" style={{ ...inp, ...borda("centroId") }} value={f.centroId} onChange={set("centroId")}>
              <option value="">— Selecione —</option>
              {cadastros.centros.filter((c) => c.ativo || String(c.id) === f.centroId).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            {msg("centroId")}
          </div>
        </div>

        <label style={lbl} htmlFor="cf-obs">Observação</label>
        <input id="cf-obs" maxLength={500} style={inp} value={f.observacao} onChange={set("observacao")} placeholder="Vai para cada lançamento gerado (ex.: contrato até dez/2027)" />

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 14 }}>
          <input type="checkbox" checked={f.ativo} onChange={(e) => setF((p) => ({ ...p, ativo: e.target.checked }))} />
          Ativa <span className="muted" style={{ fontSize: 12.5 }}>(inativa para de gerar os próximos meses)</span>
        </label>

        {previa.length > 0 && f.ativo && (
          <div className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
            {jaGerou ? `Já gerado até ${mesAno(conta.gerado_ate)}. Próximos vencimentos: ` : "Vencimentos: "}
            {previa.map(formatarData).join(", ")}{!f.fim ? "…" : ""}
            {jaGerou && " Os lançamentos já gerados não mudam; ajuste cada um em A pagar / A receber, se precisar."}
          </div>
        )}
        <button type="submit" hidden />
      </form>
      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
      {novaPessoa && (
        <PessoaModal papelPadrao={pagar ? "fornecedor" : "cliente"} onFechar={() => setNovaPessoa(false)}
          onSalvo={(p) => { setNovaPessoa(false); setPessoasExtras((l) => [...l, p]); setF((x) => ({ ...x, pessoaId: String(p.id) })); onCadastrosMudaram(); }} />
      )}
    </Modal>
  );
}
