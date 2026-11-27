import { useState } from "react";
import { Header, Pill } from "../ui";
import Icone from "./Icone";
import { Indicador } from "./ContasPagar";
import { useCarga } from "./useCarga";
import { carregarPainel, carregarOrcamento, listarFechamentos } from "./db";
import { juntarOrcamento, medirLinha } from "./calculoOrcamento";
import { formatarMoeda, formatarData, hojeISO, paraCentavos, deCentavos } from "./format";
import { somarDias, somarMeses } from "./financeiro";

// Financeiro → Painel: a tela de abertura do tesoureiro. Mostra o saldo das contas caixa, o que vence
// (vencido, hoje e nos próximos 7 dias, a pagar e a receber), as entradas e saídas do mês comparadas com
// o mesmo período do mês anterior e o que está pendente (dias sem conciliar, notas em rascunho). Só lê.

const DIAS_AGENDA = 7;
const MAX_AGENDA = 6;
const DIAS_ALERTA_CONCILIACAO = 7;
const TRANSFERENCIAS = new Set(["transferencia_saida", "transferencia_entrada"]);
const LINHAS_ENTRADA = [
  { id: "dizimo", rotulo: "Dízimos" }, { id: "oferta", rotulo: "Ofertas" }, { id: "campanha", rotulo: "Campanhas" },
  { id: "recebimento", rotulo: "Recebimentos" }, { id: "avulsa", rotulo: "Entradas avulsas" },
];
const LINHAS_SAIDA = [{ id: "pagamento", rotulo: "Pagamentos" }, { id: "saida", rotulo: "Saídas avulsas" }];

const diasEntre = (de, ate) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000);
const moeda = (c) => formatarMoeda(deCentavos(c));

// Categoria de uma linha do extrato (null = transferência, não conta como entrada nem saída).
function categoria(l) {
  if (TRANSFERENCIAS.has(l.origem)) return null;
  if (l.origem === "entrada") return l.subtipo === "dizimo" || l.subtipo === "campanha" ? l.subtipo : "oferta"; // "outra" (antiga) conta como oferta
  if (l.origem === "entrada_avulsa") return "avulsa";
  return l.origem; // recebimento, pagamento, saida
}

function somarPeriodo(linhas, de, ate) {
  const r = {};
  for (const l of linhas) {
    if (l.data < de || l.data > ate) continue;
    const k = categoria(l);
    if (k) r[k] = (r[k] ?? 0) + Math.abs(paraCentavos(l.valor));
  }
  return r;
}

function Variacao({ atual, anterior, inverter = false }) {
  if (!anterior) return atual ? <span className="rel-var">novo</span> : null;
  const pct = Math.round(((atual - anterior) / anterior) * 100);
  if (pct === 0) return <span className="rel-var">igual</span>;
  const bom = inverter ? pct < 0 : pct > 0;
  return <span className={`rel-var ${bom ? "rel-pos" : "rel-neg"}`}>{pct > 0 ? "+" : ""}{pct}%</span>;
}

// Uma coluna da agenda: vencidos, hoje e próximos dias de um lado (pagar ou receber).
function Agenda({ titulo, href, titulos, hoje, rotuloAcao }) {
  const limite = somarDias(hoje, DIAS_AGENDA);
  const grupos = [
    { id: "vencido", rotulo: "Vencidos", tom: "danger", itens: titulos.filter((t) => t.vencimento < hoje) },
    { id: "hoje", rotulo: "Vencem hoje", tom: "warn", itens: titulos.filter((t) => t.vencimento === hoje) },
    { id: "semana", rotulo: `Próximos ${DIAS_AGENDA} dias`, tom: "neutral", itens: titulos.filter((t) => t.vencimento > hoje && t.vencimento <= limite) },
  ];
  const nada = grupos.every((g) => g.itens.length === 0);
  return (
    <section className="card painel-bloco">
      <div className="painel-cab">
        <h3>{titulo}</h3>
        <a className="btn btn-ghost btn-sm" href={href}>{rotuloAcao} <Icone nome="seta" tamanho={14} /></a>
      </div>
      {nada && <p className="painel-vazio"><Icone nome="check" tamanho={16} /> Nada vencido nem vencendo nos próximos {DIAS_AGENDA} dias.</p>}
      {grupos.filter((g) => g.itens.length).map((g) => {
        const total = g.itens.reduce((a, t) => a + paraCentavos(t.valor), 0);
        return (
          <div key={g.id} className="painel-grupo">
            <div className="painel-grupo-cab">
              <Pill tone={g.tom}>{g.rotulo} · {g.itens.length}</Pill>
              <strong>{moeda(total)}</strong>
            </div>
            <ul className="painel-lista">
              {g.itens.slice(0, MAX_AGENDA).map((t) => (
                <li key={t.id}>
                  <span className="painel-data">{formatarData(t.vencimento).slice(0, 5)}</span>
                  <span className="painel-desc">
                    {t.fornecedor_nome}
                    <small>{t.descricao}{t.total_parcelas > 1 ? ` · ${t.parcela}/${t.total_parcelas}` : ""}{t.conta_fixa_id ? " · fixa" : ""}</small>
                  </span>
                  <span className="painel-valor">{formatarMoeda(t.valor)}</span>
                </li>
              ))}
            </ul>
            {g.itens.length > MAX_AGENDA && <a className="painel-mais" href={href}>e mais {g.itens.length - MAX_AGENDA}…</a>}
          </div>
        );
      })}
    </section>
  );
}

