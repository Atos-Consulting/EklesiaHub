import { useEffect, useMemo, useState } from "react";
import { Header, Pill } from "../ui";
import { lbl, inp, msgErro } from "../estilos";
import Icone from "./Icone";
import Modal from "./Modal";
import ThOrdenavel from "./ThOrdenavel";
import { useOrdenacao } from "./useOrdenacao";
import { carregarExtrato, listarMovimentos, registrarMovimento, estornarMovimento, mensagemErro } from "./db";
import { formatarMoeda, formatarData, hojeISO, lerNumero, paraCentavos, deCentavos, somarValores } from "./format";
import { TIPOS_MOVIMENTO, ORIGENS_EXTRATO, somarDias } from "./financeiro";

const inicioDoMes = () => `${hojeISO().slice(0, 8)}01`;
const VISOES = [{ id: "extrato", rotulo: "Extrato da conta" }, { id: "movimentos", rotulo: "Movimentos registrados" }];
// Tela de onde veio cada linha do extrato que não é movimento de caixa.
const TELA_ORIGEM = { entrada: "#/financeiro/entradas", pagamento: "#/financeiro/lancamentos/pagar", recebimento: "#/financeiro/lancamentos/receber" };
const NOME_TELA = { entrada: "Dízimos e ofertas", pagamento: "Contas a pagar", recebimento: "Contas a receber" };
const ehMovimento = (origem) => !TELA_ORIGEM[origem];

const COLUNAS_EXTRATO = {
  data: (l) => l.ordem,
  descricao: (l) => l.descricao,
  origem: (l) => ORIGENS_EXTRATO[l.origem],
  entrada: (l) => (l.valor > 0 ? l.valor : 0),
  saida: (l) => (l.valor < 0 ? -l.valor : 0),
  saldo: (l) => l.saldo,
};
const COLUNAS_MOV = {
  data: (m) => `${m.data}${String(m.id).padStart(12, "0")}`,
  tipo: (m) => TIPOS_MOVIMENTO[m.tipo],
  contas: (m) => `${m.conta_origem_nome ?? ""} ${m.conta_destino_nome ?? ""}`,
  descricao: (m) => m.descricao,
  valor: (m) => Number(m.valor),
  situacao: (m) => (m.estornado ? 1 : 0),
};

function Indicador({ icone, tom = "", rotulo, valor, sub }) {
  return (
    <div className="card stat">
      <div>
        <div className="stat-label">{rotulo}</div>
        <div className="stat-value">{valor}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
      <div className={`stat-icon ${tom}`}><Icone nome={icone} tamanho={19} /></div>
    </div>
  );
}

// Carrega do banco quando a chave muda; enquanto não chega, devolve o resultado anterior (a tela não pisca).
function useCarga(chave, carregar) {
  const [r, setR] = useState({ chave: null, dados: null, erro: "" });
  useEffect(() => {
    if (!chave) return undefined;
    let ativo = true;
    carregar().then((d) => { if (ativo) setR({ chave, dados: d, erro: "" }); })
      .catch((e) => { if (ativo) setR({ chave, dados: null, erro: mensagemErro(e) }); });
    return () => { ativo = false; };
  }, [chave]); // eslint-disable-line react-hooks/exhaustive-deps -- `carregar` muda junto com a chave
  return { dados: r.dados, erro: r.erro, carregando: r.chave !== chave };
}

