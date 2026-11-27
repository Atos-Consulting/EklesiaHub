import { useState } from "react";
import { Header, Pill } from "../ui";
import { inp } from "../estilos";
import Icone from "./Icone";
import { useCarga } from "./useCarga";
import { carregarExtrato, saldoCaixaAte, listarTitulosPagar, listarTitulosReceber, conciliarCaixa, mensagemErro } from "./db";
import { formatarMoeda, formatarData, hojeISO, deCentavos, soDigitos } from "./format";
import { ORIGENS_EXTRATO, somarDias } from "./financeiro";
import { decodificarOfx, lerOfx, conferirExtrato } from "./ofx";
import { PagarModal } from "./ContasPagar";
import { MovimentoModal } from "./MovimentosCaixa";

// Financeiro → Caixa → Extrato do banco (OFX): lê o arquivo OFX que o banco fornece e confere com os
// lançamentos da conta caixa. Mostra o que está nos dois, o que está só no banco (falta lançar: dá para
// lançar ali mesmo, como saída/entrada avulsa ou baixando uma conta em aberto de mesmo valor) e o que está
// só no sistema. Se o saldo do banco bater, fecha a conta até a data do extrato. Nada do arquivo é gravado.

const TOLERANCIA = 3; // dias de diferença aceitos entre a data do banco e a do sistema
const moeda = (c) => formatarMoeda(deCentavos(c));

