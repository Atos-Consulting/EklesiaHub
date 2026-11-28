import { useMemo, useState } from "react";
import { Header, Pill } from "../../ui";
import { inp, lbl } from "../../estilos";
import Icone from "../Icone";
import Modal from "../Modal";
import ThOrdenavel from "../ThOrdenavel";
import { useOrdenacao } from "../useOrdenacao";
import { useCarga } from "../useCarga";
import { listarRazao, lancarContabil, estornarLancamento, mensagemErro } from "../db";
import { formatarData, hojeISO, lerNumero, paraCentavos, deCentavos } from "../format";
import { ORIGENS, moeda } from "./calculoContabil";
import { Pendencias, ContaSelect, Periodo } from "./comum";
import { useContabilizar, periodoValido } from "./useContabilizar";
import Vinculos from "../Vinculos";

// Origens que têm nota e/ou lançamento do Financeiro para mostrar em Vínculos (v29).
const COM_VINCULOS = ["nota", "titulo_pagar", "titulo_receber", "pagamento"];
// As demais abrem a tela de origem.
const ROTA_ORIGEM = { entrada: "#/financeiro/entradas", movimento: "#/financeiro/caixa/extrato", caixa_pdv: "#/comercial/caixas", estoque: "#/comercial/produtos", abertura: "#/parametros/caixas" };

// Contábil → Lançamentos (diário). Os automáticos vêm do resto do sistema (notas, pagamentos, dízimos e ofertas,
// contas a receber, movimentos de caixa e saldo inicial das contas); o manual serve para ajustes do contador.
// Nada se edita: erro se corrige com estorno.

const COLUNAS = {
  data: (l) => l.data,
  historico: (l) => l.historico,
  origem: (l) => ORIGENS[l.origem] ?? l.origem,
  valor: (l) => l.valor,
};

