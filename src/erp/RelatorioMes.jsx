import { Fragment, useEffect, useMemo, useState } from "react";
import { Header } from "../ui";
import { inp } from "../estilos";
import Icone from "./Icone";
import { carregarRelatorioMes, mensagemErro } from "./db";
import { exportarParaContador } from "./exportarContador";
import { formatarMoeda, formatarData, hojeISO, paraCentavos, deCentavos } from "./format";
import { ORIGENS_EXTRATO, somarDias, somarMeses } from "./financeiro";

// Relatório do mês = prestação de contas que o tesoureiro apresenta ao conselho: saldos de cada conta,
// entradas por categoria, saídas por centro de custo (com os maiores fornecedores), o que ficou em aberto,
// campanhas e espaço para assinaturas. Compara com o mês anterior. Não grava nada; imprime ou salva em PDF.

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const TRANSFERENCIAS = new Set(["transferencia_saida", "transferencia_entrada"]);
const SEM_CENTRO = "sem";
const MAX_FORNECEDORES = 5;
const ORDEM_ENTRADA = { dizimo: 1, oferta: 2, campanha: 3, recebimento: 4, entrada_avulsa: 5, outra: 6 };

const nomeMes = (ym) => `${MESES[Number(ym.slice(5, 7)) - 1]} de ${ym.slice(0, 4)}`;
const primeiroDia = (ym) => `${ym}-01`;
const ultimoDia = (ym) => somarDias(somarMeses(primeiroDia(ym), 1), -1);
const mesMais = (ym, n) => somarMeses(primeiroDia(ym), n).slice(0, 7);

// Soma os lançamentos de um período em categorias. lk = mapas de detalhes (entradas, pagamentos, movimentos).
function resumir(linhas, lk) {
  const entradas = new Map();
  const saidas = new Map();
  const contas = new Map();
  const somaEm = (mapa, chave, base, c) => {
    if (!mapa.has(chave)) mapa.set(chave, { ...base, c: 0 });
    mapa.get(chave).c += c;
    return mapa.get(chave);
  };
  for (const l of linhas) {
    const c = paraCentavos(l.valor);
    const conta = somaEm(contas, l.conta_caixa_id, { ent: 0, sai: 0, transf: 0 }, 0);
    if (TRANSFERENCIAS.has(l.origem)) { conta.transf += c; continue; }
    if (c > 0) conta.ent += c; else conta.sai -= c;

    if (l.origem === "entrada") {
      const e = lk.entradas.get(l.ref_id);
      const tipo = e?.tipo ?? l.subtipo;
      if (tipo === "campanha") somaEm(entradas, `campanha:${e?.campanha_id ?? "?"}`, { ordem: ORDEM_ENTRADA.campanha, rotulo: `Campanha — ${e?.campanha_nome ?? "sem nome"}` }, c);
      else somaEm(entradas, tipo, { ordem: ORDEM_ENTRADA[tipo] ?? 9, rotulo: { dizimo: "Dízimos", oferta: "Ofertas", outra: "Outras entradas" }[tipo] ?? tipo }, c);
    } else if (l.origem === "recebimento") {
      somaEm(entradas, "recebimento", { ordem: ORDEM_ENTRADA.recebimento, rotulo: "Recebimentos (aluguéis, vendas e outras contas a receber)" }, c);
    } else if (l.origem === "entrada_avulsa") {
      somaEm(entradas, "entrada_avulsa", { ordem: ORDEM_ENTRADA.entrada_avulsa, rotulo: "Entradas avulsas" }, c);
    } else if (c < 0) {
      let centro = null;
      let quem = ORIGENS_EXTRATO[l.origem] ?? l.origem;
      let partes = null; // [{ centro, c }] quando o pagamento se divide pelos itens da nota
      if (l.origem === "pagamento") {
        const t = lk.pagos.get(l.ref_id);
        centro = t?.centro_custo_id ?? null;
        quem = t?.fornecedor_nome ?? "Pagamento";
        partes = dividirPorItens(-c, lk.itens.get(t?.documento_id), centro);
      }
      if (l.origem === "saida") { centro = lk.movimentos.get(l.ref_id)?.centro_custo_id ?? null; quem = "Saídas avulsas"; }
      for (const p of partes ?? [{ centro, c: -c }]) {
        const g = somaEm(saidas, p.centro ?? SEM_CENTRO, { filhos: new Map() }, p.c);
        g.filhos.set(quem, (g.filhos.get(quem) ?? 0) + p.c);
      }
    } else {
      somaEm(entradas, "outra", { ordem: ORDEM_ENTRADA.outra, rotulo: "Outras entradas" }, c);
    }
  }
  const total = (mapa) => [...mapa.values()].reduce((a, x) => a + x.c, 0);
  return { entradas, saidas, contas, totalEntradas: total(entradas), totalSaidas: total(saidas) };
}

