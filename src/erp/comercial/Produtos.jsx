import { useCallback, useEffect, useMemo, useState } from "react";
import { Header, Pill } from "../../ui";
import { lbl, inp, msgErro } from "../../estilos";
import Icone from "../Icone";
import Modal from "../Modal";
import ThOrdenavel from "../ThOrdenavel";
import { useOrdenacao } from "../useOrdenacao";
import { listarProdutos, salvarProduto, ajustarEstoque, listarMovimentosEstoque, mensagemErro } from "../db";
import { formatarData, formatarMoeda, hojeISO, lerNumero, numeroParaCampo } from "../format";
import { FormModal, CampoAtivo } from "../parametros/comum";
import { quantidadeTexto } from "./calculoPdv";

// Comercial → Produtos (v27): cadastro, preço, onde é vendido e estoque (opcional por produto).
// Estoque entra pela nota de entrada (item ligado ao produto), sai na venda e se corrige com ajuste.

const COLUNAS = {
  nome: (p) => p.nome, categoria: (p) => p.categoria ?? "", preco: (p) => Number(p.preco),
  estoque: (p) => (p.controla_estoque ? Number(p.estoque) : -Infinity), valor: (p) => Number(p.valor_estoque),
  situacao: (p) => (p.ativo ? "Ativo" : "Inativo"),
};
const TIPOS_MOV = { nota: "Compra (nota de entrada)", estorno_nota: "Nota cancelada", venda: "Venda", estorno_venda: "Venda cancelada", ajuste: "Ajuste" };
const baixo = (p) => p.controla_estoque && p.ativo && p.estoque_minimo !== null && Number(p.estoque) <= Number(p.estoque_minimo);

