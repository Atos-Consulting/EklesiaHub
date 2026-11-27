import { useMemo, useState } from "react";
import { Header, Pill } from "../ui";
import { lbl, inp, msgErro } from "../estilos";
import Icone from "./Icone";
import Modal from "./Modal";
import { useCarga } from "./useCarga";
import { listarConciliacoes, saldoCaixaAte, carregarExtrato, conciliarCaixa, desfazerConciliacao, mensagemErro } from "./db";
import { formatarMoeda, formatarData, hojeISO, lerNumero, paraCentavos, deCentavos } from "./format";
import { ORIGENS_EXTRATO, somarDias, nomeForma } from "./financeiro";

// Financeiro → Caixa → Fechamento do dia (conciliação, v19/v21): mostra o que entrou e saiu no dia por forma,
// confere o saldo com o extrato do banco ou com a contagem de cédulas e moedas (cofre) e, se bater, fecha
// a conta até aquele dia (período travado). O Administrador desfaz o fechamento mais recente, com motivo.

// Cédulas e moedas do real (chave = valor, como o banco guarda na contagem).
const DINHEIRO = [
  { k: "200", c: 20000, r: "R$ 200" }, { k: "100", c: 10000, r: "R$ 100" }, { k: "50", c: 5000, r: "R$ 50" }, { k: "20", c: 2000, r: "R$ 20" },
  { k: "10", c: 1000, r: "R$ 10" }, { k: "5", c: 500, r: "R$ 5" }, { k: "2", c: 200, r: "R$ 2" },
  { k: "1", c: 100, r: "R$ 1", moeda: true }, { k: "0.50", c: 50, r: "50 ¢", moeda: true }, { k: "0.25", c: 25, r: "25 ¢", moeda: true },
  { k: "0.10", c: 10, r: "10 ¢", moeda: true }, { k: "0.05", c: 5, r: "5 ¢", moeda: true },
];
const qtd = (t) => (/^\d{1,6}$/.test(String(t ?? "").trim()) ? Number(t) : 0);
const textoContagem = (cont) => DINHEIRO.filter((d) => cont?.[d.k]).map((d) => `${cont[d.k]} × ${d.r}`).join(" · ");

// Agrupa as linhas do dia por forma (entradas e pagamentos) ou pela origem (movimentos de caixa).
function resumoPorForma(linhas, formas) {
  const ent = new Map();
  const sai = new Map();
  for (const l of linhas) {
    const rotulo = l.forma_pagamento_id ? nomeForma(formas, l.forma_pagamento_id) : (ORIGENS_EXTRATO[l.origem] ?? l.origem);
    const mapa = l.valor > 0 ? ent : sai;
    const g = mapa.get(rotulo) ?? { rotulo, c: 0, n: 0 };
    g.c += Math.abs(paraCentavos(l.valor)); g.n += 1;
    mapa.set(rotulo, g);
  }
  const ord = (m) => [...m.values()].sort((a, b) => b.c - a.c);
  return { entradas: ord(ent), saidas: ord(sai) };
}

