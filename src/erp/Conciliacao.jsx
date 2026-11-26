import { useMemo, useState } from "react";
import { Header, Pill } from "../ui";
import { lbl, inp, msgErro } from "../estilos";
import Icone from "./Icone";
import Modal from "./Modal";
import { useCarga } from "./useCarga";
import { listarConciliacoes, saldoCaixaAte, carregarExtrato, conciliarCaixa, desfazerConciliacao, mensagemErro } from "./db";
import { formatarMoeda, formatarData, hojeISO, lerNumero, paraCentavos, deCentavos } from "./format";
import { ORIGENS_EXTRATO, somarDias } from "./financeiro";

// Financeiro → Caixa → Conciliação (v19): confere o saldo de uma conta num dia com o extrato do banco
// (ou a contagem do cofre) e marca a conta como conciliada até aquele dia. Só concilia se bater;
// o período conciliado fica travado. O Administrador desfaz a mais recente, com motivo.
export default function Conciliacao({ cadastros, podeConciliar, podeDesfazer }) {
  const hoje = hojeISO();
  const caixasAtivas = cadastros.caixas.filter((c) => c.ativo);
  const [conta, setConta] = useState(() => String((caixasAtivas[0] ?? cadastros.caixas[0])?.id ?? ""));
  const [dia, setDia] = useState(hoje);
  const [saldoTxt, setSaldoTxt] = useState("");
  const [observacao, setObservacao] = useState("");
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

  const informado = saldoTxt.trim() ? lerNumero(saldoTxt) : null;
  const saldoSistema = diaOk && !sistema.carregando ? sistema.dados : null;
  const diferenca = informado !== null && Number.isFinite(informado) && saldoSistema !== null ? deCentavos(paraCentavos(informado) - paraCentavos(saldoSistema)) : null;
  const bate = diferenca === 0;

  const linhas = useMemo(() => {
    if (!lancamentos.dados || lancamentos.carregando) return [];
    let saldo = paraCentavos(lancamentos.dados.saldoAnterior);
    return lancamentos.dados.linhas.map((l) => { saldo += paraCentavos(l.valor); return { ...l, valor: Number(l.valor), saldo: deCentavos(saldo) }; });
  }, [lancamentos.dados, lancamentos.carregando]);

  async function conciliar() {
    setErro("");
    setAviso("");
    if (!bate) return;
    setSalvando(true);
    try {
      await conciliarCaixa(Number(conta), dia, informado, observacao);
      setAviso(`${caixa?.nome} conciliada até ${formatarData(dia)}.`);
      setSaldoTxt("");
      setObservacao("");
      setVersao((v) => v + 1);
    } catch (e) { setErro(mensagemErro(e)); }
    finally { setSalvando(false); }
  }

  const trocarConta = (v) => { setConta(v); setSaldoTxt(""); setErro(""); setAviso(""); };

  return (
    <div>
      <div className="page-header">
        <Header title="Conciliação" subtitle="Confira o saldo de uma conta num dia com o extrato do banco (ou a contagem do cofre). Se bater, a conta fica conciliada até esse dia e os lançamentos até ali ficam travados: ninguém lança nem estorna com data no período. Para corrigir algo já conciliado, um Administrador desfaz a conciliação mais recente." />
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
              ? <><Icone nome="cadeado" tamanho={15} /><span>Conciliada até <strong>{formatarData(ultima.data)}</strong> · saldo {formatarMoeda(ultima.saldo)}{ultima.conciliado_por_nome ? ` · por ${ultima.conciliado_por_nome}` : ""}</span></>
              : <span className="muted">Esta conta ainda não foi conciliada.</span>)}
          </div>
        </div>
      </div>

      {historico.erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{historico.erro}</span></div>}
      {aviso && <div className="alert alert-ok" role="status" style={{ marginBottom: 16 }}><Icone nome="check" tamanho={16} /><span>{aviso}</span></div>}

      {podeConciliar && conta && ultima && ultima.data >= hoje && (
        <div className="card muted" style={{ marginBottom: 16, padding: "16px 20px" }}>
          A conta está conciliada até hoje. A próxima conciliação pode ser feita a partir de amanhã.
        </div>
      )}
      {podeConciliar && conta && !(ultima && ultima.data >= hoje) && (
        <div className="card" style={{ marginBottom: 16, padding: "16px 20px" }}>
          <h3 className="section-title" style={{ marginTop: 0 }}>Nova conciliação</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0 16px", alignItems: "start" }}>
            <div>
              <label style={lbl} htmlFor="cc-dia">Conciliar até o dia *</label>
              <input id="cc-dia" type="date" max={hoje} style={{ ...inp, ...(erroDia ? { borderColor: "var(--danger)" } : {}) }} value={dia} onChange={(e) => { setDia(e.target.value); setErro(""); setAviso(""); }} />
              {erroDia && <div style={msgErro}>{erroDia}</div>}
            </div>
            <div>
              <label style={lbl} htmlFor="cc-saldo">Saldo no extrato (fim do dia) *</label>
              <input id="cc-saldo" inputMode="decimal" placeholder="0,00" style={{ ...inp, textAlign: "right" }} value={saldoTxt} onChange={(e) => { setSaldoTxt(e.target.value); setErro(""); setAviso(""); }} />
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Do extrato do banco ou da contagem do cofre.</div>
            </div>
            <div>
              <label style={lbl}>Saldo do sistema</label>
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
          <input id="cc-obs" maxLength={300} style={inp} value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex.: conferido com o extrato de novembro do Banco do Brasil" />
          {diferenca !== null && !bate && (
            <div className="alert alert-warn" style={{ marginTop: 12 }}><Icone nome="alerta" tamanho={16} />
              <span>O saldo não bateu. Confira os lançamentos abaixo com o extrato: falta registrar algo (ex.: tarifa, rendimento, um dízimo) ou algo foi lançado com valor ou data errados. A conciliação só é feita quando a diferença zerar.</span>
            </div>
          )}
          {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 12 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <button className="btn btn-primary" onClick={conciliar} disabled={!bate || salvando || Boolean(erroDia)}>
              <Icone nome="cadeado" tamanho={15} /> {salvando ? "Conciliando..." : dia && !erroDia ? `Conciliar até ${formatarData(dia)}` : "Conciliar"}
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
          <div style={{ padding: "14px 16px 4px" }}><h3 className="section-title" style={{ margin: 0 }}>Histórico de conciliações</h3></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Conciliada até</th><th className="num">Saldo</th><th>Por</th><th>Em</th><th>Situação</th><th className="acoes"><span className="sr-only">Ações</span></th></tr></thead>
              <tbody>
                {historico.dados && historico.dados.length === 0 && <tr><td className="vazio" colSpan={6}>Nenhuma conciliação nesta conta.</td></tr>}
                {(historico.dados || []).map((c) => (
                  <tr key={c.id} style={c.desfeita ? { color: "var(--faint)" } : undefined}>
                    <td style={{ fontWeight: 550 }}>{formatarData(c.data)}{c.observacao && <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{c.observacao}</div>}</td>
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
    <Modal titulo="Desfazer conciliação?" largura={480} nivel={300} onFechar={onFechar}
      rodape={<><button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Voltar</button>
        <button className="btn btn-primary" style={{ background: "var(--danger)", borderColor: "var(--danger)" }} onClick={confirmar} disabled={salvando}>{salvando ? "Desfazendo..." : "Desfazer"}</button></>}>
      <p style={{ marginTop: 0 }}>A conta <strong>{conta}</strong> deixa de estar conciliada até <strong>{formatarData(c.data)}</strong>, e os lançamentos desse período voltam a poder ser lançados e estornados. A conciliação fica no histórico como desfeita.</p>
      <label style={lbl} htmlFor="dc-motivo">Motivo *</label>
      <input id="dc-motivo" autoFocus maxLength={300} style={inp} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: faltou lançar a tarifa de novembro" />
      {erro && <div style={msgErro}>{erro}</div>}
    </Modal>
  );
}
