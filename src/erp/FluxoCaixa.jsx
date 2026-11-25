import { Fragment, useEffect, useMemo, useState } from "react";
import { Header, Pill } from "../ui";
import { inp } from "../estilos";
import Icone from "./Icone";
import ThOrdenavel from "./ThOrdenavel";
import { useOrdenacao } from "./useOrdenacao";
import { carregarFluxo, mensagemErro } from "./db";
import { formatarMoeda, formatarData, hojeISO, paraCentavos, deCentavos } from "./format";
import { ORIGENS_EXTRATO, somarDias, somarMeses } from "./financeiro";

// Fluxo de caixa = realizado (extrato_caixa) + previsto (contas a pagar e a receber em aberto), por dia, semana ou mês.
// Não grava nada: só lê o que as outras telas do Financeiro registram.

const AGRUPAR = { dia: "Dia", semana: "Semana", mes: "Mês" };
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const TRANSFERENCIAS = new Set(["transferencia_saida", "transferencia_entrada"]);

// Chave e rótulo do grupo de uma data. Semana começa na segunda-feira.
function grupoDe(iso, agrupar) {
  if (agrupar === "dia") return { chave: iso, rotulo: formatarData(iso) };
  if (agrupar === "mes") { const [a, m] = iso.split("-"); return { chave: `${a}-${m}`, rotulo: `${MESES[Number(m) - 1]}/${a}` }; }
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = domingo
  const inicio = somarDias(iso, -((dow + 6) % 7));
  return { chave: inicio, rotulo: `${formatarData(inicio).slice(0, 5)} a ${formatarData(somarDias(inicio, 6)).slice(0, 5)}` };
}

const fimDoMes = (iso) => somarDias(somarMeses(`${iso.slice(0, 8)}01`, 1), -1);
const PERIODOS = {
  mes: { rotulo: "Este mês", calc: (h) => ({ de: `${h.slice(0, 8)}01`, ate: fimDoMes(h) }) },
  tres: { rotulo: "Próximos 3 meses", calc: (h) => ({ de: `${h.slice(0, 8)}01`, ate: fimDoMes(somarMeses(`${h.slice(0, 8)}01`, 2)) }) },
  seis: { rotulo: "Próximos 6 meses", calc: (h) => ({ de: `${h.slice(0, 8)}01`, ate: fimDoMes(somarMeses(`${h.slice(0, 8)}01`, 5)) }) },
  ano: { rotulo: "Este ano", calc: (h) => ({ de: `${h.slice(0, 4)}-01-01`, ate: `${h.slice(0, 4)}-12-31` }) },
};

