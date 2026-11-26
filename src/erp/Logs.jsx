import { Fragment, useEffect, useMemo, useState } from "react";
import { Header, Pill } from "../ui";
import { inp } from "../estilos";
import Icone from "./Icone";
import ThOrdenavel from "./ThOrdenavel";
import { useOrdenacao } from "./useOrdenacao";
import { listarLogs, mensagemErro } from "./db";
import { hojeISO } from "./format";
import { somarDias } from "./financeiro";

// Nome legível de cada tabela registrada no log (gatilho registrar_log, migration v10).
const TABELAS = {
  documentos_entrada: "Nota de entrada", documento_anexos: "Anexo de nota", pessoas: "Fornecedor / pessoa",
  titulos_financeiros: "Conta a pagar", pagamentos: "Pagamento", condicoes_pagamento: "Condição de pagamento",
  contas_caixa: "Conta caixa", plano_contas: "Plano de contas", tipos_contabeis: "Tipo contábil", centros_custo: "Centro de custo",
  parametros: "Parâmetro", empresas: "Igreja", profiles: "Usuário", entradas: "Dízimo / oferta", campanhas: "Campanha", movimentos_caixa: "Movimento de caixa", formas_pagamento: "Forma de pagamento", conciliacoes_caixa: "Conciliação de caixa", contas_fixas: "Conta fixa",
};
const ACOES = { criou: { rotulo: "Criou", tom: "ok" }, alterou: { rotulo: "Alterou", tom: "warn" }, excluiu: { rotulo: "Excluiu", tom: "danger" } };
const OCULTOS = new Set(["id", "empresa_id", "user_id"]);

const COLUNAS = {
  data: (l) => l.criado_em,
  usuario: (l) => l.usuario_nome,
  acao: (l) => ACOES[l.acao]?.rotulo,
  tabela: (l) => TABELAS[l.tabela] ?? l.tabela,
  registro: (l) => l.descricao,
};