// Divide um valor (centavos) pelos centros de custo dos itens da nota, na proporção do total de cada item.
// Item sem centro (notas de antes da v17) fica com o centro do título. A sobra de centavos vai para a maior parte.
function dividirPorItens(centavos, itens, centroTitulo) {
  if (!itens?.length) return null;
  const pesos = new Map();
  for (const i of itens) {
    const k = i.centro_custo_id ?? centroTitulo ?? null;
    pesos.set(k, (pesos.get(k) ?? 0) + paraCentavos(i.valor_total));
  }
  const total = [...pesos.values()].reduce((a, v) => a + v, 0);
  if (pesos.size < 2 || total <= 0) return [{ centro: [...pesos.keys()][0], c: centavos }];
  const partes = [...pesos.entries()].map(([centro, peso]) => ({ centro, c: Math.floor((centavos * peso) / total) }));
  const sobra = centavos - partes.reduce((a, p) => a + p.c, 0);
  partes.sort((a, b) => b.c - a.c)[0].c += sobra;
  return partes;
}

function Variacao({ atual, anterior }) {
  if (!anterior || !atual) return null;
  const pct = Math.round(((atual - anterior) / Math.abs(anterior)) * 100);
  if (!Number.isFinite(pct) || pct === 0) return null;
  return <span className="rel-var">{pct > 0 ? "▲" : "▼"} {Math.abs(pct)}%</span>;
}

const moeda = (c) => formatarMoeda(deCentavos(c));
const moedaOuTraco = (c) => (c ? moeda(c) : "—");