export default function PainelFinanceiro({ cadastros }) {
  const [versao, setVersao] = useState(0);
  const hoje = hojeISO();
  const inicioMes = `${hoje.slice(0, 7)}-01`;
  const inicioAnt = somarMeses(inicioMes, -1);
  const mesmoDiaAnt = somarMeses(hoje, -1); // dia 31 vira o último dia do mês anterior
  const contas = cadastros.caixas.filter((c) => c.ativo);
  const ids = contas.map((c) => c.id);
  const dados = useCarga(`painel|${hoje}|${ids.join(",")}|${versao}`, () => carregarPainel(ids, { deAnt: inicioAnt, ate: hoje }));
  const d = dados.dados;
  // Orçamento do ano (v23): centros que já passaram do orçado (pago + a pagar). Sem orçamento (ou sem a v23), nada aparece.
  const anoAtual = Number(hoje.slice(0, 4));
  const orc = useCarga(`painel-orc|${anoAtual}|${versao}`, () => carregarOrcamento(anoAtual));
  // Fechamento do mês (v24): avisa se o mês passado ainda não foi fechado (sem a v24, nada aparece).
  const fechs = useCarga(`painel-fech|${versao}`, () => listarFechamentos().catch(() => null));
  const mesPassado = inicioAnt;
  const mesPassadoAberto = Array.isArray(fechs.dados) && !fechs.dados.some((f) => !f.reaberto && f.mes >= mesPassado);
  const estourados = orc.dados
    ? [...juntarOrcamento(orc.dados.orcamentos, orc.dados.realizado).values()].filter((l) => l.natureza === "despesa" && medirLinha(l, 12).situacao === "estourado")
    : [];

  const saldoTotal = contas.reduce((a, c) => a + paraCentavos(c.saldo_atual), 0);
  const atual = d ? somarPeriodo(d.linhas, inicioMes, hoje) : {};
  const anterior = d ? somarPeriodo(d.linhas, inicioAnt, mesmoDiaAnt) : {};
  const soma = (r, linhas) => linhas.reduce((a, l) => a + (r[l.id] ?? 0), 0);
  const entAtual = soma(atual, LINHAS_ENTRADA);
  const saiAtual = soma(atual, LINHAS_SAIDA);
  const entAnt = soma(anterior, LINHAS_ENTRADA);
  const saiAnt = soma(anterior, LINHAS_SAIDA);
  const resultado = entAtual - saiAtual;

  const limite = somarDias(hoje, DIAS_AGENDA);
  const resumoLado = (lista) => {
    const prox = (lista || []).filter((t) => t.vencimento <= limite);
    const venc = prox.filter((t) => t.vencimento < hoje);
    return { qtd: prox.length, valor: prox.reduce((a, t) => a + paraCentavos(t.valor), 0), vencidos: venc.length, valorVencidos: venc.reduce((a, t) => a + paraCentavos(t.valor), 0) };
  };
  const rp = resumoLado(d?.pagar);
  const rr = resumoLado(d?.receber);

  const conciliacao = contas.map((c) => {
    const ate = d?.conciliadoAte?.[c.id] ?? null;
    const dias = ate ? diasEntre(ate, hoje) : null;
    return { conta: c, ate, dias, atrasada: ate === null || dias > DIAS_ALERTA_CONCILIACAO };
  });
  const pendencias = [
    ...(d && d.rascunhos ? [{ id: "rascunhos", texto: `${d.rascunhos} nota(s) de entrada em rascunho aguardando aprovação`, href: "#/administrativo/notas" }] : []),
    ...(d ? conciliacao.filter((x) => x.atrasada).map((x) => ({
      id: `conc-${x.conta.id}`,
      texto: x.ate ? `${x.conta.nome}: conciliada até ${formatarData(x.ate)} (${x.dias} dias sem conciliar)` : `${x.conta.nome}: nunca foi conciliada`,
      href: "#/financeiro/caixa/conciliacao",
    })) : []),
    ...(rp.vencidos ? [{ id: "venc-pagar", texto: `${rp.vencidos} conta(s) a pagar vencida(s), ${moeda(rp.valorVencidos)}`, href: "#/financeiro/lancamentos/pagar/vencido" }] : []),
    ...(mesPassadoAberto ? [{ id: "fechamento", texto: `O mês de ${new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(new Date(`${mesPassado}T12:00:00Z`))} ainda não foi fechado`, href: "#/financeiro/caixa/fechamento" }] : []),
    ...(estourados.length ? [{
      id: "orcamento",
      texto: `${estourados.length === 1 ? "1 centro de custo passou" : `${estourados.length} centros de custo passaram`} do orçado de ${anoAtual}: ${estourados.map((l) => cadastros.centros.find((c) => c.id === l.id)?.nome ?? l.id).join(", ")}`,
      href: "#/financeiro/orcamento",
    }] : []),
    ...(rr.vencidos ? [{ id: "venc-receber", texto: `${rr.vencidos} conta(s) a receber vencida(s), ${moeda(rr.valorVencidos)}`, href: "#/financeiro/lancamentos/receber/vencido" }] : []),
  ];
  const nomeMesAtual = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(new Date(`${inicioMes}T12:00:00Z`));
  const nomeMesAnt = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(new Date(`${inicioAnt}T12:00:00Z`));
  const diaHoje = Number(hoje.slice(8, 10));
  const periodoAnt = `1 a ${Number(mesmoDiaAnt.slice(8, 10))} de ${nomeMesAnt}`;

  return (
    <div>
      <div className="page-header">
        <Header title="Painel do Financeiro" subtitle={`Resumo de hoje, ${formatarData(hoje)}: saldos, o que vence nos próximos ${DIAS_AGENDA} dias, entradas e saídas do mês e o que está pendente.`} />
        <button className="btn btn-ghost" onClick={() => setVersao((v) => v + 1)} disabled={dados.carregando}><Icone nome="relogio" tamanho={16} /> Atualizar</button>
      </div>

      {dados.erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{dados.erro}</span></div>}

      <div className="stat-grid">
        <Indicador icone="carteira" rotulo="Saldo em caixa" valor={moeda(saldoTotal)} sub={`${contas.length} conta(s) ativa(s)`} />
        <Indicador icone="alerta" tom={rp.vencidos ? "perigo" : rp.qtd ? "alerta" : "neutro"} rotulo={`A pagar em ${DIAS_AGENDA} dias`} valor={d ? moeda(rp.valor) : "…"}
          sub={d ? `${rp.qtd} conta(s)${rp.vencidos ? `, ${rp.vencidos} vencida(s)` : ""}` : null} />
        <Indicador icone="relogio" tom={rr.vencidos ? "alerta" : "neutro"} rotulo={`A receber em ${DIAS_AGENDA} dias`} valor={d ? moeda(rr.valor) : "…"}
          sub={d ? `${rr.qtd} conta(s)${rr.vencidos ? `, ${rr.vencidos} vencida(s)` : ""}` : null} />
        <Indicador icone="grafico" tom={resultado < 0 ? "perigo" : ""} rotulo={`Resultado de ${nomeMesAtual}`} valor={d ? moeda(resultado) : "…"}
          sub={d ? `${moeda(entAtual)} entraram, ${moeda(saiAtual)} saíram` : null} />
      </div>

      {pendencias.length > 0 && (
        <section className="card painel-bloco painel-pendencias">
          <div className="painel-cab"><h3>Pendências</h3></div>
          <ul>
            {pendencias.map((p) => (
              <li key={p.id}><Icone nome="alerta" tamanho={15} /><a href={p.href}>{p.texto}</a></li>
            ))}
          </ul>
        </section>
      )}

      {!d && !dados.erro && <div className="carregando-linha"><div className="spinner" /> Carregando...</div>}

      {d && (
        <>
          <div className="painel-grid">
            <Agenda titulo="Contas a pagar" href="#/financeiro/lancamentos/pagar" titulos={d.pagar} hoje={hoje} rotuloAcao="Abrir" />
            <Agenda titulo="Contas a receber" href="#/financeiro/lancamentos/receber" titulos={d.receber} hoje={hoje} rotuloAcao="Abrir" />
          </div>

          <div className="painel-grid">
            <section className="card painel-bloco">
              <div className="painel-cab">
                <h3>Movimento de {nomeMesAtual}</h3>
                <a className="btn btn-ghost btn-sm" href="#/financeiro/caixa/relatorio">Relatório do mês <Icone nome="seta" tamanho={14} /></a>
              </div>
              <table className="rel-tabela">
                <thead><tr><th /><th className="num">1 a {diaHoje} de {nomeMesAtual}</th><th className="num">{periodoAnt}</th></tr></thead>
                <tbody>
                  {LINHAS_ENTRADA.filter((l) => atual[l.id] || anterior[l.id]).map((l) => (
                    <tr key={l.id}><td>{l.rotulo}</td><td className="num">{moeda(atual[l.id] ?? 0)}<Variacao atual={atual[l.id] ?? 0} anterior={anterior[l.id] ?? 0} /></td><td className="num">{moeda(anterior[l.id] ?? 0)}</td></tr>
                  ))}
                  <tr className="rel-grupo"><td>Total de entradas</td><td className="num">{moeda(entAtual)}<Variacao atual={entAtual} anterior={entAnt} /></td><td className="num">{moeda(entAnt)}</td></tr>
                  {LINHAS_SAIDA.filter((l) => atual[l.id] || anterior[l.id]).map((l) => (
                    <tr key={l.id}><td>{l.rotulo}</td><td className="num">{moeda(atual[l.id] ?? 0)}<Variacao atual={atual[l.id] ?? 0} anterior={anterior[l.id] ?? 0} inverter /></td><td className="num">{moeda(anterior[l.id] ?? 0)}</td></tr>
                  ))}
                  <tr className="rel-grupo"><td>Total de saídas</td><td className="num">{moeda(saiAtual)}<Variacao atual={saiAtual} anterior={saiAnt} inverter /></td><td className="num">{moeda(saiAnt)}</td></tr>
                </tbody>
                <tfoot><tr>
                  <td>Resultado</td>
                  <td className={`num ${resultado < 0 ? "rel-neg" : "rel-pos"}`}>{moeda(resultado)}</td>
                  <td className={`num ${entAnt - saiAnt < 0 ? "rel-neg" : "rel-pos"}`}>{moeda(entAnt - saiAnt)}</td>
                </tr></tfoot>
              </table>
              <p className="rel-nota">Compara com os mesmos dias do mês anterior. Transferências entre contas não entram.</p>
            </section>

            <section className="card painel-bloco">
              <div className="painel-cab">
                <h3>Contas caixa</h3>
                <a className="btn btn-ghost btn-sm" href="#/financeiro/caixa/extrato">Extrato <Icone nome="seta" tamanho={14} /></a>
              </div>
              {contas.length === 0 && <p className="painel-vazio">Nenhuma conta caixa ativa. Cadastre em Parâmetros → Financeiro.</p>}
              {contas.length > 0 && (
                <table className="rel-tabela">
                  <thead><tr><th>Conta</th><th className="num">Saldo</th><th>Conciliada até</th></tr></thead>
                  <tbody>
                    {conciliacao.map(({ conta: c, ate, dias, atrasada }) => (
                      <tr key={c.id}>
                        <td>{c.nome}</td>
                        <td className={`num${Number(c.saldo_atual) < 0 ? " rel-neg" : ""}`}>{formatarMoeda(c.saldo_atual)}</td>
                        <td>{ate
                          ? <Pill tone={atrasada ? "warn" : "ok"}>{formatarData(ate)}{dias > 0 ? ` · ${dias} dia(s)` : ""}</Pill>
                          : <Pill tone="warn">Nunca</Pill>}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td>Total</td><td className="num">{moeda(saldoTotal)}</td><td /></tr></tfoot>
                </table>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