function DetalheModal({ lanc, podeEstornar, caixas, onFechar, onMudou }) {
  const [motivo, setMotivo] = useState("");
  const [verVinculos, setVerVinculos] = useState(false);
  const [estornando, setEstornando] = useState(false);
  const [erro, setErro] = useState("");
  const manualAtivo = lanc.origem === "manual" && !lanc.estorno_de && !lanc.estornado;
  async function estornar() {
    if (motivo.trim().length < 5) { setErro("Informe o motivo (mínimo de 5 caracteres)."); return; }
    setEstornando(true); setErro("");
    try { await estornarLancamento(lanc.id, motivo); onMudou(); onFechar(); }
    catch (e) { setErro(mensagemErro(e)); setEstornando(false); }
  }
  return (
    <Modal titulo={`Lançamento nº ${lanc.id}`} largura={760} onFechar={onFechar}
      extra={lanc.estornado ? <Pill tone="danger">Estornado</Pill> : lanc.estorno_de ? <Pill tone="warn">Estorno do nº {lanc.estorno_de}</Pill> : null}
      rodape={<>
        {COM_VINCULOS.includes(lanc.origem) && (
          <button className="btn btn-ghost" style={{ marginRight: "auto" }} onClick={() => setVerVinculos(true)} title="Ver a nota e os lançamentos do Financeiro que geraram este lançamento">
            <Icone nome="vinculo" tamanho={15} /> {lanc.origem === "nota" ? "Ver nota e financeiro" : "Ver financeiro e nota"}
          </button>
        )}
        {ROTA_ORIGEM[lanc.origem] && <a className="btn btn-ghost" style={{ marginRight: "auto" }} href={ROTA_ORIGEM[lanc.origem]}><Icone nome="externo" tamanho={14} /> Abrir a origem</a>}
        <button className="btn btn-ghost" onClick={onFechar}>Fechar</button>
      </>}>
      <div className="resumo-pagar" style={{ marginTop: 0 }}>
        <span>Data: <strong>{formatarData(lanc.data)}</strong>{lanc.data_competencia !== lanc.data ? <> (competência {formatarData(lanc.data_competencia)})</> : null}</span>
        <span>Origem: <strong>{ORIGENS[lanc.origem] ?? lanc.origem}</strong></span>
        {lanc.criado_por_nome && <span>Por: <strong>{lanc.criado_por_nome}</strong></span>}
      </div>
      <p style={{ margin: "4px 0 12px", fontSize: 14 }}>{lanc.historico}</p>
      {lanc.motivo_estorno && <p className="muted" style={{ marginTop: -6, fontSize: 13 }}>Motivo do estorno: {lanc.motivo_estorno}</p>}
      {lanc.data_competencia !== lanc.data && !lanc.estorno_de && (
        <p className="muted" style={{ fontSize: 12.5 }}>O mês da competência estava fechado quando o lançamento entrou; por isso ele foi para o primeiro dia depois do mês fechado.</p>
      )}
      <div className="table-wrap">
        <table className="rel-tabela">
          <thead><tr><th>Conta</th><th>Centro de custo</th><th className="num">Débito</th><th className="num">Crédito</th></tr></thead>
          <tbody>
            {lanc.partidas.map((p) => (
              <tr key={p.partida_id}>
                <td>{p.conta_codigo} - {p.conta_nome}</td>
                <td>{p.centro_custo_nome ?? "—"}</td>
                <td className="num">{Number(p.debito) ? moeda(paraCentavos(p.debito)) : ""}</td>
                <td className="num">{Number(p.credito) ? moeda(paraCentavos(p.credito)) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={2}>Total</td><td className="num">{moeda(lanc.valor)}</td><td className="num">{moeda(lanc.valor)}</td></tr></tfoot>
        </table>
      </div>
      {lanc.origem !== "manual" && !lanc.estorno_de && (
        <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>Lançamento automático: para desfazer, cancele ou estorne a origem no Financeiro/Administrativo, ou faça um lançamento manual de ajuste.</p>
      )}
      {manualAtivo && podeEstornar && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          <label style={lbl} htmlFor="lc-motivo">Estornar este lançamento — motivo</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input id="lc-motivo" maxLength={300} style={inp} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: lançado na conta errada" />
            <button className="btn btn-danger" onClick={estornar} disabled={estornando}>{estornando ? "Estornando..." : "Estornar"}</button>
          </div>
        </div>
      )}
      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 12 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
      {verVinculos && <Vinculos origem={{ tipo: "contabil", id: lanc.id, origem: lanc.origem, origem_id: lanc.origem_id }} caixas={caixas} onFechar={() => setVerVinculos(false)} />}
    </Modal>
  );
}

const partidaVazia = () => ({ chave: crypto.randomUUID(), conta: null, centro: "", debito: "", credito: "" });

function NovoLancamento({ cadastros, onFechar, onSalvo }) {
  const [data, setData] = useState(hojeISO());
  const [historico, setHistorico] = useState("");
  const [partidas, setPartidas] = useState(() => [partidaVazia(), partidaVazia()]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const cent = (t) => { const n = lerNumero(t); return Number.isFinite(n) && n > 0 ? paraCentavos(n) : 0; };
  const totD = partidas.reduce((a, p) => a + cent(p.debito), 0);
  const totC = partidas.reduce((a, p) => a + cent(p.credito), 0);
  const mudar = (i, k, v) => setPartidas((ps) => ps.map((p, j) => (j === i ? { ...p, [k]: v, ...(k === "debito" && v ? { credito: "" } : {}), ...(k === "credito" && v ? { debito: "" } : {}) } : p)));
  const usadas = partidas.filter((p) => p.conta && (cent(p.debito) || cent(p.credito)));

  async function salvar() {
    setErro("");
    if (historico.trim().length < 3) { setErro("Informe o histórico."); return; }
    if (usadas.length < 2) { setErro("Informe ao menos duas partidas, com conta e valor."); return; }
    if (partidas.some((p) => !p.conta && (cent(p.debito) || cent(p.credito)))) { setErro("Há valor sem conta."); return; }
    if (totD !== totC) { setErro("Débitos e créditos precisam ser iguais."); return; }
    setSalvando(true);
    try {
      await lancarContabil(data, historico.trim(), usadas.map((p) => ({
        conta_id: p.conta, centro_custo_id: p.centro ? Number(p.centro) : null, debito: deCentavos(cent(p.debito)), credito: deCentavos(cent(p.credito)),
      })));
      onSalvo();
    } catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }

  return (
    <Modal titulo="Novo lançamento manual" largura={900} onFechar={onFechar} fecharFora={false}
      rodape={<>
        <span className="muted" style={{ marginRight: "auto", fontSize: 13 }}>
          Débitos {moeda(totD)} · Créditos {moeda(totC)}{totD !== totC ? <strong style={{ color: "var(--danger-text)" }}> · diferença {moeda(Math.abs(totD - totC))}</strong> : totD ? <strong style={{ color: "var(--ok-text)" }}> · fechado</strong> : null}
        </span>
        <button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Cancelar</button>
        <button className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? "Lançando..." : "Lançar"}</button>
      </>}>
      <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}>Para ajustes e reclassificações. Depois de lançado, não se edita: corrige-se com estorno.</p>
      <div style={{ display: "grid", gridTemplateColumns: "170px 1fr", gap: 12 }}>
        <div><label style={lbl} htmlFor="lm-data">Data *</label><input id="lm-data" type="date" style={inp} value={data} max={hojeISO()} onChange={(e) => setData(e.target.value)} /></div>
        <div><label style={lbl} htmlFor="lm-hist">Histórico *</label><input id="lm-hist" style={inp} maxLength={300} value={historico} onChange={(e) => setHistorico(e.target.value)} placeholder="Ex.: reclassificação de despesa de manutenção" /></div>
      </div>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="table orc-editor">
          <thead><tr><th>Conta *</th><th>Centro de custo</th><th className="num">Débito</th><th className="num">Crédito</th><th className="acoes"><span className="sr-only">Remover</span></th></tr></thead>
          <tbody>
            {partidas.map((p, i) => (
              <tr key={p.chave}>
                <td style={{ minWidth: 260 }}><ContaSelect contas={cadastros.contas} valor={p.conta} onChange={(v) => mudar(i, "conta", v)} aria-label={`Conta da partida ${i + 1}`} /></td>
                <td>
                  <select style={inp} value={p.centro} onChange={(e) => mudar(i, "centro", e.target.value)} aria-label={`Centro de custo da partida ${i + 1}`}>
                    <option value="">—</option>
                    {cadastros.centros.filter((c) => c.ativo || String(c.id) === p.centro).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </td>
                <td><input inputMode="decimal" style={{ ...inp, textAlign: "right", width: 120 }} placeholder="0,00" value={p.debito} onChange={(e) => mudar(i, "debito", e.target.value)} aria-label={`Débito da partida ${i + 1}`} /></td>
                <td><input inputMode="decimal" style={{ ...inp, textAlign: "right", width: 120 }} placeholder="0,00" value={p.credito} onChange={(e) => mudar(i, "credito", e.target.value)} aria-label={`Crédito da partida ${i + 1}`} /></td>
                <td className="acoes">
                  {partidas.length > 2 && <button type="button" className="icon-btn perigo" title="Remover partida" aria-label="Remover partida" onClick={() => setPartidas((ps) => ps.filter((_, j) => j !== i))}><Icone nome="lixeira" tamanho={15} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setPartidas((ps) => [...ps, partidaVazia()])}><Icone nome="mais" tamanho={14} /> Adicionar partida</button>
      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 12 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}

export default function Diario({ cadastros, podeLancar, podeConfigurar }) {
  const hoje = hojeISO();
  const [periodo, setPeriodo] = useState({ de: `${hoje.slice(0, 7)}-01`, ate: hoje });
  const [origem, setOrigem] = useState("");
  const [busca, setBusca] = useState("");
  const [gatilho, setGatilho] = useState(0);
  const [aberto, setAberto] = useState(null);
  const [novo, setNovo] = useState(false);
  const ctb = useContabilizar(gatilho);
  const ok = periodoValido(periodo.de, periodo.ate);
  const carga = useCarga(ctb.pronto && ok ? `diario|${periodo.de}|${periodo.ate}|${ctb.versao}` : null, () => listarRazao(periodo));

  const lancamentos = useMemo(() => {
    const m = new Map();
    for (const p of carga.dados ?? []) {
      if (!m.has(p.lancamento_id)) m.set(p.lancamento_id, { ...p, id: p.lancamento_id, partidas: [], valor: 0 });
      const l = m.get(p.lancamento_id);
      l.partidas.push(p);
      l.valor += paraCentavos(p.debito);
    }
    return [...m.values()];
  }, [carga.dados]);
  const termo = busca.trim().toLowerCase();
  const filtrados = lancamentos.filter((l) => (!origem || l.origem === origem)
    && (!termo || l.historico.toLowerCase().includes(termo) || l.partidas.some((p) => `${p.conta_codigo} ${p.conta_nome}`.toLowerCase().includes(termo)) || String(l.id) === termo));
  const ordenacao = useOrdenacao(filtrados, COLUNAS, { chave: "data", dir: "desc" });
  const total = filtrados.reduce((a, l) => a + l.valor, 0);

  return (
    <div>
      <div className="page-header">
        <Header title="Lançamentos contábeis" subtitle="O diário da igreja em partidas dobradas (regime de competência). Os lançamentos automáticos vêm das notas, pagamentos, dízimos e ofertas, contas a receber e movimentos de caixa; os manuais são para ajustes." />
        {podeLancar && <button className="btn btn-primary" onClick={() => setNovo(true)}><Icone nome="mais" tamanho={16} /> Novo lançamento</button>}
      </div>

      {ctb.erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{ctb.erro}</span></div>}
      <Pendencias versao={ctb.versao} podeConfigurar={podeConfigurar} />

      <div className="card">
        <div className="toolbar">
          <Periodo de={periodo.de} ate={periodo.ate} onChange={setPeriodo} />
          <label>Origem
            <select style={{ ...inp, width: 190 }} value={origem} onChange={(e) => setOrigem(e.target.value)}>
              <option value="">Todas</option>
              {Object.entries(ORIGENS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label style={{ flex: 1, minWidth: 180 }}>Buscar
            <input style={inp} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Histórico, conta ou nº" />
          </label>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nº</th>
                <ThOrdenavel chave="data" ordenacao={ordenacao}>Data</ThOrdenavel>
                <ThOrdenavel chave="historico" ordenacao={ordenacao}>Histórico</ThOrdenavel>
                <th>Contas</th>
                <ThOrdenavel chave="origem" ordenacao={ordenacao}>Origem</ThOrdenavel>
                <ThOrdenavel chave="valor" ordenacao={ordenacao} className="num">Valor</ThOrdenavel>
              </tr>
            </thead>
            <tbody>
              {!ok && <tr><td className="vazio" colSpan={6}>Escolha um período válido.</td></tr>}
              {ok && (!ctb.pronto || carga.carregando) && !carga.dados && !ctb.erro && <tr><td className="vazio" colSpan={6}>Carregando...</td></tr>}
              {carga.dados && filtrados.length === 0 && <tr><td className="vazio" colSpan={6}>Nenhum lançamento no período.</td></tr>}
              {ordenacao.ordenadas.map((l) => (
                <tr key={l.id} className="clicavel" tabIndex={0} onClick={() => setAberto(l)} onKeyDown={(e) => { if (e.key === "Enter") setAberto(l); }}
                  style={l.estornado || l.estorno_de ? { opacity: 0.6 } : undefined}>
                  <td className="muted">{l.id}</td>
                  <td>{formatarData(l.data)}</td>
                  <td style={{ whiteSpace: "normal", minWidth: 240 }}>
                    {l.historico}
                    {l.estornado && <> <Pill tone="danger">Estornado</Pill></>}
                  </td>
                  <td style={{ whiteSpace: "normal", fontSize: 12.5 }}>
                    {l.partidas.slice(0, 3).map((p) => (
                      <div key={p.partida_id}><span className="muted">{Number(p.debito) ? "D" : "C"}</span> {p.conta_codigo} {p.conta_nome}</div>
                    ))}
                    {l.partidas.length > 3 && <div className="muted">+ {l.partidas.length - 3} partida(s)</div>}
                  </td>
                  <td><Pill tone={l.origem === "manual" ? "warn" : "neutral"}>{ORIGENS[l.origem] ?? l.origem}</Pill></td>
                  <td className="num" style={{ fontWeight: 550 }}>{moeda(l.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtrados.length > 0 && <div className="table-footer"><span>{filtrados.length} lançamento(s)</span><span>Total movimentado: <strong>{moeda(total)}</strong></span></div>}
      </div>

      {aberto && <DetalheModal lanc={aberto} podeEstornar={podeLancar} caixas={cadastros.caixas} onFechar={() => setAberto(null)} onMudou={() => setGatilho((g) => g + 1)} />}
      {novo && <NovoLancamento cadastros={cadastros} onFechar={() => setNovo(false)} onSalvo={() => { setNovo(false); setGatilho((g) => g + 1); }} />}
    </div>
  );
}

