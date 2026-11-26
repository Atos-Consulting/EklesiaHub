import { useCallback, useEffect, useMemo, useState } from "react";
import { Header, Pill } from "../ui";
import { lbl, inp, msgErro } from "../estilos";
import Icone from "./Icone";
import Modal from "./Modal";
import ThOrdenavel from "./ThOrdenavel";
import { useOrdenacao } from "./useOrdenacao";
import { listarTitulosPagar, listarTitulosReceber, listarPagamentosDoTitulo, pagarTitulo, receberTitulo, estornarPagamento, atualizarTitulo, mensagemErro } from "./db";
import { NovaContaReceber, CancelarContaReceber } from "./NovaContaReceber";
import { formatarMoeda, formatarData, hojeISO, lerNumero, paraCentavos, deCentavos, somarValores, mascararDocumento } from "./format";
import { ORIGEM_PAGAMENTO, nomeForma, formaPorId, situacaoTitulo, somarDias } from "./financeiro";
import FormaSelect from "./FormaSelect";

// Mesma tela para contas a pagar (geradas pelas notas) e contas a receber (lançadas aqui): a aba escolhe a situação.
// Os textos de cada lado ficam em TEXTOS; os dados vêm das views titulos_pagar e titulos_receber (mesmas colunas).
const TEXTOS = {
  pagar: {
    titulo: "Contas a pagar", pessoa: "Fornecedor", buscar: "Fornecedor ou documento", pagas: "Pagas", pagosMes: "Pagos no mês",
    acao: "Pagar", feito: "Pago", baixa: "Pagamento", baixas: "Pagamentos", dados: "Dados para pagamento",
    subtitulo: "Lançamentos gerados pela aprovação das notas de entrada, conforme a condição de pagamento. Clique em um lançamento para ver ou completar os dados de pagamento (boleto, PIX, banco); ao pagar, o valor sai da conta caixa escolhida.",
    vazio: "Nenhuma conta a pagar ainda. Elas aparecem quando uma nota de entrada é aprovada.",
  },
  receber: {
    titulo: "Contas a receber", pessoa: "Pagador", buscar: "Pagador ou descrição", pagas: "Recebidas", pagosMes: "Recebidos no mês",
    acao: "Receber", feito: "Recebido", baixa: "Recebimento", baixas: "Recebimentos", dados: "Dados para recebimento",
    subtitulo: "Valores que a igreja tem a receber (aluguel do espaço, eventos, repasses), em uma ou mais parcelas. Clique em uma conta para ver ou completar os dados; ao receber, o valor entra na conta caixa escolhida. Parcela em aberto pode ser cancelada, com motivo.",
    vazio: "Nenhuma conta a receber ainda. Use “Nova conta a receber” para lançar.",
  },
};
const SITUACOES = [
  { id: "abertos", rotulo: "Em aberto" }, { id: "vencido", rotulo: "Vencidas" }, { id: "semana", rotulo: "Vencem em 7 dias" },
  { id: "pago", rotulo: "Pagas" }, { id: "cancelado", rotulo: "Canceladas" }, { id: "todos", rotulo: "Todas" },
];
const FILTROS_VAZIOS = { busca: "", de: "", ate: "" };