export default function Produtos({ cadastros, podeEditar }) {
  const [produtos, setProdutos] = useState(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("ativos");
  const [editando, setEditando] = useState(null);
  const [ajustando, setAjustando] = useState(null);
  const [vendo, setVendo] = useState(null);
  const [aviso, setAviso] = useState("");
  const [codigoNovo, setCodigoNovo] = useState("");

  const recarregar = useCallback(() => listarProdutos().then((d) => { setProdutos(d); setErro(""); }).catch((e) => setErro(mensagemErro(e))), []);
  useEffect(() => { recarregar(); }, [recarregar]);

  const nomePonto = useMemo(() => Object.fromEntries((cadastros.pontos ?? []).map((p) => [p.id, p.nome])), [cadastros.pontos]);
  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (produtos ?? []).filter((p) => (filtro === "todos" || (filtro === "ativos" ? p.ativo : filtro === "baixo" ? baixo(p) : p.controla_estoque && p.ativo))
      && (!t || p.nome.toLowerCase().includes(t) || (p.codigo ?? "").toLowerCase().includes(t) || (p.categoria ?? "").toLowerCase().includes(t)));
  }, [produtos, busca, filtro]);
  const ordenacao = useOrdenacao(filtrados, COLUNAS, { chave: "nome", dir: "asc" });
  const valorTotal = (produtos ?? []).reduce((a, p) => a + Number(p.valor_estoque), 0);
  const qtdBaixo = (produtos ?? []).filter(baixo).length;

  function salvo(msg) { setEditando(null); setAjustando(null); setAviso(msg); recarregar(); }

  return (
    <div>
      <div className="page-header">
        <Header title="Produtos" subtitle="O que se vende no frente de loja, com o preço e onde é vendido. O estoque é opcional por produto: entra pela nota de entrada, sai na venda e se corrige com ajuste." />
        {podeEditar && <button className="btn btn-primary" onClick={() => { setCodigoNovo(""); setEditando("novo"); }}><Icone nome="mais" tamanho={16} traco={2.2} /> Novo produto</button>}
      </div>
      <div className="stat-grid">
        <div className="card stat"><div><div className="stat-label">Produtos ativos</div><div className="stat-value">{(produtos ?? []).filter((p) => p.ativo).length}</div></div><div className="stat-icon"><Icone nome="sacola" /></div></div>
        <div className="card stat"><div><div className="stat-label">Valor do estoque (custo)</div><div className="stat-value">{formatarMoeda(valorTotal)}</div></div><div className="stat-icon neutro"><Icone nome="grafico" /></div></div>
        <div className="card stat"><div><div className="stat-label">Abaixo do mínimo</div><div className="stat-value">{qtdBaixo}</div>{qtdBaixo > 0 && <button className="link-botao" onClick={() => setFiltro("baixo")}>ver quais</button>}</div><div className={`stat-icon ${qtdBaixo ? "alerta" : "neutro"}`}><Icone nome="alerta" /></div></div>
      </div>
      {aviso && <div className="alert alert-ok" role="status" style={{ marginBottom: 16 }}><Icone nome="check" tamanho={16} /><span>{aviso}</span></div>}
      {erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
      <div className="card">
        <div className="toolbar">
          <label style={{ flex: "1 1 260px", maxWidth: 380 }}>Buscar
            <input placeholder="Nome, categoria ou bipe o código" value={busca} onChange={(e) => setBusca(e.target.value)} style={inp}
              onKeyDown={(e) => {
                // leitor de código de barras: código + Enter abre o produto, ou o cadastro de um novo com o código preenchido
                if (e.key !== "Enter" || !busca.trim()) return;
                e.preventDefault();
                const cod = busca.trim();
                const achado = (produtos ?? []).find((p) => (p.codigo ?? "").toLowerCase() === cod.toLowerCase());
                if (achado) { if (podeEditar) setEditando(achado); else setFiltro("todos"); return; }
                if (podeEditar && /^[0-9A-Za-z.-]{3,60}$/.test(cod) && !/\s/.test(cod)) { setCodigoNovo(cod); setBusca(""); setEditando("novo"); }
              }} />
          </label>
          <label>Mostrar
            <select style={{ ...inp, width: 200 }} value={filtro} onChange={(e) => setFiltro(e.target.value)}>
              <option value="ativos">Ativos</option><option value="estoque">Com estoque</option><option value="baixo">Abaixo do mínimo</option><option value="todos">Todos</option>
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <ThOrdenavel chave="nome" ordenacao={ordenacao}>Produto</ThOrdenavel>
              <ThOrdenavel chave="categoria" ordenacao={ordenacao}>Categoria</ThOrdenavel>
              <th>Onde vende</th>
              <ThOrdenavel chave="preco" ordenacao={ordenacao} className="num">Preço</ThOrdenavel>
              <ThOrdenavel chave="estoque" ordenacao={ordenacao} className="num">Estoque</ThOrdenavel>
              <ThOrdenavel chave="valor" ordenacao={ordenacao} className="num">Custo médio / valor</ThOrdenavel>
              <ThOrdenavel chave="situacao" ordenacao={ordenacao}>Situação</ThOrdenavel>
              <th />
            </tr></thead>
            <tbody>
              {!produtos && !erro && <tr><td className="vazio" colSpan={8}>Carregando...</td></tr>}
              {produtos && ordenacao.ordenadas.length === 0 && <tr><td className="vazio" colSpan={8}>{produtos.length ? "Nenhum produto encontrado." : "Nenhum produto cadastrado."}</td></tr>}
              {ordenacao.ordenadas.map((p) => (
                <tr key={p.id} style={!p.ativo ? { color: "var(--faint)" } : undefined}>
                  <td style={{ fontWeight: 550 }}>{p.nome}{p.codigo && <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>Código {p.codigo}</div>}</td>
                  <td>{p.categoria ?? "—"}</td>
                  <td style={{ fontSize: 12.5 }}>{p.pontos_venda?.length ? p.pontos_venda.map((id) => nomePonto[id] ?? "?").join(", ") : "Todos os locais"}</td>
                  <td className="num">{formatarMoeda(p.preco)}{p.unidade !== "UN" && <span className="muted">/{p.unidade}</span>}</td>
                  <td className="num">{p.controla_estoque ? <>{quantidadeTexto(p.estoque)} {p.unidade}{baixo(p) && <div><Pill tone="warn">abaixo do mínimo ({quantidadeTexto(p.estoque_minimo)})</Pill></div>}</> : <span className="muted">não controla</span>}</td>
                  <td className="num" style={{ fontSize: 12.5 }}>{p.controla_estoque ? <>{p.custo_medio ? formatarMoeda(p.custo_medio) : "—"}<div className="muted">{formatarMoeda(p.valor_estoque)}</div></> : "—"}</td>
                  <td><Pill tone={p.ativo ? "ok" : "neutral"}>{p.ativo ? "Ativo" : "Inativo"}</Pill></td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {p.controla_estoque && <button className="btn btn-ghost btn-sm" onClick={() => setVendo(p)}>Movimentos</button>}
                    {podeEditar && p.controla_estoque && <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={() => setAjustando(p)}>Ajustar</button>}
                    {podeEditar && <button className="icon-btn" style={{ marginLeft: 6 }} aria-label={`Editar ${p.nome}`} title="Editar" onClick={() => setEditando(p)}><Icone nome="editar" tamanho={16} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtrados.length > 0 && <div className="table-footer"><span>{filtrados.length} produto(s)</span></div>}
      </div>
      {editando && <ProdutoForm produto={editando === "novo" ? null : editando} codigoInicial={codigoNovo} produtos={produtos ?? []} pontos={cadastros.pontos ?? []} onFechar={() => setEditando(null)}
        onSalvo={() => salvo(editando === "novo" ? "Produto cadastrado." : "Produto atualizado.")} />}
      {ajustando && <AjusteModal produto={ajustando} onFechar={() => setAjustando(null)} onSalvo={() => salvo(`Estoque de “${ajustando.nome}” ajustado.`)} />}
      {vendo && <MovimentosModal produto={vendo} onFechar={() => setVendo(null)} />}
    </div>
  );
}

function ProdutoForm({ produto, codigoInicial, produtos, pontos, onFechar, onSalvo }) {
  const [f, setF] = useState({
    nome: produto?.nome ?? "", codigo: produto?.codigo ?? codigoInicial ?? "", categoria: produto?.categoria ?? "", unidade: produto?.unidade ?? "UN",
    preco: produto ? numeroParaCampo(Number(produto.preco)) : "", controlaEstoque: produto?.controla_estoque ?? false,
    estoqueMinimo: produto?.estoque_minimo !== null && produto?.estoque_minimo !== undefined ? quantidadeTexto(produto.estoque_minimo) : "",
    pontosVenda: produto?.pontos_venda ?? [], ativo: produto?.ativo ?? true,
  });
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const preco = lerNumero(f.preco);
  const minimo = f.estoqueMinimo.trim() ? lerNumero(f.estoqueMinimo) : null;
  const erros = {};
  if (!f.nome.trim()) erros.nome = "Informe o nome";
  if (!(preco >= 0)) erros.preco = "Informe o preço";
  if (minimo !== null && !(minimo >= 0)) erros.estoqueMinimo = "Valor inválido";
  const repetido = f.codigo.trim() && produtos.find((p) => p.id !== produto?.id && (p.codigo ?? "").toLowerCase() === f.codigo.trim().toLowerCase());
  if (repetido) erros.codigo = `Este código já é do produto “${repetido.nome}”`;
  const borda = (k) => (tentou && erros[k] ? { borderColor: "var(--danger)" } : {});
  const marcarPonto = (id, sim) => setF((p) => ({ ...p, pontosVenda: sim ? [...p.pontosVenda, id] : p.pontosVenda.filter((x) => x !== id) }));

  async function salvar() {
    setTentou(true);
    setErro("");
    if (Object.keys(erros).length) return;
    setSalvando(true);
    try { await salvarProduto(produto?.id ?? null, { ...f, preco, estoqueMinimo: minimo }); onSalvo(); }
    catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }

  return (
    <FormModal titulo={produto ? "Editar produto" : "Novo produto"} largura={580} onFechar={onFechar} onSalvar={salvar} salvando={salvando} erro={erro}>
      <label style={{ ...lbl, marginTop: 4 }} htmlFor="pr-cod">Código de barras ou interno</label>
      <input id="pr-cod" autoFocus={!produto && !f.codigo} maxLength={60} style={{ ...inp, fontFamily: "monospace", letterSpacing: 0.5, ...(erros.codigo ? { borderColor: "var(--danger)" } : {}) }}
        value={f.codigo} onChange={set("codigo")} placeholder="Bipe o código com o leitor ou digite"
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("pr-nome")?.focus(); } }} />
      {erros.codigo ? <div style={msgErro}>{erros.codigo}</div> : <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>Opcional. Com o código, a venda é feita só bipando o produto.</div>}

      <label style={lbl} htmlFor="pr-nome">Nome *</label>
      <input id="pr-nome" autoFocus={Boolean(produto) || Boolean(f.codigo)} maxLength={120} style={{ ...inp, ...borda("nome") }} value={f.nome} onChange={set("nome")} placeholder="Ex.: Café expresso, Bíblia de estudo" />
      {tentou && erros.nome && <div style={msgErro}>{erros.nome}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0 12px" }}>
        <div><label style={lbl} htmlFor="pr-cat">Categoria</label>
          <input id="pr-cat" maxLength={60} style={inp} value={f.categoria} onChange={set("categoria")} placeholder="Ex.: Bebidas, Livros" /></div>
        <div><label style={lbl} htmlFor="pr-un">Unidade</label>
          <input id="pr-un" maxLength={6} style={inp} value={f.unidade} onChange={set("unidade")} placeholder="UN, KG, CX" /></div>
        <div><label style={lbl} htmlFor="pr-preco">Preço de venda (R$) *</label>
          <input id="pr-preco" inputMode="decimal" style={{ ...inp, textAlign: "right", ...borda("preco") }} value={f.preco} onChange={set("preco")} />
          {tentou && erros.preco && <div style={msgErro}>{erros.preco}</div>}</div>
      </div>

      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 18, fontSize: 13.5 }}>
        <input type="checkbox" checked={f.controlaEstoque} onChange={(e) => setF((p) => ({ ...p, controlaEstoque: e.target.checked }))} style={{ marginTop: 3 }} />
        <span><strong>Controla estoque</strong><span className="muted" style={{ display: "block", fontSize: 12.5 }}>Para livros e mercadorias compradas. A compra entra pela nota de entrada (ligue o item ao produto) e a venda baixa o estoque; não vende sem estoque. Café e itens feitos na hora normalmente não controlam.</span></span>
      </label>
      {f.controlaEstoque && (
        <div style={{ maxWidth: 220 }}>
          <label style={lbl} htmlFor="pr-min">Estoque mínimo (aviso)</label>
          <input id="pr-min" inputMode="decimal" style={{ ...inp, textAlign: "right", ...borda("estoqueMinimo") }} value={f.estoqueMinimo} onChange={set("estoqueMinimo")} placeholder="opcional" />
        </div>
      )}

      <label style={lbl}>Onde é vendido</label>
      {pontos.length === 0 ? <div className="muted" style={{ fontSize: 12.5 }}>Nenhum local de venda cadastrado ainda.</div> : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
          {pontos.filter((p) => p.ativo || f.pontosVenda.includes(p.id)).map((p) => (
            <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5 }}>
              <input type="checkbox" checked={f.pontosVenda.includes(p.id)} onChange={(e) => marcarPonto(p.id, e.target.checked)} /> {p.nome}
            </label>
          ))}
        </div>
      )}
      <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>Sem nenhum marcado, aparece em todos os locais.</div>
      <CampoAtivo ativo={f.ativo} onChange={(v) => setF((p) => ({ ...p, ativo: v }))} dica="produto inativo não aparece no frente de loja" />
    </FormModal>
  );
}

