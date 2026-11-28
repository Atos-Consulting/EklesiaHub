import { useMemo, useState } from "react";
import { Header, Pill } from "../../ui";
import { inp } from "../../estilos";
import Icone from "../Icone";
import Modal from "../Modal";
import { useCarga } from "../useCarga";
import { listarCaixasPdv, listarVendas } from "../db";
import { formatarData, formatarMoeda, hojeISO, paraCentavos, deCentavos } from "../format";
import { Periodo, CabecalhoRelatorio } from "../contabil/comum";
import { ListaVendas } from "./FrenteLoja";
import { horaDe, somarPor, quantidadeTexto } from "./calculoPdv";

// Comercial → Caixas (histórico dos caixas do frente de loja) e Comercial → Vendas (relatório do período), v27.

const moeda = (c) => formatarMoeda(deCentavos(c));
const inicioMes = () => `${hojeISO().slice(0, 7)}-01`;

function useVendasDoPeriodo(periodo, pontoId) {
  const chave = periodo.de && periodo.ate && periodo.de <= periodo.ate ? `${periodo.de}|${periodo.ate}|${pontoId}` : null;
  return useCarga(chave, async () => {
    const caixas = await listarCaixasPdv({ de: periodo.de, ate: periodo.ate, pontoId: pontoId ? Number(pontoId) : null });
    const vendas = await listarVendas(caixas.map((c) => c.id));
    return { caixas, vendas };
  });
}