export default function RelatorioMes({ cadastros, perfil }) {
  const hoje = hojeISO();
  const [mes, setMes] = useState(() => mesMais(hoje.slice(0, 7), -1)); // padrão: o último mês fechado
  const [resultado, setResultado] = useState({ chave: null, dados: null, erro: "" });
  const [exportando, setExportando] = useState(false);
  const [erroExport, setErroExport] = useState("");
  const contaIds = useMemo(() => cadastros.caixas.map((c) => c.id), [cadastros.caixas]);

  const mesOk = /^\d{4}-\d{2}$/.test(mes);
  const periodo = mesOk ? { deAnt: primeiroDia(mesMais(mes, -1)), de: primeiroDia(mes), ate: ultimoDia(mes) } : null;
  const chave = periodo && contaIds.length ? `${contaIds.join(",")}|${mes}` : null;
  useEffect(() => {
    if (!chave) return undefined;
    let ativo = true;
    carregarRelatorioMes(contaIds, periodo)
      .then((d) => { if (ativo) setResultado({ chave, dados: d, erro: "" }); })
      .catch((e) => { if (ativo) setResultado({ chave, dados: null, erro: mensagemErro(e) }); });
    return () => { ativo = false; };
  }, [chave]); // eslint-disable-line react-hooks/exhaustive-deps -- contas e mês já estão na chave
  const dados = resultado.chave === chave ? resultado.dados : null;
  const erro = resultado.chave === chave ? resultado.erro : "";

  const rel = useMemo(() => {
    if (!dados || !periodo) return null;
    const lk = {
      entradas: new Map(dados.entradas.map((e) => [e.id, e])),
      pagos: new Map(dados.pagos.map((t) => [t.pagamento_id, t])),
      movimentos: new Map(dados.movimentos.map((m) => [m.id, m])),
      itens: dados.itensNotas.reduce((mapa, i) => mapa.set(i.documento_id, [...(mapa.get(i.documento_id) ?? []), i]), new Map()),
    };
    const atual = resumir(dados.linhas.filter((l) => l.data >= periodo.de), lk);
    const anterior = resumir(dados.linhas.filter((l) => l.data < periodo.de), lk);
    const nomeCentro = (id) => (id === SEM_CENTRO ? "Sem centro de custo" : cadastros.centros.find((c) => c.id === id)?.nome ?? `Centro ${id}`);

    const linhasEntrada = [...new Set([...atual.entradas.keys(), ...anterior.entradas.keys()])]
      .map((k) => { const x = atual.entradas.get(k) ?? anterior.entradas.get(k); return { chave: k, ordem: x.ordem, rotulo: x.rotulo, c: atual.entradas.get(k)?.c ?? 0, ant: anterior.entradas.get(k)?.c ?? 0 }; })
      .sort((a, b) => a.ordem - b.ordem || a.rotulo.localeCompare(b.rotulo));

    const linhasSaida = [...new Set([...atual.saidas.keys(), ...anterior.saidas.keys()])]
      .map((k) => {
        const filhos = [...(atual.saidas.get(k)?.filhos ?? new Map()).entries()].map(([nome, c]) => ({ nome, c })).sort((a, b) => b.c - a.c);
        const demais = filhos.slice(MAX_FORNECEDORES);
        return {
          chave: k, rotulo: nomeCentro(k), c: atual.saidas.get(k)?.c ?? 0, ant: anterior.saidas.get(k)?.c ?? 0,
          filhos: demais.length ? [...filhos.slice(0, MAX_FORNECEDORES), { nome: `Demais (${demais.length})`, c: demais.reduce((a, f) => a + f.c, 0) }] : filhos,
        };
      })
      .sort((a, b) => (a.chave === SEM_CENTRO) - (b.chave === SEM_CENTRO) || b.c - a.c || b.ant - a.ant);

    const contas = dados.saldos
      .map((s) => {
        const caixa = cadastros.caixas.find((c) => c.id === s.conta_caixa_id);
        const m = atual.contas.get(s.conta_caixa_id) ?? { ent: 0, sai: 0, transf: 0 };
        return { id: s.conta_caixa_id, nome: caixa?.nome ?? "?", ativo: caixa?.ativo, anterior: paraCentavos(s.anterior), final: paraCentavos(s.final), ...m };
      })
      .filter((c) => c.ativo || c.anterior || c.final || c.ent || c.sai || c.transf)
      .sort((a, b) => a.nome.localeCompare(b.nome));
    const somaContas = (k) => contas.reduce((a, c) => a + c[k], 0);

    const aberto = (lista) => ({
      c: lista.reduce((a, t) => a + paraCentavos(t.valor), 0), qtd: lista.length,
      vencidoC: lista.filter((t) => t.vencimento <= periodo.ate).reduce((a, t) => a + paraCentavos(t.valor), 0),
      vencidoQtd: lista.filter((t) => t.vencimento <= periodo.ate).length,
    });

    const noMes = new Map();
    for (const l of dados.linhas) {
      if (l.data < periodo.de || l.origem !== "entrada") continue;
      const e = lk.entradas.get(l.ref_id);
      if (e?.campanha_id) noMes.set(e.campanha_id, (noMes.get(e.campanha_id) ?? 0) + paraCentavos(l.valor));
    }
    const campanhas = cadastros.campanhas
      .filter((c) => noMes.has(c.id) || (c.ativo && (!c.data_inicio || c.data_inicio <= periodo.ate) && (!c.data_fim || c.data_fim >= periodo.de)))
      .map((c) => ({ id: c.id, nome: c.nome, mes: noMes.get(c.id) ?? 0, total: paraCentavos(c.arrecadado), meta: c.meta ? paraCentavos(c.meta) : null }))
      .sort((a, b) => b.mes - a.mes || a.nome.localeCompare(b.nome));

    return {
      atual, anterior, linhasEntrada, linhasSaida, contas, campanhas,
      totais: { anterior: somaContas("anterior"), final: somaContas("final"), ent: somaContas("ent"), sai: somaContas("sai"), transf: somaContas("transf") },
      pagar: aberto(dados.abertoPagar), receber: aberto(dados.abertoReceber),
      semCentro: atual.saidas.get(SEM_CENTRO)?.c ?? 0,
    };
  }, [dados, periodo?.de, cadastros.centros, cadastros.caixas, cadastros.campanhas]); // eslint-disable-line react-hooks/exhaustive-deps -- periodo deriva de mes

  const emAndamento = periodo && hoje >= periodo.de && hoje <= periodo.ate;
  const futuro = periodo && hoje < periodo.de;
  const resultadoMes = rel ? rel.atual.totalEntradas - rel.atual.totalSaidas : 0;
  const resultadoAnt = rel ? rel.anterior.totalEntradas - rel.anterior.totalSaidas : 0;
  const nomeUsuario = perfil?.nome || perfil?.email || "";

  return (
    <div>
      <div className="page-header no-print">
        <Header title="Relatório do mês" subtitle="Prestação de contas para o conselho fiscal ou a liderança: saldos, entradas por categoria, saídas por centro de custo, o que ficou em aberto e espaço para assinaturas. Imprima ou salve em PDF." />
      </div>

      <div className="card no-print" style={{ marginBottom: 16 }}>
        <div className="toolbar">
          <label>Mês
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setMes((m) => mesMais(m, -1))} disabled={!mesOk} aria-label="Mês anterior">‹</button>
              <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} style={{ ...inp, width: 170 }} />
              <button type="button" className="btn btn-ghost" onClick={() => setMes((m) => mesMais(m, 1))} disabled={!mesOk} aria-label="Próximo mês">›</button>
            </div>
          </label>
          <button type="button" className="btn btn-ghost" style={{ marginLeft: "auto", alignSelf: "flex-end" }} disabled={!periodo || exportando}
            title="Planilha do mês para o contador: resumo, extrato, pagamentos, recebimentos, entradas e movimentos"
            onClick={async () => {
              setErroExport(""); setExportando(true);
              try { await exportarParaContador({ de: periodo.de, ate: periodo.ate, cadastros, nomeIgreja: perfil?.empresa_nome }); }
              catch (e) { setErroExport(mensagemErro(e)); }
              finally { setExportando(false); }
            }}>
            <Icone nome="arquivo" tamanho={16} /> {exportando ? "Gerando..." : "Exportar para o contador (Excel)"}
          </button>
          <button type="button" className="btn btn-primary" style={{ alignSelf: "flex-end" }} onClick={() => window.print()} disabled={!rel}>
            <Icone nome="impressora" tamanho={16} /> Imprimir ou salvar PDF
          </button>
        </div>
        {erroExport && <div className="alert alert-danger" role="alert" style={{ margin: "0 16px 12px" }}><Icone nome="alerta" tamanho={16} /><span>{erroExport}</span></div>}
        {(emAndamento || futuro) && (
          <div className="alert alert-warn" style={{ margin: "0 16px 12px" }}>
            <Icone nome="alerta" tamanho={16} />
            <span>{futuro ? "Este mês ainda não começou." : "Mês em andamento: os valores vão só até hoje e ainda podem mudar."}</span>
          </div>
        )}
      </div>

      {erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
      {contaIds.length === 0 && <div className="card" style={{ padding: 24 }}>Cadastre uma conta caixa em Parâmetros → Financeiro → Contas caixa.</div>}
      {chave && !dados && !erro && <div className="carregando-linha"><div className="spinner" /> Carregando...</div>}

      {rel && (
        <article className="card relatorio-folha">
          <header className="rel-cabecalho">
            <div>
              <div className="rel-igreja">{perfil?.empresa_nome}</div>
              <h2 className="rel-titulo">Prestação de contas — {nomeMes(mes)}</h2>
              <div className="rel-sub">Período de {formatarData(periodo.de)} a {formatarData(periodo.ate)}{emAndamento ? " (mês em andamento)" : ""}</div>
            </div>
            <div className="rel-emissao">Emitido em {formatarData(hoje)}{nomeUsuario ? <><br />por {nomeUsuario}</> : null}</div>
          </header>

          <div className="rel-resumo">
            <div><span>Saldo anterior</span><strong>{moeda(rel.totais.anterior)}</strong></div>
            <div><span>Entradas</span><strong className="rel-pos">{moeda(rel.atual.totalEntradas)}</strong></div>
            <div><span>Saídas</span><strong className="rel-neg">{moeda(rel.atual.totalSaidas)}</strong></div>
            <div><span>Saldo final</span><strong>{moeda(rel.totais.final)}</strong></div>
          </div>

          <section className="rel-secao">
            <h3>1. Entradas</h3>
            <table className="rel-tabela">
              <thead><tr><th>Categoria</th><th className="num">{nomeMes(mes).split(" ")[0]}</th><th className="num">Mês anterior</th></tr></thead>
              <tbody>
                {rel.linhasEntrada.length === 0 && <tr><td colSpan={3} className="muted">Nenhuma entrada.</td></tr>}
                {rel.linhasEntrada.map((l) => (
                  <tr key={l.chave}><td>{l.rotulo}</td><td className="num">{moedaOuTraco(l.c)} <Variacao atual={l.c} anterior={l.ant} /></td><td className="num muted">{moedaOuTraco(l.ant)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><td>Total de entradas</td><td className="num">{moeda(rel.atual.totalEntradas)}</td><td className="num">{moeda(rel.anterior.totalEntradas)}</td></tr></tfoot>
            </table>
          </section>

          <section className="rel-secao">
            <h3>2. Saídas por centro de custo</h3>
            <table className="rel-tabela">
              <thead><tr><th>Centro de custo / maiores fornecedores</th><th className="num">{nomeMes(mes).split(" ")[0]}</th><th className="num">Mês anterior</th></tr></thead>
              <tbody>
                {rel.linhasSaida.length === 0 && <tr><td colSpan={3} className="muted">Nenhuma saída.</td></tr>}
                {rel.linhasSaida.map((g) => (
                  <Fragment key={g.chave}>
                    <tr className={`rel-grupo${g.chave === SEM_CENTRO ? " rel-sem-centro" : ""}`}>
                      <td>{g.rotulo}</td><td className="num">{moedaOuTraco(g.c)} <Variacao atual={g.c} anterior={g.ant} /></td><td className="num muted">{moedaOuTraco(g.ant)}</td>
                    </tr>
                    {g.filhos.map((f) => (
                      <tr key={f.nome} className="rel-filho"><td>{f.nome}</td><td className="num">{moeda(f.c)}</td><td /></tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
              <tfoot><tr><td>Total de saídas</td><td className="num">{moeda(rel.atual.totalSaidas)}</td><td className="num">{moeda(rel.anterior.totalSaidas)}</td></tr></tfoot>
            </table>
            {rel.semCentro > 0 && (
              <p className="rel-nota">{moeda(rel.semCentro)} em saídas sem centro de custo: notas antigas sem centro de custo ou saídas avulsas lançadas sem centro.</p>
            )}
          </section>

          <section className="rel-secao">
            <h3>3. Resultado do mês</h3>
            <table className="rel-tabela">
              <tbody>
                <tr><td>Entradas − saídas</td>
                  <td className={`num ${resultadoMes < 0 ? "rel-neg" : "rel-pos"}`} style={{ fontWeight: 650 }}>{moeda(resultadoMes)}</td>
                  <td className="num muted">{moeda(resultadoAnt)} no mês anterior</td></tr>
              </tbody>
            </table>
          </section>

          <section className="rel-secao">
            <h3>4. Saldo das contas</h3>
            <div className="table-wrap">
              <table className="rel-tabela">
                <thead><tr><th>Conta</th><th className="num">Saldo anterior</th><th className="num">Entradas</th><th className="num">Saídas</th><th className="num">Transferências</th><th className="num">Saldo final</th></tr></thead>
                <tbody>
                  {rel.contas.map((c) => (
                    <tr key={c.id}>
                      <td>{c.nome}{c.ativo ? "" : " (inativa)"}</td>
                      <td className="num">{moeda(c.anterior)}</td>
                      <td className="num">{moedaOuTraco(c.ent)}</td>
                      <td className="num">{c.sai ? moeda(-c.sai) : "—"}</td>
                      <td className="num">{moedaOuTraco(c.transf)}</td>
                      <td className="num" style={{ fontWeight: 650 }}>{moeda(c.final)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr>
                  <td>Total</td><td className="num">{moeda(rel.totais.anterior)}</td><td className="num">{moeda(rel.totais.ent)}</td>
                  <td className="num">{moeda(-rel.totais.sai)}</td><td className="num">{moedaOuTraco(rel.totais.transf)}</td><td className="num">{moeda(rel.totais.final)}</td>
                </tr></tfoot>
              </table>
            </div>
          </section>

          <section className="rel-secao">
            <h3>5. Em aberto em {formatarData(periodo.ate)}</h3>
            <table className="rel-tabela">
              <thead><tr><th /><th className="num">Total</th><th className="num">Já vencido</th></tr></thead>
              <tbody>
                <tr><td>Contas a pagar ({rel.pagar.qtd} parcela{rel.pagar.qtd === 1 ? "" : "s"})</td><td className="num">{moedaOuTraco(rel.pagar.c)}</td><td className={`num${rel.pagar.vencidoC ? " rel-neg" : ""}`}>{moedaOuTraco(rel.pagar.vencidoC)}</td></tr>
                <tr><td>Contas a receber ({rel.receber.qtd} parcela{rel.receber.qtd === 1 ? "" : "s"})</td><td className="num">{moedaOuTraco(rel.receber.c)}</td><td className="num">{moedaOuTraco(rel.receber.vencidoC)}</td></tr>
              </tbody>
            </table>
          </section>

          {rel.campanhas.length > 0 && (
            <section className="rel-secao">
              <h3>6. Campanhas</h3>
              <table className="rel-tabela">
                <thead><tr><th>Campanha</th><th className="num">No mês</th><th className="num">Arrecadado até hoje</th><th className="num">Meta</th></tr></thead>
                <tbody>
                  {rel.campanhas.map((c) => (
                    <tr key={c.id}>
                      <td>{c.nome}</td>
                      <td className="num">{moedaOuTraco(c.mes)}</td>
                      <td className="num">{moeda(c.total)}</td>
                      <td className="num">{c.meta ? <>{moeda(c.meta)} <span className="muted">({Math.round((c.total / c.meta) * 100)}%)</span></> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <footer className="rel-assinaturas">
            <div><span className="rel-linha" />Tesoureiro(a)</div>
            <div><span className="rel-linha" />Conselho fiscal / Presidente</div>
            <p className="rel-aprovacao">Aprovado em ____/____/________</p>
          </footer>
        </article>
      )}
    </div>
  );
}