function AjusteModal({ produto, onFechar, onSalvo }) {
  const [sentido, setSentido] = useState("saida");
  const [qtd, setQtd] = useState("");
  const [custo, setCusto] = useState(produto.custo_medio ? numeroParaCampo(Number(produto.custo_medio)) : "");
  const [data, setData] = useState(hojeISO());
  const [motivo, setMotivo] = useState("");
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const q = lerNumero(qtd);
  const c = custo.trim() ? lerNumero(custo) : null;
  const erros = {
    qtd: !(q > 0) ? "Informe a quantidade" : sentido === "saida" && q > Number(produto.estoque) ? `O estoque é ${quantidadeTexto(produto.estoque)}` : "",
    custo: sentido === "entrada" && !(c >= 0) ? "Informe o custo (zero se foi doação)" : "",
    motivo: motivo.trim().length < 3 ? "Informe o motivo" : "",
  };
  async function salvar() {
    setTentou(true);
    setErro("");
    if (Object.values(erros).some(Boolean)) return;
    setSalvando(true);
    try { await ajustarEstoque(produto.id, data, sentido === "saida" ? -q : q, sentido === "entrada" ? c : null, motivo.trim()); onSalvo(); }
    catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }
  return (
    <FormModal titulo={`Ajustar estoque — ${produto.nome}`} largura={480} onFechar={onFechar} onSalvar={salvar} salvando={salvando} erro={erro}>
      <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>Estoque atual: <strong>{quantidadeTexto(produto.estoque)} {produto.unidade}</strong>{produto.custo_medio ? `, custo médio ${formatarMoeda(produto.custo_medio)}` : ""}. Compra com nota entra pela nota de entrada; aqui ficam perdas, avarias, uso interno, doações recebidas e acertos de inventário.</p>
      <div className="segmented" style={{ marginTop: 8 }}>
        <button type="button" aria-pressed={sentido === "saida"} className={sentido === "saida" ? "ativo" : ""} onClick={() => setSentido("saida")}>Saída (perda, avaria, uso)</button>
        <button type="button" aria-pressed={sentido === "entrada"} className={sentido === "entrada" ? "ativo" : ""} onClick={() => setSentido("entrada")}>Entrada (doação, sobra)</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "0 12px" }}>
        <div><label style={lbl} htmlFor="aj-qtd">Quantidade *</label>
          <input id="aj-qtd" autoFocus inputMode="decimal" style={{ ...inp, textAlign: "right" }} value={qtd} onChange={(e) => setQtd(e.target.value)} />
          {tentou && erros.qtd && <div style={msgErro}>{erros.qtd}</div>}</div>
        {sentido === "entrada" && <div><label style={lbl} htmlFor="aj-custo">Custo unitário (R$) *</label>
          <input id="aj-custo" inputMode="decimal" style={{ ...inp, textAlign: "right" }} value={custo} onChange={(e) => setCusto(e.target.value)} />
          {tentou && erros.custo && <div style={msgErro}>{erros.custo}</div>}</div>}
        <div><label style={lbl} htmlFor="aj-data">Data *</label>
          <input id="aj-data" type="date" max={hojeISO()} style={inp} value={data} onChange={(e) => setData(e.target.value)} /></div>
      </div>
      {sentido === "saida" && <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>A saída vale pelo custo médio e vai para “Perdas e ajustes de estoque” na contabilidade.</div>}
      <label style={lbl} htmlFor="aj-motivo">Motivo *</label>
      <input id="aj-motivo" maxLength={300} style={inp} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: avaria na chuva, inventário de dezembro" />
      {tentou && erros.motivo && <div style={msgErro}>{erros.motivo}</div>}
    </FormModal>
  );
}

