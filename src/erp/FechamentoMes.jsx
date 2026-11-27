import { useState } from "react";
import { Header, Pill } from "../ui";
import { inp, lbl } from "../estilos";
import Icone from "./Icone";
import Modal from "./Modal";
import ThOrdenavel from "./ThOrdenavel";
import { useOrdenacao } from "./useOrdenacao";
import { useCarga } from "./useCarga";
import { conferirFechamentoMes, listarFechamentos, fecharMes, reabrirMes, mensagemErro } from "./db";
import { formatarMoeda, formatarData, hojeISO } from "./format";
import { somarMeses } from "./financeiro";

// Financeiro → Caixa → Fechamento do mês (v24). Confere o mês (todas as contas com o Fechamento do dia em dia,
// mais avisos), fecha e guarda o resumo dos saldos. Mês fechado fica travado: nada que mexa em saldo entra ou
// é estornado com data até o fim dele. Os meses fecham em ordem; só o Administrador reabre (o mais recente).

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const nomeMes = (iso) => `${MESES[Number(iso.slice(5, 7)) - 1]} de ${iso.slice(0, 4)}`;
const tituloMes = (iso) => { const t = nomeMes(iso); return t[0].toUpperCase() + t.slice(1); };
const primeiro = (iso) => `${iso.slice(0, 7)}-01`;

const COLUNAS = {
  mes: (f) => f.mes,
  em: (f) => f.criado_em,
  por: (f) => f.fechado_por_nome,
  entradas: (f) => Number(f.resumo?.totais?.entradas ?? 0),
  saidas: (f) => Number(f.resumo?.totais?.saidas ?? 0),
  final: (f) => Number(f.resumo?.totais?.saldo_final ?? 0),
  situacao: (f) => (f.reaberto ? 1 : 0),
};

function Item({ ok, aviso, info, titulo, children }) {
  const tom = ok ? "ok" : info ? "info" : aviso ? "aviso" : "falta";
  return (
    <li className={`fm-item fm-${tom}`}>
      <span className="fm-icone"><Icone nome={ok ? "check" : info ? "relogio" : "alerta"} tamanho={15} /></span>
      <div><strong>{titulo}</strong>{children && <div className="fm-det">{children}</div>}</div>
    </li>
  );
}