// Financeiro → Movimentos de caixa: extrato por conta (com saldo dia a dia) e transferências/saídas/entradas avulsas.
export default function MovimentosCaixa({ cadastros, podeRegistrar, onCadastrosMudaram }) {
  const caixasAtivas = cadastros.caixas.filter((c) => c.ativo);
  const [filtros, setFiltros] = useState(() => ({ conta: caixasAtivas[0] ? String(caixasAtivas[0].id) : "", de: inicioDoMes(), ate: hojeISO(), busca: "" }));
  const [visao, setVisao] = useState("extrato");
  const [versao, setVersao] = useState(0);
  const [acao, setAcao] = useState(null); // { tipo: "novo" | "ver" | "estornar", movimento }
  const f = (k) => (e) => setFiltros((p) => ({ ...p, [k]: e.target.value }));
  const periodoOk = filtros.de && filtros.ate && filtros.de <= filtros.ate;

  const extrato = useCarga(periodoOk && filtros.conta ? `${filtros.conta}|${filtros.de}|${filtros.ate}|${versao}` : null,
    () => carregarExtrato(Number(filtros.conta), { de: filtros.de, ate: filtros.ate }));
  const movimentos = useCarga(periodoOk ? `${filtros.de}|${filtros.ate}|${versao}` : null,
    () => listarMovimentos({ de: filtros.de, ate: filtros.ate }));
  const atualizar = async () => { setVersao((v) => v + 1); await onCadastrosMudaram(); };

  // Saldo depois de cada lançamento, em ordem cronológica (vale mesmo se a tabela for ordenada por outra coluna).
  const linhas = useMemo(() => {
    if (!extrato.dados) return [];
    let saldo = paraCentavos(extrato.dados.saldoAnterior);
    return extrato.dados.linhas.map((l, i) => {
      saldo += paraCentavos(l.valor);
      return { ...l, valor: Number(l.valor), saldo: deCentavos(saldo), ordem: String(i).padStart(6, "0"), chave: `${l.origem}-${l.ref_id}` };
    });
  }, [extrato.dados]);
  const termo = filtros.busca.trim().toLowerCase();
  const linhasFiltradas = useMemo(() => linhas.filter((l) => !termo || (l.descricao || "").toLowerCase().includes(termo)), [linhas, termo]);
  const ordExtrato = useOrdenacao(linhasFiltradas, COLUNAS_EXTRATO, { chave: "data", dir: "asc" });

  const movFiltrados = useMemo(() => (movimentos.dados || []).filter((m) =>
    !termo || [m.descricao, m.conta_origem_nome, m.conta_destino_nome].some((v) => (v || "").toLowerCase().includes(termo))), [movimentos.dados, termo]);
  const ordMov = useOrdenacao(movFiltrados, COLUNAS_MOV, { chave: "data", dir: "desc" });

  const resumo = useMemo(() => {
    const entradas = somarValores(linhas.filter((l) => l.valor > 0).map((l) => l.valor));
    const saidas = somarValores(linhas.filter((l) => l.valor < 0).map((l) => -l.valor));
    const anterior = extrato.dados?.saldoAnterior ?? 0;
    return { anterior, entradas, saidas, final: deCentavos(paraCentavos(anterior) + paraCentavos(entradas) - paraCentavos(saidas)), qtdE: linhas.filter((l) => l.valor > 0).length, qtdS: linhas.filter((l) => l.valor < 0).length };
  }, [linhas, extrato.dados]);

  const conta = cadastros.caixas.find((c) => String(c.id) === filtros.conta);
  const abrirMovimento = (id) => { const m = (movimentos.dados || []).find((x) => x.id === id); if (m) setAcao({ tipo: "ver", movimento: m }); };
  const erro = visao === "extrato" ? extrato.erro : movimentos.erro;
  const colMov = podeRegistrar ? 7 : 6;

  return (
    <div>
      <div className="page-header">
        <Header title="Extrato e movimentos" subtitle="Extrato de cada conta caixa (entradas, pagamentos, transferências e lançamentos avulsos) com o saldo dia a dia. Aqui também se registram transferências entre contas (ex.: depósito do caixa no banco), saídas sem nota (ex.: tarifa bancária) e entradas que não são contribuição (ex.: rendimento)." />
        {podeRegistrar && <button className="btn btn-primary" onClick={() => setAcao({ tipo: "novo" })}><Icone nome="mais" tamanho={16} traco={2.2} /> Novo movimento</button>}
      </div>

      {visao === "extrato" && (
        <div className="stat-grid">
          <Indicador icone="relogio" tom="neutro" rotulo="Saldo anterior" valor={formatarMoeda(resumo.anterior)} sub={periodoOk ? `ao fim de ${formatarData(somarDias(filtros.de, -1))}` : ""} />
          <Indicador icone="seta" rotulo="Entradas no período" valor={formatarMoeda(resumo.entradas)} sub={`${resumo.qtdE} lançamento(s)`} />
          <Indicador icone="carteira" tom={resumo.saidas ? "alerta" : "neutro"} rotulo="Saídas no período" valor={formatarMoeda(resumo.saidas)} sub={`${resumo.qtdS} lançamento(s)`} />
          <Indicador icone="check" tom={resumo.final < 0 ? "perigo" : ""} rotulo="Saldo no fim do período" valor={formatarMoeda(resumo.final)} sub={conta ? `saldo atual: ${formatarMoeda(conta.saldo_atual)}` : ""} />
        </div>
      )}

      {erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}

      <div className="card">
        <div className="toolbar">
          {visao === "extrato" && (
            <label>Conta caixa
              <select value={filtros.conta} onChange={f("conta")} style={{ ...inp, width: 220 }}>
                {cadastros.caixas.length === 0 && <option value="">Nenhuma conta cadastrada</option>}
                {cadastros.caixas.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.ativo ? "" : " (inativa)"}</option>)}
              </select>
            </label>
          )}
          <label style={{ flex: "1 1 180px", maxWidth: 280 }}>Buscar
            <input placeholder="Descrição ou conta" value={filtros.busca} onChange={f("busca")} style={inp} />
          </label>
          <label>De
            <input type="date" value={filtros.de} onChange={f("de")} style={{ ...inp, width: 156 }} />
          </label>
          <label>até
            <input type="date" value={filtros.ate} onChange={f("ate")} style={{ ...inp, width: 156 }} />
          </label>
        </div>
        {!periodoOk && <div className="alert alert-warn" style={{ margin: "0 16px 12px" }}><Icone nome="alerta" tamanho={16} /><span>Informe um período válido (a data inicial não pode ser depois da final).</span></div>}

        <div className="abas" role="tablist" aria-label="Visão">
          {VISOES.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={visao === v.id} className={`aba${visao === v.id ? " ativa" : ""}`} onClick={() => setVisao(v.id)}>
              {v.rotulo}{v.id === "movimentos" && movimentos.dados && <span className="contador">{movFiltrados.length}</span>}
            </button>
          ))}
        </div>

        {visao === "extrato" ? (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr>
                  <ThOrdenavel chave="data" ordenacao={ordExtrato}>Data</ThOrdenavel>
                  <ThOrdenavel chave="descricao" ordenacao={ordExtrato}>Lançamento</ThOrdenavel>
                  <ThOrdenavel chave="origem" ordenacao={ordExtrato}>Origem</ThOrdenavel>
                  <ThOrdenavel chave="entrada" ordenacao={ordExtrato} className="num">Entrada</ThOrdenavel>
                  <ThOrdenavel chave="saida" ordenacao={ordExtrato} className="num">Saída</ThOrdenavel>
                  <ThOrdenavel chave="saldo" ordenacao={ordExtrato} className="num">Saldo</ThOrdenavel>
                </tr></thead>
                <tbody>
                  {periodoOk && filtros.conta && extrato.carregando && !extrato.dados && <tr><td className="vazio" colSpan={6}>Carregando...</td></tr>}
                  {!filtros.conta && <tr><td className="vazio" colSpan={6}>Cadastre uma conta caixa em Parâmetros → Financeiro → Contas caixa.</td></tr>}
                  {extrato.dados && linhasFiltradas.length === 0 && <tr><td className="vazio" colSpan={6}>{linhas.length ? "Nenhum lançamento com essa busca." : "Nenhum lançamento nesta conta no período."}</td></tr>}
                  {ordExtrato.ordenadas.map((l) => {
                    const abrir = () => (ehMovimento(l.origem) ? abrirMovimento(l.ref_id) : (window.location.hash = TELA_ORIGEM[l.origem]));
                    return (
                      <tr key={l.chave} className="clicavel" tabIndex={0} onClick={abrir} onKeyDown={(e) => { if (e.key === "Enter") abrir(); }}
                        title={ehMovimento(l.origem) ? "Ver o movimento" : `Abrir ${NOME_TELA[l.origem]}`}>
                        <td>{formatarData(l.data)}</td>
                        <td className="truncate" style={{ maxWidth: 360 }}>{l.descricao}</td>
                        <td><Pill tone={l.valor > 0 ? "ok" : "neutral"}>{ORIGENS_EXTRATO[l.origem] ?? l.origem}</Pill></td>
                        <td className="num" style={{ color: "var(--ok-text)", fontWeight: 550 }}>{l.valor > 0 ? formatarMoeda(l.valor) : ""}</td>
                        <td className="num" style={{ color: "var(--danger-text)", fontWeight: 550 }}>{l.valor < 0 ? formatarMoeda(-l.valor) : ""}</td>
                        <td className="num" style={{ fontWeight: 600, color: l.saldo < 0 ? "var(--danger)" : undefined }}>{formatarMoeda(l.saldo)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {extrato.dados && linhas.length > 0 && (
              <div className="table-footer">
                <span>{linhasFiltradas.length} lançamento(s){extrato.dados.linhas.length >= 5000 && " · exibindo os 5000 primeiros; diminua o período"}</span>
                <span>Saldo no fim do período: <strong>{formatarMoeda(resumo.final)}</strong></span>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr>
                  <ThOrdenavel chave="data" ordenacao={ordMov}>Data</ThOrdenavel>
                  <ThOrdenavel chave="tipo" ordenacao={ordMov}>Tipo</ThOrdenavel>
                  <ThOrdenavel chave="contas" ordenacao={ordMov}>Contas</ThOrdenavel>
                  <ThOrdenavel chave="descricao" ordenacao={ordMov}>Descrição</ThOrdenavel>
                  <ThOrdenavel chave="valor" ordenacao={ordMov} className="num">Valor</ThOrdenavel>
                  <ThOrdenavel chave="situacao" ordenacao={ordMov}>Situação</ThOrdenavel>
                  {podeRegistrar && <th className="acoes"><span className="sr-only">Ações</span></th>}
                </tr></thead>
                <tbody>
                  {periodoOk && movimentos.carregando && !movimentos.dados && <tr><td className="vazio" colSpan={colMov}>Carregando...</td></tr>}
                  {movimentos.dados && movFiltrados.length === 0 && <tr><td className="vazio" colSpan={colMov}>Nenhum movimento de caixa no período.</td></tr>}
                  {ordMov.ordenadas.map((m) => (
                    <tr key={m.id} className="clicavel" tabIndex={0} style={m.estornado ? { color: "var(--faint)" } : undefined}
                      onClick={() => setAcao({ tipo: "ver", movimento: m })} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) setAcao({ tipo: "ver", movimento: m }); }}>
                      <td>{formatarData(m.data)}</td>
                      <td>{TIPOS_MOVIMENTO[m.tipo]}</td>
                      <td><Contas m={m} /></td>
                      <td className="truncate" style={{ maxWidth: 280 }}>{m.descricao}</td>
                      <td className="num" style={m.estornado ? { textDecoration: "line-through" } : { fontWeight: 550 }}>{formatarMoeda(m.valor)}</td>
                      <td>{m.estornado ? <Pill tone="danger">Estornado</Pill> : <Pill tone="ok">Válido</Pill>}</td>
                      {podeRegistrar && (
                        <td className="acoes" onClick={(e) => e.stopPropagation()}>
                          {!m.estornado && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAcao({ tipo: "estornar", movimento: m })}>Estornar</button>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {movFiltrados.length > 0 && <div className="table-footer"><span>{movFiltrados.length} movimento(s)</span></div>}
          </>
        )}
      </div>

      {acao?.tipo === "novo" && <MovimentoModal cadastros={cadastros} contaPadrao={filtros.conta} onFechar={() => setAcao(null)} onRegistrado={async () => { setAcao(null); await atualizar(); }} />}
      {acao?.tipo === "ver" && <DetalheModal m={acao.movimento} podeEstornar={podeRegistrar} onFechar={() => setAcao(null)} onEstornar={() => setAcao({ tipo: "estornar", movimento: acao.movimento })} />}
      {acao?.tipo === "estornar" && <EstornoModal m={acao.movimento} onFechar={() => setAcao(null)} onConcluido={async () => { setAcao(null); await atualizar(); }} />}
    </div>
  );
}

function Contas({ m }) {
  if (m.tipo === "transferencia") return <span>{m.conta_origem_nome} <span className="muted">→</span> {m.conta_destino_nome}</span>;
  if (m.tipo === "saida") return <span>{m.conta_origem_nome} <span className="muted">(sai)</span></span>;
  return <span>{m.conta_destino_nome} <span className="muted">(entra)</span></span>;
}

const DICA_TIPO = {
  transferencia: "Dinheiro que muda de conta, sem sair da igreja (ex.: depósito do caixa no banco, saque para o caixa).",
  saida: "Dinheiro que sai sem nota fiscal (ex.: tarifa bancária, despesa miúda). Despesas com nota entram por Notas de entrada.",
  entrada: "Dinheiro que entra e não é contribuição (ex.: rendimento, devolução, ajuste). Dízimos e ofertas têm tela própria.",
};

function MovimentoModal({ cadastros, contaPadrao, onFechar, onRegistrado }) {
  const caixasAtivas = cadastros.caixas.filter((c) => c.ativo);
  const padrao = caixasAtivas.some((c) => String(c.id) === contaPadrao) ? contaPadrao : "";
  const [f, setF] = useState({ tipo: "transferencia", data: hojeISO(), valor: "", origem: padrao, destino: "", descricao: "", centroCustoId: "" });
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const usaOrigem = f.tipo !== "entrada";
  const usaDestino = f.tipo !== "saida";
  const valor = lerNumero(f.valor);
  const origem = caixasAtivas.find((c) => String(c.id) === f.origem);
  const destino = caixasAtivas.find((c) => String(c.id) === f.destino);

  const erros = {};
  if (!(valor > 0)) erros.valor = "Informe um valor maior que zero";
  if (!f.data) erros.data = "Informe a data";
  else if (f.data > hojeISO()) erros.data = "A data não pode ser futura";
  else {
    const antes = [usaOrigem && origem, usaDestino && destino].filter(Boolean).find((c) => f.data < c.data_saldo_inicial);
    if (antes) erros.data = `Antes do saldo inicial de ${antes.nome} (${formatarData(antes.data_saldo_inicial)})`;
  }
  if (usaOrigem && !f.origem) erros.origem = "Escolha a conta de onde sai";
  if (usaDestino && !f.destino) erros.destino = "Escolha a conta que recebe";
  if (f.tipo === "transferencia" && f.origem && f.origem === f.destino) erros.destino = "Escolha uma conta diferente da origem";
  if (!f.descricao.trim()) erros.descricao = "Descreva o movimento";
  const borda = (k) => (tentou && erros[k] ? { borderColor: "var(--danger)" } : {});
  const msg = (k) => tentou && erros[k] && <div style={msgErro}>{erros[k]}</div>;
  const depois = (c, sinal) => (c && valor > 0 ? deCentavos(paraCentavos(c.saldo_atual) + sinal * paraCentavos(valor)) : null);
  const saldoOrigemDepois = usaOrigem ? depois(origem, -1) : null;

  async function salvar() {
    setTentou(true);
    setErro("");
    if (Object.keys(erros).length) return;
    setSalvando(true);
    try {
      await registrarMovimento({
        tipo: f.tipo, data: f.data, valor, descricao: f.descricao.trim(),
        conta_origem_id: usaOrigem ? Number(f.origem) : null, conta_destino_id: usaDestino ? Number(f.destino) : null,
        centro_custo_id: f.centroCustoId ? Number(f.centroCustoId) : null,
      });
      await onRegistrado();
    } catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }

  const opcoes = (excluir) => caixasAtivas.filter((c) => String(c.id) !== excluir).map((c) => <option key={c.id} value={c.id}>{c.nome} · saldo {formatarMoeda(c.saldo_atual)}</option>);
  const ajuda = { fontSize: 12, marginTop: 4 };
  return (
    <Modal titulo="Novo movimento de caixa" largura={600} fecharFora={false} onFechar={onFechar}
      rodape={<>
        <button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Cancelar</button>
        <button className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</button>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); salvar(); }} noValidate>
        <div className="abas" role="radiogroup" aria-label="Tipo de movimento" style={{ margin: "0 0 4px", padding: 0 }}>
          {Object.entries(TIPOS_MOVIMENTO).map(([v, r]) => (
            <button key={v} type="button" role="radio" aria-checked={f.tipo === v} className={`aba${f.tipo === v ? " ativa" : ""}`} onClick={() => setF((p) => ({ ...p, tipo: v }))}>{r}</button>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>{DICA_TIPO[f.tipo]}</p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0 12px" }}>
          <div>
            <label style={lbl} htmlFor="mv-valor">Valor *</label>
            <input id="mv-valor" autoFocus inputMode="decimal" placeholder="0,00" style={{ ...inp, textAlign: "right", ...borda("valor") }} value={f.valor} onChange={set("valor")} />
            {msg("valor")}
          </div>
          <div>
            <label style={lbl} htmlFor="mv-data">Data *</label>
            <input id="mv-data" type="date" max={hojeISO()} style={{ ...inp, ...borda("data") }} value={f.data} onChange={set("data")} />
            {msg("data")}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: usaOrigem && usaDestino ? "repeat(auto-fit, minmax(220px, 1fr))" : "1fr", gap: "0 12px" }}>
          {usaOrigem && (
            <div>
              <label style={lbl} htmlFor="mv-origem">{f.tipo === "transferencia" ? "De (sai da conta) *" : "Conta de onde sai *"}</label>
              <select id="mv-origem" style={{ ...inp, ...borda("origem") }} value={f.origem} onChange={set("origem")}>
                <option value="">— Selecione —</option>
                {opcoes(f.tipo === "transferencia" ? f.destino : "")}
              </select>
              {msg("origem") || (saldoOrigemDepois !== null && (
                <div className="muted" style={ajuda}>Saldo depois: <strong style={{ color: saldoOrigemDepois < 0 ? "var(--danger)" : undefined }}>{formatarMoeda(saldoOrigemDepois)}</strong>{saldoOrigemDepois < 0 && " (fica negativo)"}</div>
              ))}
            </div>
          )}
          {usaDestino && (
            <div>
              <label style={lbl} htmlFor="mv-destino">{f.tipo === "transferencia" ? "Para (entra na conta) *" : "Conta que recebe *"}</label>
              <select id="mv-destino" style={{ ...inp, ...borda("destino") }} value={f.destino} onChange={set("destino")}>
                <option value="">— Selecione —</option>
                {opcoes(f.tipo === "transferencia" ? f.origem : "")}
              </select>
              {msg("destino") || (destino && valor > 0 && <div className="muted" style={ajuda}>Saldo depois: <strong>{formatarMoeda(depois(destino, 1))}</strong></div>)}
            </div>
          )}
        </div>
        {caixasAtivas.length < (f.tipo === "transferencia" ? 2 : 1) && (
          <div className="alert alert-warn" style={{ marginTop: 10 }}><Icone nome="alerta" tamanho={16} /><span>{f.tipo === "transferencia" ? "Transferência precisa de duas contas caixa ativas." : "Cadastre uma conta caixa."} Um Administrador cadastra em Parâmetros → Financeiro → Contas caixa.</span></div>
        )}

        <label style={lbl} htmlFor="mv-desc">Descrição *</label>
        <input id="mv-desc" maxLength={200} style={{ ...inp, ...borda("descricao") }} value={f.descricao} onChange={set("descricao")}
          placeholder={{ transferencia: "Ex.: depósito das ofertas de domingo", saida: "Ex.: tarifa de manutenção da conta", entrada: "Ex.: rendimento da poupança" }[f.tipo]} />
        {msg("descricao")}

        <label style={lbl} htmlFor="mv-centro">Centro de custo <span className="muted">(opcional)</span></label>
        <select id="mv-centro" style={inp} value={f.centroCustoId} onChange={set("centroCustoId")}>
          <option value="">— Nenhum —</option>
          {cadastros.centros.filter((c) => c.ativo).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
        <button type="submit" hidden />
      </form>
      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}

function Campo({ rotulo, children }) {
  return (
    <div className="tributo">
      <span className="tributo-rotulo">{rotulo}</span>
      <span className="tributo-valor" style={{ fontWeight: 500 }}>{children || "—"}</span>
    </div>
  );
}

function DetalheModal({ m, podeEstornar, onFechar, onEstornar }) {
  return (
    <Modal titulo={`${TIPOS_MOVIMENTO[m.tipo]} de ${formatarMoeda(m.valor)}`} largura={560} onFechar={onFechar}
      extra={m.estornado ? <Pill tone="danger">Estornado</Pill> : <Pill tone="ok">Válido</Pill>}
      rodape={<>
        <button className="btn btn-ghost" onClick={onFechar}>Fechar</button>
        {podeEstornar && !m.estornado && <button className="btn btn-danger" onClick={onEstornar}>Estornar</button>}
      </>}>
      {m.estornado && (
        <div className="alert alert-danger" style={{ marginBottom: 12 }}>
          <Icone nome="alerta" tamanho={16} />
          <span>Estornado em {new Date(m.estornado_em).toLocaleString("pt-BR")}: {m.motivo_estorno}. Não conta no saldo.</span>
        </div>
      )}
      <div className="tributos-grid">
        <Campo rotulo="Data">{formatarData(m.data)}</Campo>
        <Campo rotulo="Valor">{formatarMoeda(m.valor)}</Campo>
        {m.conta_origem_nome && <Campo rotulo="Sai de">{m.conta_origem_nome}</Campo>}
        {m.conta_destino_nome && <Campo rotulo="Entra em">{m.conta_destino_nome}</Campo>}
        <Campo rotulo="Centro de custo">{m.centro_custo_nome}</Campo>
        <Campo rotulo="Registrado por">{m.registrado_por_nome ? `${m.registrado_por_nome}, em ${new Date(m.criado_em).toLocaleString("pt-BR")}` : new Date(m.criado_em).toLocaleString("pt-BR")}</Campo>
      </div>
      <p style={{ marginTop: 12, fontSize: 13.5, color: "var(--text-2)" }}><strong>Descrição:</strong> {m.descricao}</p>
    </Modal>
  );
}

function EstornoModal({ m, onFechar, onConcluido }) {
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const valido = motivo.trim().length >= 5;
  async function confirmar() {
    if (!valido) return;
    setSalvando(true);
    setErro("");
    try { await estornarMovimento(m.id, motivo); await onConcluido(); }
    catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }
  const efeito = m.tipo === "transferencia"
    ? `O valor volta para ${m.conta_origem_nome} e sai de ${m.conta_destino_nome}.`
    : m.tipo === "saida" ? `O valor volta para ${m.conta_origem_nome}.` : `O valor deixa de contar em ${m.conta_destino_nome}.`;
  return (
    <Modal titulo="Estornar movimento" largura={480} nivel={400} fecharFora={false} onFechar={onFechar}
      rodape={<>
        <button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Voltar</button>
        <button className="btn btn-danger" style={{ opacity: valido ? 1 : 0.5 }} disabled={!valido || salvando} onClick={confirmar}>{salvando ? "Estornando..." : "Estornar"}</button>
      </>}>
      <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "4px 0 0" }}>
        <strong>{TIPOS_MOVIMENTO[m.tipo]} de {formatarMoeda(m.valor)}</strong> em {formatarData(m.data)} ({m.descricao}). {efeito} O estorno fica registrado e não pode ser desfeito; se precisar, lance de novo. Informe o motivo:
      </p>
      <textarea autoFocus maxLength={300} style={{ ...inp, minHeight: 70, marginTop: 8, marginBottom: 8, fontFamily: "inherit" }} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: depósito não foi feito (mín. 5 caracteres)" />
      {erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 8 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}
