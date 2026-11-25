import { useCallback, useEffect, useMemo, useState } from "react";
import { Header, Pill } from "../ui";
import { inp } from "../estilos";
import Icone from "./Icone";
import NotaModal from "./NotaModal";
import Modal from "./Modal";
import ThOrdenavel from "./ThOrdenavel";
import { useOrdenacao } from "./useOrdenacao";
import { listarNotas, aprovarNota, mensagemErro } from "./db";
import { TIPOS_NOTA, STATUS_NOTA, TOM_STATUS, formatarMoeda, formatarData, hojeISO, somarValores } from "./format";

const FILTROS_VAZIOS = { busca: "", status: "", de: "", ate: "" };

// Valor de ordenação de cada coluna (objeto fora do componente: referência estável).
const COLUNAS = {
  entrada: (n) => n.data_entrada,
  tipo: (n) => TIPOS_NOTA[n.tipo],
  numero: (n) => n.numero,
  fornecedor: (n) => n.fornecedor?.nome,
  emissao: (n) => n.data_emissao,
  valor: (n) => Number(n.valor_total),
  status: (n) => STATUS_NOTA[n.status],
};

function Indicador({ icone, tom = "", rotulo, valor, sub }) {
  return (
    <div className="card stat">
      <div>
        <div className="stat-label">{rotulo}</div>
        <div className="stat-value">{valor}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
      <div className={`stat-icon ${tom}`}><Icone nome={icone} tamanho={19} /></div>
    </div>
  );
}