function TabelaResumo({ contas, totais }) {
  return (
    <div className="table-wrap">
      <table className="rel-tabela">
        <thead><tr><th>Conta</th><th className="num">Saldo anterior</th><th className="num">Entradas</th><th className="num">Saídas</th><th className="num">Transferências</th><th className="num">Saldo final</th></tr></thead>
        <tbody>
          {contas.length === 0 && <tr><td colSpan={6} className="muted">Nenhuma conta caixa no período.</td></tr>}
          {contas.map((c) => (
            <tr key={c.id}>
              <td>{c.nome}{c.ativo ? "" : " (inativa)"}</td>
              <td className="num">{formatarMoeda(c.saldo_anterior)}</td>
              <td className="num">{Number(c.entradas) ? formatarMoeda(c.entradas) : "—"}</td>
              <td className="num">{Number(c.saidas) ? formatarMoeda(-c.saidas) : "—"}</td>
              <td className="num">{Number(c.transferencias) ? formatarMoeda(c.transferencias) : "—"}</td>
              <td className="num" style={{ fontWeight: 650 }}>{formatarMoeda(c.saldo_final)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr>
          <td>Total</td><td className="num">{formatarMoeda(totais.saldo_anterior)}</td><td className="num">{formatarMoeda(totais.entradas)}</td>
          <td className="num">{formatarMoeda(-totais.saidas)}</td><td /><td className="num">{formatarMoeda(totais.saldo_final)}</td>
        </tr></tfoot>
      </table>
    </div>
  );
}

function ReabrirModal({ fechamento, onFechar, onConcluido }) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  async function confirmar() {
    if (motivo.trim().length < 5) { setErro("Informe o motivo (mínimo de 5 caracteres)."); return; }
    setOcupado(true); setErro("");
    try { await reabrirMes(fechamento.id, motivo); onConcluido(); }
    catch (e) { setErro(mensagemErro(e)); setOcupado(false); }
  }
  return (
    <Modal titulo={`Reabrir ${nomeMes(fechamento.mes)}?`} largura={480} onFechar={onFechar}
      rodape={<><button className="btn btn-ghost" onClick={onFechar} disabled={ocupado}>Voltar</button><button className="btn btn-danger" onClick={confirmar} disabled={ocupado}>{ocupado ? "Reabrindo..." : "Reabrir o mês"}</button></>}>
      <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "4px 0 12px" }}>
        O mês volta a aceitar lançamentos e estornos. O fechamento fica no histórico como <strong>reaberto</strong>, com o motivo. Depois de corrigir, feche de novo.
      </p>
      <label style={lbl} htmlFor="fm-motivo">Motivo *</label>
      <input id="fm-motivo" autoFocus maxLength={300} style={inp} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: faltou lançar a tarifa do banco" />
      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 12 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}

export default function FechamentoMes({ podeFechar, podeReabrir }) {
  const hoje = hojeISO();
  const [versao, setVersao] = useState(0);
  const [mesEscolhido, setMes] = useState(null); // null = o próximo a fechar
  const [obs, setObs] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  const [fechando, setFechando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [reabrir, setReabrir] = useState(null);

  const hist = useCarga(`fm-hist|${versao}`, () => listarFechamentos());
  const ativos = (hist.dados ?? []).filter((f) => !f.reaberto);
  const ultimo = ativos[0] ?? null; // lista vem do mais recente
  const sugerido = ultimo ? somarMeses(ultimo.mes, 1) : somarMeses(primeiro(hoje), -1);
  const mes = mesEscolhido ?? (hist.dados ? sugerido : null);
  const conf = useCarga(mes ? `fm-conf|${mes}|${versao}` : null, () => conferirFechamentoMes(mes));
  const c = conf.dados;
  const fechamento = c?.fechado ? ativos.find((f) => f.mes === c.mes) : null;
  const pendentes = c ? c.contas.filter((x) => x.pendente) : [];
  const foraDeOrdem = c && c.proximo && c.proximo !== c.mes && !c.fechado;
  const podeAgora = c && !c.fechado && c.terminou && !foraDeOrdem && pendentes.length === 0;
  const ordenacao = useOrdenacao(hist.dados ?? [], COLUNAS, { chave: "mes", dir: "desc" });

  async function fechar() {
    setConfirmar(false); setFechando(true); setErro(""); setOk("");
    try {
      await fecharMes(mes, obs);
      setOk(`${tituloMes(mes)} fechado.`); setObs(""); setMes(null); setVersao((v) => v + 1);
    } catch (e) { setErro(mensagemErro(e)); }
    finally { setFechando(false); }
  }

  return (
    <div>
      <div className="page-header">
        <Header title="Fechamento do mês" subtitle="Confira e feche o mês inteiro: com todas as contas conferidas no Fechamento do dia, o sistema guarda os saldos e trava o período. Para corrigir depois, o Administrador reabre o mês, com motivo." />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="toolbar">
          <label>Mês
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setMes(somarMeses(mes, -1))} disabled={!mes} aria-label="Mês anterior">‹</button>
              <input type="month" value={mes ? mes.slice(0, 7) : ""} onChange={(e) => { setOk(""); setErro(""); if (/^\d{4}-\d{2}$/.test(e.target.value)) setMes(`${e.target.value}-01`); }} style={{ ...inp, width: 170 }} />
              <button type="button" className="btn btn-ghost" onClick={() => setMes(somarMeses(mes, 1))} disabled={!mes} aria-label="Próximo mês">›</button>
            </div>
          </label>
          {mesEscolhido && mesEscolhido !== sugerido && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-end" }} onClick={() => setMes(null)}>Ir para o próximo a fechar ({nomeMes(sugerido)})</button>
          )}
          <span className="muted" style={{ marginLeft: "auto", alignSelf: "flex-end", fontSize: 12.5 }}>
            {ultimo ? `Último mês fechado: ${nomeMes(ultimo.mes)}` : "Nenhum mês fechado ainda"}
          </span>
        </div>
      </div>

      {ok && <div className="alert alert-ok" style={{ marginBottom: 16 }}><Icone nome="check" tamanho={16} /><span>{ok} Lançamentos com data até o fim do mês ficam travados.</span></div>}
      {(hist.erro || conf.erro) && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{hist.erro || conf.erro}</span></div>}
      {mes && !c && !conf.erro && <div className="carregando-linha"><div className="spinner" /> Carregando...</div>}

      {c && (
        <section className="card painel-bloco" style={{ marginBottom: 16 }}>
          <div className="painel-cab">
            <h3>{tituloMes(c.mes)}</h3>
            {c.fechado ? <Pill tone="ok">Fechado</Pill> : !c.terminou ? <Pill tone="neutral">Em andamento</Pill> : podeAgora ? <Pill tone="ok">Pronto para fechar</Pill> : <Pill tone="warn">Falta conferir</Pill>}
          </div>

          {c.fechado && fechamento && (
            <p className="muted" style={{ margin: "0 0 12px", fontSize: 13.5 }}>
              Fechado em {formatarData(fechamento.criado_em.slice(0, 10))}{fechamento.fechado_por_nome ? ` por ${fechamento.fechado_por_nome}` : ""}.
              {fechamento.observacao ? ` Observação: ${fechamento.observacao}` : ""} Os saldos abaixo são os guardados no fechamento.
            </p>
          )}

          {!c.fechado && (
            <ul className="fm-lista">
              {!c.terminou && <Item info titulo={`O mês termina em ${formatarData(c.fim)}`}>Só dá para fechar depois do último dia. Enquanto isso, a conferência abaixo mostra como está até agora.</Item>}
              {foraDeOrdem && <Item titulo={`Os meses fecham em ordem: o próximo é ${nomeMes(c.proximo)}`} />}
              <Item ok={pendentes.length === 0} titulo={pendentes.length === 0 ? `Todas as contas conferidas até ${formatarData(c.fim)}` : `Fechamento do dia pendente em ${pendentes.length} conta(s)`}>
                {pendentes.length > 0 && (
                  <>
                    <ul>
                      {pendentes.map((p) => (
                        <li key={p.id}>{p.nome}: {p.conciliado_ate ? `conferida até ${formatarData(p.conciliado_ate)}` : "nunca conferida"}, último lançamento em {formatarData(p.ultimo_lancamento)}</li>
                      ))}
                    </ul>
                    <a href="#/financeiro/caixa/conciliacao">Abrir o Fechamento do dia</a>
                  </>
                )}
              </Item>
              <Item ok={!c.rascunhos} aviso titulo={c.rascunhos ? `${c.rascunhos} nota(s) de entrada em rascunho com emissão até ${formatarData(c.fim)}` : "Nenhuma nota em rascunho do período"}>
                {c.rascunhos > 0 && <>Não impede o fechamento, mas a despesa ficará fora deste mês. <a href="#/administrativo/notas">Ver notas</a></>}
              </Item>
              <Item ok={!Number(c.sem_centro.qtd)} aviso titulo={Number(c.sem_centro.qtd) ? `${c.sem_centro.qtd} saída(s) sem centro de custo no mês (${formatarMoeda(c.sem_centro.valor)})` : "Todas as saídas do mês têm centro de custo"}>
                {Number(c.sem_centro.qtd) > 0 && "Aparecem como “Sem centro de custo” no Relatório do mês e no Orçamento."}
              </Item>
              <Item ok={!Number(c.vencidos.qtd)} aviso titulo={Number(c.vencidos.qtd) ? `${c.vencidos.qtd} conta(s) a pagar vencida(s) em aberto até ${formatarData(c.fim)} (${formatarMoeda(c.vencidos.valor)})` : "Nenhuma conta a pagar vencida em aberto"}>
                {Number(c.vencidos.qtd) > 0 && <>Confira se foram pagas e só falta dar baixa. <a href="#/financeiro/lancamentos/pagar/vencido">Ver vencidas</a></>}
              </Item>
            </ul>
          )}

          <h4 className="fm-sub">Saldos do mês</h4>
          {fechamento
            ? <TabelaResumo contas={fechamento.resumo.contas} totais={fechamento.resumo.totais} />
            : <TabelaResumo contas={c.contas} totais={c.totais} />}

          {!c.fechado && podeFechar && (
            <div className="fm-fechar">
              <div style={{ flex: 1, minWidth: 240 }}>
                <label style={lbl} htmlFor="fm-obs">Observação (opcional)</label>
                <input id="fm-obs" maxLength={500} style={inp} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: apresentado ao conselho fiscal em 05/12" />
              </div>
              <button type="button" className="btn btn-primary" onClick={() => setConfirmar(true)} disabled={!podeAgora || fechando}>
                <Icone nome="cadeado" tamanho={16} /> {fechando ? "Fechando..." : `Fechar ${nomeMes(c.mes)}`}
              </button>
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <a href="#/financeiro/caixa/relatorio" className="link-botao">Abrir o Relatório do mês (prestação de contas)</a>
          </div>
          {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 12 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
        </section>
      )}

      <section className="card">
        <div className="painel-cab" style={{ padding: "14px 16px 6px" }}><h3 style={{ margin: 0 }}>Histórico de fechamentos</h3></div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <ThOrdenavel chave="mes" ordenacao={ordenacao}>Mês</ThOrdenavel>
                <ThOrdenavel chave="em" ordenacao={ordenacao}>Fechado em</ThOrdenavel>
                <ThOrdenavel chave="por" ordenacao={ordenacao}>Por</ThOrdenavel>
                <ThOrdenavel chave="entradas" ordenacao={ordenacao} className="num">Entradas</ThOrdenavel>
                <ThOrdenavel chave="saidas" ordenacao={ordenacao} className="num">Saídas</ThOrdenavel>
                <ThOrdenavel chave="final" ordenacao={ordenacao} className="num">Saldo final</ThOrdenavel>
                <ThOrdenavel chave="situacao" ordenacao={ordenacao}>Situação</ThOrdenavel>
                <th className="acoes"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {hist.dados?.length === 0 && <tr><td className="vazio" colSpan={8}>Nenhum mês fechado ainda.</td></tr>}
              {ordenacao.ordenadas.map((f) => (
                <tr key={f.id} className="clicavel" tabIndex={0} onClick={() => setMes(f.mes)} onKeyDown={(e) => { if (e.key === "Enter") setMes(f.mes); }}>
                  <td style={{ fontWeight: 550 }}>{tituloMes(f.mes)}</td>
                  <td>{formatarData(f.criado_em.slice(0, 10))}</td>
                  <td>{f.fechado_por_nome ?? "—"}</td>
                  <td className="num">{formatarMoeda(f.resumo?.totais?.entradas)}</td>
                  <td className="num">{formatarMoeda(f.resumo?.totais?.saidas)}</td>
                  <td className="num" style={{ fontWeight: 550 }}>{formatarMoeda(f.resumo?.totais?.saldo_final)}</td>
                  <td style={{ whiteSpace: "normal" }}>
                    {f.reaberto
                      ? <><Pill tone="warn">Reaberto</Pill><div className="muted" style={{ fontSize: 12 }}>{formatarData(f.reaberto_em?.slice(0, 10))}{f.reaberto_por_nome ? ` · ${f.reaberto_por_nome}` : ""} · {f.motivo_reabertura}</div></>
                      : <Pill tone="ok">Fechado</Pill>}
                  </td>
                  <td className="acoes">
                    {podeReabrir && f.id === ultimo?.id && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setReabrir(f); }}>Reabrir</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {confirmar && c && (
        <Modal titulo={`Fechar ${nomeMes(c.mes)}?`} largura={480} onFechar={() => setConfirmar(false)}
          rodape={<><button className="btn btn-ghost" onClick={() => setConfirmar(false)}>Voltar</button><button className="btn btn-primary" onClick={fechar}>Sim, fechar o mês</button></>}>
          <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "4px 0 8px" }}>
            Depois de fechado, <strong>nada que mexa em saldo</strong> poderá ser lançado ou estornado com data até {formatarData(c.fim)}, em nenhuma conta. Os saldos de hoje ficam guardados no histórico.
          </p>
          <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: 0 }}>Para corrigir depois, só o Administrador reabre o mês, com motivo.</p>
        </Modal>
      )}
      {reabrir && <ReabrirModal fechamento={reabrir} onFechar={() => setReabrir(null)} onConcluido={() => { setReabrir(null); setOk(""); setMes(null); setVersao((v) => v + 1); }} />}
    </div>
  );
}
