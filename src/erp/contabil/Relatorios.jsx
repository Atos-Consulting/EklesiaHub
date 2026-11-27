import { useMemo, useState } from "react";
import { Header } from "../../ui";
import { inp } from "../../estilos";
import Icone from "../Icone";
import { useCarga } from "../useCarga";
import { listarRazao, carregarBalancete } from "../db";
import { formatarData, hojeISO, paraCentavos } from "../format";
import { ORIGENS, NATUREZAS, moeda, saldoDC, rotuloConta, montarBalancete, montarDre, montarBalanco, temValor } from "./calculoContabil";
import { Pendencias, ContaSelect, Periodo, CabecalhoRelatorio } from "./comum";
import { useContabilizar, periodoValido } from "./useContabilizar";

// Contábil → Razão, Balancete, DRE e Balanço (v25). Só leem; todos saem do diário (partidas_contabeis).

const diaAntes = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const inicioDoMes = (h) => `${h.slice(0, 7)}-01`;

function BotaoImprimir({ desabilitado }) {
  return (
    <button type="button" className="btn btn-primary" style={{ marginLeft: "auto", alignSelf: "flex-end" }} onClick={() => window.print()} disabled={desabilitado}>
      <Icone nome="impressora" tamanho={16} /> Imprimir ou salvar PDF
    </button>
  );
}

function Estado({ ctb, carga, vazio }) {
  if (ctb.erro || carga.erro) return <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{ctb.erro || carga.erro}</span></div>;
  if (vazio) return <div className="card" style={{ padding: 24 }}>{vazio}</div>;
  if (!carga.dados) return <div className="carregando-linha"><div className="spinner" /> Carregando...</div>;
  return null;
}

function CentroSelect({ cadastros, valor, onChange }) {
  return (
    <label>Centro de custo
      <select style={{ ...inp, width: 190 }} value={valor} onChange={(e) => onChange(e.target.value)}>
        <option value="">Todos</option>
        {cadastros.centros.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.ativo ? "" : " (inativo)"}</option>)}
      </select>
    </label>
  );
}

// ── Razão ─────────────────────────────────────────────────────────────

