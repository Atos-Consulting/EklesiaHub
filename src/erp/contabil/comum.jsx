import { useEffect, useState } from "react";
import { inp } from "../../estilos";
import Icone from "../Icone";
import { listarPendenciasContabeis, urlLogo } from "../db";
import { formatarData, formatarMoeda, hojeISO } from "../format";
import { ORIGENS, rotuloConta } from "./calculoContabil";

// Peças comuns das telas do Contábil (v25).

const ROTA_ORIGEM = {
  abertura: "#/parametros/caixas", nota: "#/administrativo/notas", titulo_pagar: "#/financeiro/lancamentos/pagar",
  titulo_receber: "#/financeiro/lancamentos/receber", pagamento: "#/financeiro/lancamentos/pagar", entrada: "#/financeiro/entradas", movimento: "#/financeiro/caixa/extrato",
};

// Eventos que ainda não entraram no diário porque falta alguma conta.
export function Pendencias({ versao, podeConfigurar }) {
  const [lista, setLista] = useState(null);
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    if (versao === null) return undefined;
    let ativo = true;
    listarPendenciasContabeis().then((d) => { if (ativo) setLista(d); }).catch(() => { if (ativo) setLista([]); });
    return () => { ativo = false; };
  }, [versao]);
  if (!lista?.length) return null;
  const faltas = [...new Set(lista.flatMap((p) => p.faltas.split("; ")))];
  return (
    <div className="alert alert-warn" style={{ marginBottom: 16, display: "block" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <Icone nome="alerta" tamanho={16} />
        <div style={{ flex: 1 }}>
          <strong>{lista.length} lançamento(s) do sistema ainda não entraram na contabilidade</strong> porque falta conta contábil:
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{faltas.map((f) => <li key={f}>{f}</li>)}</ul>
          <div style={{ marginTop: 6, fontSize: 13 }}>
            {podeConfigurar
              ? <>Informe em <a href="#/parametros/regras">Parâmetros → Regras de contabilização</a>, na conta caixa (<a href="#/parametros/caixas">Contas caixa</a>) ou no tipo contábil dos itens. Eles entram sozinhos depois.</>
              : "Peça ao Administrador da igreja para completar as contas nos Parâmetros. Eles entram sozinhos depois."}
            {" "}<button type="button" className="link-botao" onClick={() => setAberto((a) => !a)}>{aberto ? "Esconder a lista" : "Ver a lista"}</button>
          </div>
        </div>
      </div>
      {aberto && (
        <div className="table-wrap" style={{ marginTop: 10, background: "var(--surface)", borderRadius: 8 }}>
          <table className="rel-tabela">
            <thead><tr><th>Data</th><th>Origem</th><th>Histórico</th><th className="num">Valor</th><th>Falta</th></tr></thead>
            <tbody>
              {lista.slice(0, 200).map((p) => (
                <tr key={`${p.origem}-${p.origem_id}`}>
                  <td>{formatarData(p.data)}</td>
                  <td><a href={ROTA_ORIGEM[p.origem] ?? "#"}>{ORIGENS[p.origem] ?? p.origem}</a></td>
                  <td>{p.historico}</td>
                  <td className="num">{formatarMoeda(p.valor)}</td>
                  <td style={{ fontSize: 12 }}>{p.faltas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Select de conta contábil (por padrão só analíticas ativas, mais a já escolhida).
export function ContaSelect({ id, contas, valor, onChange, naturezas, todas = false, vazio = "— Selecione —", style, ...resto }) {
  const lista = contas
    .filter((c) => (todas || (c.analitica && c.ativo) || String(c.id) === String(valor)) && (!naturezas || naturezas.includes(c.natureza)))
    .sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true }));
  return (
    <select id={id} style={{ ...inp, ...style }} value={valor ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} {...resto}>
      <option value="">{vazio}</option>
      {lista.map((c) => <option key={c.id} value={c.id}>{rotuloConta(c)}{c.analitica ? "" : " (sintética)"}{c.ativo ? "" : " (inativa)"}</option>)}
    </select>
  );
}

// Cabeçalho dos relatórios impressos.
export function CabecalhoRelatorio({ perfil, titulo, sub }) {
  return (
    <header className="rel-cabecalho">
      {perfil?.empresa_logo && <img className="rel-logo" src={urlLogo(perfil.empresa_logo)} alt="" />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="rel-igreja">{perfil?.empresa_nome}</div>
        <h2 className="rel-titulo">{titulo}</h2>
        {sub && <div className="rel-sub">{sub}</div>}
      </div>
      <div className="rel-emissao">Emitido em {formatarData(hojeISO())}{perfil?.nome ? <><br />por {perfil.nome}</> : null}</div>
    </header>
  );
}

// Período (de/até) com atalhos de mês e ano.
export function Periodo({ de, ate, onChange }) {
  const hoje = hojeISO();
  const ano = hoje.slice(0, 4);
  const atalhos = [
    { rotulo: "Este mês", de: `${hoje.slice(0, 7)}-01`, ate: hoje },
    { rotulo: "Mês passado", ...(() => { const d = new Date(`${hoje.slice(0, 7)}-01T12:00:00Z`); d.setUTCDate(0); const fim = d.toISOString().slice(0, 10); return { de: `${fim.slice(0, 7)}-01`, ate: fim }; })() },
    { rotulo: "Este ano", de: `${ano}-01-01`, ate: hoje },
    { rotulo: "Ano passado", de: `${Number(ano) - 1}-01-01`, ate: `${Number(ano) - 1}-12-31` },
  ];
  return (
    <>
      <label>De<input type="date" style={{ ...inp, width: 160 }} value={de} onChange={(e) => onChange({ de: e.target.value, ate })} /></label>
      <label>Até<input type="date" style={{ ...inp, width: 160 }} value={ate} onChange={(e) => onChange({ de, ate: e.target.value })} /></label>
      <div style={{ display: "flex", gap: 6, alignSelf: "flex-end", flexWrap: "wrap" }}>
        {atalhos.map((a) => (
          <button key={a.rotulo} type="button" className={`btn btn-ghost btn-sm${a.de === de && a.ate === ate ? " ativo" : ""}`} onClick={() => onChange({ de: a.de, ate: a.ate })}>{a.rotulo}</button>
        ))}
      </div>
    </>
  );
}