function MovimentosModal({ produto, onFechar }) {
  const [movs, setMovs] = useState(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    let ativo = true;
    listarMovimentosEstoque(produto.id).then((d) => { if (ativo) setMovs(d); }).catch((e) => { if (ativo) setErro(mensagemErro(e)); });
    return () => { ativo = false; };
  }, [produto.id]);
  return (
    <Modal titulo={`Movimentos — ${produto.nome}`} largura={760} onFechar={onFechar}>
      <p className="muted" style={{ marginTop: 4 }}>Estoque atual: <strong>{quantidadeTexto(produto.estoque)} {produto.unidade}</strong>, valor {formatarMoeda(produto.valor_estoque)}.</p>
      {erro && <div className="alert alert-danger" role="alert"><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
      {!movs && !erro && <div className="carregando-linha"><div className="spinner" /> Carregando...</div>}
      {movs && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Data</th><th>Movimento</th><th className="num">Quantidade</th><th className="num">Custo</th><th>Por</th></tr></thead>
            <tbody>
              {movs.length === 0 && <tr><td className="vazio" colSpan={5}>Sem movimentos.</td></tr>}
              {movs.map((m) => (
                <tr key={m.id}>
                  <td>{formatarData(m.data)}</td>
                  <td>{TIPOS_MOV[m.tipo] ?? m.tipo}{m.motivo && m.tipo === "ajuste" && <div className="muted" style={{ fontSize: 12 }}>{m.motivo}</div>}</td>
                  <td className="num" style={{ color: Number(m.quantidade) < 0 ? "var(--danger)" : "var(--ok-text)" }}>{Number(m.quantidade) > 0 ? "+" : ""}{quantidadeTexto(m.quantidade)}</td>
                  <td className="num">{formatarMoeda(Math.abs(Number(m.valor)))}</td>
                  <td style={{ fontSize: 12.5 }}>{m.criado_por_nome ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
