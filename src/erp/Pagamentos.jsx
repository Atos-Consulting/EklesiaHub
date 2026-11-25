import { useCallback, useEffect, useMemo, useState } from "react";
import { Header, Pill } from "../ui";
import { inp } from "../estilos";
import Icone from "./Icone";
import ThOrdenavel from "./ThOrdenavel";
import { useOrdenacao } from "./useOrdenacao";
import { EstornoModal } from "./ContasPagar";
import { listarPagamentos, mensagemErro } from "./db";
import { formatarMoeda, formatarData, somarValores } from "./format";
import { ORIGEM_PAGAMENTO } from "./financeiro";

const FILTROS_VAZIOS = { busca: "", caixa: "", de: "", ate: "", estornados: false };

const COLUNAS = {
  data: (p) => p.data_pagamento,
  fornecedor: (p) => p.fornecedor_nome,
  documento: (p) => p.descricao,
  caixa: (p) => p.conta_caixa_nome,
  principal: (p) => Number(p.valor_principal),
  acrescimos: (p) => Number(p.juros) + Number(p.multa) - Number(p.desconto),
  pago: (p) => Number(p.valor_pago),
  origem: (p) => ORIGEM_PAGAMENTO[p.origem],
  situacao: (p) => p.estornado,
};

// Histórico de saídas de dinheiro: cada pagamento (baixa) de título, inclusive os estornados.
export default function Pagamentos({ cadastros, podePagar, onCadastrosMudaram }) {
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState("");
  const [filtros, setFiltros] = useState(FILTROS_VAZIOS);
  const [estornando, setEstornando] = useState(null);

  const recarregar = useCallback(
    () => listarPagamentos().then((d) => { setLista(d); setErro(""); }).catch((e) => setErro(mensagemErro(e))),
    [],
  );
  useEffect(() => { recarregar(); }, [recarregar]);

  const filtrados = useMemo(() => {
    const termo = filtros.busca.trim().toLowerCase();
    return (lista || []).filter((p) =>
      (filtros.estornados || !p.estornado) &&
      (!termo || p.fornecedor_nome.toLowerCase().includes(termo) || p.descricao.toLowerCase().includes(termo)) &&
      (!filtros.caixa || String(p.conta_caixa_id) === filtros.caixa) &&
      (!filtros.de || p.data_pagamento >= filtros.de) &&
      (!filtros.ate || p.data_pagamento <= filtros.ate));
  }, [lista, filtros]);
  const ordenacao = useOrdenacao(filtrados, COLUNAS, { chave: "data", dir: "desc" });
  const f = (campo) => (e) => setFiltros((p) => ({ ...p, [campo]: e.target.value }));
  const temFiltro = JSON.stringify(filtros) !== JSON.stringify(FILTROS_VAZIOS);
  const total = somarValores(filtrados.filter((p) => !p.estornado).map((p) => Number(p.valor_pago)));
  const colunas = podePagar ? 10 : 9;

  return (
    <div>
      <div className="page-header">
        <Header title="Pagamentos" subtitle="Tudo o que saiu das contas caixa: notas à vista e parcelas pagas em Contas a pagar. Estornos ficam registrados." />
      </div>
      {erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
      <div className="card">
        <div className="toolbar">
          <label style={{ flex: "1 1 220px", maxWidth: 320 }}>Buscar
            <input placeholder="Fornecedor ou documento" value={filtros.busca} onChange={f("busca")} style={inp} />
          </label>
          <label>Conta caixa
            <select value={filtros.caixa} onChange={f("caixa")} style={{ ...inp, width: 180 }}>
              <option value="">Todas</option>
              {cadastros.caixas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <label>Pago de
            <input type="date" value={filtros.de} onChange={f("de")} style={{ ...inp, width: 156 }} />
          </label>
          <label>até
            <input type="date" value={filtros.ate} onChange={f("ate")} style={{ ...inp, width: 156 }} />
          </label>
          <label style={{ flexDirection: "row", display: "flex", alignItems: "center", gap: 8, paddingBottom: 9 }}>
            <input type="checkbox" checked={filtros.estornados} onChange={(e) => setFiltros((p) => ({ ...p, estornados: e.target.checked }))} />
            Mostrar estornados
          </label>
          {temFiltro && <button className="btn btn-ghost" onClick={() => setFiltros(FILTROS_VAZIOS)}>Limpar filtros</button>}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <ThOrdenavel chave="data" ordenacao={ordenacao}>Data</ThOrdenavel>
              <ThOrdenavel chave="fornecedor" ordenacao={ordenacao}>Fornecedor</ThOrdenavel>
              <ThOrdenavel chave="documento" ordenacao={ordenacao}>Documento</ThOrdenavel>
              <ThOrdenavel chave="caixa" ordenacao={ordenacao}>Conta caixa</ThOrdenavel>
              <ThOrdenavel chave="principal" ordenacao={ordenacao} className="num">Parcela</ThOrdenavel>
              <ThOrdenavel chave="acrescimos" ordenacao={ordenacao} className="num">Juros/multa/desc.</ThOrdenavel>
              <ThOrdenavel chave="pago" ordenacao={ordenacao} className="num">Valor pago</ThOrdenavel>
              <ThOrdenavel chave="origem" ordenacao={ordenacao}>Origem</ThOrdenavel>
              <ThOrdenavel chave="situacao" ordenacao={ordenacao}>Situação</ThOrdenavel>
              {podePagar && <th className="acoes"><span className="sr-only">Ações</span></th>}
            </tr></thead>
            <tbody>
              {lista === null && !erro && <tr><td className="vazio" colSpan={colunas}>Carregando...</td></tr>}
              {lista && filtrados.length === 0 && <tr><td className="vazio" colSpan={colunas}>{lista.length === 0 ? "Nenhum pagamento registrado ainda." : "Nenhum pagamento encontrado com esses filtros."}</td></tr>}
              {ordenacao.ordenadas.map((p) => {
                const acresc = Number(p.juros) + Number(p.multa) - Number(p.desconto);
                return (
                  <tr key={p.id} style={p.estornado ? { color: "var(--faint)" } : undefined}>
                    <td>{formatarData(p.data_pagamento)}</td>
                    <td className="truncate" style={{ fontWeight: 550, maxWidth: 240 }}>{p.fornecedor_nome}</td>
                    <td>{p.descricao} · {p.parcela}/{p.total_parcelas}{p.observacao && <div className="muted" style={{ fontSize: 12 }}>{p.observacao}</div>}</td>
                    <td>{p.conta_caixa_nome ?? "—"}</td>
                    <td className="num">{formatarMoeda(p.valor_principal)}</td>
                    <td className="num">{acresc === 0 ? "—" : `${acresc > 0 ? "+" : "−"} ${formatarMoeda(Math.abs(acresc))}`}</td>
                    <td className="num" style={p.estornado ? { textDecoration: "line-through" } : { fontWeight: 600 }}>{formatarMoeda(p.valor_pago)}</td>
                    <td style={{ fontSize: 12.5 }}>{ORIGEM_PAGAMENTO[p.origem]}</td>
                    <td>{p.estornado
                      ? <span title={p.motivo_estorno}><Pill tone="danger">Estornado</Pill><div className="muted" style={{ fontSize: 12 }}>{formatarData(p.estornado_em)}</div></span>
                      : <Pill tone="ok">Pago</Pill>}</td>
                    {podePagar && (
                      <td className="acoes">
                        {!p.estornado && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEstornando(p)}>Estornar</button>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {lista && filtrados.length > 0 && (
          <div className="table-footer">
            <span>{filtrados.length} pagamento(s)</span>
            <span>Total pago (sem estornos): <strong>{formatarMoeda(total)}</strong></span>
          </div>
        )}
      </div>
      {estornando && (
        <EstornoModal descricao={`${estornando.fornecedor_nome} · ${estornando.descricao} ${estornando.parcela}/${estornando.total_parcelas} · ${formatarMoeda(estornando.valor_pago)}`}
          pagamentoId={estornando.id} onFechar={() => setEstornando(null)}
          onConcluido={async () => { setEstornando(null); await Promise.all([recarregar(), onCadastrosMudaram()]); }} />
      )}
    </div>
  );
}