const COLUNAS = {
  vencimento: (t) => t.vencimento,
  fornecedor: (t) => t.fornecedor_nome,
  documento: (t) => t.descricao,
  parcela: (t) => t.parcela,
  valor: (t) => Number(t.valor),
  situacao: (t) => t.status + t.vencimento,
  pagamento: (t) => t.data_pagamento,
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

export default function ContasPagar({ natureza = "pagar", cadastros, podePagar, onCadastrosMudaram }) {
  const T = TEXTOS[natureza];
  const receber = natureza === "receber";
  const [titulos, setTitulos] = useState(null);
  const [erro, setErro] = useState("");
  const [filtros, setFiltros] = useState(FILTROS_VAZIOS);
  const [situacao, setSituacao] = useState("abertos");
  const [acao, setAcao] = useState(null); // { tipo: "pagar" | "estornar" | "ver" | "nova" | "cancelar", titulo }
  const hoje = hojeISO();
  const emSete = somarDias(hoje, 7);

  const recarregar = useCallback(
    () => (receber ? listarTitulosReceber() : listarTitulosPagar()).then((d) => { setTitulos(d); setErro(""); }).catch((e) => setErro(mensagemErro(e))),
    [receber],
  );
  useEffect(() => { recarregar(); }, [recarregar]);
  const aoConcluir = async () => { setAcao(null); await Promise.all([recarregar(), onCadastrosMudaram()]); };

  const indicadores = useMemo(() => {
    const lista = titulos || [];
    const abertos = lista.filter((t) => t.status === "aberto");
    const vencidos = abertos.filter((t) => t.vencimento < hoje);
    const semana = abertos.filter((t) => t.vencimento >= hoje && t.vencimento <= emSete);
    const mes = hoje.slice(0, 7);
    const pagosMes = lista.filter((t) => t.status === "pago" && t.data_pagamento?.startsWith(mes));
    const soma = (l, campo = "valor") => formatarMoeda(somarValores(l.map((t) => Number(t[campo]))));
    return {
      vencidos: vencidos.length, valorVencidos: soma(vencidos),
      semana: semana.length, valorSemana: soma(semana),
      abertos: abertos.length, valorAbertos: soma(abertos),
      pagosMes: pagosMes.length, valorPagosMes: soma(pagosMes, "valor_pago"),
    };
  }, [titulos, hoje, emSete]);

  const naSituacao = useCallback((t, sit) => sit === "todos"
    || (sit === "abertos" && t.status === "aberto")
    || (sit === "vencido" && t.status === "aberto" && t.vencimento < hoje)
    || (sit === "semana" && t.status === "aberto" && t.vencimento >= hoje && t.vencimento <= emSete)
    || sit === t.status, [hoje, emSete]);

  // Busca e período valem para todas as abas (o contador de cada aba já respeita esses filtros).
  const porFiltro = useMemo(() => {
    const termo = filtros.busca.trim().toLowerCase();
    const campoData = (t) => (t.status === "pago" && t.data_pagamento ? t.data_pagamento : t.vencimento);
    return (titulos || []).filter((t) =>
      (!termo || t.fornecedor_nome.toLowerCase().includes(termo) || t.descricao.toLowerCase().includes(termo))
      && (!filtros.de || campoData(t) >= filtros.de)
      && (!filtros.ate || campoData(t) <= filtros.ate));
  }, [titulos, filtros]);
  const filtrados = useMemo(() => porFiltro.filter((t) => naSituacao(t, situacao)), [porFiltro, situacao, naSituacao]);

  const ordenacao = useOrdenacao(filtrados, COLUNAS, { chave: "vencimento", dir: "asc" });
  const f = (campo) => (e) => setFiltros((p) => ({ ...p, [campo]: e.target.value }));
  const temFiltro = JSON.stringify(filtros) !== JSON.stringify(FILTROS_VAZIOS);
  const verPagas = situacao === "pago";
  const totalAberto = somarValores(filtrados.filter((t) => t.status === "aberto").map((t) => Number(t.valor)));
  const totalPago = somarValores(filtrados.filter((t) => t.status === "pago").map((t) => Number(t.valor_pago)));
  const colunas = podePagar ? 8 : 7;

  return (
    <div>
      <div className="page-header">
        <Header title={T.titulo} subtitle={T.subtitulo} />
        {receber && podePagar && <button className="btn btn-primary" onClick={() => setAcao({ tipo: "nova" })}><Icone nome="mais" tamanho={16} traco={2.2} /> Nova conta a receber</button>}
      </div>

      <div className="stat-grid">
        <Indicador icone="alerta" tom={indicadores.vencidos ? "perigo" : "neutro"} rotulo="Vencidos" valor={indicadores.vencidos} sub={indicadores.valorVencidos} />
        <Indicador icone="relogio" tom={indicadores.semana ? "alerta" : "neutro"} rotulo="Vencem em 7 dias" valor={indicadores.semana} sub={indicadores.valorSemana} />
        <Indicador icone="carteira" tom="neutro" rotulo="Total em aberto" valor={indicadores.abertos} sub={indicadores.valorAbertos} />
        <Indicador icone="check" rotulo={T.pagosMes} valor={indicadores.pagosMes} sub={indicadores.valorPagosMes} />
      </div>

      {erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}

      <div className="card">
        <div className="toolbar">
          <label style={{ flex: "1 1 240px", maxWidth: 340 }}>Buscar
            <input placeholder={T.buscar} value={filtros.busca} onChange={f("busca")} style={inp} />
          </label>
          <label>{verPagas ? `${T.pagas} de` : "Vencimento de"}
            <input type="date" value={filtros.de} onChange={f("de")} style={{ ...inp, width: 156 }} />
          </label>
          <label>até
            <input type="date" value={filtros.ate} onChange={f("ate")} style={{ ...inp, width: 156 }} />
          </label>
          {temFiltro && <button className="btn btn-ghost" onClick={() => setFiltros(FILTROS_VAZIOS)}>Limpar filtros</button>}
        </div>

        <div className="abas" role="tablist" aria-label="Situação dos lançamentos">
          {SITUACOES.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={situacao === s.id} className={`aba${situacao === s.id ? " ativa" : ""}`} onClick={() => setSituacao(s.id)}>
              {s.id === "pago" ? T.pagas : s.rotulo}<span className="contador">{porFiltro.filter((t) => naSituacao(t, s.id)).length}</span>
            </button>
          ))}
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <ThOrdenavel chave="vencimento" ordenacao={ordenacao}>Vencimento</ThOrdenavel>
              <ThOrdenavel chave="fornecedor" ordenacao={ordenacao}>{T.pessoa}</ThOrdenavel>
              <ThOrdenavel chave="documento" ordenacao={ordenacao}>{receber ? "Descrição" : "Documento"}</ThOrdenavel>
              <ThOrdenavel chave="parcela" ordenacao={ordenacao}>Parcela</ThOrdenavel>
              <ThOrdenavel chave="valor" ordenacao={ordenacao} className="num">Valor</ThOrdenavel>
              <ThOrdenavel chave="situacao" ordenacao={ordenacao}>Situação</ThOrdenavel>
              <ThOrdenavel chave="pagamento" ordenacao={ordenacao}>{T.baixa}</ThOrdenavel>
              {podePagar && <th className="acoes"><span className="sr-only">Ações</span></th>}
            </tr></thead>
            <tbody>
              {titulos === null && !erro && <tr><td className="vazio" colSpan={colunas}>Carregando...</td></tr>}
              {titulos && filtrados.length === 0 && (
                <tr><td className="vazio" colSpan={colunas}>{titulos.length === 0 ? T.vazio : "Nenhum título encontrado com esses filtros."}</td></tr>
              )}
              {ordenacao.ordenadas.map((t) => {
                const sit = situacaoTitulo(t, hoje, natureza);
                return (
                  <tr key={t.id} className="clicavel" tabIndex={0} style={t.status === "cancelado" ? { color: "var(--faint)" } : undefined}
                    onClick={() => setAcao({ tipo: "ver", titulo: t })} onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) setAcao({ tipo: "ver", titulo: t }); }}>
                    <td style={sit.id === "vencido" ? { color: "var(--danger)", fontWeight: 600 } : undefined}>{formatarData(t.vencimento)}</td>
                    <td className="truncate" style={{ fontWeight: 550, maxWidth: 260 }}>{t.fornecedor_nome}</td>
                    <td>{t.descricao}{t.forma_pagamento && <div className="muted" style={{ fontSize: 12 }}>{t.forma_pagamento_nome ?? nomeForma(cadastros.formas, t.forma_pagamento_id, t.forma_pagamento)}{temDadosPagamento(t) && " · dados informados"}</div>}</td>
                    <td>{t.parcela}/{t.total_parcelas}</td>
                    <td className="num" style={t.status === "cancelado" ? { textDecoration: "line-through" } : { fontWeight: 550 }}>{formatarMoeda(t.valor)}</td>
                    <td><Pill tone={sit.tom}>{sit.rotulo}</Pill></td>
                    <td>{t.data_pagamento ? <>{formatarData(t.data_pagamento)}<div className="muted" style={{ fontSize: 12 }}>{formatarMoeda(t.valor_pago)}</div></> : "—"}</td>
                    {podePagar && (
                      <td className="acoes" style={{ whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                        {t.status === "aberto" && (
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => setAcao({ tipo: "pagar", titulo: t })}>{T.acao}</button>
                        )}
                        {t.status === "pago" && t.pagamento_id && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAcao({ tipo: "estornar", titulo: t })}>Estornar</button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {titulos && filtrados.length > 0 && (
          <div className="table-footer">
            <span>{filtrados.length} título(s){titulos.length >= 2000 && " · exibindo os 2000 primeiros"}</span>
            <span>Em aberto: <strong>{formatarMoeda(totalAberto)}</strong>{totalPago > 0 && <> · {T.feito}: <strong>{formatarMoeda(totalPago)}</strong></>}</span>
          </div>
        )}
      </div>

      {acao?.tipo === "pagar" && <PagarModal natureza={natureza} titulo={acao.titulo} caixas={cadastros.caixas} pessoas={cadastros.pessoas} onFechar={() => setAcao(null)} onConcluido={aoConcluir} />}
      {acao?.tipo === "nova" && <NovaContaReceber cadastros={cadastros} onFechar={() => setAcao(null)} onConcluido={aoConcluir} onCadastrosMudaram={onCadastrosMudaram} />}
      {acao?.tipo === "cancelar" && <CancelarContaReceber titulo={acao.titulo} onFechar={() => setAcao(null)} onConcluido={aoConcluir} />}
      {acao?.tipo === "estornar" && (
        <EstornoModal natureza={natureza} descricao={`${acao.titulo.descricao} — parcela ${acao.titulo.parcela}/${acao.titulo.total_parcelas} · ${formatarMoeda(acao.titulo.valor_pago)}`}
          pagamentoId={acao.titulo.pagamento_id} onFechar={() => setAcao(null)} onConcluido={aoConcluir} />
      )}
      {acao?.tipo === "ver" && (
        <LancamentoModal natureza={natureza} titulo={acao.titulo} caixas={cadastros.caixas} formas={cadastros.formas} podePagar={podePagar} onFechar={() => setAcao(null)}
          onCancelar={() => setAcao({ tipo: "cancelar", titulo: acao.titulo })}
          onSalvo={async () => { await Promise.all([recarregar(), onCadastrosMudaram()]); }}
          onPagar={() => setAcao({ tipo: "pagar", titulo: acao.titulo })} onEstornar={() => setAcao({ tipo: "estornar", titulo: acao.titulo })} />
      )}
    </div>
  );
}

const valorCampo = (txt) => { const n = lerNumero(txt); return String(txt ?? "").trim() === "" ? 0 : n; };

function PagarModal({ natureza, titulo: t, caixas, pessoas, onFechar, onConcluido }) {
  const T = TEXTOS[natureza];
  const receber = natureza === "receber";
  const ativas = caixas.filter((c) => c.ativo);
  const prevista = ativas.find((c) => c.id === t.conta_caixa_id);
  const [f, setF] = useState({
    contaCaixaId: prevista ? String(prevista.id) : ativas.length === 1 ? String(ativas[0].id) : "",
    data: hojeISO(), juros: "", multa: "", desconto: "", observacao: "",
  });
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const caixa = caixas.find((c) => String(c.id) === f.contaCaixaId);
  const fornecedor = pessoas.find((p) => p.id === t.pessoa_id);

  const juros = valorCampo(f.juros), multa = valorCampo(f.multa), desconto = valorCampo(f.desconto);
  const totalCent = paraCentavos(Number(t.valor)) + paraCentavos(juros) + paraCentavos(multa) - paraCentavos(desconto);
  const erros = {};
  if (!f.contaCaixaId) erros.contaCaixaId = "Escolha a conta caixa";
  if (!f.data) erros.data = "Informe a data";
  else if (f.data > hojeISO()) erros.data = "Não pode ser futura";
  for (const k of ["juros", "multa", "desconto"]) if (!(valorCampo(f[k]) >= 0)) erros[k] = "Valor inválido";
  if (!erros.desconto && totalCent <= 0) erros.desconto = receber ? "Maior que o valor a receber" : "Maior que o valor a pagar";
  if (!erros.data && receber && caixa && f.data < caixa.data_saldo_inicial) erros.data = `Antes do saldo inicial da conta (${formatarData(caixa.data_saldo_inicial)})`;

  async function confirmar() {
    setTentou(true);
    setErro("");
    if (Object.keys(erros).length) return;
    setSalvando(true);
    try {
      await (receber ? receberTitulo : pagarTitulo)(t.id, { contaCaixaId: f.contaCaixaId, data: f.data, juros, multa, desconto, observacao: f.observacao });
      await onConcluido();
    } catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }
  const borda = (k) => (tentou && erros[k] ? { borderColor: "var(--danger)" } : {});
  const saldoDepois = caixa ? deCentavos(paraCentavos(Number(caixa.saldo_atual)) + (receber ? totalCent : -totalCent)) : null;

  return (
    <Modal titulo={`Registrar ${T.baixa.toLowerCase()}`} largura={560} fecharFora={false} onFechar={onFechar}
      rodape={<>
        <button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Cancelar</button>
        <button className="btn btn-primary" onClick={confirmar} disabled={salvando}>{salvando ? "Registrando..." : Number.isFinite(totalCent) && totalCent > 0 ? `${T.acao} ${formatarMoeda(deCentavos(totalCent))}` : T.acao}</button>
      </>}>
      <div className="resumo-pagar" style={{ marginTop: 0 }}>
        <span>{T.pessoa}: <strong>{t.fornecedor_nome}</strong>{fornecedor?.documento ? ` · ${mascararDocumento(fornecedor.tipo_pessoa, fornecedor.documento)}` : ""}</span>
        <span>{t.descricao} · parcela <strong>{t.parcela}/{t.total_parcelas}</strong></span>
        <span>Vencimento: <strong style={t.vencimento < hojeISO() ? { color: "var(--danger)" } : undefined}>{formatarData(t.vencimento)}</strong></span>
        <span>Valor da parcela: <strong>{formatarMoeda(t.valor)}</strong></span>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); confirmar(); }} noValidate>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 12px" }}>
          <div>
            <label style={lbl} htmlFor="pg-caixa">{receber ? "Conta caixa (onde entra) *" : "Conta caixa (de onde sai) *"}</label>
            <select id="pg-caixa" autoFocus style={{ ...inp, ...borda("contaCaixaId") }} value={f.contaCaixaId} onChange={set("contaCaixaId")}>
              <option value="">— Selecione —</option>
              {ativas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            {tentou && erros.contaCaixaId ? <div style={msgErro}>{erros.contaCaixaId}</div>
              : caixa && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Saldo: {formatarMoeda(caixa.saldo_atual)} → depois: <strong style={{ color: saldoDepois < 0 ? "var(--danger)" : "var(--text)" }}>{formatarMoeda(saldoDepois)}</strong></div>}
          </div>
          <div>
            <label style={lbl} htmlFor="pg-data">Data do {T.baixa.toLowerCase()} *</label>
            <input id="pg-data" type="date" max={hojeISO()} style={{ ...inp, ...borda("data") }} value={f.data} onChange={set("data")} />
            {tentou && erros.data && <div style={msgErro}>{erros.data}</div>}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "0 12px" }}>
          {[["juros", "Juros"], ["multa", "Multa"], ["desconto", "Desconto"]].map(([k, r]) => (
            <div key={k}>
              <label style={lbl} htmlFor={`pg-${k}`}>{r}</label>
              <input id={`pg-${k}`} inputMode="decimal" placeholder="0,00" style={{ ...inp, textAlign: "right", ...borda(k) }} value={f[k]} onChange={set(k)} />
              {tentou && erros[k] && <div style={msgErro}>{erros[k]}</div>}
            </div>
          ))}
        </div>
        <label style={lbl} htmlFor="pg-obs">Observação</label>
        <input id="pg-obs" style={inp} maxLength={200} value={f.observacao} onChange={set("observacao")} placeholder="Ex.: PIX nº, comprovante, cheque nº" />
        <button type="submit" hidden />
      </form>
      <div className="totais" style={{ maxWidth: "none" }}>
        <div><span>Parcela</span><span>{formatarMoeda(t.valor)}</span></div>
        {juros + multa > 0 && <div><span>(+) Juros e multa</span><span>{formatarMoeda(juros + multa)}</span></div>}
        {desconto > 0 && <div><span>(−) Desconto</span><span>{formatarMoeda(desconto)}</span></div>}
        <div className="final"><span>Total {receber ? "recebido" : "pago"}</span><span>{Number.isFinite(totalCent) ? formatarMoeda(deCentavos(totalCent)) : "—"}</span></div>
      </div>
      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}

