import { Pill } from "../ui";
import Icone from "./Icone";
import Modal from "./Modal";
import { useCarga } from "./useCarga";
import { carregarVinculos, contabilizar } from "./db";
import { TIPOS_NOTA, STATUS_NOTA, TOM_STATUS, formatarMoeda, formatarData, hojeISO, paraCentavos, deCentavos } from "./format";
import { situacaoTitulo, ORIGEM_PAGAMENTO } from "./financeiro";
import { ORIGENS } from "./contabil/calculoContabil";

// Vínculos (v29, sem migration): de uma nota, de um lançamento do Financeiro ou de um lançamento contábil,
// mostra o resto da cadeia — a nota, as parcelas (quanto já foi pago e quanto falta), os pagamentos e a
// contabilidade — com links para abrir cada um na sua tela. origem = { tipo: "nota" | "titulo" | "contabil", ... }.

const somaCent = (lista, f) => lista.reduce((a, x) => a + paraCentavos(Number(f(x) ?? 0)), 0);
const caixaNome = (caixas, id) => (caixas || []).find((c) => c.id === id)?.nome ?? "—";

async function carregar(origem, comContabilidade) {
  // A contabilidade é gerada sob demanda (as telas do Contábil chamam ao abrir): gera antes de mostrar.
  if (comContabilidade) await contabilizar().catch(() => 0);
  return carregarVinculos(origem);
}

function Resumo({ rotulo, valor, tom }) {
  return (
    <div className="vinc-resumo">
      <span>{rotulo}</span>
      <strong style={tom ? { color: tom } : undefined}>{formatarMoeda(deCentavos(valor))}</strong>
    </div>
  );
}