const dataHora = (iso) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const nomeCampo = (k) => k.replace(/_id$/, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
function valor(v) {
  if (v === null || v === undefined || v === "") return "—";
  if (v === true) return "Sim";
  if (v === false) return "Não";
  if (typeof v === "object") return Object.keys(v).length ? JSON.stringify(v) : "—";
  return String(v);
}

function Detalhes({ log }) {
  const campos = Object.entries(log.alteracoes || {}).filter(([k]) => !OCULTOS.has(k));
  if (!campos.length) return <span className="muted">Sem detalhes.</span>;
  if (log.acao === "alterou") {
    return (
      <table className="parcelas">
        <thead><tr><th>Campo</th><th>Antes</th><th>Depois</th></tr></thead>
        <tbody>{campos.map(([k, v]) => (
          <tr key={k}><td style={{ fontWeight: 550 }}>{nomeCampo(k)}</td><td style={{ color: "var(--danger-text)", whiteSpace: "normal", wordBreak: "break-word" }}>{valor(v?.de)}</td><td style={{ color: "var(--ok-text)", whiteSpace: "normal", wordBreak: "break-word" }}>{valor(v?.para)}</td></tr>
        ))}</tbody>
      </table>
    );
  }
  return (
    <div className="tributos-grid">
      {campos.filter(([, v]) => valor(v) !== "—").map(([k, v]) => (
        <div key={k} className="tributo"><span className="tributo-rotulo">{nomeCampo(k)}</span><span className="tributo-valor" style={{ fontWeight: 500 }}>{valor(v)}</span></div>
      ))}
    </div>
  );
}

// Sistema → Logs: quem criou, alterou ou excluiu o quê, e quando. Só leitura (o banco não deixa alterar o log).
export default function Logs() {
  const [filtros, setFiltros] = useState(() => ({ de: somarDias(hojeISO(), -30), ate: hojeISO(), tabela: "", acao: "", busca: "" }));
  const [resultado, setResultado] = useState({ periodo: null, logs: [], erro: "" });
  const [aberto, setAberto] = useState(null);

  // Recarrega do banco quando o período muda; enquanto a resposta não chega, a lista mostra "Carregando".
  const periodo = `${filtros.de}|${filtros.ate}`;
  useEffect(() => {
    let ativo = true;
    listarLogs({ de: filtros.de, ate: filtros.ate })
      .then((d) => { if (ativo) setResultado({ periodo, logs: d, erro: "" }); })
      .catch((e) => { if (ativo) setResultado({ periodo, logs: [], erro: mensagemErro(e) }); });
    return () => { ativo = false; };
  }, [periodo, filtros.de, filtros.ate]);
  const logs = resultado.periodo === periodo ? resultado.logs : null;
  const erro = resultado.periodo === periodo ? resultado.erro : "";

  const filtrados = useMemo(() => {
    const t = filtros.busca.trim().toLowerCase();
    return (logs || []).filter((l) =>
      (!filtros.tabela || l.tabela === filtros.tabela) &&
      (!filtros.acao || l.acao === filtros.acao) &&
      (!t || (l.usuario_nome || "").toLowerCase().includes(t) || (l.descricao || "").toLowerCase().includes(t)));
  }, [logs, filtros]);
  const ordenacao = useOrdenacao(filtrados, COLUNAS, { chave: "data", dir: "desc" });
  const f = (k) => (e) => setFiltros((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div>
      <div className="page-header">
        <Header title="Logs" subtitle="Registro de tudo o que foi criado, alterado ou excluído nesta igreja: quem fez, quando e o que mudou. Ninguém consegue alterar ou apagar este registro." />
      </div>
      {erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
      <div className="card">
        <div className="toolbar">
          <label style={{ flex: "1 1 200px", maxWidth: 280 }}>Buscar
            <input placeholder="Usuário ou registro" value={filtros.busca} onChange={f("busca")} style={inp} />
          </label>
          <label>Cadastro
            <select value={filtros.tabela} onChange={f("tabela")} style={{ ...inp, width: 200 }}>
              <option value="">Todos</option>
              {Object.entries(TABELAS).sort((a, b) => a[1].localeCompare(b[1])).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </select>
          </label>
          <label>Ação
            <select value={filtros.acao} onChange={f("acao")} style={{ ...inp, width: 130 }}>
              <option value="">Todas</option>
              {Object.entries(ACOES).map(([v, a]) => <option key={v} value={v}>{a.rotulo}</option>)}
            </select>
          </label>
          <label>De
            <input type="date" value={filtros.de} onChange={f("de")} style={{ ...inp, width: 156 }} />
          </label>
          <label>até
            <input type="date" value={filtros.ate} onChange={f("ate")} style={{ ...inp, width: 156 }} />
          </label>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <ThOrdenavel chave="data" ordenacao={ordenacao}>Data e hora</ThOrdenavel>
              <ThOrdenavel chave="usuario" ordenacao={ordenacao}>Usuário</ThOrdenavel>
              <ThOrdenavel chave="acao" ordenacao={ordenacao}>Ação</ThOrdenavel>
              <ThOrdenavel chave="tabela" ordenacao={ordenacao}>Cadastro</ThOrdenavel>
              <ThOrdenavel chave="registro" ordenacao={ordenacao}>Registro</ThOrdenavel>
              <th className="acoes"><span className="sr-only">Detalhes</span></th>
            </tr></thead>
            <tbody>
              {logs === null && <tr><td className="vazio" colSpan={6}>Carregando...</td></tr>}
              {logs && filtrados.length === 0 && <tr><td className="vazio" colSpan={6}>Nenhum registro no período.</td></tr>}
              {ordenacao.ordenadas.map((l) => (
                <Fragment key={l.id}>
                  <tr className="clicavel" tabIndex={0} onClick={() => setAberto(aberto === l.id ? null : l.id)}
                    onKeyDown={(e) => { if (e.key === "Enter") setAberto(aberto === l.id ? null : l.id); }}>
                    <td>{dataHora(l.criado_em)}</td>
                    <td>{l.usuario_nome || <span className="muted">Sistema</span>}</td>
                    <td><Pill tone={ACOES[l.acao]?.tom}>{ACOES[l.acao]?.rotulo ?? l.acao}</Pill></td>
                    <td>{TABELAS[l.tabela] ?? l.tabela}</td>
                    <td className="truncate" style={{ maxWidth: 320 }}>{l.descricao || <span className="muted">#{l.registro_id}</span>}
                      {l.acao === "alterou" && <span className="muted" style={{ fontSize: 12 }}> · {Object.keys(l.alteracoes || {}).length} campo(s)</span>}</td>
                    <td className="acoes"><Icone nome="chevronBaixo" tamanho={16} style={{ transform: aberto === l.id ? "rotate(180deg)" : "none", transition: "transform .15s", color: "var(--muted)" }} /></td>
                  </tr>
                  {aberto === l.id && <tr><td colSpan={6} style={{ background: "var(--surface-2)", whiteSpace: "normal" }}><Detalhes log={l} /></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {logs && filtrados.length > 0 && <div className="table-footer"><span>{filtrados.length} registro(s){logs.length >= 1000 && " · exibindo os 1000 mais recentes do período"}</span></div>}
      </div>
    </div>
  );
}