export default function Conciliacao({ cadastros, podeConciliar, podeDesfazer }) {
  const hoje = hojeISO();
  const caixasAtivas = cadastros.caixas.filter((c) => c.ativo);
  const [conta, setConta] = useState(() => String((caixasAtivas[0] ?? cadastros.caixas[0])?.id ?? ""));
  const [dia, setDia] = useState(hoje);
  const [saldoTxt, setSaldoTxt] = useState("");
  const [observacao, setObservacao] = useState("");
  const [modo, setModo] = useState(null); // "contagem" | "saldo" (null = padrão da conta: banco informa o saldo, cofre conta)
  const [contagem, setContagem] = useState({});
  const [versao, setVersao] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [desfazer, setDesfazer] = useState(null);

  const caixa = cadastros.caixas.find((c) => String(c.id) === conta);
  const historico = useCarga(conta ? `${conta}|${versao}` : null, () => listarConciliacoes(Number(conta)));
  const ultima = (historico.dados || []).find((c) => !c.desfeita) ?? null;
  const inicio = ultima ? somarDias(ultima.data, 1) : caixa?.data_saldo_inicial;

  let erroDia = "";
  if (!dia) erroDia = "Informe o dia";
  else if (dia > hoje) erroDia = "Não é possível conciliar um dia futuro";
  else if (caixa && dia < caixa.data_saldo_inicial) erroDia = `Antes do saldo inicial da conta (${formatarData(caixa.data_saldo_inicial)})`;
  else if (ultima && dia <= ultima.data) erroDia = `A conta já está conciliada até ${formatarData(ultima.data)}`;

  const diaOk = conta && !erroDia && !historico.carregando;
  const sistema = useCarga(diaOk ? `${conta}|${dia}|${versao}` : null, () => saldoCaixaAte(Number(conta), dia));
  const lancamentos = useCarga(diaOk && inicio ? `${conta}|${inicio}|${dia}|${versao}` : null,
    () => carregarExtrato(Number(conta), { de: inicio, ate: dia }));

  const modoAtual = modo ?? (caixa?.banco || caixa?.numero_conta ? "saldo" : "contagem");
  const totalContado = DINHEIRO.reduce((a, d) => a + qtd(contagem[d.k]) * d.c, 0);
  const contou = DINHEIRO.some((d) => qtd(contagem[d.k]) > 0);
  const informado = modoAtual === "contagem" ? (contou ? deCentavos(totalContado) : null) : saldoTxt.trim() ? lerNumero(saldoTxt) : null;
  const saldoSistema = diaOk && !sistema.carregando ? sistema.dados : null;
  const diferenca = informado !== null && Number.isFinite(informado) && saldoSistema !== null ? deCentavos(paraCentavos(informado) - paraCentavos(saldoSistema)) : null;
  const bate = diferenca === 0;

  const linhas = useMemo(() => {
    if (!lancamentos.dados || lancamentos.carregando) return [];
    let saldo = paraCentavos(lancamentos.dados.saldoAnterior);
    return lancamentos.dados.linhas.map((l) => { saldo += paraCentavos(l.valor); return { ...l, valor: Number(l.valor), saldo: deCentavos(saldo) }; });
  }, [lancamentos.dados, lancamentos.carregando]);
  const doDia = linhas.filter((l) => l.data === dia);
  const saldoInicioDia = lancamentos.dados && !lancamentos.carregando
    ? deCentavos(paraCentavos(lancamentos.dados.saldoAnterior) + linhas.filter((l) => l.data < dia).reduce((a, l) => a + paraCentavos(l.valor), 0)) : null;
  const resumo = resumoPorForma(doDia, cadastros.formas);
  const somaC = (l) => l.reduce((a, g) => a + g.c, 0);
  const diasAbertos = inicio && dia && inicio < dia; // fechar este dia fecha também os anteriores ainda abertos

  async function conciliar() {
    setErro("");
    setAviso("");
    if (!bate) return;
    setSalvando(true);
    try {
      const cont = modoAtual === "contagem" ? Object.fromEntries(DINHEIRO.filter((d) => qtd(contagem[d.k]) > 0).map((d) => [d.k, qtd(contagem[d.k])])) : null;
      await conciliarCaixa(Number(conta), dia, informado, observacao, cont);
      setAviso(`${caixa?.nome}: dia ${formatarData(dia)} fechado.`);
      setSaldoTxt("");
      setContagem({});
      setObservacao("");
      setVersao((v) => v + 1);
    } catch (e) { setErro(mensagemErro(e)); }
    finally { setSalvando(false); }
  }

  const trocarConta = (v) => { setConta(v); setSaldoTxt(""); setContagem({}); setModo(null); setErro(""); setAviso(""); };

  return (
    <div>
      <div className="page-header">
        <Header title="Fechamento do dia" subtitle="Veja o que entrou e saiu no dia em cada conta, por forma de pagamento, e confira o saldo: conte as cédulas e moedas do cofre ou informe o saldo do extrato do banco. Se bater, o dia é fechado e os lançamentos até ali ficam travados (ninguém lança nem estorna com essa data). Para corrigir um dia fechado, um Administrador desfaz o fechamento mais recente." />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="toolbar">
          <label>Conta caixa
            <select value={conta} onChange={(e) => trocarConta(e.target.value)} style={{ ...inp, width: 240 }}>
              {cadastros.caixas.length === 0 && <option value="">Nenhuma conta cadastrada</option>}
              {cadastros.caixas.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.ativo ? "" : " (inativa)"}</option>)}
            </select>
          </label>
          <div style={{ alignSelf: "flex-end", paddingBottom: 9, display: "flex", alignItems: "center", gap: 6 }}>
            {historico.dados && (ultima
              ? <><Icone nome="cadeado" tamanho={15} /><span>Fechada até <strong>{formatarData(ultima.data)}</strong> · saldo {formatarMoeda(ultima.saldo)}{ultima.conciliado_por_nome ? ` · por ${ultima.conciliado_por_nome}` : ""}</span></>
              : <span className="muted">Nenhum dia fechado nesta conta ainda.</span>)}
          </div>
        </div>
      </div>

      {historico.erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{historico.erro}</span></div>}
      {aviso && <div className="alert alert-ok" role="status" style={{ marginBottom: 16 }}><Icone nome="check" tamanho={16} /><span>{aviso}</span></div>}

      {podeConciliar && conta && ultima && ultima.data >= hoje && (
        <div className="card muted" style={{ marginBottom: 16, padding: "16px 20px" }}>
          O dia de hoje já está fechado nesta conta. O próximo fechamento pode ser feito a partir de amanhã.
        </div>
      )}
      {podeConciliar && conta && !(ultima && ultima.data >= hoje) && (
        <div className="card" style={{ marginBottom: 16, padding: "16px 20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0 16px", alignItems: "start" }}>
            <div>
              <label style={lbl} htmlFor="cc-dia">Dia a fechar *</label>
              <input id="cc-dia" type="date" max={hoje} style={{ ...inp, ...(erroDia ? { borderColor: "var(--danger)" } : {}) }} value={dia} onChange={(e) => { setDia(e.target.value); setErro(""); setAviso(""); }} />
              {erroDia && <div style={msgErro}>{erroDia}</div>}
            </div>
            <div>
              <label style={lbl}>Saldo no início do dia</label>
              <div style={{ ...inp, background: "var(--surface-2)", textAlign: "right" }}>{saldoInicioDia === null || !diaOk ? "—" : formatarMoeda(saldoInicioDia)}</div>
            </div>
          </div>

          {diaOk && lancamentos.dados && !lancamentos.carregando && (
            <div className="fech-resumo">
              <div>
                <h4>Entrou em {formatarData(dia)}</h4>
                {resumo.entradas.length === 0 && <p className="muted">Nada.</p>}
                {resumo.entradas.map((g) => <div key={g.rotulo} className="fech-linha"><span>{g.rotulo} <small className="muted">({g.n})</small></span><strong className="rel-pos">{formatarMoeda(deCentavos(g.c))}</strong></div>)}
                {resumo.entradas.length > 0 && <div className="fech-linha fech-total"><span>Total</span><strong>{formatarMoeda(deCentavos(somaC(resumo.entradas)))}</strong></div>}
              </div>
              <div>
                <h4>Saiu em {formatarData(dia)}</h4>
                {resumo.saidas.length === 0 && <p className="muted">Nada.</p>}
                {resumo.saidas.map((g) => <div key={g.rotulo} className="fech-linha"><span>{g.rotulo} <small className="muted">({g.n})</small></span><strong className="rel-neg">{formatarMoeda(deCentavos(g.c))}</strong></div>)}
                {resumo.saidas.length > 0 && <div className="fech-linha fech-total"><span>Total</span><strong>{formatarMoeda(deCentavos(somaC(resumo.saidas)))}</strong></div>}
              </div>
            </div>
          )}
          {diaOk && diasAbertos && (
            <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
              Os dias desde {formatarData(inicio)} ainda não foram fechados: fechar {formatarData(dia)} fecha também esses dias (os lançamentos estão na lista abaixo).
            </div>
          )}

          <div className="abas" role="tablist" aria-label="Como conferir" style={{ marginTop: 16 }}>
            <button type="button" role="tab" aria-selected={modoAtual === "contagem"} className={`aba${modoAtual === "contagem" ? " ativa" : ""}`} onClick={() => setModo("contagem")}>Contar cédulas e moedas</button>
            <button type="button" role="tab" aria-selected={modoAtual === "saldo"} className={`aba${modoAtual === "saldo" ? " ativa" : ""}`} onClick={() => setModo("saldo")}>Informar o saldo do extrato</button>
          </div>
          {modoAtual === "contagem" ? (
            <div className="fech-contagem">
              {DINHEIRO.map((d) => (
                <label key={d.k} className={d.moeda ? "moeda" : undefined}>
                  <span>{d.r}</span>
                  <input inputMode="numeric" placeholder="0" maxLength={6} value={contagem[d.k] ?? ""} style={{ ...inp, textAlign: "right" }}
                    onChange={(e) => { setContagem((c) => ({ ...c, [d.k]: e.target.value.replace(/\D/g, "") })); setErro(""); setAviso(""); }} />
                  <small className="muted">{qtd(contagem[d.k]) ? formatarMoeda(deCentavos(qtd(contagem[d.k]) * d.c)) : ""}</small>
                </label>
              ))}
            </div>
          ) : (
            <div style={{ maxWidth: 260 }}>
              <label style={lbl} htmlFor="cc-saldo">Saldo no extrato (fim do dia) *</label>
              <input id="cc-saldo" inputMode="decimal" placeholder="0,00" style={{ ...inp, textAlign: "right" }} value={saldoTxt} onChange={(e) => { setSaldoTxt(e.target.value); setErro(""); setAviso(""); }} />
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0 16px", marginTop: 4 }}>
            <div>
              <label style={lbl}>{modoAtual === "contagem" ? "Total contado" : "Saldo informado"}</label>
              <div style={{ ...inp, background: "var(--surface-2)", textAlign: "right", fontWeight: 600 }}>{informado === null || !Number.isFinite(informado) ? "—" : formatarMoeda(informado)}</div>
            </div>
            <div>
              <label style={lbl}>Saldo do sistema (fim do dia)</label>
              <div style={{ ...inp, background: "var(--surface-2)", textAlign: "right", fontWeight: 600 }}>{saldoSistema === null ? "—" : formatarMoeda(saldoSistema)}</div>
            </div>
            <div>
              <label style={lbl}>Diferença</label>
              <div style={{ ...inp, background: "var(--surface-2)", textAlign: "right", fontWeight: 650, color: diferenca === null ? undefined : bate ? "var(--ok-text)" : "var(--danger)" }}>
                {diferenca === null ? "—" : bate ? "Bateu" : formatarMoeda(diferenca)}
              </div>
            </div>
          </div>
          <label style={lbl} htmlFor="cc-obs">Observação</label>
          <input id="cc-obs" maxLength={300} style={inp} value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex.: contado por Ana e João depois do culto de domingo" />
          {diferenca !== null && !bate && (
            <div className="alert alert-warn" style={{ marginTop: 12 }}><Icone nome="alerta" tamanho={16} />
              <span>{diferenca > 0 ? "Sobrou dinheiro" : "Faltou dinheiro"} em relação ao sistema. Confira os lançamentos abaixo: falta registrar algo (ex.: uma oferta, tarifa, rendimento) ou algo foi lançado com valor ou data errados. O dia só é fechado quando a diferença zerar.</span>
            </div>
          )}
          {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 12 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <button className="btn btn-primary" onClick={conciliar} disabled={!bate || salvando || Boolean(erroDia)}>
              <Icone nome="cadeado" tamanho={15} /> {salvando ? "Fechando..." : dia && !erroDia ? `Fechar o dia ${formatarData(dia)}` : "Fechar o dia"}
            </button>
          </div>
        </div>
      )}

      {conta && diaOk && inicio && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ padding: "14px 16px 4px" }}>
            <h3 className="section-title" style={{ margin: 0 }}>Lançamentos a conferir</h3>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>De {formatarData(inicio)} a {formatarData(dia)}{ultima ? " (desde a última conciliação)" : " (desde o saldo inicial)"} · saldo anterior {lancamentos.dados && !lancamentos.carregando ? formatarMoeda(lancamentos.dados.saldoAnterior) : "—"}</div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Data</th><th>Lançamento</th><th>Origem</th><th className="num">Entrada</th><th className="num">Saída</th><th className="num">Saldo</th></tr></thead>
              <tbody>
                {lancamentos.carregando && <tr><td className="vazio" colSpan={6}>Carregando...</td></tr>}
                {!lancamentos.carregando && linhas.length === 0 && <tr><td className="vazio" colSpan={6}>Nenhum lançamento no período.</td></tr>}
                {linhas.map((l) => (
                  <tr key={`${l.origem}-${l.ref_id}`}>
                    <td>{formatarData(l.data)}</td>
                    <td className="truncate" style={{ maxWidth: 360 }}>{l.descricao}</td>
                    <td><Pill tone={l.valor > 0 ? "ok" : "neutral"}>{ORIGENS_EXTRATO[l.origem] ?? l.origem}</Pill></td>
                    <td className="num" style={{ color: "var(--ok-text)", fontWeight: 550 }}>{l.valor > 0 ? formatarMoeda(l.valor) : ""}</td>
                    <td className="num" style={{ color: "var(--danger-text)", fontWeight: 550 }}>{l.valor < 0 ? formatarMoeda(-l.valor) : ""}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{formatarMoeda(l.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {conta && (
        <div className="card">
          <div style={{ padding: "14px 16px 4px" }}><h3 className="section-title" style={{ margin: 0 }}>Dias fechados</h3></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Fechado até</th><th className="num">Saldo</th><th>Por</th><th>Em</th><th>Situação</th><th className="acoes"><span className="sr-only">Ações</span></th></tr></thead>
              <tbody>
                {historico.dados && historico.dados.length === 0 && <tr><td className="vazio" colSpan={6}>Nenhum dia fechado nesta conta.</td></tr>}
                {(historico.dados || []).map((c) => (
                  <tr key={c.id} style={c.desfeita ? { color: "var(--faint)" } : undefined}>
                    <td style={{ fontWeight: 550 }}>{formatarData(c.data)}{c.observacao && <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{c.observacao}</div>}{c.contagem && <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>Contagem: {textoContagem(c.contagem)}</div>}</td>
                    <td className="num">{formatarMoeda(c.saldo)}</td>
                    <td>{c.conciliado_por_nome ?? "—"}</td>
                    <td>{new Date(c.criado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td>{c.desfeita
                      ? <><Pill tone="danger">Desfeita</Pill><div className="muted" style={{ fontSize: 12 }}>{c.motivo_desfazer}{c.desfeita_por_nome ? ` · ${c.desfeita_por_nome}` : ""}</div></>
                      : <Pill tone={c.id === ultima?.id ? "ok" : "neutral"}>{c.id === ultima?.id ? "Vigente" : "Ativa"}</Pill>}</td>
                    <td className="acoes">{podeDesfazer && c.id === ultima?.id && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDesfazer(c)}>Desfazer</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {desfazer && <DesfazerModal conciliacao={desfazer} conta={caixa?.nome} onFechar={() => setDesfazer(null)}
        onConcluido={() => { setDesfazer(null); setAviso(""); setVersao((v) => v + 1); }} />}
    </div>
  );
}

function DesfazerModal({ conciliacao: c, conta, onFechar, onConcluido }) {
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const curto = motivo.trim().length < 5;

  async function confirmar() {
    setErro("");
    if (curto) { setErro("Informe o motivo (mínimo de 5 caracteres)."); return; }
    setSalvando(true);
    try { await desfazerConciliacao(c.id, motivo); onConcluido(); }
    catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }

  return (
    <Modal titulo="Desfazer o fechamento?" largura={480} nivel={300} onFechar={onFechar}
      rodape={<><button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Voltar</button>
        <button className="btn btn-primary" style={{ background: "var(--danger)", borderColor: "var(--danger)" }} onClick={confirmar} disabled={salvando}>{salvando ? "Desfazendo..." : "Desfazer"}</button></>}>
      <p style={{ marginTop: 0 }}>A conta <strong>{conta}</strong> deixa de estar fechada até <strong>{formatarData(c.data)}</strong>, e os lançamentos desse período voltam a poder ser lançados e estornados. O fechamento fica no histórico como desfeito.</p>
      <label style={lbl} htmlFor="dc-motivo">Motivo *</label>
      <input id="dc-motivo" autoFocus maxLength={300} style={inp} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: faltou lançar a tarifa de novembro" />
      {erro && <div style={msgErro}>{erro}</div>}
    </Modal>
  );
}