export function Razao({ cadastros, perfil, podeConfigurar }) {
  const hoje = hojeISO();
  const [periodo, setPeriodo] = useState({ de: inicioDoMes(hoje), ate: hoje });
  const [contaId, setContaId] = useState(null);
  const [centro, setCentro] = useState("");
  const ctb = useContabilizar();
  const ok = periodoValido(periodo.de, periodo.ate) && contaId;
  const chave = ctb.pronto && ok ? `razao|${contaId}|${centro}|${periodo.de}|${periodo.ate}` : null;
  const carga = useCarga(chave, async () => {
    const [linhas, bal] = await Promise.all([
      listarRazao({ ...periodo, contaId, centroId: centro ? Number(centro) : null }),
      carregarBalancete(periodo.de, periodo.ate, centro ? Number(centro) : null),
    ]);
    const b = bal.find((x) => x.conta_id === contaId);
    return { linhas, anterior: b ? paraCentavos(b.debito_anterior) - paraCentavos(b.credito_anterior) : 0 };
  });
  const conta = cadastros.contas.find((c) => c.id === contaId);
  const linhas = useMemo(() => {
    if (!carga.dados) return [];
    const ordenadas = [...carga.dados.linhas].sort((a, b) => a.data.localeCompare(b.data) || a.lancamento_id - b.lancamento_id);
    return ordenadas.reduce((acc, l) => {
      const ant = acc.length ? acc[acc.length - 1].saldo : carga.dados.anterior;
      acc.push({ ...l, d: paraCentavos(l.debito), c: paraCentavos(l.credito), saldo: ant + paraCentavos(l.debito) - paraCentavos(l.credito) });
      return acc;
    }, []);
  }, [carga.dados]);
  const totD = linhas.reduce((a, l) => a + l.d, 0);
  const totC = linhas.reduce((a, l) => a + l.c, 0);
  const final = (carga.dados?.anterior ?? 0) + totD - totC;

  return (
    <div>
      <div className="page-header no-print"><Header title="Razão" subtitle="Todos os lançamentos de uma conta no período, com o saldo dia a dia." /></div>
      <div className="no-print"><Pendencias versao={ctb.versao} podeConfigurar={podeConfigurar} /></div>
      <div className="card no-print" style={{ marginBottom: 16 }}>
        <div className="toolbar">
          <label style={{ minWidth: 280, flex: 1 }}>Conta
            <ContaSelect contas={cadastros.contas} valor={contaId} onChange={setContaId} />
          </label>
          <CentroSelect cadastros={cadastros} valor={centro} onChange={setCentro} />
          <Periodo de={periodo.de} ate={periodo.ate} onChange={setPeriodo} />
          <BotaoImprimir desabilitado={!carga.dados} />
        </div>
      </div>
      <Estado ctb={ctb} carga={carga} vazio={!contaId ? "Escolha a conta." : !periodoValido(periodo.de, periodo.ate) ? "Escolha um período válido." : null} />
      {carga.dados && chave && (
        <article className="card relatorio-folha">
          <CabecalhoRelatorio perfil={perfil} titulo={`Razão — ${rotuloConta(conta)}`}
            sub={`${NATUREZAS[conta?.natureza] ?? ""} · ${formatarData(periodo.de)} a ${formatarData(periodo.ate)}${centro ? ` · centro: ${cadastros.centros.find((c) => String(c.id) === centro)?.nome}` : ""}`} />
          <div className="table-wrap">
            <table className="rel-tabela">
              <thead><tr><th>Data</th><th>Nº</th><th>Histórico</th><th>Centro</th><th className="num">Débito</th><th className="num">Crédito</th><th className="num">Saldo</th></tr></thead>
              <tbody>
                <tr className="rel-grupo"><td colSpan={6}>Saldo anterior a {formatarData(periodo.de)}</td><td className="num">{saldoDC(carga.dados.anterior)}</td></tr>
                {linhas.length === 0 && <tr><td colSpan={7} className="muted">Nenhum lançamento nesta conta no período.</td></tr>}
                {linhas.map((l) => (
                  <tr key={l.partida_id}>
                    <td>{formatarData(l.data)}</td>
                    <td className="muted">{l.lancamento_id}</td>
                    <td>{l.historico}<div className="muted" style={{ fontSize: 11.5 }}>{ORIGENS[l.origem]}</div></td>
                    <td>{l.centro_custo_nome ?? ""}</td>
                    <td className="num">{l.d ? moeda(l.d) : ""}</td>
                    <td className="num">{l.c ? moeda(l.c) : ""}</td>
                    <td className="num">{saldoDC(l.saldo)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={4}>Totais do período e saldo final</td><td className="num">{moeda(totD)}</td><td className="num">{moeda(totC)}</td><td className="num">{saldoDC(final)}</td></tr></tfoot>
            </table>
          </div>
        </article>
      )}
    </div>
  );
}

// ── Balancete ─────────────────────────────────────────────────────────

export function Balancete({ cadastros, perfil, podeConfigurar }) {
  const hoje = hojeISO();
  const [periodo, setPeriodo] = useState({ de: inicioDoMes(hoje), ate: hoje });
  const [centro, setCentro] = useState("");
  const [zeradas, setZeradas] = useState(false);
  const [ateNivel, setAteNivel] = useState(0); // 0 = todos
  const ctb = useContabilizar();
  const ok = periodoValido(periodo.de, periodo.ate);
  const chave = ctb.pronto && ok ? `balancete|${centro}|${periodo.de}|${periodo.ate}` : null;
  const carga = useCarga(chave, () => carregarBalancete(periodo.de, periodo.ate, centro ? Number(centro) : null));
  const linhas = useMemo(() => (carga.dados ? montarBalancete(cadastros.contas, carga.dados) : []), [carga.dados, cadastros.contas]);
  const visiveis = linhas.filter((r) => (zeradas || temValor(r)) && (!ateNivel || r.nivel <= ateNivel));
  const raizes = linhas.filter((r) => !r.conta.pai_id);
  const tot = raizes.reduce((a, r) => ({ antD: a.antD + Math.max(r.saldoAnt, 0), antC: a.antC + Math.max(-r.saldoAnt, 0), d: a.d + r.d, c: a.c + r.c }), { antD: 0, antC: 0, d: 0, c: 0 });
  const maxNivel = Math.max(1, ...linhas.map((r) => r.nivel));

  return (
    <div>
      <div className="page-header no-print"><Header title="Balancete" subtitle="Saldo anterior, débitos, créditos e saldo atual de cada conta no período. As contas sintéticas somam as de baixo." /></div>
      <div className="no-print"><Pendencias versao={ctb.versao} podeConfigurar={podeConfigurar} /></div>
      <div className="card no-print" style={{ marginBottom: 16 }}>
        <div className="toolbar">
          <Periodo de={periodo.de} ate={periodo.ate} onChange={setPeriodo} />
          <CentroSelect cadastros={cadastros} valor={centro} onChange={setCentro} />
          <label>Mostrar até o nível
            <select style={{ ...inp, width: 120 }} value={ateNivel} onChange={(e) => setAteNivel(Number(e.target.value))}>
              <option value={0}>Todos</option>
              {Array.from({ length: maxNivel }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </select>
          </label>
          <label className="check" style={{ alignSelf: "flex-end", display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={zeradas} onChange={(e) => setZeradas(e.target.checked)} /> Contas sem movimento
          </label>
          <BotaoImprimir desabilitado={!carga.dados} />
        </div>
      </div>
      <Estado ctb={ctb} carga={carga} vazio={!ok ? "Escolha um período válido." : null} />
      {carga.dados && ok && (
        <article className="card relatorio-folha">
          <CabecalhoRelatorio perfil={perfil} titulo="Balancete de verificação"
            sub={`${formatarData(periodo.de)} a ${formatarData(periodo.ate)}${centro ? ` · centro: ${cadastros.centros.find((c) => String(c.id) === centro)?.nome}` : ""}`} />
          <div className="table-wrap">
            <table className="rel-tabela ctb-balancete">
              <thead><tr><th>Conta</th><th className="num">Saldo anterior</th><th className="num">Débitos</th><th className="num">Créditos</th><th className="num">Saldo atual</th></tr></thead>
              <tbody>
                {visiveis.length === 0 && <tr><td colSpan={5} className="muted">Nenhuma conta com movimento.</td></tr>}
                {visiveis.map((r) => (
                  <tr key={r.conta.id} className={r.conta.analitica ? "" : "rel-grupo"}>
                    <td style={{ paddingLeft: 8 + (r.nivel - 1) * 14 }}>{r.conta.codigo} {r.conta.nome}</td>
                    <td className="num">{saldoDC(r.saldoAnt)}</td>
                    <td className="num">{r.d ? moeda(r.d) : "—"}</td>
                    <td className="num">{r.c ? moeda(r.c) : "—"}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{saldoDC(r.saldo)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <td>Total (débitos = créditos)</td>
                <td className="num">{moeda(tot.antD)} D / {moeda(tot.antC)} C</td>
                <td className="num">{moeda(tot.d)}</td><td className="num">{moeda(tot.c)}</td>
                <td className="num">{tot.d === tot.c ? "Fechado" : <span className="rel-neg">Diferença {moeda(Math.abs(tot.d - tot.c))}</span>}</td>
              </tr></tfoot>
            </table>
          </div>
        </article>
      )}
    </div>
  );
}

// ── DRE ───────────────────────────────────────────────────────────────

function LinhasDre({ titulo, linhas, total }) {
  return (
    <section className="rel-secao">
      <h3>{titulo}</h3>
      <table className="rel-tabela">
        <tbody>
          {linhas.length === 0 && <tr><td className="muted">Nada no período.</td><td /></tr>}
          {linhas.map((r) => (
            <tr key={r.conta.id} className={r.conta.analitica ? "" : "rel-grupo"}>
              <td style={{ paddingLeft: 8 + (r.nivel - 1) * 14 }}>{r.conta.codigo} {r.conta.nome}</td>
              <td className="num">{moeda(r.valor)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td>Total de {titulo.toLowerCase()}</td><td className="num">{moeda(total)}</td></tr></tfoot>
      </table>
    </section>
  );
}

export function Dre({ cadastros, perfil, podeConfigurar }) {
  const hoje = hojeISO();
  const [periodo, setPeriodo] = useState({ de: `${hoje.slice(0, 4)}-01-01`, ate: hoje });
  const [centro, setCentro] = useState("");
  const ctb = useContabilizar();
  const ok = periodoValido(periodo.de, periodo.ate);
  const chave = ctb.pronto && ok ? `dre|${centro}|${periodo.de}|${periodo.ate}` : null;
  const carga = useCarga(chave, () => carregarBalancete(periodo.de, periodo.ate, centro ? Number(centro) : null));
  const dre = useMemo(() => (carga.dados ? montarDre(montarBalancete(cadastros.contas, carga.dados)) : null), [carga.dados, cadastros.contas]);

  return (
    <div>
      <div className="page-header no-print"><Header title="DRE" subtitle="Demonstração do resultado: receitas menos despesas do período, pelo regime de competência. Resultado positivo = superávit; negativo = déficit." /></div>
      <div className="no-print"><Pendencias versao={ctb.versao} podeConfigurar={podeConfigurar} /></div>
      <div className="card no-print" style={{ marginBottom: 16 }}>
        <div className="toolbar">
          <Periodo de={periodo.de} ate={periodo.ate} onChange={setPeriodo} />
          <CentroSelect cadastros={cadastros} valor={centro} onChange={setCentro} />
          <BotaoImprimir desabilitado={!dre} />
        </div>
      </div>
      <Estado ctb={ctb} carga={carga} vazio={!ok ? "Escolha um período válido." : null} />
      {dre && ok && (
        <article className="card relatorio-folha">
          <CabecalhoRelatorio perfil={perfil} titulo="Demonstração do resultado do período"
            sub={`${formatarData(periodo.de)} a ${formatarData(periodo.ate)}${centro ? ` · centro: ${cadastros.centros.find((c) => String(c.id) === centro)?.nome}` : ""}`} />
          <LinhasDre titulo="Receitas" linhas={dre.receitas} total={dre.totalReceitas} />
          <LinhasDre titulo="Despesas" linhas={dre.despesas} total={dre.totalDespesas} />
          <section className="rel-secao">
            <table className="rel-tabela">
              <tbody><tr className="rel-grupo">
                <td style={{ fontSize: 15 }}>{dre.resultado >= 0 ? "Superávit do período" : "Déficit do período"}</td>
                <td className={`num ${dre.resultado < 0 ? "rel-neg" : "rel-pos"}`} style={{ fontSize: 15, fontWeight: 700 }}>{moeda(dre.resultado)}</td>
              </tr></tbody>
            </table>
          </section>
        </article>
      )}
    </div>
  );
}

// ── Balanço patrimonial ───────────────────────────────────────────────

function BlocoBalanco({ titulo, linhas, extras = [], total }) {
  return (
    <section className="rel-secao">
      <h3>{titulo}</h3>
      <table className="rel-tabela">
        <tbody>
          {linhas.length === 0 && extras.length === 0 && <tr><td className="muted">Sem saldo.</td><td /></tr>}
          {linhas.map((r) => (
            <tr key={r.conta.id} className={r.conta.analitica ? "" : "rel-grupo"}>
              <td style={{ paddingLeft: 8 + (r.nivel - 1) * 14 }}>{r.conta.codigo} {r.conta.nome}</td>
              <td className="num">{moeda(r.valor)}</td>
            </tr>
          ))}
          {extras.map((x) => <tr key={x.rotulo}><td style={{ paddingLeft: 22 }}>{x.rotulo}</td><td className={`num ${x.valor < 0 ? "rel-neg" : ""}`}>{moeda(x.valor)}</td></tr>)}
        </tbody>
        <tfoot><tr><td>Total</td><td className="num">{moeda(total)}</td></tr></tfoot>
      </table>
    </section>
  );
}

export function Balanco({ cadastros, perfil, podeConfigurar }) {
  const [data, setData] = useState(hojeISO());
  const ctb = useContabilizar();
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(data);
  const inicioAno = ok ? `${data.slice(0, 4)}-01-01` : null;
  const chave = ctb.pronto && ok ? `balanco|${data}` : null;
  const carga = useCarga(chave, () => carregarBalancete(inicioAno, data));
  const b = useMemo(() => (carga.dados ? montarBalanco(montarBalancete(cadastros.contas, carga.dados)) : null), [carga.dados, cadastros.contas]);
  const ano = data.slice(0, 4);

  return (
    <div>
      <div className="page-header no-print"><Header title="Balanço patrimonial" subtitle="O que a igreja tem (ativo), o que deve (passivo) e o patrimônio social numa data, com o superávit ou déficit acumulado." /></div>
      <div className="no-print"><Pendencias versao={ctb.versao} podeConfigurar={podeConfigurar} /></div>
      <div className="card no-print" style={{ marginBottom: 16 }}>
        <div className="toolbar">
          <label>Data<input type="date" style={{ ...inp, width: 170 }} value={data} onChange={(e) => setData(e.target.value)} /></label>
          <div style={{ display: "flex", gap: 6, alignSelf: "flex-end" }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setData(hojeISO())}>Hoje</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setData(diaAntes(`${hojeISO().slice(0, 7)}-01`))}>Fim do mês passado</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setData(`${Number(hojeISO().slice(0, 4)) - 1}-12-31`)}>Fim do ano passado</button>
          </div>
          <BotaoImprimir desabilitado={!b} />
        </div>
      </div>
      <Estado ctb={ctb} carga={carga} vazio={!ok ? "Escolha a data." : null} />
      {b && ok && (
        <article className="card relatorio-folha">
          <CabecalhoRelatorio perfil={perfil} titulo="Balanço patrimonial" sub={`Em ${formatarData(data)}`} />
          <div className="ctb-balanco">
            <div>
              <BlocoBalanco titulo="Ativo" linhas={b.ativo} total={b.totalAtivo} />
            </div>
            <div>
              <BlocoBalanco titulo="Passivo" linhas={b.passivo} total={b.totalPassivo} />
              <BlocoBalanco titulo="Patrimônio social" linhas={b.patrimonio} total={b.totalPatrimonio}
                extras={[
                  { rotulo: `Superávits/déficits até ${Number(ano) - 1}`, valor: b.resultadoAnterior },
                  { rotulo: `Superávit/déficit de ${ano} (até ${formatarData(data)})`, valor: b.resultadoExercicio },
                ].filter((x) => x.valor !== 0)} />
              <table className="rel-tabela"><tfoot><tr><td>Passivo + patrimônio social</td><td className="num">{moeda(b.totalPassivo + b.totalPatrimonio)}</td></tr></tfoot></table>
            </div>
          </div>
          {b.diferenca !== 0 && <p className="rel-nota rel-neg">Diferença de {moeda(Math.abs(b.diferenca))} entre ativo e passivo + patrimônio. Confira os lançamentos manuais.</p>}
          <p className="rel-nota">Sem lançamentos de encerramento: o resultado das receitas e despesas aparece no patrimônio social.</p>
        </article>
      )}
    </div>
  );
}
