import { useCallback, useEffect, useMemo, useState } from "react";
import { Header, Pill } from "../ui";
import { lbl, inp, msgErro } from "../estilos";
import Icone from "./Icone";
import Modal from "./Modal";
import ThOrdenavel from "./ThOrdenavel";
import { useOrdenacao } from "./useOrdenacao";
import { listarTitulosPagar, pagarTitulo, estornarPagamento, alterarVencimento, mensagemErro } from "./db";
import { formatarMoeda, formatarData, hojeISO, lerNumero, paraCentavos, deCentavos, somarValores, mascararDocumento } from "./format";
import { FORMAS_PAGAMENTO, situacaoTitulo, somarDias } from "./financeiro";

const SITUACOES = {
  abertos: "Em aberto (todos)", vencido: "Vencidos", semana: "Vencem em 7 dias", pago: "Pagos", cancelado: "Cancelados", todos: "Todos",
};
const FILTROS_VAZIOS = { busca: "", situacao: "abertos", de: "", ate: "" };

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

export default function ContasPagar({ cadastros, podePagar, onCadastrosMudaram }) {
  const [titulos, setTitulos] = useState(null);
  const [erro, setErro] = useState("");
  const [filtros, setFiltros] = useState(FILTROS_VAZIOS);
  const [acao, setAcao] = useState(null); // { tipo: "pagar" | "estornar" | "vencimento", titulo }
  const hoje = hojeISO();
  const emSete = somarDias(hoje, 7);

  const recarregar = useCallback(
    () => listarTitulosPagar().then((d) => { setTitulos(d); setErro(""); }).catch((e) => setErro(mensagemErro(e))),
    [],
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

  const filtrados = useMemo(() => {
    const termo = filtros.busca.trim().toLowerCase();
    return (titulos || []).filter((t) => {
      const sit = filtros.situacao;
      const passaSituacao = sit === "todos"
        || (sit === "abertos" && t.status === "aberto")
        || (sit === "vencido" && t.status === "aberto" && t.vencimento < hoje)
        || (sit === "semana" && t.status === "aberto" && t.vencimento >= hoje && t.vencimento <= emSete)
        || (sit === t.status);
      return passaSituacao
        && (!termo || t.fornecedor_nome.toLowerCase().includes(termo) || t.descricao.toLowerCase().includes(termo))
        && (!filtros.de || t.vencimento >= filtros.de)
        && (!filtros.ate || t.vencimento <= filtros.ate);
    });
  }, [titulos, filtros, hoje, emSete]);

  const ordenacao = useOrdenacao(filtrados, COLUNAS, { chave: "vencimento", dir: "asc" });
  const f = (campo) => (e) => setFiltros((p) => ({ ...p, [campo]: e.target.value }));
  const temFiltro = JSON.stringify(filtros) !== JSON.stringify(FILTROS_VAZIOS);
  const totalAberto = somarValores(filtrados.filter((t) => t.status === "aberto").map((t) => Number(t.valor)));
  const totalPago = somarValores(filtrados.filter((t) => t.status === "pago").map((t) => Number(t.valor_pago)));
  const colunas = podePagar ? 8 : 7;

  return (
    <div>
      <div className="page-header">
        <Header title="Contas a pagar" subtitle="Parcelas geradas pela aprovação das notas de entrada, conforme a condição de pagamento. Registre aqui cada pagamento: o valor sai da conta caixa escolhida." />
      </div>

      <div className="stat-grid">
        <Indicador icone="alerta" tom={indicadores.vencidos ? "perigo" : "neutro"} rotulo="Vencidos" valor={indicadores.vencidos} sub={indicadores.valorVencidos} />
        <Indicador icone="relogio" tom={indicadores.semana ? "alerta" : "neutro"} rotulo="Vencem em 7 dias" valor={indicadores.semana} sub={indicadores.valorSemana} />
        <Indicador icone="carteira" tom="neutro" rotulo="Total em aberto" valor={indicadores.abertos} sub={indicadores.valorAbertos} />
        <Indicador icone="check" rotulo="Pagos no mês" valor={indicadores.pagosMes} sub={indicadores.valorPagosMes} />
      </div>

      {erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}

      <div className="card">
        <div className="toolbar">
          <label style={{ flex: "1 1 240px", maxWidth: 340 }}>Buscar
            <input placeholder="Fornecedor ou documento" value={filtros.busca} onChange={f("busca")} style={inp} />
          </label>
          <label>Situação
            <select value={filtros.situacao} onChange={f("situacao")} style={{ ...inp, width: 180 }}>
              {Object.entries(SITUACOES).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </select>
          </label>
          <label>Vencimento de
            <input type="date" value={filtros.de} onChange={f("de")} style={{ ...inp, width: 156 }} />
          </label>
          <label>até
            <input type="date" value={filtros.ate} onChange={f("ate")} style={{ ...inp, width: 156 }} />
          </label>
          {temFiltro && <button className="btn btn-ghost" onClick={() => setFiltros(FILTROS_VAZIOS)}>Limpar filtros</button>}
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <ThOrdenavel chave="vencimento" ordenacao={ordenacao}>Vencimento</ThOrdenavel>
              <ThOrdenavel chave="fornecedor" ordenacao={ordenacao}>Fornecedor</ThOrdenavel>
              <ThOrdenavel chave="documento" ordenacao={ordenacao}>Documento</ThOrdenavel>
              <ThOrdenavel chave="parcela" ordenacao={ordenacao}>Parcela</ThOrdenavel>
              <ThOrdenavel chave="valor" ordenacao={ordenacao} className="num">Valor</ThOrdenavel>
              <ThOrdenavel chave="situacao" ordenacao={ordenacao}>Situação</ThOrdenavel>
              <ThOrdenavel chave="pagamento" ordenacao={ordenacao}>Pagamento</ThOrdenavel>
              {podePagar && <th className="acoes"><span className="sr-only">Ações</span></th>}
            </tr></thead>
            <tbody>
              {titulos === null && !erro && <tr><td className="vazio" colSpan={colunas}>Carregando...</td></tr>}
              {titulos && filtrados.length === 0 && (
                <tr><td className="vazio" colSpan={colunas}>{titulos.length === 0 ? "Nenhuma conta a pagar ainda. Elas aparecem quando uma nota de entrada é aprovada." : "Nenhum título encontrado com esses filtros."}</td></tr>
              )}
              {ordenacao.ordenadas.map((t) => {
                const sit = situacaoTitulo(t, hoje);
                return (
                  <tr key={t.id} style={t.status === "cancelado" ? { color: "var(--faint)" } : undefined}>
                    <td style={sit.id === "vencido" ? { color: "var(--danger)", fontWeight: 600 } : undefined}>{formatarData(t.vencimento)}</td>
                    <td className="truncate" style={{ fontWeight: 550, maxWidth: 260 }}>{t.fornecedor_nome}</td>
                    <td>{t.descricao}{t.forma_pagamento && <div className="muted" style={{ fontSize: 12 }}>{FORMAS_PAGAMENTO[t.forma_pagamento]}</div>}</td>
                    <td>{t.parcela}/{t.total_parcelas}</td>
                    <td className="num" style={t.status === "cancelado" ? { textDecoration: "line-through" } : { fontWeight: 550 }}>{formatarMoeda(t.valor)}</td>
                    <td><Pill tone={sit.tom}>{sit.rotulo}</Pill></td>
                    <td>{t.data_pagamento ? <>{formatarData(t.data_pagamento)}<div className="muted" style={{ fontSize: 12 }}>{formatarMoeda(t.valor_pago)}</div></> : "—"}</td>
                    {podePagar && (
                      <td className="acoes" style={{ whiteSpace: "nowrap" }}>
                        {t.status === "aberto" && (
                          <>
                            <button type="button" className="icon-btn" title="Alterar vencimento" aria-label={`Alterar vencimento de ${t.descricao} ${t.parcela}/${t.total_parcelas}`}
                              onClick={() => setAcao({ tipo: "vencimento", titulo: t })}><Icone nome="relogio" tamanho={16} /></button>
                            <button type="button" className="btn btn-primary btn-sm" style={{ marginLeft: 6 }} onClick={() => setAcao({ tipo: "pagar", titulo: t })}>Pagar</button>
                          </>
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
            <span>Em aberto: <strong>{formatarMoeda(totalAberto)}</strong>{totalPago > 0 && <> · Pago: <strong>{formatarMoeda(totalPago)}</strong></>}</span>
          </div>
        )}
      </div>

      {acao?.tipo === "pagar" && <PagarModal titulo={acao.titulo} caixas={cadastros.caixas} pessoas={cadastros.pessoas} onFechar={() => setAcao(null)} onConcluido={aoConcluir} />}
      {acao?.tipo === "estornar" && (
        <EstornoModal descricao={`${acao.titulo.descricao} — parcela ${acao.titulo.parcela}/${acao.titulo.total_parcelas} · ${formatarMoeda(acao.titulo.valor_pago)}`}
          pagamentoId={acao.titulo.pagamento_id} onFechar={() => setAcao(null)} onConcluido={aoConcluir} />
      )}
      {acao?.tipo === "vencimento" && <VencimentoModal titulo={acao.titulo} onFechar={() => setAcao(null)} onConcluido={aoConcluir} />}
    </div>
  );
}

const valorCampo = (txt) => { const n = lerNumero(txt); return String(txt ?? "").trim() === "" ? 0 : n; };

function PagarModal({ titulo: t, caixas, pessoas, onFechar, onConcluido }) {
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
  if (!erros.desconto && totalCent <= 0) erros.desconto = "Maior que o valor a pagar";

  async function confirmar() {
    setTentou(true);
    setErro("");
    if (Object.keys(erros).length) return;
    setSalvando(true);
    try {
      await pagarTitulo(t.id, { contaCaixaId: f.contaCaixaId, data: f.data, juros, multa, desconto, observacao: f.observacao });
      await onConcluido();
    } catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }
  const borda = (k) => (tentou && erros[k] ? { borderColor: "var(--danger)" } : {});
  const saldoDepois = caixa ? deCentavos(paraCentavos(Number(caixa.saldo_atual)) - totalCent) : null;

  return (
    <Modal titulo="Registrar pagamento" largura={560} fecharFora={false} onFechar={onFechar}
      rodape={<>
        <button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Cancelar</button>
        <button className="btn btn-primary" onClick={confirmar} disabled={salvando}>{salvando ? "Registrando..." : Number.isFinite(totalCent) && totalCent > 0 ? `Pagar ${formatarMoeda(deCentavos(totalCent))}` : "Pagar"}</button>
      </>}>
      <div className="resumo-pagar" style={{ marginTop: 0 }}>
        <span>Fornecedor: <strong>{t.fornecedor_nome}</strong>{fornecedor?.documento ? ` · ${mascararDocumento(fornecedor.tipo_pessoa, fornecedor.documento)}` : ""}</span>
        <span>{t.descricao} · parcela <strong>{t.parcela}/{t.total_parcelas}</strong></span>
        <span>Vencimento: <strong style={t.vencimento < hojeISO() ? { color: "var(--danger)" } : undefined}>{formatarData(t.vencimento)}</strong></span>
        <span>Valor da parcela: <strong>{formatarMoeda(t.valor)}</strong></span>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); confirmar(); }} noValidate>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 12px" }}>
          <div>
            <label style={lbl} htmlFor="pg-caixa">Conta caixa (de onde sai) *</label>
            <select id="pg-caixa" autoFocus style={{ ...inp, ...borda("contaCaixaId") }} value={f.contaCaixaId} onChange={set("contaCaixaId")}>
              <option value="">— Selecione —</option>
              {ativas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            {tentou && erros.contaCaixaId ? <div style={msgErro}>{erros.contaCaixaId}</div>
              : caixa && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Saldo: {formatarMoeda(caixa.saldo_atual)} → depois: <strong style={{ color: saldoDepois < 0 ? "var(--danger)" : "var(--text)" }}>{formatarMoeda(saldoDepois)}</strong></div>}
          </div>
          <div>
            <label style={lbl} htmlFor="pg-data">Data do pagamento *</label>
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
        <div className="final"><span>Total pago</span><span>{Number.isFinite(totalCent) ? formatarMoeda(deCentavos(totalCent)) : "—"}</span></div>
      </div>
      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}

export function EstornoModal({ descricao, pagamentoId, onFechar, onConcluido }) {
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
    <Modal titulo="Estornar pagamento" largura={480} nivel={400} fecharFora={false} onFechar={onFechar}
      rodape={<>
        <button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Voltar</button>
        <button className="btn btn-danger" style={{ opacity: valido ? 1 : 0.5 }} disabled={!valido || salvando} onClick={confirmar}>{salvando ? "Estornando..." : "Estornar"}</button>
      </>}>
      <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "4px 0 0" }}>
        <strong>{descricao}</strong>. O valor volta para a conta caixa e a parcela fica em aberto de novo. O estorno fica registrado. Informe o motivo:
      </p>
      <textarea autoFocus style={{ ...inp, minHeight: 70, marginTop: 8, marginBottom: 8, fontFamily: "inherit" }} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: pago na conta errada (mín. 5 caracteres)" />
      {erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 8 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}

function VencimentoModal({ titulo: t, onFechar, onConcluido }) {
  const [data, setData] = useState(t.vencimento);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  async function confirmar() {
    if (!data) return;
    setSalvando(true);
    setErro("");
    try { await alterarVencimento(t.id, data); await onConcluido(); }
    catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }
  return (
    <Modal titulo="Alterar vencimento" largura={420} fecharFora={false} onFechar={onFechar}
      rodape={<>
        <button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Cancelar</button>
        <button className="btn btn-primary" onClick={confirmar} disabled={!data || data === t.vencimento || salvando}>{salvando ? "Salvando..." : "Salvar"}</button>
      </>}>
      <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "4px 0 0" }}>{t.fornecedor_nome} · {t.descricao} · parcela {t.parcela}/{t.total_parcelas} · {formatarMoeda(t.valor)}</p>
      <label style={lbl} htmlFor="venc-data">Novo vencimento</label>
      <input id="venc-data" type="date" autoFocus style={inp} value={data} onChange={(e) => setData(e.target.value)} />
      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 12 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}
