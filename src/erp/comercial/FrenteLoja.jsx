import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header, Pill } from "../../ui";
import { lbl, inp, msgErro } from "../../estilos";
import Icone from "../Icone";
import Modal from "../Modal";
import {
  listarCaixasPdv, listarAcessosPdv, listarProdutos, listarVendas, abrirCaixaPdv, registrarVendaComNumero, cancelarVenda,
  resumoCaixaPdv, fecharCaixaPdv, mensagemErro,
} from "../db";
import { formatarData, formatarMoeda, hojeISO, lerNumero, paraCentavos, deCentavos, numeroParaCampo } from "../format";
import { centavosItem, centavosCarrinho, formasDeVenda, podeNoLocal, vendidoNoLocal, horaDe, quantidadeTexto } from "./calculoPdv";

// Comercial → Frente de loja (v27): abre o caixa de um local num dia, vende e fecha.
// Rota: #/comercial/frente (lista dos caixas) e #/comercial/frente/<id do caixa> (vendendo).

const moeda = (c) => formatarMoeda(deCentavos(c));
const irPara = (caixaId) => { window.location.hash = caixaId ? `#/comercial/frente/${caixaId}` : "#/comercial/frente"; };

export default function FrenteLoja({ perfil, cadastros, admin, caixaRota }) {
  const [caixas, setCaixas] = useState(null);
  const [acessos, setAcessos] = useState([]);
  const [erro, setErro] = useState("");
  const [abrindo, setAbrindo] = useState(false);

  const recarregar = useCallback(() => {
    Promise.all([listarCaixasPdv({ abertos: true }), admin ? Promise.resolve([]) : listarAcessosPdv(perfil.user_id)])
      .then(([c, a]) => { setCaixas(c); setAcessos(a); setErro(""); })
      .catch((e) => setErro(mensagemErro(e)));
  }, [admin, perfil.user_id]);
  useEffect(() => { recarregar(); }, [recarregar]);

  const pontos = cadastros.pontos ?? [];
  const nomePonto = (id) => pontos.find((p) => p.id === id)?.nome ?? "?";
  const pode = (pontoId, acao) => podeNoLocal(admin, acessos, pontoId, acao);
  const meusCaixas = (caixas ?? []).filter((c) => pode(c.ponto_venda_id, "vender"));
  const paraAbrir = pontos.filter((p) => p.ativo && pode(p.id, "abrir") && !(caixas ?? []).some((c) => c.ponto_venda_id === p.id));
  const caixa = caixaRota ? (caixas ?? []).find((c) => String(c.id) === String(caixaRota)) : null;

  if (erro) return <div className="alert alert-danger" role="alert"><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>;
  if (!caixas) return <div className="carregando-linha"><div className="spinner" /> Carregando...</div>;

  if (caixa) {
    return <Vendendo key={caixa.id} caixa={caixa} ponto={pontos.find((p) => p.id === caixa.ponto_venda_id)} cadastros={cadastros}
      podeFechar={pode(caixa.ponto_venda_id, "abrir")} onFechado={() => { irPara(null); recarregar(); }} />;
  }

  const semAcesso = !admin && acessos.length === 0;
  return (
    <div>
      <div className="page-header">
        <Header title="Frente de loja" subtitle="Caixa da cafeteria, da livraria, do bazar... Abra o caixa escolhendo o local e o dia, venda e feche no fim com a contagem do dinheiro." />
        {paraAbrir.length > 0 && <button className="btn btn-primary" onClick={() => setAbrindo(true)}><Icone nome="mais" tamanho={16} traco={2.2} /> Abrir caixa</button>}
      </div>
      {caixaRota && <div className="alert alert-warn" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>Este caixa não está mais aberto (ou você não vende neste local).</span></div>}

      {pontos.length === 0 ? (
        <div className="card"><div className="empty">
          <div className="empty-icon"><Icone nome="sacola" tamanho={26} /></div>
          <h2>Nenhum local de venda cadastrado</h2>
          <p>{admin ? <>Cadastre a cafeteria, a livraria ou o bazar em <a href="#/parametros/locais">Parâmetros → Comercial → Locais de venda</a>.</> : "Peça ao Administrador da igreja para cadastrar os locais de venda."}</p>
        </div></div>
      ) : semAcesso ? (
        <div className="card"><div className="empty">
          <div className="empty-icon"><Icone nome="cadeado" tamanho={26} /></div>
          <h2>Você não usa o frente de loja</h2>
          <p>Quem abre o caixa e quem vende em cada local é definido no cadastro do usuário. Peça ao Administrador ou ao Supervisor da igreja.</p>
        </div></div>
      ) : (
        <>
          <h3 className="section-title">Caixas abertos</h3>
          {meusCaixas.length === 0 && <div className="card" style={{ padding: 18 }}><span className="muted">Nenhum caixa aberto nos seus locais.{paraAbrir.length ? " Clique em “Abrir caixa” para começar." : " Quem abre o caixa ainda não abriu."}</span></div>}
          <div className="pdv-caixas">
            {meusCaixas.map((c) => (
              <button key={c.id} type="button" className="card pdv-caixa" onClick={() => irPara(c.id)}>
                <div className="pdv-caixa-local"><Icone nome="sacola" tamanho={18} /> {nomePonto(c.ponto_venda_id)}</div>
                <div className="pdv-caixa-dia">Caixa de {formatarData(c.data)}{c.data !== hojeISO() && <Pill tone="warn">outro dia</Pill>}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>Aberto por {c.aberto_por_nome} às {horaDe(c.aberto_em)} · troco {formatarMoeda(c.troco_inicial)}</div>
                <span className="btn btn-primary btn-sm" style={{ marginTop: 10, alignSelf: "flex-start" }}>Vender <Icone nome="seta" tamanho={14} /></span>
              </button>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 14 }}>O histórico dos caixas fechados fica em Comercial → Caixas.</p>
        </>
      )}
      {abrindo && <AbrirCaixaModal pontos={paraAbrir} onFechar={() => setAbrindo(false)}
        onAberto={(id) => { setAbrindo(false); recarregar(); irPara(id); }} />}
    </div>
  );
}

function AbrirCaixaModal({ pontos, onFechar, onAberto }) {
  const [pontoId, setPontoId] = useState(pontos.length === 1 ? String(pontos[0].id) : "");
  const [dia, setDia] = useState(hojeISO());
  const [troco, setTroco] = useState("");
  const [obs, setObs] = useState("");
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const valorTroco = troco.trim() ? lerNumero(troco) : 0;
  const erros = {
    pontoId: !pontoId ? "Escolha o local" : "",
    dia: !dia ? "Escolha o dia" : dia > hojeISO() ? "O dia não pode ser no futuro" : "",
    troco: !(valorTroco >= 0) ? "Valor inválido" : "",
  };
  async function abrir() {
    setTentou(true);
    setErro("");
    if (Object.values(erros).some(Boolean)) return;
    setSalvando(true);
    try { onAberto(await abrirCaixaPdv(Number(pontoId), dia, valorTroco, obs.trim())); }
    catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }
  const borda = (k) => (tentou && erros[k] ? { borderColor: "var(--danger)" } : {});
  return (
    <Modal titulo="Abrir caixa" largura={460} onFechar={onFechar} fecharFora={false}
      rodape={<>
        <button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Cancelar</button>
        <button className="btn btn-primary" onClick={abrir} disabled={salvando}>{salvando ? "Abrindo..." : "Abrir caixa"}</button>
      </>}>
      <label style={{ ...lbl, marginTop: 4 }} htmlFor="ab-local">Onde *</label>
      <select id="ab-local" autoFocus style={{ ...inp, ...borda("pontoId") }} value={pontoId} onChange={(e) => setPontoId(e.target.value)}>
        <option value="">— Escolha o local —</option>
        {pontos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
      </select>
      {tentou && erros.pontoId && <div style={msgErro}>{erros.pontoId}</div>}
      <label style={lbl} htmlFor="ab-dia">Dia *</label>
      <input id="ab-dia" type="date" max={hojeISO()} style={{ ...inp, ...borda("dia") }} value={dia} onChange={(e) => setDia(e.target.value)} />
      {tentou && erros.dia && <div style={msgErro}>{erros.dia}</div>}
      <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>As vendas entram no Financeiro com esta data. Para lançar um bazar de outro dia, escolha o dia dele.</div>
      <label style={lbl} htmlFor="ab-troco">Troco na gaveta (R$)</label>
      <input id="ab-troco" inputMode="decimal" placeholder="0,00" style={{ ...inp, textAlign: "right", ...borda("troco") }} value={troco} onChange={(e) => setTroco(e.target.value)} />
      {tentou && erros.troco && <div style={msgErro}>{erros.troco}</div>}
      <label style={lbl} htmlFor="ab-obs">Observação</label>
      <input id="ab-obs" maxLength={300} style={inp} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: bazar de Natal" />
      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}

// ── Vendendo num caixa aberto ────────────────────────────────────

function Vendendo({ caixa, ponto, cadastros, podeFechar, onFechado }) {
  const [produtos, setProdutos] = useState(null);
  const [vendas, setVendas] = useState([]);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [carrinho, setCarrinho] = useState([]);
  const [desconto, setDesconto] = useState("");
  const [pagando, setPagando] = useState(false);
  const [avulso, setAvulso] = useState(false);
  const [fechando, setFechando] = useState(false);
  const [cancelando, setCancelando] = useState(null);
  const [aviso, setAviso] = useState("");
  const buscaRef = useRef(null);

  const recarregar = useCallback(() => {
    Promise.all([listarProdutos(), listarVendas([caixa.id])])
      .then(([p, v]) => { setProdutos(p); setVendas(v); setErro(""); })
      .catch((e) => setErro(mensagemErro(e)));
  }, [caixa.id]);
  useEffect(() => { recarregar(); }, [recarregar]);

  const doLocal = useMemo(() => (produtos ?? []).filter((p) => p.ativo && vendidoNoLocal(p, caixa.ponto_venda_id)), [produtos, caixa.ponto_venda_id]);
  const termo = busca.trim().toLowerCase();
  const achados = termo ? doLocal.filter((p) => p.nome.toLowerCase().includes(termo) || (p.codigo ?? "").toLowerCase() === termo) : doLocal;
  const noCarrinho = (id) => carrinho.filter((i) => i.produtoId === id).reduce((a, i) => a + Number(i.quantidade), 0);
  const subtotal = centavosCarrinho(carrinho);
  const descCent = desconto.trim() ? paraCentavos(lerNumero(desconto)) : 0;
  const descInvalido = !(descCent >= 0) || (descCent > 0 && descCent >= subtotal);
  const total = subtotal - (descInvalido ? 0 : descCent);

  function adicionar(p) {
    setAviso("");
    if (p.controla_estoque && noCarrinho(p.id) + 1 > Number(p.estoque)) { setAviso(`Sem estoque de “${p.nome}” para mais uma unidade.`); return; }
    setCarrinho((c) => {
      const i = c.findIndex((x) => x.produtoId === p.id);
      if (i >= 0) return c.map((x, n) => (n === i ? { ...x, quantidade: Number(x.quantidade) + 1 } : x));
      return [...c, { chave: crypto.randomUUID(), produtoId: p.id, descricao: p.nome, preco: Number(p.preco), quantidade: 1, unidade: p.unidade }];
    });
  }
  function mudarQtd(chave, q) {
    setAviso("");
    setCarrinho((c) => c.flatMap((x) => {
      if (x.chave !== chave) return [x];
      if (q <= 0) return [];
      const p = x.produtoId && (produtos ?? []).find((pp) => pp.id === x.produtoId);
      if (p?.controla_estoque && noCarrinho(p.id) - Number(x.quantidade) + q > Number(p.estoque)) { setAviso(`O estoque de “${p.nome}” é ${quantidadeTexto(p.estoque)}.`); return [x]; }
      return [{ ...x, quantidade: q }];
    }));
  }
  function buscarEnter(e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const exato = doLocal.find((p) => (p.codigo ?? "").toLowerCase() === termo);
    const alvo = exato ?? (achados.length === 1 ? achados[0] : null);
    if (alvo) { adicionar(alvo); setBusca(""); }
  }
  function concluida(venda, troco) {
    setPagando(false);
    setCarrinho([]);
    setDesconto("");
    setAviso(`Venda nº ${venda} concluída.${troco > 0 ? ` Troco: ${moeda(troco)}.` : ""}`);
    recarregar();
    buscaRef.current?.focus();
  }

  const concluidas = vendas.filter((v) => v.status === "concluida");
  const totalCaixa = concluidas.reduce((a, v) => a + paraCentavos(v.total), 0);

  return (
    <div>
      <div className="page-header">
        <Header title={`${ponto?.nome ?? "Caixa"} · caixa de ${formatarData(caixa.data)}`}
          subtitle={`Aberto por ${caixa.aberto_por_nome} às ${horaDe(caixa.aberto_em)} · troco ${formatarMoeda(caixa.troco_inicial)} · ${concluidas.length} venda(s), ${moeda(totalCaixa)}`} />
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => irPara(null)}>Trocar de caixa</button>
          {podeFechar && <button className="btn btn-ghost" onClick={() => setFechando(true)}><Icone nome="cadeado" tamanho={16} /> Fechar caixa</button>}
        </div>
      </div>
      {erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}

      <div className="pdv">
        <section className="card pdv-produtos">
          <div className="pdv-busca">
            <input ref={buscaRef} autoFocus style={inp} placeholder="Buscar produto ou ler o código de barras (Enter adiciona)" value={busca}
              onChange={(e) => setBusca(e.target.value)} onKeyDown={buscarEnter} aria-label="Buscar produto" />
            <button type="button" className="btn btn-ghost" onClick={() => setAvulso(true)} title="Item sem cadastro (ex.: bazar)"><Icone nome="mais" tamanho={16} /> Item avulso</button>
          </div>
          {!produtos && <div className="carregando-linha"><div className="spinner" /> Carregando produtos...</div>}
          {produtos && doLocal.length === 0 && <p className="muted" style={{ padding: 16 }}>Nenhum produto ativo neste local. Cadastre em Comercial → Produtos, ou venda como item avulso.</p>}
          <div className="pdv-grade">
            {achados.slice(0, 120).map((p) => {
              const sem = p.controla_estoque && Number(p.estoque) - noCarrinho(p.id) <= 0;
              return (
                <button key={p.id} type="button" className="pdv-produto" disabled={sem} onClick={() => adicionar(p)} title={p.codigo ? `Código ${p.codigo}` : p.nome}>
                  <span className="pdv-produto-nome">{p.nome}</span>
                  <span className="pdv-produto-preco">{formatarMoeda(p.preco)}</span>
                  {p.controla_estoque && <span className={`pdv-produto-est${sem ? " sem" : ""}`}>{sem ? "sem estoque" : `estoque ${quantidadeTexto(Number(p.estoque) - noCarrinho(p.id))}`}</span>}
                </button>
              );
            })}
          </div>
          {achados.length > 120 && <p className="muted" style={{ padding: "0 16px 16px", fontSize: 12.5 }}>Mostrando 120 de {achados.length}. Refine a busca.</p>}
        </section>

        <section className="card pdv-carrinho" aria-label="Venda atual">
          <h3 className="section-title" style={{ margin: 0 }}>Venda atual</h3>
          {carrinho.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Toque nos produtos para adicionar.</p>}
          <ul className="pdv-itens">
            {carrinho.map((i) => (
              <li key={i.chave}>
                <div className="pdv-item-desc">{i.descricao}<span className="muted"> · {formatarMoeda(i.preco)}{i.unidade && i.unidade !== "UN" ? `/${i.unidade}` : ""}</span></div>
                <div className="pdv-item-qtd">
                  <button type="button" className="icon-btn" aria-label={`Menos ${i.descricao}`} onClick={() => mudarQtd(i.chave, Number(i.quantidade) - 1)}>−</button>
                  <span>{quantidadeTexto(i.quantidade)}</span>
                  <button type="button" className="icon-btn" aria-label={`Mais ${i.descricao}`} onClick={() => mudarQtd(i.chave, Number(i.quantidade) + 1)}>+</button>
                </div>
                <div className="pdv-item-total">{moeda(centavosItem(i))}</div>
                <button type="button" className="icon-btn perigo" aria-label={`Tirar ${i.descricao}`} onClick={() => mudarQtd(i.chave, 0)}><Icone nome="lixeira" tamanho={15} /></button>
              </li>
            ))}
          </ul>
          {aviso && <div className={`alert ${aviso.startsWith("Venda") ? "alert-ok" : "alert-warn"}`} role="status" style={{ marginTop: 8 }}><Icone nome={aviso.startsWith("Venda") ? "check" : "alerta"} tamanho={16} /><span>{aviso}</span></div>}
          <div className="pdv-totais">
            <div><span>Itens</span><span>{moeda(subtotal)}</span></div>
            <div><label htmlFor="pdv-desc">Desconto</label>
              <input id="pdv-desc" inputMode="decimal" placeholder="0,00" style={{ ...inp, width: 110, textAlign: "right", ...(descInvalido ? { borderColor: "var(--danger)" } : {}) }} value={desconto} onChange={(e) => setDesconto(e.target.value)} />
            </div>
            <div className="pdv-total"><span>Total</span><span>{moeda(total)}</span></div>
          </div>
          <button type="button" className="btn btn-primary pdv-receber" disabled={!carrinho.length || descInvalido || total <= 0} onClick={() => setPagando(true)}>
            Receber {carrinho.length > 0 && moeda(total)}
          </button>
          {carrinho.length > 0 && <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => { setCarrinho([]); setDesconto(""); setAviso(""); }}>Limpar a venda</button>}
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="painel-cab" style={{ padding: "14px 16px 0" }}><h3>Vendas deste caixa</h3></div>
        <ListaVendas vendas={vendas} cadastros={cadastros} onCancelar={podeFechar ? setCancelando : null} />
      </section>

      {pagando && <PagamentoModal caixa={caixa} carrinho={carrinho} desconto={descCent} total={total} formas={formasDeVenda(cadastros.formas)}
        onFechar={() => setPagando(false)} onConcluida={concluida} />}
      {avulso && <AvulsoModal onFechar={() => setAvulso(false)} onIncluir={(i) => { setCarrinho((c) => [...c, { ...i, chave: crypto.randomUUID() }]); setAvulso(false); }} />}
      {cancelando && <CancelarVendaModal venda={cancelando} onFechar={() => setCancelando(null)} onCancelada={() => { setCancelando(null); setAviso(""); recarregar(); }} />}
      {fechando && <FecharCaixaModal caixa={caixa} ponto={ponto} onFechar={() => setFechando(false)} onFechado={onFechado} />}
    </div>
  );
}

// Lista de vendas (também usada no detalhe do caixa).
export function ListaVendas({ vendas, cadastros, onCancelar }) {
  const nomeForma = (id) => cadastros.formas.find((f) => f.id === id)?.nome ?? "?";
  if (!vendas.length) return <p className="muted" style={{ padding: 16, fontSize: 13 }}>Nenhuma venda ainda.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Nº</th><th>Hora</th><th>Itens</th><th>Pagamento</th><th>Vendedor</th><th className="num">Total</th><th>Situação</th>{onCancelar && <th />}</tr></thead>
        <tbody>
          {vendas.map((v) => (
            <tr key={v.id} style={v.status === "cancelada" ? { color: "var(--faint)" } : undefined}>
              <td>{v.numero}</td>
              <td>{horaDe(v.criado_em)}</td>
              <td style={{ fontSize: 12.5, maxWidth: 320 }}>{(v.venda_itens ?? []).map((i) => `${quantidadeTexto(i.quantidade)}× ${i.descricao}`).join(", ")}{Number(v.desconto) > 0 && <span className="muted"> · desconto {formatarMoeda(v.desconto)}</span>}</td>
              <td style={{ fontSize: 12.5 }}>{(v.venda_pagamentos ?? []).map((p) => `${nomeForma(p.forma_pagamento_id)} ${formatarMoeda(p.valor)}`).join(" + ")}</td>
              <td style={{ fontSize: 12.5 }}>{v.vendedor_nome}</td>
              <td className="num" style={{ fontWeight: 600 }}>{formatarMoeda(v.total)}</td>
              <td>{v.status === "cancelada" ? <span title={`${v.motivo_cancelamento} — ${v.cancelada_por_nome}`}><Pill tone="danger">Cancelada</Pill></span> : <Pill tone="ok">Concluída</Pill>}</td>
              {onCancelar && <td style={{ textAlign: "right" }}>{v.status === "concluida" && <button className="btn btn-ghost btn-sm" onClick={() => onCancelar(v)}>Cancelar</button>}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PagamentoModal({ caixa, carrinho, desconto, total, formas, onFechar, onConcluida }) {
  const dinheiro = formas.find((f) => f.tipo === "dinheiro");
  const [linhas, setLinhas] = useState(() => [{ chave: crypto.randomUUID(), formaId: String((dinheiro ?? formas[0])?.id ?? ""), valor: numeroParaCampo(deCentavos(total)), recebido: "" }]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const tipoDe = (id) => formas.find((f) => String(f.id) === String(id))?.tipo;
  const cent = (txt) => (String(txt).trim() ? paraCentavos(lerNumero(txt)) : 0);
  const pago = linhas.reduce((a, l) => a + cent(l.valor), 0);
  const falta = total - pago;
  const troco = linhas.reduce((a, l) => a + (tipoDe(l.formaId) === "dinheiro" && String(l.recebido).trim() ? Math.max(0, cent(l.recebido) - cent(l.valor)) : 0), 0);
  const recebidoCurto = linhas.some((l) => tipoDe(l.formaId) === "dinheiro" && String(l.recebido).trim() && cent(l.recebido) < cent(l.valor));
  const invalido = linhas.some((l) => !l.formaId || !(cent(l.valor) > 0)) || falta !== 0 || recebidoCurto;
  const mudar = (chave, patch) => setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, ...patch } : l)));
  const so = (f) => setLinhas([{ chave: crypto.randomUUID(), formaId: String(f.id), valor: numeroParaCampo(deCentavos(total)), recebido: "" }]);

  async function concluir() {
    if (invalido) return;
    setSalvando(true);
    setErro("");
    try {
      const itens = carrinho.map((i) => (i.produtoId ? { produto_id: i.produtoId, quantidade: Number(i.quantidade) } : { descricao: i.descricao, quantidade: Number(i.quantidade), preco_unitario: i.preco }));
      const pagamentos = linhas.map((l) => ({
        forma_pagamento_id: Number(l.formaId), valor: deCentavos(cent(l.valor)),
        valor_recebido: tipoDe(l.formaId) === "dinheiro" && String(l.recebido).trim() ? deCentavos(cent(l.recebido)) : null,
      }));
      onConcluida(await registrarVendaComNumero(caixa.id, itens, pagamentos, deCentavos(desconto)), troco);
    } catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }

  return (
    <Modal titulo={`Receber ${moeda(total)}`} largura={560} onFechar={onFechar} fecharFora={false}
      rodape={<>
        <button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Voltar</button>
        <button className="btn btn-primary" onClick={concluir} disabled={salvando || invalido}>{salvando ? "Registrando..." : "Concluir venda"}</button>
      </>}>
      {formas.length === 0 && <div className="alert alert-warn"><Icone nome="alerta" tamanho={16} /><span>Nenhuma forma de pagamento ativa. Um Administrador cadastra em Parâmetros → Financeiro → Formas de pagamento.</span></div>}
      <div className="pdv-formas">
        {formas.map((f) => <button key={f.id} type="button" className={`btn btn-ghost${linhas.length === 1 && linhas[0].formaId === String(f.id) ? " ativo" : ""}`} onClick={() => so(f)}>{f.nome}</button>)}
      </div>
      {linhas.map((l) => (
        <div key={l.chave} className="pdv-pag-linha">
          <select style={inp} value={l.formaId} onChange={(e) => mudar(l.chave, { formaId: e.target.value, recebido: "" })} aria-label="Forma de pagamento">
            {formas.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
          <input inputMode="decimal" style={{ ...inp, textAlign: "right" }} value={l.valor} onChange={(e) => mudar(l.chave, { valor: e.target.value })} aria-label="Valor" />
          {tipoDe(l.formaId) === "dinheiro"
            ? <input inputMode="decimal" style={{ ...inp, textAlign: "right" }} placeholder="Recebido" value={l.recebido} onChange={(e) => mudar(l.chave, { recebido: e.target.value })} aria-label="Valor recebido em dinheiro" />
            : <span />}
          {linhas.length > 1 ? <button type="button" className="icon-btn perigo" aria-label="Tirar forma" onClick={() => setLinhas((ls) => ls.filter((x) => x.chave !== l.chave))}><Icone nome="lixeira" tamanho={15} /></button> : <span />}
        </div>
      ))}
      <button type="button" className="link-botao" style={{ marginTop: 6 }} disabled={falta <= 0}
        onClick={() => setLinhas((ls) => [...ls, { chave: crypto.randomUUID(), formaId: String(formas.find((f) => !ls.some((x) => x.formaId === String(f.id)))?.id ?? formas[0]?.id ?? ""), valor: numeroParaCampo(deCentavos(Math.max(0, falta))), recebido: "" }])}>
        + Dividir em outra forma
      </button>
      <div className="pdv-pag-resumo">
        {falta > 0 && <div className="cor-aviso">Falta {moeda(falta)}</div>}
        {falta < 0 && <div className="cor-aviso">Passou {moeda(-falta)} do total</div>}
        {recebidoCurto && <div className="cor-aviso">O valor recebido em dinheiro é menor que o valor</div>}
        {troco > 0 && <div className="pdv-troco">Troco: {moeda(troco)}</div>}
      </div>
      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 12 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}

function AvulsoModal({ onFechar, onIncluir }) {
  const [descricao, setDescricao] = useState("");
  const [preco, setPreco] = useState("");
  const [qtd, setQtd] = useState("1");
  const [tentou, setTentou] = useState(false);
  const p = lerNumero(preco);
  const q = lerNumero(qtd);
  const erros = { descricao: !descricao.trim() ? "Descreva o item" : "", preco: !(p > 0) ? "Informe o preço" : "", qtd: !(q > 0) ? "Quantidade inválida" : "" };
  function incluir() {
    setTentou(true);
    if (Object.values(erros).some(Boolean)) return;
    onIncluir({ produtoId: null, descricao: descricao.trim(), preco: p, quantidade: q, unidade: "UN" });
  }
  return (
    <Modal titulo="Item avulso" largura={420} onFechar={onFechar}
      rodape={<><button className="btn btn-ghost" onClick={onFechar}>Cancelar</button><button className="btn btn-primary" onClick={incluir}>Incluir</button></>}>
      <form onSubmit={(e) => { e.preventDefault(); incluir(); }}>
        <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>Para o que não tem cadastro (ex.: peças do bazar). Não mexe em estoque.</p>
        <label style={lbl} htmlFor="av-desc">Descrição *</label>
        <input id="av-desc" autoFocus maxLength={120} style={inp} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Blusa de lã" />
        {tentou && erros.descricao && <div style={msgErro}>{erros.descricao}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div><label style={lbl} htmlFor="av-preco">Preço (R$) *</label>
            <input id="av-preco" inputMode="decimal" style={{ ...inp, textAlign: "right" }} value={preco} onChange={(e) => setPreco(e.target.value)} />
            {tentou && erros.preco && <div style={msgErro}>{erros.preco}</div>}</div>
          <div><label style={lbl} htmlFor="av-qtd">Quantidade *</label>
            <input id="av-qtd" inputMode="decimal" style={{ ...inp, textAlign: "right" }} value={qtd} onChange={(e) => setQtd(e.target.value)} />
            {tentou && erros.qtd && <div style={msgErro}>{erros.qtd}</div>}</div>
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function CancelarVendaModal({ venda, onFechar, onCancelada }) {
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  async function cancelar() {
    if (motivo.trim().length < 3) { setErro("Informe o motivo do cancelamento."); return; }
    setSalvando(true);
    setErro("");
    try { await cancelarVenda(venda.id, motivo.trim()); onCancelada(); }
    catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }
  return (
    <Modal titulo={`Cancelar a venda nº ${venda.numero}`} largura={440} onFechar={onFechar} fecharFora={false}
      rodape={<><button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Voltar</button><button className="btn btn-danger" onClick={cancelar} disabled={salvando}>{salvando ? "Cancelando..." : "Cancelar venda"}</button></>}>
      <p style={{ marginTop: 4 }}>Venda de {formatarMoeda(venda.total)} às {horaDe(venda.criado_em)}. Os produtos voltam ao estoque e o valor sai do fechamento deste caixa. Devolva o dinheiro ao cliente.</p>
      <label style={lbl} htmlFor="cv-motivo">Motivo *</label>
      <input id="cv-motivo" autoFocus maxLength={300} style={inp} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: cliente desistiu, lançado errado" />
      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 12 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}

function FecharCaixaModal({ caixa, ponto, onFechar, onFechado }) {
  const [resumo, setResumo] = useState(null);
  const [contado, setContado] = useState("");
  const [obs, setObs] = useState("");
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  useEffect(() => {
    let ativo = true;
    resumoCaixaPdv(caixa.id).then((r) => { if (ativo) setResumo(r); }).catch((e) => { if (ativo) setErro(mensagemErro(e)); });
    return () => { ativo = false; };
  }, [caixa.id]);
  const esperado = resumo ? paraCentavos(resumo.dinheiro_esperado) : 0;
  const cContado = contado.trim() ? paraCentavos(lerNumero(contado)) : null;
  const dif = cContado === null ? null : cContado - esperado;
  const erros = {
    contado: !(cContado >= 0) ? "Informe o dinheiro contado na gaveta" : "",
    obs: dif && obs.trim().length < 3 ? "Explique a diferença" : "",
  };
  async function fechar() {
    setTentou(true);
    setErro("");
    if (Object.values(erros).some(Boolean)) return;
    setSalvando(true);
    try { await fecharCaixaPdv(caixa.id, deCentavos(cContado), obs.trim()); onFechado(); }
    catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }
  return (
    <Modal titulo={`Fechar o caixa — ${ponto?.nome ?? ""} de ${formatarData(caixa.data)}`} largura={560} onFechar={onFechar} fecharFora={false}
      rodape={<><button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Voltar</button><button className="btn btn-primary" onClick={fechar} disabled={salvando || !resumo}>{salvando ? "Fechando..." : "Fechar caixa"}</button></>}>
      {!resumo && !erro && <div className="carregando-linha"><div className="spinner" /> Somando as vendas...</div>}
      {resumo && (
        <>
          <div className="pdv-resumo">
            <div className="fech-linha"><span>Vendas</span><strong>{resumo.vendas}{resumo.canceladas ? ` (+${resumo.canceladas} cancelada${resumo.canceladas > 1 ? "s" : ""})` : ""}</strong></div>
            {Number(resumo.desconto) > 0 && <div className="fech-linha"><span>Descontos dados</span><strong>{formatarMoeda(resumo.desconto)}</strong></div>}
            {resumo.formas.map((f) => <div key={f.id} className="fech-linha"><span>{f.nome}</span><strong>{formatarMoeda(f.valor)}</strong></div>)}
            <div className="fech-linha fech-total"><span>Total vendido</span><strong>{formatarMoeda(resumo.total)}</strong></div>
          </div>
          <h3 className="section-title">Dinheiro na gaveta</h3>
          <div className="pdv-resumo">
            <div className="fech-linha"><span>Troco da abertura</span><strong>{formatarMoeda(resumo.troco_inicial)}</strong></div>
            <div className="fech-linha"><span>Vendas em dinheiro</span><strong>{formatarMoeda(resumo.dinheiro_vendas)}</strong></div>
            <div className="fech-linha fech-total"><span>Deve haver na gaveta</span><strong>{formatarMoeda(resumo.dinheiro_esperado)}</strong></div>
          </div>
          <label style={lbl} htmlFor="fc-contado">Dinheiro contado (com o troco) *</label>
          <input id="fc-contado" autoFocus inputMode="decimal" placeholder="0,00" style={{ ...inp, textAlign: "right", ...(tentou && erros.contado ? { borderColor: "var(--danger)" } : {}) }} value={contado} onChange={(e) => setContado(e.target.value)} />
          {tentou && erros.contado && <div style={msgErro}>{erros.contado}</div>}
          {dif !== null && dif !== 0 && <div className="cor-aviso" style={{ marginTop: 6 }}>{dif > 0 ? `Sobra de ${moeda(dif)}` : `Falta de ${moeda(-dif)}`} — entra no Financeiro como diferença de caixa.</div>}
          {dif === 0 && <div style={{ marginTop: 6, color: "var(--ok-text)", fontSize: 13 }}>Bateu certinho.</div>}
          <label style={lbl} htmlFor="fc-obs">Observação{dif ? " *" : ""}</label>
          <input id="fc-obs" maxLength={500} style={{ ...inp, ...(tentou && erros.obs ? { borderColor: "var(--danger)" } : {}) }} value={obs} onChange={(e) => setObs(e.target.value)} placeholder={dif ? "O que aconteceu? (ex.: troco dado a mais)" : "Opcional"} />
          {tentou && erros.obs && <div style={msgErro}>{erros.obs}</div>}
          <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>Ao fechar, as vendas entram na conta caixa do local (dinheiro) e na conta de PIX e cartões, com a data do caixa. Fechado, o caixa não reabre.</p>
        </>
      )}
      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 12 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}