export default function Vinculos({ origem, caixas, comContabilidade = true, onFechar }) {
  const chave = `${origem.tipo}|${origem.id}|${origem.origem ?? ""}|${origem.origem_id ?? ""}`;
  const carga = useCarga(chave, () => carregar(origem, comContabilidade));
  const d = carga.dados;
  const hoje = hojeISO();
  const validos = (d?.titulos ?? []).filter((t) => t.status !== "cancelado");
  const totalCent = somaCent(validos, (t) => t.valor);
  const pagoCent = somaCent(validos.filter((t) => t.status === "pago"), (t) => t.valor_pago);
  const faltaCent = somaCent(validos.filter((t) => t.status === "aberto"), (t) => t.valor);
  const receber = d?.titulos?.[0]?.natureza === "receber";
  const titulo = d?.nota ? `${TIPOS_NOTA[d.nota.tipo]} ${d.nota.numero}${d.nota.serie ? `/${d.nota.serie}` : ""}` : d?.titulos?.[0]?.descricao ?? "Lançamento";

  return (
    <Modal titulo={`Vínculos — ${titulo}`} largura={900} nivel={350} onFechar={onFechar}
      rodape={<button className="btn btn-ghost" onClick={onFechar}>Fechar</button>}>
      {carga.carregando && <div className="muted" style={{ padding: 20, textAlign: "center" }}>Carregando...</div>}
      {carga.erro && <div className="alert alert-danger" role="alert"><Icone nome="alerta" tamanho={16} /><span>{carga.erro}</span></div>}
      {d && (
        <>
          <p className="muted" style={{ fontSize: 13, margin: "0 0 4px" }}>
            Tudo o que nasceu do mesmo documento: a nota, os lançamentos do Financeiro e os lançamentos contábeis. Use “Abrir” para ir até a tela de cada um.
          </p>

          {/* Nota */}
          <h3 className="section-title">Nota</h3>
          {d.nota ? (
            <div className="painel" style={{ paddingTop: 10 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 240, fontSize: 13.5, lineHeight: 1.7 }}>
                  <div><strong>{titulo}</strong> · {d.nota.fornecedor?.nome} <Pill tone={TOM_STATUS[d.nota.status]}>{STATUS_NOTA[d.nota.status]}</Pill></div>
                  <div className="muted">Emissão {formatarData(d.nota.data_emissao)} · Entrada {formatarData(d.nota.data_entrada)} · Total <strong style={{ color: "var(--text)" }}>{formatarMoeda(d.nota.valor_total)}</strong></div>
                  {d.nota.motivo_cancelamento && <div className="muted">Cancelada: {d.nota.motivo_cancelamento}</div>}
                </div>
                <a className="btn btn-ghost btn-sm" href={`#/administrativo/notas/${d.nota.id}`} onClick={onFechar}><Icone nome="externo" tamanho={14} /> Abrir nota</a>
              </div>
              {d.itens.length > 0 && (
                <table className="parcelas" style={{ marginTop: 8 }}>
                  <thead><tr><th>Item</th><th className="num">Qtd.</th><th className="num">Valor</th></tr></thead>
                  <tbody>
                    {d.itens.slice(0, 8).map((i) => <tr key={i.id}><td>{i.descricao}</td><td className="num">{Number(i.quantidade).toLocaleString("pt-BR")}</td><td className="num">{formatarMoeda(i.valor_total)}</td></tr>)}
                    {d.itens.length > 8 && <tr><td colSpan={3} className="muted">… mais {d.itens.length - 8} item(ns)</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
          ) : <div className="muted" style={{ fontSize: 13 }}>{d.titulos.length ? "Lançamento sem nota (lançado à mão, conta fixa ou guia de tributo)." : "Sem nota ligada."}</div>}

          {/* Financeiro */}
          <h3 className="section-title">Financeiro {d.titulos.length > 0 && `— ${receber ? "a receber" : "a pagar"}`}</h3>
          {d.titulos.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>{d.nota?.status === "rascunho" ? "A nota ainda é rascunho: as parcelas nascem na aprovação." : "Nenhum lançamento no Financeiro."}</div>
          ) : (
            <>
              <div className="vinc-resumos">
                <Resumo rotulo={`Total ${receber ? "a receber" : "a pagar"}`} valor={totalCent} />
                <Resumo rotulo={receber ? "Já recebido" : "Já pago"} valor={pagoCent} tom="var(--ok-text)" />
                <Resumo rotulo="Falta" valor={faltaCent} tom={faltaCent > 0 ? "var(--danger)" : undefined} />
              </div>
              <div className="table-wrap">
                <table className="parcelas">
                  <thead><tr><th>Parcela</th><th>Vencimento</th><th className="num">Valor</th><th>Situação</th><th>{receber ? "Recebido em" : "Pago em"}</th><th><span className="sr-only">Abrir</span></th></tr></thead>
                  <tbody>
                    {d.titulos.map((t) => {
                      const sit = situacaoTitulo(t, hoje, t.natureza);
                      return (
                        <tr key={t.id} style={t.status === "cancelado" ? { color: "var(--faint)" } : undefined}>
                          <td>{t.parcela}/{t.total_parcelas}{t.tributo_retido && <span className="pill" style={{ marginLeft: 6, fontSize: 11 }}>guia</span>}</td>
                          <td>{formatarData(t.vencimento)}</td>
                          <td className="num" style={t.status === "cancelado" ? { textDecoration: "line-through" } : undefined}>{formatarMoeda(t.valor)}</td>
                          <td><Pill tone={sit.tom}>{sit.rotulo}</Pill></td>
                          <td>{t.data_pagamento ? `${formatarData(t.data_pagamento)} · ${formatarMoeda(t.valor_pago)}` : "—"}</td>
                          <td style={{ textAlign: "right" }}><a href={`#/financeiro/lancamentos/${t.natureza}/t${t.id}`} onClick={onFechar} style={{ fontSize: 12.5 }}>Abrir</a></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {d.pagamentos.length > 0 && (
                <>
                  <div className="muted" style={{ fontSize: 12.5, margin: "12px 0 4px" }}>{receber ? "Recebimentos" : "Pagamentos"} (inclusive estornados)</div>
                  <table className="parcelas">
                    <thead><tr><th>Data</th><th>Parcela</th><th>Conta caixa</th><th className="num">Valor</th><th>Origem</th><th>Situação</th></tr></thead>
                    <tbody>
                      {d.pagamentos.map((p) => {
                        const t = d.titulos.find((x) => x.id === p.titulo_id);
                        return (
                          <tr key={p.id} style={p.estornado ? { color: "var(--faint)" } : undefined}>
                            <td>{formatarData(p.data_pagamento)}</td>
                            <td>{t ? `${t.parcela}/${t.total_parcelas}` : "—"}</td>
                            <td>{p.conta_caixa_id ? caixaNome(caixas, p.conta_caixa_id) : "—"}</td>
                            <td className="num" style={p.estornado ? { textDecoration: "line-through" } : undefined}>{formatarMoeda(p.valor_pago)}</td>
                            <td style={{ fontSize: 12.5 }}>{ORIGEM_PAGAMENTO[p.origem] ?? p.origem}</td>
                            <td>{p.estornado ? <Pill tone="danger">Estornado</Pill> : <Pill tone="ok">{receber ? "Recebido" : "Pago"}</Pill>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}
            </>
          )}

          {/* Contabilidade */}
          <h3 className="section-title">Contabilidade</h3>
          {d.lancamentos.length === 0 ? (
            <div className="muted" style={{ fontSize: 13 }}>{comContabilidade ? "Nenhum lançamento contábil ligado (ou falta conta contábil: veja as pendências em Contábil → Lançamentos)." : "A contabilidade está desligada nesta igreja."}</div>
          ) : d.lancamentos.map((l) => (
            <div key={l.id} className="vinc-lanc" style={l.estornado || l.estorno_de ? { opacity: 0.7 } : undefined}>
              <div className="vinc-lanc-topo">
                <span><strong>Nº {l.id}</strong> · {formatarData(l.data)} · {ORIGENS[l.origem] ?? l.origem}</span>
                {l.estornado && <Pill tone="danger">Estornado</Pill>}
                {l.estorno_de && <Pill tone="warn">Estorno do nº {l.estorno_de}</Pill>}
                <span className="muted" style={{ flex: 1, minWidth: 200 }}>{l.historico}</span>
              </div>
              <table className="parcelas">
                <thead><tr><th>Conta</th><th>Centro de custo</th><th className="num">Débito</th><th className="num">Crédito</th></tr></thead>
                <tbody>
                  {l.partidas.map((p) => (
                    <tr key={p.partida_id}>
                      <td>{p.conta_codigo} - {p.conta_nome}</td>
                      <td>{p.centro_custo_nome ?? "—"}</td>
                      <td className="num">{Number(p.debito) ? formatarMoeda(p.debito) : ""}</td>
                      <td className="num">{Number(p.credito) ? formatarMoeda(p.credito) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </Modal>
  );
}