function Filtros({ periodo, setPeriodo, pontoId, setPontoId, pontos, imprimir }) {
  return (
    <div className="card no-print" style={{ marginBottom: 16 }}>
      <div className="toolbar">
        <Periodo de={periodo.de} ate={periodo.ate} onChange={setPeriodo} />
        <label>Local
          <select style={{ ...inp, width: 190 }} value={pontoId} onChange={(e) => setPontoId(e.target.value)}>
            <option value="">Todos</option>
            {pontos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </label>
        {imprimir && <button type="button" className="btn btn-primary" style={{ marginLeft: "auto", alignSelf: "flex-end" }} onClick={() => window.print()}><Icone nome="impressora" tamanho={16} /> Imprimir ou salvar PDF</button>}
      </div>
    </div>
  );
}

export function CaixasPdv({ cadastros }) {
  const [periodo, setPeriodo] = useState({ de: inicioMes(), ate: hojeISO() });
  const [pontoId, setPontoId] = useState("");
  const [detalhe, setDetalhe] = useState(null);
  const carga = useVendasDoPeriodo(periodo, pontoId);
  const pontos = cadastros.pontos ?? [];
  const nomePonto = (id) => pontos.find((p) => p.id === id)?.nome ?? "?";
  const porCaixa = useMemo(() => {
    const m = new Map();
    for (const v of carga.dados?.vendas ?? []) {
      if (!m.has(v.caixa_id)) m.set(v.caixa_id, { c: 0, n: 0, cancel: 0 });
      const g = m.get(v.caixa_id);
      if (v.status === "concluida") { g.c += paraCentavos(v.total); g.n += 1; } else g.cancel += 1;
    }
    return m;
  }, [carga.dados]);

  return (
    <div>
      <div className="page-header no-print">
        <Header title="Caixas" subtitle="Cada caixa aberto no frente de loja: local, dia, quem abriu e fechou, o que vendeu e a diferença do dinheiro." />
      </div>
      <Filtros periodo={periodo} setPeriodo={setPeriodo} pontoId={pontoId} setPontoId={setPontoId} pontos={pontos} />
      {carga.erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{carga.erro}</span></div>}
      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Dia</th><th>Local</th><th>Situação</th><th>Abriu</th><th>Fechou</th><th className="num">Vendas</th><th className="num">Total</th><th className="num">Diferença</th><th /></tr></thead>
            <tbody>
              {!carga.dados && !carga.erro && <tr><td className="vazio" colSpan={9}>Carregando...</td></tr>}
              {carga.dados?.caixas.length === 0 && <tr><td className="vazio" colSpan={9}>Nenhum caixa no período.</td></tr>}
              {(carga.dados?.caixas ?? []).map((k) => {
                const t = porCaixa.get(k.id) ?? { c: 0, n: 0, cancel: 0 };
                return (
                  <tr key={k.id}>
                    <td>{formatarData(k.data)}</td>
                    <td style={{ fontWeight: 550 }}>{nomePonto(k.ponto_venda_id)}</td>
                    <td>{k.status === "aberto" ? <Pill tone="warn">Aberto</Pill> : <Pill tone="ok">Fechado</Pill>}</td>
                    <td style={{ fontSize: 12.5 }}>{k.aberto_por_nome}<div className="muted">{horaDe(k.aberto_em)}</div></td>
                    <td style={{ fontSize: 12.5 }}>{k.fechado_por_nome ?? "—"}{k.fechado_em && <div className="muted">{formatarData(k.fechado_em.slice(0, 10))} {horaDe(k.fechado_em)}</div>}</td>
                    <td className="num">{t.n}{t.cancel > 0 && <div className="muted" style={{ fontSize: 12 }}>+{t.cancel} cancel.</div>}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{moeda(t.c)}</td>
                    <td className="num" style={{ color: Number(k.diferenca) < 0 ? "var(--danger)" : undefined }}>{k.diferenca === null ? "—" : Number(k.diferenca) === 0 ? "ok" : formatarMoeda(k.diferenca)}</td>
                    <td style={{ textAlign: "right" }}><button className="btn btn-ghost btn-sm" onClick={() => setDetalhe(k)}>Detalhes</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {detalhe && <DetalheCaixa caixa={detalhe} nomePonto={nomePonto(detalhe.ponto_venda_id)} cadastros={cadastros}
        vendas={(carga.dados?.vendas ?? []).filter((v) => v.caixa_id === detalhe.id)} onFechar={() => setDetalhe(null)} />}
    </div>
  );
}

function DetalheCaixa({ caixa, nomePonto, cadastros, vendas, onFechar }) {
  const nomeForma = (id) => cadastros.formas.find((f) => f.id === id)?.nome ?? "?";
  const pags = vendas.filter((v) => v.status === "concluida").flatMap((v) => v.venda_pagamentos ?? []);
  const formas = somarPor(pags, (p) => p.forma_pagamento_id, (p) => nomeForma(p.forma_pagamento_id), (p) => paraCentavos(p.valor));
  const total = formas.reduce((a, f) => a + f.c, 0);
  return (
    <Modal titulo={`${nomePonto} — caixa de ${formatarData(caixa.data)}`} largura={860} onFechar={onFechar}>
      <div className="pdv-resumo" style={{ marginTop: 4 }}>
        <div className="fech-linha"><span>Aberto por</span><strong>{caixa.aberto_por_nome} às {horaDe(caixa.aberto_em)}{caixa.observacao_abertura ? ` — ${caixa.observacao_abertura}` : ""}</strong></div>
        <div className="fech-linha"><span>Troco da abertura</span><strong>{formatarMoeda(caixa.troco_inicial)}</strong></div>
        {formas.map((f) => <div key={f.chave} className="fech-linha"><span>{f.rotulo}</span><strong>{moeda(f.c)}</strong></div>)}
        <div className="fech-linha fech-total"><span>Total vendido</span><strong>{moeda(total)}</strong></div>
        {caixa.status === "fechado" && <>
          <div className="fech-linha"><span>Fechado por</span><strong>{caixa.fechado_por_nome} às {horaDe(caixa.fechado_em)}</strong></div>
          <div className="fech-linha"><span>Dinheiro contado</span><strong>{formatarMoeda(caixa.dinheiro_contado)}</strong></div>
          <div className="fech-linha"><span>Diferença</span><strong style={{ color: Number(caixa.diferenca) < 0 ? "var(--danger)" : undefined }}>{Number(caixa.diferenca) === 0 ? "Bateu" : formatarMoeda(caixa.diferenca)}</strong></div>
          {caixa.observacao && <div className="fech-linha"><span>Observação</span><strong>{caixa.observacao}</strong></div>}
        </>}
      </div>
      <h3 className="section-title">Vendas</h3>
      <ListaVendas vendas={vendas} cadastros={cadastros} onCancelar={null} />
    </Modal>
  );
}

function Tabela({ titulo, coluna, linhas, total, comQtd }) {
  return (
    <section className="rel-secao">
      <h3>{titulo}</h3>
      <table className="rel-tabela">
        <thead><tr><th>{coluna}</th>{comQtd && <th className="num">Quantidade</th>}<th className="num">Valor</th><th className="num">%</th></tr></thead>
        <tbody>
          {linhas.length === 0 && <tr><td colSpan={comQtd ? 4 : 3} className="muted">Nada no período.</td></tr>}
          {linhas.map((l) => (
            <tr key={String(l.chave)}><td>{l.rotulo}</td>{comQtd && <td className="num">{quantidadeTexto(Math.round(l.qtd * 10000) / 10000)}</td>}<td className="num">{moeda(l.c)}</td><td className="num">{total ? String(Math.round((l.c / total) * 1000) / 10).replace(".", ",") : 0}%</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function RelatorioVendas({ cadastros, perfil }) {
  const [periodo, setPeriodo] = useState({ de: inicioMes(), ate: hojeISO() });
  const [pontoId, setPontoId] = useState("");
  const carga = useVendasDoPeriodo(periodo, pontoId);
  const pontos = useMemo(() => cadastros.pontos ?? [], [cadastros.pontos]);
  const d = useMemo(() => {
    if (!carga.dados) return null;
    const nomePonto = Object.fromEntries(pontos.map((p) => [p.id, p.nome]));
    const nomeForma = Object.fromEntries(cadastros.formas.map((f) => [f.id, f.nome]));
    const pontoDoCaixa = Object.fromEntries(carga.dados.caixas.map((k) => [k.id, k.ponto_venda_id]));
    const vendas = carga.dados.vendas.filter((v) => v.status === "concluida");
    const itens = vendas.flatMap((v) => v.venda_itens ?? []);
    return {
      qtd: vendas.length,
      canceladas: carga.dados.vendas.length - vendas.length,
      total: vendas.reduce((a, v) => a + paraCentavos(v.total), 0),
      desconto: vendas.reduce((a, v) => a + paraCentavos(v.desconto), 0),
      diferencas: carga.dados.caixas.reduce((a, k) => a + paraCentavos(k.diferenca ?? 0), 0),
      abertos: carga.dados.caixas.filter((k) => k.status === "aberto").length,
      porLocal: somarPor(vendas, (v) => pontoDoCaixa[v.caixa_id], (v) => nomePonto[pontoDoCaixa[v.caixa_id]] ?? "?", (v) => paraCentavos(v.total)),
      porForma: somarPor(vendas.flatMap((v) => v.venda_pagamentos ?? []), (p) => p.forma_pagamento_id, (p) => nomeForma[p.forma_pagamento_id] ?? "?", (p) => paraCentavos(p.valor)),
      porVendedor: somarPor(vendas, (v) => v.vendedor ?? v.vendedor_nome,(v) => v.vendedor_nome ?? "?", (v) => paraCentavos(v.total)),
      porProduto: somarPor(itens, (i) => i.produto_id ?? `avulso:${i.descricao}`, (i) => (i.produto_id ? i.descricao : `${i.descricao} (avulso)`), (i) => paraCentavos(i.total), (i) => Number(i.quantidade)),
    };
  }, [carga.dados, pontos, cadastros.formas]);
  const local = pontoId ? pontos.find((p) => String(p.id) === pontoId)?.nome : "todos os locais";

  return (
    <div>
      <div className="page-header no-print">
        <Header title="Vendas" subtitle="Quanto o frente de loja vendeu no período (pelo dia do caixa): por local, forma de pagamento, produto e vendedor." />
      </div>
      <Filtros periodo={periodo} setPeriodo={setPeriodo} pontoId={pontoId} setPontoId={setPontoId} pontos={pontos} imprimir={Boolean(d)} />
      {carga.erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{carga.erro}</span></div>}
      {!d && !carga.erro && <div className="carregando-linha"><div className="spinner" /> Carregando...</div>}
      {d && (
        <article className="card relatorio-folha">
          <CabecalhoRelatorio perfil={perfil} titulo="Vendas do frente de loja" sub={`${formatarData(periodo.de)} a ${formatarData(periodo.ate)} · ${local}`} />
          <div className="rel-resumo" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div><span>Vendas</span><strong>{d.qtd}</strong></div>
            <div><span>Total vendido</span><strong>{moeda(d.total)}</strong></div>
            <div><span>Ticket médio</span><strong>{d.qtd ? moeda(Math.round(d.total / d.qtd)) : "—"}</strong></div>
            <div><span>Descontos</span><strong>{moeda(d.desconto)}</strong></div>
          </div>
          {(d.canceladas > 0 || d.diferencas !== 0 || d.abertos > 0) && (
            <p className="rel-nota">
              {d.canceladas > 0 && `${d.canceladas} venda(s) cancelada(s) fora do total. `}
              {d.diferencas !== 0 && `Diferenças de caixa no período: ${moeda(d.diferencas)}. `}
              {d.abertos > 0 && `${d.abertos} caixa(s) ainda aberto(s): as vendas deles só entram no Financeiro no fechamento.`}
            </p>
          )}
          <Tabela titulo="1. Por local" coluna="Local" linhas={d.porLocal} total={d.total} />
          <Tabela titulo="2. Por forma de pagamento" coluna="Forma" linhas={d.porForma} total={d.total} />
          <Tabela titulo="3. Por produto" coluna="Produto" linhas={d.porProduto} total={d.total} comQtd />
          <Tabela titulo="4. Por vendedor" coluna="Vendedor" linhas={d.porVendedor} total={d.total} />
        </article>
      )}
    </div>
  );
}