const COLUNAS = {
  periodo: (g) => g.chave,
  entradas: (g) => g.entradas,
  saidas: (g) => g.saidas,
  receber: (g) => g.receber,
  pagar: (g) => g.pagar,
  resultado: (g) => g.resultado,
  saldo: (g) => g.saldo,
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

const moedaOuVazio = (v) => (v ? formatarMoeda(v) : <span className="muted">—</span>);

export default function FluxoCaixa({ cadastros }) {
  const hoje = hojeISO();
  const [filtros, setFiltros] = useState(() => ({ conta: "", periodo: "tres", ...PERIODOS.tres.calc(hoje), agrupar: "mes", atrasados: true }));
  const [resultado, setResultado] = useState({ chave: null, dados: null, erro: "" });
  const [aberto, setAberto] = useState(null);
  const periodoOk = filtros.de && filtros.ate && filtros.de <= filtros.ate;
  const contaIds = useMemo(() => (filtros.conta ? [Number(filtros.conta)] : cadastros.caixas.map((c) => c.id)), [filtros.conta, cadastros.caixas]);

  const chave = periodoOk && contaIds.length ? `${contaIds.join(",")}|${filtros.de}|${filtros.ate}` : null;
  useEffect(() => {
    if (!chave) return undefined;
    let ativo = true;
    carregarFluxo(contaIds, { de: filtros.de, ate: filtros.ate })
      .then((d) => { if (ativo) setResultado({ chave, dados: d, erro: "" }); })
      .catch((e) => { if (ativo) setResultado({ chave, dados: null, erro: mensagemErro(e) }); });
    return () => { ativo = false; };
  }, [chave]); // eslint-disable-line react-hooks/exhaustive-deps -- contaIds e o período já estão na chave
  const dados = resultado.chave === chave ? resultado.dados : null;
  const carregando = Boolean(chave) && resultado.chave !== chave;

  // Monta os lançamentos (realizados e previstos) e agrupa.
  const calc = useMemo(() => {
    if (!dados) return null;
    const todas = !filtros.conta;
    const conta = Number(filtros.conta);
    const itens = [];
    // Realizado: vendo todas as contas, transferência entre elas não é entrada nem saída da igreja.
    for (const l of dados.linhas) {
      if (todas && TRANSFERENCIAS.has(l.origem)) continue;
      itens.push({ data: l.data, descricao: l.descricao, tipo: ORIGENS_EXTRATO[l.origem] ?? l.origem, previsto: false, centavos: paraCentavos(l.valor) });
    }
    // Previsto: títulos em aberto. Vencido vai para hoje (se o período inclui hoje); filtrando uma conta, só os que têm essa conta prevista.
    let semConta = 0;
    let atrasados = 0;
    const previsto = (t, sinal) => {
      if (!todas && t.conta_caixa_id !== conta) { if (!t.conta_caixa_id) semConta += 1; return; }
      let data = t.vencimento;
      if (data < hoje) {
        if (!filtros.atrasados) return;
        atrasados += 1;
        data = hoje < filtros.de ? filtros.de : hoje;
      }
      if (data < filtros.de || data > filtros.ate) return;
      itens.push({
        data, descricao: `${t.descricao} — parcela ${t.parcela}/${t.total_parcelas} · ${t.fornecedor_nome}`, previsto: true, atrasado: t.vencimento < hoje,
        vencimento: t.vencimento, tipo: sinal > 0 ? "A receber" : "A pagar", centavos: sinal * paraCentavos(t.valor),
      });
    };
    dados.receber.forEach((t) => previsto(t, 1));
    dados.pagar.forEach((t) => previsto(t, -1));
    itens.sort((a, b) => a.data.localeCompare(b.data) || Number(a.previsto) - Number(b.previsto));

    const mapa = new Map();
    for (const i of itens) {
      const g = grupoDe(i.data, filtros.agrupar);
      if (!mapa.has(g.chave)) mapa.set(g.chave, { ...g, ent: 0, sai: 0, rec: 0, pag: 0, itens: [] });
      const x = mapa.get(g.chave);
      if (i.previsto) { if (i.centavos > 0) x.rec += i.centavos; else x.pag -= i.centavos; } else if (i.centavos > 0) x.ent += i.centavos; else x.sai -= i.centavos;
      x.itens.push(i);
    }
    let saldo = paraCentavos(dados.saldoInicial);
    let menor = null;
    const grupos = [...mapa.values()].sort((a, b) => a.chave.localeCompare(b.chave)).map((g) => {
      const res = g.ent + g.rec - g.sai - g.pag;
      saldo += res;
      if (saldo < 0 && !menor) menor = { rotulo: g.rotulo, saldo: deCentavos(saldo) };
      return { chave: g.chave, rotulo: g.rotulo, itens: g.itens, entradas: deCentavos(g.ent), saidas: deCentavos(g.sai), receber: deCentavos(g.rec), pagar: deCentavos(g.pag), resultado: deCentavos(res), saldo: deCentavos(saldo) };
    });
    const soma = (k) => deCentavos(grupos.reduce((a, g) => a + paraCentavos(g[k]), 0));
    return { grupos, semConta, atrasados, primeiroNegativo: menor, totais: { entradas: soma("entradas"), saidas: soma("saidas"), receber: soma("receber"), pagar: soma("pagar") }, saldoFinal: deCentavos(saldo) };
  }, [dados, filtros, hoje]);

  const ordenacao = useOrdenacao(calc?.grupos ?? [], COLUNAS, { chave: "periodo", dir: "asc" });
  const set = (k) => (e) => setFiltros((p) => ({ ...p, [k]: e.target.value, ...(k === "de" || k === "ate" ? { periodo: "" } : {}) }));
  const escolherPeriodo = (id) => setFiltros((p) => ({ ...p, periodo: id, ...(PERIODOS[id]?.calc(hoje) ?? {}) }));
  const erro = resultado.chave === chave ? resultado.erro : "";

  return (
    <div>
      <div className="page-header">
        <Header title="Fluxo de caixa" subtitle="O que já entrou e saiu das contas caixa (realizado) e o que está previsto pelas contas a pagar e a receber em aberto, com o saldo acumulado. Dízimos e ofertas entram só quando registrados, porque não têm previsão." />
      </div>

      {calc && (
        <div className="stat-grid">
          <Indicador icone="relogio" tom="neutro" rotulo="Saldo no início" valor={formatarMoeda(dados.saldoInicial)} sub={`ao fim de ${formatarData(somarDias(filtros.de, -1))}`} />
          <Indicador icone="seta" rotulo="Entradas" valor={formatarMoeda(calc.totais.entradas + calc.totais.receber)} sub={`${formatarMoeda(calc.totais.entradas)} realizadas · ${formatarMoeda(calc.totais.receber)} a receber`} />
          <Indicador icone="carteira" tom={calc.totais.saidas + calc.totais.pagar ? "alerta" : "neutro"} rotulo="Saídas" valor={formatarMoeda(calc.totais.saidas + calc.totais.pagar)} sub={`${formatarMoeda(calc.totais.saidas)} realizadas · ${formatarMoeda(calc.totais.pagar)} a pagar`} />
          <Indicador icone="check" tom={calc.saldoFinal < 0 ? "perigo" : ""} rotulo="Saldo previsto no fim" valor={formatarMoeda(calc.saldoFinal)} sub={`em ${formatarData(filtros.ate)}`} />
        </div>
      )}

      {calc?.primeiroNegativo && (
        <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}>
          <Icone nome="alerta" tamanho={16} />
          <span>O saldo fica negativo em <strong>{calc.primeiroNegativo.rotulo}</strong> ({formatarMoeda(calc.primeiroNegativo.saldo)}). Veja as contas a pagar desse período ou programe uma entrada.</span>
        </div>
      )}
      {erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}

      <div className="card">
        <div className="toolbar">
          <label>Conta caixa
            <select value={filtros.conta} onChange={set("conta")} style={{ ...inp, width: 210 }}>
              <option value="">Todas as contas</option>
              {cadastros.caixas.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.ativo ? "" : " (inativa)"}</option>)}
            </select>
          </label>
          <label>Período
            <select value={filtros.periodo} onChange={(e) => escolherPeriodo(e.target.value)} style={{ ...inp, width: 180 }}>
              {Object.entries(PERIODOS).map(([v, p]) => <option key={v} value={v}>{p.rotulo}</option>)}
              <option value="">Personalizado</option>
            </select>
          </label>
          <label>De
            <input type="date" value={filtros.de} onChange={set("de")} style={{ ...inp, width: 156 }} />
          </label>
          <label>até
            <input type="date" value={filtros.ate} onChange={set("ate")} style={{ ...inp, width: 156 }} />
          </label>
          <label>Agrupar por
            <select value={filtros.agrupar} onChange={set("agrupar")} style={{ ...inp, width: 120 }}>
              {Object.entries(AGRUPAR).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </select>
          </label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-end", paddingBottom: 9 }}>
            <input type="checkbox" checked={filtros.atrasados} onChange={(e) => setFiltros((p) => ({ ...p, atrasados: e.target.checked }))} />
            <span>Incluir vencidos em aberto</span>
          </label>
        </div>
        {!periodoOk && <div className="alert alert-warn" style={{ margin: "0 16px 12px" }}><Icone nome="alerta" tamanho={16} /><span>Informe um período válido (a data inicial não pode ser depois da final).</span></div>}
        {calc && (calc.atrasados > 0 || calc.semConta > 0) && (
          <div className="muted" style={{ fontSize: 12.5, padding: "0 16px 10px" }}>
            {calc.atrasados > 0 && <>{calc.atrasados} título(s) vencido(s) em aberto entraram em {formatarData(hoje < filtros.de ? filtros.de : hoje)}. </>}
            {calc.semConta > 0 && <>{calc.semConta} título(s) em aberto sem conta caixa prevista só aparecem em “Todas as contas”.</>}
          </div>
        )}

        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <ThOrdenavel chave="periodo" ordenacao={ordenacao}>{AGRUPAR[filtros.agrupar]}</ThOrdenavel>
              <ThOrdenavel chave="entradas" ordenacao={ordenacao} className="num">Entradas</ThOrdenavel>
              <ThOrdenavel chave="saidas" ordenacao={ordenacao} className="num">Saídas</ThOrdenavel>
              <ThOrdenavel chave="receber" ordenacao={ordenacao} className="num">A receber</ThOrdenavel>
              <ThOrdenavel chave="pagar" ordenacao={ordenacao} className="num">A pagar</ThOrdenavel>
              <ThOrdenavel chave="resultado" ordenacao={ordenacao} className="num">Resultado</ThOrdenavel>
              <ThOrdenavel chave="saldo" ordenacao={ordenacao} className="num">Saldo</ThOrdenavel>
              <th className="acoes"><span className="sr-only">Detalhes</span></th>
            </tr></thead>
            <tbody>
              {carregando && !dados && <tr><td className="vazio" colSpan={8}>Carregando...</td></tr>}
              {contaIds.length === 0 && <tr><td className="vazio" colSpan={8}>Cadastre uma conta caixa em Parâmetros → Financeiro → Contas caixa.</td></tr>}
              {calc && calc.grupos.length === 0 && <tr><td className="vazio" colSpan={8}>Nada realizado nem previsto neste período.</td></tr>}
              {ordenacao.ordenadas.map((g) => (
                <Fragment key={g.chave}>
                  <tr className="clicavel" tabIndex={0} onClick={() => setAberto(aberto === g.chave ? null : g.chave)} onKeyDown={(e) => { if (e.key === "Enter") setAberto(aberto === g.chave ? null : g.chave); }}>
                    <td style={{ fontWeight: 550 }}>{g.rotulo}</td>
                    <td className="num" style={{ color: g.entradas ? "var(--ok-text)" : undefined }}>{moedaOuVazio(g.entradas)}</td>
                    <td className="num" style={{ color: g.saidas ? "var(--danger-text)" : undefined }}>{moedaOuVazio(g.saidas)}</td>
                    <td className="num" style={{ color: g.receber ? "var(--ok-text)" : undefined, fontStyle: "italic" }}>{moedaOuVazio(g.receber)}</td>
                    <td className="num" style={{ color: g.pagar ? "var(--danger-text)" : undefined, fontStyle: "italic" }}>{moedaOuVazio(g.pagar)}</td>
                    <td className="num" style={{ fontWeight: 550, color: g.resultado < 0 ? "var(--danger-text)" : undefined }}>{formatarMoeda(g.resultado)}</td>
                    <td className="num" style={{ fontWeight: 650, color: g.saldo < 0 ? "var(--danger)" : undefined }}>{formatarMoeda(g.saldo)}</td>
                    <td className="acoes"><Icone nome="chevronBaixo" tamanho={16} style={{ transform: aberto === g.chave ? "rotate(180deg)" : "none", transition: "transform .15s", color: "var(--muted)" }} /></td>
                  </tr>
                  {aberto === g.chave && (
                    <tr><td colSpan={8} style={{ background: "var(--surface-2)", whiteSpace: "normal" }}>
                      <table className="parcelas">
                        <thead><tr><th>Data</th><th>Lançamento</th><th>Tipo</th><th className="num">Valor</th></tr></thead>
                        <tbody>{g.itens.map((i, n) => (
                          <tr key={n}>
                            <td>{formatarData(i.data)}{i.atrasado && <div style={{ fontSize: 11.5, color: "var(--danger)" }}>venceu {formatarData(i.vencimento)}</div>}</td>
                            <td style={{ whiteSpace: "normal" }}>{i.descricao}</td>
                            <td>{i.previsto ? <Pill tone={i.atrasado ? "danger" : "warn"}>{i.tipo} (previsto)</Pill> : <Pill tone={i.centavos > 0 ? "ok" : "neutral"}>{i.tipo}</Pill>}</td>
                            <td className="num" style={{ fontWeight: 550, color: i.centavos < 0 ? "var(--danger-text)" : "var(--ok-text)" }}>{formatarMoeda(deCentavos(i.centavos))}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {calc && calc.grupos.length > 0 && (
          <div className="table-footer">
            <span>Entradas e saídas = realizado · <em>A receber</em> e <em>A pagar</em> = previsto (em aberto){!filtros.conta && " · transferências entre as contas não contam"}</span>
            <span>Saldo previsto no fim: <strong style={{ color: calc.saldoFinal < 0 ? "var(--danger)" : undefined }}>{formatarMoeda(calc.saldoFinal)}</strong></span>
          </div>
        )}
      </div>
    </div>
  );
}