export function EstornoModal({ natureza = "pagar", descricao, pagamentoId, onFechar, onConcluido }) {
  const receber = natureza === "receber";
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const valido = motivo.trim().length >= 5;
  async function confirmar() {
    if (!valido) return;
    setSalvando(true);
    setErro("");
    try { await estornarPagamento(pagamentoId, motivo); await onConcluido(); }
    catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }
  return (
    <Modal titulo={receber ? "Estornar recebimento" : "Estornar pagamento"} largura={480} nivel={400} fecharFora={false} onFechar={onFechar}
      rodape={<>
        <button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Voltar</button>
        <button className="btn btn-danger" style={{ opacity: valido ? 1 : 0.5 }} disabled={!valido || salvando} onClick={confirmar}>{salvando ? "Estornando..." : "Estornar"}</button>
      </>}>
      <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "4px 0 0" }}>
        <strong>{descricao}</strong>. {receber ? "O valor sai da conta caixa" : "O valor volta para a conta caixa"} e a parcela fica em aberto de novo. O estorno fica registrado. Informe o motivo:
      </p>
      <textarea autoFocus style={{ ...inp, minHeight: 70, marginTop: 8, marginBottom: 8, fontFamily: "inherit" }} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: pago na conta errada (mín. 5 caracteres)" />
      {erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 8 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}