export default function ImportarOfx({ cadastros, podeRegistrar, onCadastrosMudaram }) {
  const hoje = hojeISO();
  const [ofx, setOfx] = useState(null);
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [conta, setConta] = useState("");
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [versao, setVersao] = useState(0);
  const [acao, setAcao] = useState(null); // { tipo: "movimento" | "pagar", ... }
  const [fechando, setFechando] = useState(false);

  async function lerArquivo(arquivo) {
    setErro(""); setAviso(""); setOfx(null);
    if (!arquivo) return;
    try {
      const r = lerOfx(decodificarOfx(await arquivo.arrayBuffer()));
      setOfx(r);
      setNomeArquivo(arquivo.name);
      // Conta caixa pelo número da conta do arquivo (só os números), se houver uma igual.
      const num = soDigitos(r.conta);
      const achada = num && cadastros.caixas.find((c) => c.ativo && soDigitos(c.numero_conta) && (num.endsWith(soDigitos(c.numero_conta)) || soDigitos(c.numero_conta).endsWith(num)));
      if (achada) setConta(String(achada.id));
    } catch (e) { setErro(e.message || "Não foi possível ler o arquivo."); }
  }

  const caixa = cadastros.caixas.find((c) => String(c.id) === conta);
  const de = ofx ? somarDias(ofx.inicio, -TOLERANCIA) : null;
  const ate = ofx ? somarDias(ofx.fim, TOLERANCIA) : null;
  const pronto = ofx && caixa;
  const sistema = useCarga(pronto ? `ofx|${conta}|${de}|${ate}|${versao}` : null, () => carregarExtrato(Number(conta), { de, ate }));
  const saldoSistema = useCarga(pronto && ofx.saldo?.data ? `ofxs|${conta}|${ofx.saldo.data}|${versao}` : null, () => saldoCaixaAte(Number(conta), ofx.saldo.data));
  const abertos = useCarga(pronto && podeRegistrar ? `ofxt|${versao}` : null, () => Promise.all([listarTitulosPagar(), listarTitulosReceber()]));

  const conferencia = pronto && sistema.dados && !sistema.carregando
    ? conferirExtrato(ofx.transacoes, sistema.dados.linhas, { tolerancia: TOLERANCIA, de: ofx.inicio, ate: ofx.fim }) : null;
  const somaBanco = (l) => l.reduce((a, t) => a + t.centavos, 0);
  const saldoBate = ofx?.saldo && saldoSistema.dados !== null && !saldoSistema.carregando && Math.round(saldoSistema.dados * 100) === ofx.saldo.centavos;
  const conciliadoAte = sistema.dados?.conciliadoAte ?? null;
  const podeFechar = podeRegistrar && saldoBate && ofx.saldo.data <= hoje && (!conciliadoAte || ofx.saldo.data > conciliadoAte) && ofx.saldo.data >= (caixa?.data_saldo_inicial ?? "");

  // Conta em aberto de mesmo valor e natureza, com o vencimento mais perto da data do banco.
  function sugestaoTitulo(t) {
    if (!abertos.dados) return null;
    const [pagar, receber] = abertos.dados;
    const lista = (t.centavos < 0 ? pagar : receber).filter((x) => x.status === "aberto" && Math.round(Number(x.valor) * 100) === Math.abs(t.centavos));
    return lista.sort((a, b) => Math.abs(Date.parse(a.vencimento) - Date.parse(t.data)) - Math.abs(Date.parse(b.vencimento) - Date.parse(t.data)))[0] ?? null;
  }

  async function fecharConta() {
    setErro(""); setAviso(""); setFechando(true);
    try {
      await conciliarCaixa(Number(conta), ofx.saldo.data, deCentavos(ofx.saldo.centavos), `Conferido com o extrato OFX (${nomeArquivo})`);
      setAviso(`${caixa.nome}: fechada até ${formatarData(ofx.saldo.data)}.`);
      setVersao((v) => v + 1);
    } catch (e) { setErro(mensagemErro(e)); }
    finally { setFechando(false); }
  }
  const depoisDeLancar = async () => { setAcao(null); setVersao((v) => v + 1); await onCadastrosMudaram(); };

  return (
    <div>
      <div className="page-header">
        <Header title="Extrato do banco (OFX)" subtitle="Baixe o extrato no internet banking no formato OFX (Money/Quicken) e abra aqui. O sistema confere cada lançamento do banco com os da conta caixa e mostra o que falta lançar e o que não aparece no banco. O arquivo não é guardado." />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="toolbar">
          <label>Arquivo OFX
            <input type="file" accept=".ofx,.OFX,application/x-ofx" style={{ ...inp, width: 300, padding: 6 }} onChange={(e) => lerArquivo(e.target.files?.[0])} />
          </label>
          <label>Conta caixa
            <select value={conta} onChange={(e) => { setConta(e.target.value); setAviso(""); }} style={{ ...inp, width: 240 }}>
              <option value="">— Escolha a conta —</option>
              {cadastros.caixas.filter((c) => c.ativo).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
        </div>
        {ofx && (
          <div className="ofx-info">
            <span>Banco <strong>{ofx.banco || "—"}</strong></span>
            <span>Agência <strong>{ofx.agencia || "—"}</strong></span>
            <span>Conta <strong>{ofx.conta || "—"}</strong></span>
            <span>Período <strong>{formatarData(ofx.inicio)} a {formatarData(ofx.fim)}</strong></span>
            <span><strong>{ofx.transacoes.length}</strong> lançamento(s)</span>
            {ofx.saldo && <span>Saldo do banco em {formatarData(ofx.saldo.data)}: <strong>{moeda(ofx.saldo.centavos)}</strong></span>}
          </div>
        )}
      </div>

      {erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
      {aviso && <div className="alert alert-ok" role="status" style={{ marginBottom: 16 }}><Icone nome="check" tamanho={16} /><span>{aviso}</span></div>}
      {sistema.erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{sistema.erro}</span></div>}
      {ofx && !caixa && <div className="card muted" style={{ padding: "16px 20px", marginBottom: 16 }}>Escolha a conta caixa deste extrato para conferir.</div>}
      {pronto && !conferencia && !sistema.erro && <div className="carregando-linha"><div className="spinner" /> Conferindo...</div>}

      {conferencia && (
        <>
          <div className="stat-grid">
            <div className="card stat"><div><div className="stat-label">Conferidos</div><div className="stat-value">{conferencia.casados.length}</div><div className="stat-sub">no banco e no sistema</div></div><div className="stat-icon"><Icone nome="check" tamanho={19} /></div></div>
            <div className="card stat"><div><div className="stat-label">Só no banco</div><div className="stat-value">{conferencia.soBanco.length}</div><div className="stat-sub">{conferencia.soBanco.length ? `${moeda(somaBanco(conferencia.soBanco))} a lançar` : "nada a lançar"}</div></div><div className={`stat-icon ${conferencia.soBanco.length ? "alerta" : "neutro"}`}><Icone nome="alerta" tamanho={19} /></div></div>
            <div className="card stat"><div><div className="stat-label">Só no sistema</div><div className="stat-value">{conferencia.soSistema.length}</div><div className="stat-sub">não aparecem no banco</div></div><div className={`stat-icon ${conferencia.soSistema.length ? "alerta" : "neutro"}`}><Icone nome="relogio" tamanho={19} /></div></div>
            {ofx.saldo && (
              <div className="card stat"><div><div className="stat-label">Saldo em {formatarData(ofx.saldo.data)}</div>
                <div className="stat-value" style={{ fontSize: 20 }}>{saldoBate ? "Bateu" : saldoSistema.dados === null ? "…" : `Dif. ${formatarMoeda(deCentavos(ofx.saldo.centavos - Math.round(saldoSistema.dados * 100)))}`}</div>
                <div className="stat-sub">banco {moeda(ofx.saldo.centavos)} · sistema {saldoSistema.dados === null ? "—" : formatarMoeda(saldoSistema.dados)}</div></div>
                <div className={`stat-icon ${saldoBate ? "" : "perigo"}`}><Icone nome={saldoBate ? "check" : "alerta"} tamanho={19} /></div></div>
            )}
          </div>

          {podeFechar && (
            <div className="alert alert-ok" style={{ marginBottom: 16, justifyContent: "space-between", flexWrap: "wrap" }}>
              <span><Icone nome="cadeado" tamanho={16} /> O saldo do sistema bate com o do banco em {formatarData(ofx.saldo.data)}. Dá para fechar a conta até esse dia.</span>
              <button type="button" className="btn btn-primary btn-sm" onClick={fecharConta} disabled={fechando}>{fechando ? "Fechando..." : `Fechar até ${formatarData(ofx.saldo.data)}`}</button>
            </div>
          )}
          {saldoBate && conciliadoAte && ofx.saldo.data <= conciliadoAte && (
            <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}><Icone nome="cadeado" tamanho={14} /> A conta já está fechada até {formatarData(conciliadoAte)}.</div>
          )}

          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ padding: "14px 16px 4px" }}>
              <h3 className="section-title" style={{ margin: 0 }}>No banco, mas não no sistema</h3>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>Falta lançar (tarifas, rendimentos, PIX recebidos...) ou foi lançado com valor diferente.</div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Data</th><th>Descrição no banco</th><th className="num">Valor</th>{podeRegistrar && <th className="acoes"><span className="sr-only">Ações</span></th>}</tr></thead>
                <tbody>
                  {conferencia.soBanco.length === 0 && <tr><td className="vazio" colSpan={4}>Tudo o que está no banco já está lançado.</td></tr>}
                  {conferencia.soBanco.map((t) => {
                    const sug = podeRegistrar ? sugestaoTitulo(t) : null;
                    const saida = t.centavos < 0;
                    return (
                      <tr key={t.id}>
                        <td>{formatarData(t.data)}</td>
                        <td>{t.descricao}{t.documento && <div className="muted" style={{ fontSize: 12 }}>Doc. {t.documento}</div>}</td>
                        <td className="num" style={{ fontWeight: 600, color: saida ? "var(--danger-text)" : "var(--ok-text)" }}>{moeda(t.centavos)}</td>
                        {podeRegistrar && (
                          <td className="acoes ofx-acoes">
                            {sug && <button type="button" className="btn btn-primary btn-sm" title={`${sug.fornecedor_nome} · ${sug.descricao} · venc. ${formatarData(sug.vencimento)}`}
                              onClick={() => setAcao({ tipo: "pagar", natureza: saida ? "pagar" : "receber", titulo: sug, data: t.data, descricao: t.descricao })}>
                              {saida ? "Pagar" : "Receber"}: {sug.descricao.length > 28 ? `${sug.descricao.slice(0, 28)}…` : sug.descricao}</button>}
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAcao({ tipo: "movimento", inicial: {
                              tipo: saida ? "saida" : "entrada", data: t.data, valor: (Math.abs(t.centavos) / 100).toFixed(2).replace(".", ","),
                              origem: saida ? conta : "", destino: saida ? "" : conta, descricao: t.descricao.slice(0, 200),
                            } })}>{saida ? "Lançar saída avulsa" : "Lançar entrada avulsa"}</button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {conferencia.soBanco.some((t) => t.centavos > 0) && podeRegistrar && (
              <div className="muted" style={{ fontSize: 12.5, padding: "8px 16px 12px" }}>Dízimo ou oferta recebido no banco? Registre em <a href="#/financeiro/entradas">Dízimos e ofertas</a> com a data do banco e confira de novo.</div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ padding: "14px 16px 4px" }}>
              <h3 className="section-title" style={{ margin: 0 }}>No sistema, mas não no banco</h3>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>Lançado com data ou valor diferente do banco, em outra conta, ou ainda não compensado (cheque, depósito).</div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Data</th><th>Lançamento</th><th>Origem</th><th className="num">Valor</th></tr></thead>
                <tbody>
                  {conferencia.soSistema.length === 0 && <tr><td className="vazio" colSpan={4}>Tudo o que está no sistema aparece no banco.</td></tr>}
                  {conferencia.soSistema.map((l) => (
                    <tr key={`${l.origem}-${l.ref_id}`}>
                      <td>{formatarData(l.data)}</td>
                      <td className="truncate" style={{ maxWidth: 380 }}>{l.descricao}</td>
                      <td><Pill tone="neutral">{ORIGENS_EXTRATO[l.origem] ?? l.origem}</Pill></td>
                      <td className="num" style={{ fontWeight: 600, color: l.centavos < 0 ? "var(--danger-text)" : "var(--ok-text)" }}>{moeda(l.centavos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <details className="card ofx-conferidos">
            <summary>Conferidos ({conferencia.casados.length})</summary>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Data no banco</th><th>Descrição no banco</th><th>Lançamento no sistema</th><th className="num">Valor</th></tr></thead>
                <tbody>
                  {conferencia.casados.map(({ banco: b, sistema: l, diferencaDias }) => (
                    <tr key={b.id}>
                      <td>{formatarData(b.data)}{diferencaDias > 0 && <div className="muted" style={{ fontSize: 12 }}>sistema: {formatarData(l.data)}</div>}</td>
                      <td className="truncate" style={{ maxWidth: 260 }}>{b.descricao}</td>
                      <td className="truncate" style={{ maxWidth: 300 }}>{l.descricao}</td>
                      <td className="num">{moeda(b.centavos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}

      {acao?.tipo === "movimento" && (
        <MovimentoModal cadastros={cadastros} contaPadrao={conta} inicial={acao.inicial} onFechar={() => setAcao(null)} onRegistrado={depoisDeLancar} />
      )}
      {acao?.tipo === "pagar" && (
        <PagarModal natureza={acao.natureza} titulo={acao.titulo} caixas={cadastros.caixas} pessoas={cadastros.pessoas} formas={cadastros.formas}
          titulos={acao.natureza === "pagar" ? abertos.dados?.[0] : abertos.dados?.[1]}
          inicial={{ data: acao.data, contaCaixaId: conta, observacao: `Extrato: ${acao.descricao}`.slice(0, 200) }}
          onFechar={() => setAcao(null)} onConcluido={depoisDeLancar} />
      )}
    </div>
  );
}