export default function NotasEntrada({ cadastros, podeEditar, podeAprovar, onCadastrosMudaram }) {
  const [notas, setNotas] = useState(null);
  const [erro, setErro] = useState("");
  const [aberta, setAberta] = useState(null); // null | "nova" | id
  const [filtros, setFiltros] = useState(FILTROS_VAZIOS);
  const [marcadas, setMarcadas] = useState(() => new Set());
  const [lote, setLote] = useState(null); // null | { fase: "confirmar" | "andamento" | "fim", falhas, feitas, total }

  const recarregar = useCallback(
    () => listarNotas().then((dados) => { setNotas(dados); setErro(""); }).catch((e) => setErro(mensagemErro(e))),
    [],
  );
  useEffect(() => { recarregar(); }, [recarregar]);
  // Aprovar/cancelar muda o saldo das contas caixa, que vêm dos cadastros: atualiza os dois.
  const aoMudar = useCallback(() => Promise.all([recarregar(), onCadastrosMudaram()]), [recarregar, onCadastrosMudaram]);

  const indicadores = useMemo(() => {
    const lista = notas || [];
    const mes = hojeISO().slice(0, 7);
    const rascunhos = lista.filter((n) => n.status === "rascunho");
    const aprovadasMes = lista.filter((n) => ["aprovada", "lancada"].includes(n.status) && n.data_entrada.startsWith(mes));
    return {
      rascunhos: rascunhos.length,
      valorRascunhos: somarValores(rascunhos.map((n) => Number(n.valor_total))),
      aprovadasMes: aprovadasMes.length,
      valorAprovadasMes: somarValores(aprovadasMes.map((n) => Number(n.valor_total))),
      canceladas: lista.filter((n) => n.status === "cancelada").length,
    };
  }, [notas]);

  const filtradas = useMemo(() => {
    const termo = filtros.busca.trim().toLowerCase();
    return (notas || []).filter((n) =>
      (!termo || n.fornecedor?.nome.toLowerCase().includes(termo) || n.numero.toLowerCase().includes(termo)) &&
      (!filtros.status || n.status === filtros.status) &&
      (!filtros.de || n.data_entrada >= filtros.de) &&
      (!filtros.ate || n.data_entrada <= filtros.ate));
  }, [notas, filtros]);

  const ordenacao = useOrdenacao(filtradas, COLUNAS, { chave: "entrada", dir: "desc" });
  const linhas = ordenacao.ordenadas;

  // Só rascunhos podem ser aprovados; a marcação sobrevive a filtros e ordenação, mas só vale para notas ainda em rascunho.
  const marcaveis = linhas.filter((n) => n.status === "rascunho");
  const selecionadas = (notas || []).filter((n) => marcadas.has(n.id) && n.status === "rascunho");
  const todasMarcadas = marcaveis.length > 0 && marcaveis.every((n) => marcadas.has(n.id));
  const valorSelecionado = somarValores(selecionadas.map((n) => Number(n.valor_total)));
  const alternarMarca = (id) => setMarcadas((p) => { const novo = new Set(p); if (novo.has(id)) novo.delete(id); else novo.add(id); return novo; });
  const alternarTodas = () => setMarcadas((p) => {
    const novo = new Set(p);
    if (todasMarcadas) marcaveis.forEach((n) => novo.delete(n.id)); else marcaveis.forEach((n) => novo.add(n.id));
    return novo;
  });

  async function aprovarSelecionadas() {
    const alvo = selecionadas;
    const falhas = [];
    setLote({ fase: "andamento", falhas, feitas: 0, total: alvo.length });
    let feitas = 0;
    for (const n of alvo) {
      try { await aprovarNota(n.id); feitas += 1; }
      catch (e) { falhas.push({ id: n.id, rotulo: `${TIPOS_NOTA[n.tipo]} ${n.numero} — ${n.fornecedor?.nome ?? ""}`, motivo: mensagemErro(e) }); }
      setLote({ fase: "andamento", falhas: [...falhas], feitas, total: alvo.length });
    }
    await aoMudar();
    setMarcadas(new Set(falhas.map((x) => x.id))); // mantém marcadas só as que falharam
    setLote({ fase: "fim", falhas, feitas, total: alvo.length });
  }

  const totalFiltrado = somarValores(filtradas.filter((n) => n.status !== "cancelada").map((n) => Number(n.valor_total)));
  const f = (campo) => (e) => setFiltros((p) => ({ ...p, [campo]: e.target.value }));
  const temFiltro = Object.values(filtros).some(Boolean);

  return (
    <div>
      <div className="page-header">
        <Header title="Notas de entrada" subtitle="Notas fiscais, recibos e faturas recebidas. Cada item indica o tipo contábil, que define as contas de débito e crédito." />
        {podeEditar && (
          <button className="btn btn-primary" onClick={() => setAberta("nova")}><Icone nome="mais" tamanho={16} traco={2.2} /> Nova nota</button>
        )}
      </div>

      <div className="stat-grid">
        <Indicador icone="arquivo" tom="neutro" rotulo="Rascunhos pendentes" valor={indicadores.rascunhos} sub={formatarMoeda(indicadores.valorRascunhos)} />
        <Indicador icone="check" rotulo="Aprovadas no mês" valor={indicadores.aprovadasMes} sub={formatarMoeda(indicadores.valorAprovadasMes)} />
        <Indicador icone="alerta" tom={indicadores.canceladas ? "perigo" : "neutro"} rotulo="Canceladas" valor={indicadores.canceladas} />
      </div>

      {erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}

      <div className="card">
        <div className="toolbar">
          <label style={{ flex: "1 1 240px", maxWidth: 340 }}>Buscar
            <input placeholder="Fornecedor ou número da nota" value={filtros.busca} onChange={f("busca")} style={inp} />
          </label>
          <label>Status
            <select value={filtros.status} onChange={f("status")} style={{ ...inp, width: 160 }}>
              <option value="">Todos</option>
              {Object.entries(STATUS_NOTA).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </select>
          </label>
          <label>Entrada de
            <input type="date" value={filtros.de} onChange={f("de")} style={{ ...inp, width: 156 }} />
          </label>
          <label>até
            <input type="date" value={filtros.ate} onChange={f("ate")} style={{ ...inp, width: 156 }} />
          </label>
          {temFiltro && <button className="btn btn-ghost" onClick={() => setFiltros(FILTROS_VAZIOS)}>Limpar filtros</button>}
        </div>

        {podeAprovar && selecionadas.length > 0 && (
          <div className="barra-lote" role="region" aria-label="Ações em lote">
            <span><strong>{selecionadas.length}</strong> rascunho(s) selecionado(s) · {formatarMoeda(valorSelecionado)}</span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-ghost btn-sm" onClick={() => setMarcadas(new Set())}>Limpar seleção</button>
            <button className="btn btn-primary btn-sm" onClick={() => setLote({ fase: "confirmar" })}>
              <Icone nome="check" tamanho={15} traco={2.2} /> Aprovar selecionadas
            </button>
          </div>
        )}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {podeAprovar && (
                  <th className="col-check">
                    <input type="checkbox" checked={todasMarcadas} disabled={marcaveis.length === 0} onChange={alternarTodas}
                      aria-label="Selecionar todos os rascunhos da lista" title="Selecionar todos os rascunhos" />
                  </th>
                )}
                <ThOrdenavel chave="entrada" ordenacao={ordenacao}>Entrada</ThOrdenavel>
                <ThOrdenavel chave="tipo" ordenacao={ordenacao}>Tipo</ThOrdenavel>
                <ThOrdenavel chave="numero" ordenacao={ordenacao}>Nº / Série</ThOrdenavel>
                <ThOrdenavel chave="fornecedor" ordenacao={ordenacao}>Fornecedor</ThOrdenavel>
                <ThOrdenavel chave="emissao" ordenacao={ordenacao}>Emissão</ThOrdenavel>
                <ThOrdenavel chave="valor" ordenacao={ordenacao} className="num">Valor</ThOrdenavel>
                <ThOrdenavel chave="status" ordenacao={ordenacao}>Status</ThOrdenavel>
              </tr>
            </thead>
            <tbody>
              {notas === null && !erro && <tr><td className="vazio" colSpan={podeAprovar ? 8 : 7}>Carregando notas...</td></tr>}
              {notas && filtradas.length === 0 && (
                <tr><td className="vazio" colSpan={podeAprovar ? 8 : 7}>{temFiltro ? "Nenhuma nota encontrada com esses filtros." : "Nenhuma nota lançada ainda."}</td></tr>
              )}
              {linhas.map((n) => (
                <tr key={n.id} className="clicavel" onClick={() => setAberta(n.id)} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) setAberta(n.id); }}>
                  {podeAprovar && (
                    <td className="col-check" onClick={(e) => e.stopPropagation()}>
                      {n.status === "rascunho" && (
                        <input type="checkbox" checked={marcadas.has(n.id)} onChange={() => alternarMarca(n.id)}
                          aria-label={`Selecionar ${TIPOS_NOTA[n.tipo]} ${n.numero}`} />
                      )}
                    </td>
                  )}
                  <td>{formatarData(n.data_entrada)}</td>
                  <td>{TIPOS_NOTA[n.tipo]}</td>
                  <td>{n.numero}{n.serie ? ` / ${n.serie}` : ""}</td>
                  <td className="truncate" style={{ fontWeight: 550 }}>{n.fornecedor?.nome}</td>
                  <td>{formatarData(n.data_emissao)}</td>
                  <td className="num" style={n.status === "cancelada" ? { textDecoration: "line-through", color: "var(--faint)" } : { fontWeight: 550 }}>
                    {formatarMoeda(n.valor_total)}
                  </td>
                  <td><Pill tone={TOM_STATUS[n.status]}>{STATUS_NOTA[n.status]}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {notas && filtradas.length > 0 && (
          <div className="table-footer">
            <span>{filtradas.length} nota(s){notas.length >= 500 && " · exibindo as 500 mais recentes"}</span>
            <span>Total sem canceladas: <strong>{formatarMoeda(totalFiltrado)}</strong></span>
          </div>
        )}
      </div>

      {lote && (
        <Modal titulo={lote.fase === "confirmar" ? "Aprovar notas selecionadas?" : lote.fase === "andamento" ? "Aprovando..." : "Aprovação concluída"}
          largura={500} fecharFora={false} onFechar={() => lote.fase !== "andamento" && setLote(null)}
          rodape={lote.fase === "confirmar" ? (
            <><button className="btn btn-ghost" onClick={() => setLote(null)}>Voltar</button>
              <button className="btn btn-primary" onClick={aprovarSelecionadas}>Sim, aprovar {selecionadas.length}</button></>
          ) : lote.fase === "fim" ? <button className="btn btn-primary" onClick={() => setLote(null)}>Fechar</button> : null}>
          {lote.fase === "confirmar" && (
            <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "4px 0 12px" }}>
              <strong>{selecionadas.length}</strong> nota(s), somando <strong>{formatarMoeda(valorSelecionado)}</strong>. Depois de aprovadas,
              as notas <strong>não poderão mais ser editadas</strong> (só canceladas, com motivo) e o valor sai da conta caixa de cada nota.
              Notas sem conta caixa ou sem tipo contábil serão recusadas e continuarão como rascunho.
            </p>
          )}
          {lote.fase === "andamento" && <p style={{ fontSize: 13.5, margin: "4px 0 12px" }}>Aprovando {lote.feitas + lote.falhas.length} de {lote.total}...</p>}
          {lote.fase === "fim" && (
            <div style={{ margin: "4px 0 12px", fontSize: 13.5 }}>
              <p style={{ margin: "0 0 8px" }}><strong>{lote.feitas}</strong> de {lote.total} nota(s) aprovada(s).</p>
              {lote.falhas.length > 0 && (
                <div className="alert alert-danger" role="alert" style={{ display: "block" }}>
                  <strong>{lote.falhas.length} não puderam ser aprovadas</strong> (continuam marcadas):
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                    {lote.falhas.map((x) => <li key={x.id}>{x.rotulo}: {x.motivo}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {aberta && (
        <NotaModal
          notaId={aberta === "nova" ? null : aberta}
          cadastros={cadastros}
          podeEditar={podeEditar}
          podeAprovar={podeAprovar}
          onCadastrosMudaram={onCadastrosMudaram}
          onMudou={aoMudar}
          onFechar={() => setAberta(null)}
        />
      )}
    </div>
  );
}