const temDadosPagamento = (t) => Boolean(t.linha_digitavel || t.pix_chave || t.banco || t.agencia || t.conta);
// Linha digitável no formato do boleto bancário (47 números); outros tamanhos ficam como vieram.
function formatarLinha(l) {
  if (!l) return "";
  if (l.length !== 47) return l;
  return `${l.slice(0, 5)}.${l.slice(5, 10)} ${l.slice(10, 15)}.${l.slice(15, 21)} ${l.slice(21, 26)}.${l.slice(26, 32)} ${l[32]} ${l.slice(33)}`;
}

function Copiar({ texto }) {
  const [ok, setOk] = useState(false);
  if (!texto) return null;
  return (
    <button type="button" className="btn btn-ghost btn-sm" style={{ flex: "none" }}
      onClick={() => navigator.clipboard?.writeText(texto).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }).catch(() => {})}>
      {ok ? "Copiado" : "Copiar"}
    </button>
  );
}

// Lançamento (título a pagar): dados da nota, vencimento e dados de pagamento, e o histórico de pagamentos.
function LancamentoModal({ natureza, titulo: t, caixas, formas, podePagar, onFechar, onSalvo, onPagar, onEstornar, onCancelar }) {
  const T = TEXTOS[natureza];
  const receber = natureza === "receber";
  const editavel = podePagar && t.status === "aberto";
  const [f, setF] = useState({
    vencimento: t.vencimento, forma_pagamento_id: String(t.forma_pagamento_id ?? ""), linha_digitavel: formatarLinha(t.linha_digitavel),
    pix_chave: t.pix_chave ?? "", banco: t.banco ?? "", agencia: t.agencia ?? "", conta: t.conta ?? "", observacao: t.observacao ?? "",
  });
  const [historico, setHistorico] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);
  const set = (k) => (e) => { setOk(false); setF((p) => ({ ...p, [k]: e.target.value })); };
  const sit = situacaoTitulo(t, hojeISO(), natureza);
  const digitos = f.linha_digitavel.replace(/\D/g, "");
  const erroLinha = digitos && (digitos.length < 44 || digitos.length > 48) ? `A linha tem de 44 a 48 números (tem ${digitos.length})` : "";
  const tipoForma = formaPorId(formas, f.forma_pagamento_id)?.tipo; // comportamento da forma escolhida
  const mostra = (forma, campo) => tipoForma === forma || Boolean(f[campo]);

  useEffect(() => {
    let ativo = true;
    listarPagamentosDoTitulo(t.id).then((d) => { if (ativo) setHistorico(d); }).catch(() => { if (ativo) setHistorico([]); });
    return () => { ativo = false; };
  }, [t.id]);

  async function salvar() {
    setErro("");
    setOk(false);
    if (!f.vencimento) { setErro("Informe o vencimento."); return; }
    if (erroLinha) { setErro(erroLinha); return; }
    setSalvando(true);
    try { await atualizarTitulo(t.id, { ...f, forma_pagamento_id: f.forma_pagamento_id || null, linha_digitavel: digitos }); await onSalvo(); setOk(true); }
    catch (e) { setErro(mensagemErro(e)); }
    finally { setSalvando(false); }
  }

  const caixaNome = (id) => caixas.find((c) => c.id === id)?.nome ?? "—";
  const leitura = (rotulo, conteudo) => (
    <div><label style={lbl}>{rotulo}</label><div style={{ ...inp, background: "var(--surface-2)", minHeight: 38 }}>{conteudo || "—"}</div></div>
  );
  const grade = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0 12px" };

  return (
    <Modal titulo={`${t.descricao} · parcela ${t.parcela}/${t.total_parcelas}`} extra={<Pill tone={sit.tom}>{sit.rotulo}</Pill>} largura={720} fecharFora={false} onFechar={onFechar}
      rodape={<>
        {podePagar && t.status === "pago" && t.pagamento_id && <button className="btn btn-ghost" style={{ marginRight: "auto", color: "var(--danger)", borderColor: "var(--danger-border)" }} onClick={onEstornar}>Estornar {T.baixa.toLowerCase()}</button>}
        {podePagar && receber && t.status === "aberto" && <button className="btn btn-ghost" style={{ marginRight: "auto", color: "var(--danger)", borderColor: "var(--danger-border)" }} onClick={onCancelar}>Cancelar parcela</button>}
        {ok && <span className="pill pill-ok">Salvo</span>}
        <button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Fechar</button>
        {editavel && <button className="btn btn-ghost" style={{ borderColor: "var(--primary)", color: "var(--primary-hover)" }} onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</button>}
        {editavel && <button className="btn btn-primary" onClick={onPagar} disabled={salvando}>{T.acao}</button>}
      </>}>
      <div className="resumo-pagar" style={{ marginTop: 0 }}>
        <span>{T.pessoa}: <strong>{t.fornecedor_nome}</strong>{t.fornecedor_documento ? ` · ${mascararDocumento(t.fornecedor_tipo, t.fornecedor_documento)}` : ""}</span>
        <span>Emissão: <strong>{formatarData(t.emissao)}</strong></span>
        <span>Valor: <strong>{formatarMoeda(t.valor)}</strong></span>
        {t.motivo_cancelamento && <span>Cancelado: <strong>{t.motivo_cancelamento}</strong></span>}
      </div>

      <h3 className="section-title">{T.dados}</h3>
      {editavel ? (
        <>
          <div style={grade}>
            <div>
              <label style={lbl} htmlFor="lc-venc">Vencimento *</label>
              <input id="lc-venc" type="date" style={inp} value={f.vencimento} onChange={set("vencimento")} />
            </div>
            <div>
              <label style={lbl} htmlFor="lc-forma">Forma de pagamento</label>
              <FormaSelect id="lc-forma" style={inp} formas={formas} value={f.forma_pagamento_id} vazio="— Não informada —"
                onChange={(v) => { setOk(false); setF((p) => ({ ...p, forma_pagamento_id: v })); }} />
            </div>
          </div>
          {mostra("boleto", "linha_digitavel") && (
            <>
              <label style={lbl} htmlFor="lc-linha">Linha digitável ou código de barras do boleto</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input id="lc-linha" style={{ ...inp, fontFamily: "monospace", ...(erroLinha ? { borderColor: "var(--danger)" } : {}) }} inputMode="numeric" maxLength={60}
                  value={f.linha_digitavel} onChange={set("linha_digitavel")} placeholder="00000.00000 00000.000000 00000.000000 0 00000000000000" />
                <Copiar texto={digitos} />
              </div>
              {erroLinha && <div style={{ fontSize: 12.5, color: "var(--danger)", marginTop: 5 }}>{erroLinha}</div>}
            </>
          )}
          {mostra("pix", "pix_chave") && (
            <>
              <label style={lbl} htmlFor="lc-pix">Chave PIX</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input id="lc-pix" style={inp} maxLength={77} value={f.pix_chave} onChange={set("pix_chave")} placeholder="CPF/CNPJ, e-mail, telefone ou chave aleatória" />
                <Copiar texto={f.pix_chave.trim()} />
              </div>
            </>
          )}
          {(mostra("transferencia", "banco") || f.agencia || f.conta) && (
            <div style={grade}>
              <div><label style={lbl} htmlFor="lc-banco">Banco</label><input id="lc-banco" style={inp} maxLength={60} value={f.banco} onChange={set("banco")} placeholder="Ex.: Banco do Brasil (001)" /></div>
              <div><label style={lbl} htmlFor="lc-ag">Agência</label><input id="lc-ag" style={inp} maxLength={20} value={f.agencia} onChange={set("agencia")} /></div>
              <div><label style={lbl} htmlFor="lc-conta">Conta</label><input id="lc-conta" style={inp} maxLength={30} value={f.conta} onChange={set("conta")} /></div>
            </div>
          )}
          <label style={lbl} htmlFor="lc-obs">Observação</label>
          <textarea id="lc-obs" style={{ ...inp, minHeight: 56, resize: "vertical", fontFamily: "inherit" }} maxLength={500} value={f.observacao} onChange={set("observacao")} placeholder={receber ? "Ex.: cobrar por WhatsApp, contrato assinado em 10/01" : "Ex.: boleto enviado por e-mail, falar com o financeiro do fornecedor"} />
        </>
      ) : (
        <>
          <div style={grade}>
            {leitura("Vencimento", formatarData(t.vencimento))}
            {leitura("Forma de pagamento", t.forma_pagamento_nome ?? nomeForma(formas, t.forma_pagamento_id, t.forma_pagamento))}
          </div>
          {t.linha_digitavel && <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}><div style={{ flex: 1 }}>{leitura("Linha digitável", <span style={{ fontFamily: "monospace" }}>{formatarLinha(t.linha_digitavel)}</span>)}</div><Copiar texto={t.linha_digitavel} /></div>}
          {t.pix_chave && leitura("Chave PIX", t.pix_chave)}
          {(t.banco || t.agencia || t.conta) && <div style={grade}>{leitura("Banco", t.banco)}{leitura("Agência", t.agencia)}{leitura("Conta", t.conta)}</div>}
          {t.observacao && leitura("Observação", t.observacao)}
          {!podePagar && t.status === "aberto" && <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Só Supervisor ou Administrador altera estes dados.</div>}
        </>
      )}

      <h3 className="section-title">{T.baixas}</h3>
      {historico === null && <div className="muted" style={{ fontSize: 13 }}>Carregando...</div>}
      {historico && historico.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Nenhum {T.baixa.toLowerCase()} registrado.</div>}
      {historico && historico.length > 0 && (
        <table className="parcelas">
          <thead><tr><th>Data</th><th>Conta caixa</th><th className="num">Valor {receber ? "recebido" : "pago"}</th><th>Origem</th><th>Situação</th></tr></thead>
          <tbody>{historico.map((p) => (
            <tr key={p.id} style={p.estornado ? { color: "var(--faint)" } : undefined}>
              <td>{formatarData(p.data_pagamento)}</td>
              <td>{p.conta_caixa_id ? caixaNome(p.conta_caixa_id) : "—"}{p.observacao && <div className="muted" style={{ fontSize: 12 }}>{p.observacao}</div>}</td>
              <td className="num" style={p.estornado ? { textDecoration: "line-through" } : { fontWeight: 600 }}>{formatarMoeda(p.valor_pago)}</td>
              <td style={{ fontSize: 12.5 }}>{ORIGEM_PAGAMENTO[p.origem]}</td>
              <td>{p.estornado ? <span title={p.motivo_estorno}><Pill tone="danger">Estornado</Pill><div className="muted" style={{ fontSize: 12, whiteSpace: "normal" }}>{p.motivo_estorno}</div></span> : <Pill tone="ok">{T.feito}</Pill>}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}
