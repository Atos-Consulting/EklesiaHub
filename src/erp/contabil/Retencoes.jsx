import { useState } from "react";
import { Header, Pill } from "../../ui";
import { inp } from "../../estilos";
import Icone from "../Icone";
import { useCarga } from "../useCarga";
import { carregarRetencoesMes } from "../db";
import { formatarData, formatarMoeda, hojeISO, mascararDocumentoLivre, paraCentavos, deCentavos, TIPOS_NOTA } from "../format";
import { situacaoTitulo } from "../financeiro";
import { CabecalhoRelatorio } from "./comum";

// Contábil → Retenções (v26): tributos retidos nas notas aprovadas do mês (por mês de emissão) e as guias
// a recolher da competência. Serve para conferir a DCTFWeb / EFD-Reinf com o contador.

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const TRIBUTOS = [
  { id: "inss", rotulo: "INSS" }, { id: "irrf", rotulo: "IRRF" }, { id: "csll", rotulo: "CSLL" },
  { id: "pis", rotulo: "PIS" }, { id: "cofins", rotulo: "COFINS" }, { id: "iss", rotulo: "ISS" }, { id: "outras", rotulo: "Outras" },
];
const NOME_TRIBUTO = { inss: "INSS retido", irrf: "IRRF retido", csll: "CSLL retida", pis: "PIS retido", cofins: "COFINS retida", iss: "ISS retido" };
const mesMenos = (ym, n) => { const d = new Date(`${ym}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const c = (v) => paraCentavos(v);
const m = (cent) => (cent ? formatarMoeda(deCentavos(cent)) : "—");

export default function Retencoes({ perfil }) {
  const [mes, setMes] = useState(() => mesMenos(hojeISO().slice(0, 7), -1));
  const ok = /^\d{4}-\d{2}$/.test(mes);
  const carga = useCarga(ok ? `retencoes|${mes}` : null, () => carregarRetencoesMes(`${mes}-01`));
  const d = carga.dados;
  const totais = Object.fromEntries(TRIBUTOS.map((t) => [t.id, (d?.notas ?? []).reduce((a, n) => a + c(n[t.id]), 0)]));
  const totalNota = (n) => TRIBUTOS.reduce((a, t) => a + c(n[t.id]), 0);
  const totalGeral = Object.values(totais).reduce((a, v) => a + v, 0);
  const nomeMes = ok ? `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}` : "";
  const colunas = TRIBUTOS.filter((t) => totais[t.id] > 0);

  return (
    <div>
      <div className="page-header no-print">
        <Header title="Retenções" subtitle="Tributos retidos nas notas de entrada aprovadas do mês (pela emissão) e as guias a recolher. Para conferir a DCTFWeb e a EFD-Reinf com o contador." />
      </div>
      <div className="card no-print" style={{ marginBottom: 16 }}>
        <div className="toolbar">
          <label>Mês de emissão
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setMes((x) => mesMenos(x, -1))} disabled={!ok} aria-label="Mês anterior">‹</button>
              <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} style={{ ...inp, width: 170 }} />
              <button type="button" className="btn btn-ghost" onClick={() => setMes((x) => mesMenos(x, 1))} disabled={!ok} aria-label="Próximo mês">›</button>
            </div>
          </label>
          <button type="button" className="btn btn-primary" style={{ marginLeft: "auto", alignSelf: "flex-end" }} onClick={() => window.print()} disabled={!d}>
            <Icone nome="impressora" tamanho={16} /> Imprimir ou salvar PDF
          </button>
        </div>
      </div>

      {carga.erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{carga.erro}</span></div>}
      {ok && !d && !carga.erro && <div className="carregando-linha"><div className="spinner" /> Carregando...</div>}

      {d && (
        <article className="card relatorio-folha">
          <CabecalhoRelatorio perfil={perfil} titulo={`Retenções — ${nomeMes}`} sub="Notas de entrada aprovadas com emissão no mês" />

          <div className="rel-resumo" style={{ gridTemplateColumns: `repeat(${Math.min(4, colunas.length + 1)}, 1fr)` }}>
            {colunas.map((t) => <div key={t.id}><span>{t.rotulo}</span><strong>{m(totais[t.id])}</strong></div>)}
            <div><span>Total retido</span><strong>{m(totalGeral)}</strong></div>
          </div>

          <section className="rel-secao">
            <h3>1. Notas com retenção</h3>
            <div className="table-wrap">
              <table className="rel-tabela">
                <thead><tr>
                  <th>Emissão</th><th>Nota</th><th>Fornecedor</th><th className="num">Valor da nota</th>
                  {colunas.map((t) => <th key={t.id} className="num">{t.rotulo}</th>)}
                  <th className="num">Total retido</th>
                </tr></thead>
                <tbody>
                  {d.notas.length === 0 && <tr><td colSpan={5 + colunas.length} className="muted">Nenhuma nota com retenção neste mês.</td></tr>}
                  {d.notas.map((n) => (
                    <tr key={n.documento_id}>
                      <td>{formatarData(n.data_emissao)}</td>
                      <td>{TIPOS_NOTA[n.tipo] ?? n.tipo} {n.numero}{n.serie ? `/${n.serie}` : ""}</td>
                      <td>{n.fornecedor_nome}<div className="muted" style={{ fontSize: 11.5 }}>{n.fornecedor_documento ? mascararDocumentoLivre(n.fornecedor_documento) : ""}</div></td>
                      <td className="num">{formatarMoeda(n.valor_total)}</td>
                      {colunas.map((t) => <td key={t.id} className="num">{m(c(n[t.id]))}</td>)}
                      <td className="num" style={{ fontWeight: 600 }}>{m(totalNota(n))}</td>
                    </tr>
                  ))}
                </tbody>
                {d.notas.length > 0 && (
                  <tfoot><tr>
                    <td colSpan={3}>Total</td><td className="num">{formatarMoeda(d.notas.reduce((a, n) => a + Number(n.valor_total), 0))}</td>
                    {colunas.map((t) => <td key={t.id} className="num">{m(totais[t.id])}</td>)}
                    <td className="num">{m(totalGeral)}</td>
                  </tr></tfoot>
                )}
              </table>
            </div>
          </section>

          <section className="rel-secao">
            <h3>2. Guias a recolher (competência {mes.slice(5, 7)}/{mes.slice(0, 4)})</h3>
            <table className="rel-tabela">
              <thead><tr><th>Tributo</th><th>Descrição</th><th>Vencimento</th><th className="num">Valor</th><th>Situação</th></tr></thead>
              <tbody>
                {d.guias.length === 0 && <tr><td colSpan={5} className="muted">Nenhuma guia nesta competência.</td></tr>}
                {d.guias.map((g) => {
                  const s = situacaoTitulo(g, hojeISO());
                  return (
                    <tr key={g.id}>
                      <td>{NOME_TRIBUTO[g.tributo_retido]}</td>
                      <td>{g.descricao}</td>
                      <td>{formatarData(g.vencimento)}</td>
                      <td className="num">{formatarMoeda(g.valor)}</td>
                      <td><Pill tone={s.tom}>{s.rotulo}</Pill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {totais.iss > 0 && !d.guias.some((g) => g.tributo_retido === "iss") && (
              <p className="rel-nota no-print">Há ISS retido, mas a guia não foi gerada: escolha a prefeitura em Parâmetros → Regras de contabilização → Guias dos tributos retidos.</p>
            )}
            <p className="rel-nota no-print">As guias ficam em Financeiro → Lançamentos → A pagar. Para mudar o valor, corrija ou cancele a nota de entrada.</p>
          </section>
        </article>
      )}
    </div>
  );
}
