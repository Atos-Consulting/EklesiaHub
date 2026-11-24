import { useEffect, useMemo, useRef, useState } from "react";
import { Pill } from "../ui";
import { lbl, inp, msgErro } from "../estilos";
import Icone from "./Icone";
import Modal from "./Modal";
import PessoaModal from "./PessoaModal";
import {
  carregarNota, salvarNota, aprovarNota, cancelarNota, excluirRascunho,
  enviarAnexo, removerAnexo, urlAnexo, mensagemErro,
} from "./db";
import {
  TIPOS_NOTA, STATUS_NOTA, TOM_STATUS, formatarMoeda, formatarData, formatarTamanho, hojeISO,
  lerNumero, numeroParaCampo, paraCentavos, somarValores, totalItem, validarAnexo, mascararDocumento,
} from "./format";
import { tamanhoNumero } from "./catalogoParametros";

const itemVazio = () => ({
  chave: crypto.randomUUID(), descricao: "", quantidade: "1", valorUnitario: "", valorTotal: "",
  totalManual: false, contaId: "", centroCustoId: "",
});
const itemEmBranco = (i) => !i.descricao.trim() && !i.valorUnitario.trim() && !i.valorTotal.trim() && !i.contaId;
const limparChave = (v) => String(v || "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 44);
const NOVO_FORNECEDOR = "__novo__"; // opção especial do select: abre o cadastro de fornecedor
const campoTexto = (n) =>String(n ?? "").replace(".", ",");

export default function NotaModal({ notaId, cadastros, podeEditar, podeAprovar, onCadastrosMudaram, onMudou, onFechar }) {
  const [idAtual, setIdAtual] = useState(notaId);
  const [carregando, setCarregando] = useState(Boolean(notaId));
  const [nota, setNota] = useState(null); // registro do banco (status, datas de aprovação...)
  const [form, setForm] = useState(() => ({
    tipo: "nfe", numero: "", serie: "", chaveAcesso: "", fornecedorId: "",
    dataEmissao: hojeISO(), dataEntrada: hojeISO(), valorTotal: "",
    centroCustoId: "", fundoId: String(cadastros.fundos.find((f) => f.nome === "Geral" && f.ativo)?.id ?? ""),
    observacoes: "",
  }));
  const [itens, setItens] = useState(() => [itemVazio()]);
  const [anexos, setAnexos] = useState([]);
  const [pendentes, setPendentes] = useState([]);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [tentou, setTentou] = useState(false);
  const [confirmacao, setConfirmacao] = useState(null); // "aprovar" | "cancelar" | "excluir"
  const [motivoCancel, setMotivoCancel] = useState("");
  const [novoFornecedor, setNovoFornecedor] = useState(false);
  const inputArquivo = useRef(null);

  function aplicar({ nota: n, itens: its, anexos: ax }) {
    setNota(n);
    setForm({
      tipo: n.tipo, numero: n.numero, serie: n.serie || "", chaveAcesso: n.chave_acesso || "",
      fornecedorId: String(n.fornecedor_id), dataEmissao: n.data_emissao, dataEntrada: n.data_entrada,
      valorTotal: numeroParaCampo(Number(n.valor_total)),
      centroCustoId: n.centro_custo_id ? String(n.centro_custo_id) : "",
      fundoId: n.fundo_id ? String(n.fundo_id) : "",
      observacoes: n.observacoes || "",
    });
    setItens(its.length
      ? its.map((i) => ({
          chave: crypto.randomUUID(), descricao: i.descricao, quantidade: campoTexto(Number(i.quantidade)),
          valorUnitario: numeroParaCampo(Number(i.valor_unitario)), valorTotal: numeroParaCampo(Number(i.valor_total)),
          totalManual: true, contaId: String(i.conta_id), centroCustoId: i.centro_custo_id ? String(i.centro_custo_id) : "",
        }))
      : [itemVazio()]);
    setAnexos(ax);
  }

  useEffect(() => {
    if (!notaId) return;
    let ativo = true;
    carregarNota(notaId)
      .then((dados) => { if (ativo) aplicar(dados); })
      .catch((e) => { if (ativo) setErro(mensagemErro(e)); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [notaId]);

  const status = nota?.status || "rascunho";
  const novo = !idAtual;
  const editavel = podeEditar && (novo || status === "rascunho");
  const podeAnexar = podeEditar && (novo || status === "rascunho" || status === "aprovada");
  const ocupadoQualquer = Boolean(ocupado) || carregando;

  const valorTotalNum = lerNumero(form.valorTotal);
  const itensAtivos = itens.filter((i) => !itemEmBranco(i));
  const somaItens = somarValores(itensAtivos.map((i) => lerNumero(i.valorTotal) || 0));
  const diferenca = Number.isFinite(valorTotalNum) ? paraCentavos(valorTotalNum) - paraCentavos(somaItens) : NaN;

  const contasDisponiveis = useMemo(() => {
    const usadas = new Set(itens.map((i) => i.contaId));
    return cadastros.contas.filter((c) => (c.analitica && c.ativo && ["despesa", "ativo"].includes(c.natureza)) || usadas.has(String(c.id)));
  }, [cadastros.contas, itens]);

  const fornecedores = cadastros.pessoas.filter(
    (p) => p.papeis.includes("fornecedor") && (p.ativo || String(p.id) === form.fornecedorId));

  // ── Validação ──
  const erros = { itens: {} };
  const chave = limparChave(form.chaveAcesso);
  const tamNumero = tamanhoNumero(cadastros.parametros, form.tipo);
  if (!form.numero.trim()) erros.numero = "Obrigatório";
  else if (form.numero.trim().length > tamNumero) erros.numero = `Máximo de ${tamNumero} caracteres para este tipo`;
  if (!form.fornecedorId) erros.fornecedorId = "Selecione o fornecedor";
  if (!form.dataEmissao) erros.dataEmissao = "Obrigatório";
  if (!form.dataEntrada) erros.dataEntrada = "Obrigatório";
  else if (form.dataEmissao && form.dataEntrada < form.dataEmissao) erros.dataEntrada = "Anterior à emissão";
  if (!(valorTotalNum > 0)) erros.valorTotal = "Informe um valor maior que zero";
  if (chave && chave.length !== 44) erros.chaveAcesso = `A chave tem 44 caracteres (${chave.length})`;
  itensAtivos.forEach((i) => {
    const e = {};
    if (!i.descricao.trim()) e.descricao = true;
    if (!(lerNumero(i.quantidade) > 0)) e.quantidade = true;
    if (!(lerNumero(i.valorUnitario) >= 0)) e.valorUnitario = true;
    if (!(lerNumero(i.valorTotal) >= 0)) e.valorTotal = true;
    if (!i.contaId) e.contaId = true;
    if (Object.keys(e).length) erros.itens[i.chave] = e;
  });
  const temErro = Object.keys(erros).some((k) => (k === "itens" ? Object.keys(erros.itens).length > 0 : erros[k]));
  const notaConsistente = itensAtivos.length > 0 && diferenca === 0;
  const mostrar = (k) => tentou && erros[k];
  const borda = (k) => (mostrar(k) ? { borderColor: "var(--danger)" } : {});

  const campo = (nome) => (e) => setForm((p) => ({ ...p, [nome]: e.target.value }));

  function atualizarItem(chaveItem, patch) {
    setItens((prev) => prev.map((i) => {
      if (i.chave !== chaveItem) return i;
      const novoItem = { ...i, ...patch };
      if ("valorTotal" in patch) novoItem.totalManual = patch.valorTotal.trim() !== "";
      if (("quantidade" in patch || "valorUnitario" in patch) && !novoItem.totalManual) {
        const q = lerNumero(novoItem.quantidade);
        const u = lerNumero(novoItem.valorUnitario);
        novoItem.valorTotal = Number.isFinite(q) && Number.isFinite(u) ? numeroParaCampo(totalItem(q, u)) : "";
      }
      return novoItem;
    }));
  }

  // ── Anexos ──
  async function enviarLista(id, arquivos) {
    const falhas = [];
    for (const arq of arquivos) {
      try {
        const novoAnexo = await enviarAnexo(id, arq);
        setAnexos((p) => [...p, novoAnexo]);
        setPendentes((p) => p.filter((x) => x !== arq));
      } catch (e) {
        falhas.push(`${arq.name}: ${mensagemErro(e)}`);
      }
    }
    return falhas;
  }

  async function aoEscolherArquivos(e) {
    const arquivos = Array.from(e.target.files || []);
    e.target.value = "";
    const problemas = arquivos.map(validarAnexo).filter(Boolean);
    const validos = arquivos.filter((a) => !validarAnexo(a));
    setErro(problemas.join(" "));
    if (!validos.length) return;
    if (!idAtual) { setPendentes((p) => [...p, ...validos]); return; }
    setOcupado("enviando");
    const falhas = await enviarLista(idAtual, validos);
    setOcupado("");
    if (falhas.length) setErro(falhas.join(" "));
  }

  async function baixar(anexo) {
    try { window.open(await urlAnexo(anexo.caminho), "_blank", "noopener"); }
    catch (e) { setErro(mensagemErro(e)); }
  }

  async function apagarAnexo(anexo) {
    setOcupado("removendo");
    try { await removerAnexo(anexo); setAnexos((p) => p.filter((a) => a.id !== anexo.id)); }
    catch (e) { setErro(mensagemErro(e)); }
    setOcupado("");
  }

  // ── Ações ──
  function montarPayload() {
    return {
      doc: {
        tipo: form.tipo, numero: form.numero.trim(), serie: form.serie.trim(), chave_acesso: chave,
        fornecedor_id: Number(form.fornecedorId), data_emissao: form.dataEmissao, data_entrada: form.dataEntrada,
        valor_total: valorTotalNum, centro_custo_id: form.centroCustoId || null, fundo_id: form.fundoId || null,
        observacoes: form.observacoes.trim(),
      },
      itens: itensAtivos.map((i) => ({
        descricao: i.descricao.trim(), quantidade: lerNumero(i.quantidade), valor_unitario: lerNumero(i.valorUnitario),
        valor_total: lerNumero(i.valorTotal), conta_id: Number(i.contaId), centro_custo_id: i.centroCustoId ? Number(i.centroCustoId) : null,
      })),
    };
  }

  // Salva cabeçalho + itens (atômico) e envia anexos pendentes. Retorna o id ou null.
  async function salvar() {
    setTentou(true);
    setErro("");
    if (temErro) { setErro("Revise os campos destacados em vermelho."); return null; }
    setOcupado("salvando");
    try {
      const { doc, itens: its } = montarPayload();
      const id = await salvarNota(idAtual, doc, its);
      setIdAtual(id);
      const falhas = pendentes.length ? await enviarLista(id, pendentes) : [];
      aplicar(await carregarNota(id));
      onMudou();
      if (falhas.length) setErro(`Nota salva, mas alguns arquivos não foram enviados — ${falhas.join(" ")}`);
      return falhas.length ? null : id;
    } catch (e) {
      setErro(mensagemErro(e));
      return null;
    } finally {
      setOcupado("");
    }
  }

  async function salvarEFechar() {
    if (await salvar()) onFechar();
  }

  async function aprovar() {
    setConfirmacao(null);
    const id = await salvar();
    if (!id) return;
    setOcupado("aprovando");
    try { await aprovarNota(id); onMudou(); onFechar(); }
    catch (e) { setErro(mensagemErro(e)); setOcupado(""); }
  }

  async function cancelar() {
    if (motivoCancel.trim().length < 5) return;
    setOcupado("cancelando");
    try { await cancelarNota(idAtual, motivoCancel); onMudou(); onFechar(); }
    catch (e) { setErro(mensagemErro(e)); setOcupado(""); setConfirmacao(null); }
  }

  async function excluir() {
    setOcupado("excluindo");
    try { await excluirRascunho(idAtual); onMudou(); onFechar(); }
    catch (e) { setErro(mensagemErro(e)); setOcupado(""); setConfirmacao(null); }
  }

  async function aoSalvarFornecedor(pessoa) {
    setNovoFornecedor(false);
    await onCadastrosMudaram();
    setForm((p) => ({ ...p, fornecedorId: String(pessoa.id) }));
  }

  // ── Interface ──
  const desabilitado = { disabled: !editavel };
  const estiloCampo = (k) => ({ ...inp, ...borda(k) });
  const titulo = novo ? "Nova nota de entrada" : `${TIPOS_NOTA[form.tipo] || "Nota"} ${form.numero}${form.serie ? `/${form.serie}` : ""}`;
  const colunas = "minmax(160px,2.2fr) 70px 100px 100px minmax(170px,2fr) minmax(110px,1fr) 30px";

  const rodape = carregando ? null : (
    <>
      {editavel && !novo && (
        <button onClick={() => setConfirmacao("excluir")} disabled={ocupadoQualquer} className="btn btn-ghost" style={{ color: "var(--danger)", borderColor: "var(--danger-border)", marginRight: podeAprovar ? "auto" : 0 }}>Excluir rascunho</button>
      )}
      {!editavel && podeAprovar && status === "aprovada" && (
        <button onClick={() => setConfirmacao("cancelar")} disabled={ocupadoQualquer} className="btn btn-ghost" style={{ color: "var(--danger)", borderColor: "var(--danger-border)", marginRight: "auto" }}>Cancelar nota</button>
      )}
      {editavel && !podeAprovar && (
        <span className="muted" style={{ fontSize: 12.5, marginRight: "auto" }}>A aprovação é feita por um Supervisor ou Administrador.</span>
      )}
      <button onClick={onFechar} disabled={Boolean(ocupado)} className="btn btn-ghost">{editavel ? "Cancelar" : "Fechar"}</button>
      {editavel && (
        <>
          <button onClick={salvarEFechar} disabled={ocupadoQualquer} className="btn btn-ghost" style={{ borderColor: "var(--primary)", color: "var(--primary-hover)" }}>
            {ocupado === "salvando" ? "Salvando..." : "Salvar rascunho"}
          </button>
          {podeAprovar && <button onClick={() => {
            setTentou(true);
            setErro("");
            if (temErro) setErro("Revise os campos destacados em vermelho.");
            else if (itensAtivos.length === 0) setErro("Inclua ao menos um item para aprovar a nota.");
            else if (!notaConsistente) setErro("A soma dos itens precisa ser igual ao valor total da nota.");
            else setConfirmacao("aprovar");
          }}
            disabled={ocupadoQualquer} className="btn btn-primary" style={{ opacity: ocupadoQualquer ? 0.6 : 1 }}>
            Salvar e aprovar
          </button>}
        </>
      )}
    </>
  );

  return (
    <Modal titulo={titulo} largura={960} onFechar={onFechar} fecharFora={false}
      extra={!novo && <Pill tone={TOM_STATUS[status]}>{STATUS_NOTA[status]}</Pill>} rodape={rodape}>
      {carregando ? (
        <div style={{ padding: 30, textAlign: "center", color: "var(--muted)" }}>Carregando nota...</div>
      ) : (
        <>
          {status === "cancelada" && nota && (
            <div className="alert alert-danger" style={{ marginBottom: 14 }}>
              <Icone nome="alerta" tamanho={16} />
              <span>Cancelada em {formatarData(nota.cancelado_em)}. Motivo: {nota.motivo_cancelamento}</span>
            </div>
          )}
          {status === "aprovada" && nota && (
            <div className="alert alert-ok" style={{ marginBottom: 14 }}>
              <Icone nome="check" tamanho={16} />
              <span>Aprovada em {formatarData(nota.aprovado_em)}. A nota não pode mais ser editada — apenas cancelada, com motivo.</span>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0 12px" }}>
            <div>
              <label style={lbl}>Tipo *</label>
              <select style={estiloCampo()} value={form.tipo} onChange={campo("tipo")} {...desabilitado}>
                {Object.entries(TIPOS_NOTA).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Número *</label>
              <input style={estiloCampo("numero")} value={form.numero} onChange={campo("numero")} maxLength={tamNumero} {...desabilitado} />
              {mostrar("numero") ? <div style={msgErro}>{erros.numero}</div> : editavel && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>até {tamNumero} caracteres</div>}
            </div>
            <div>
              <label style={lbl}>Série</label>
              <input style={estiloCampo()} value={form.serie} onChange={campo("serie")} {...desabilitado} />
            </div>
            <div>
              <label style={lbl}>Data de emissão *</label>
              <input type="date" style={estiloCampo("dataEmissao")} value={form.dataEmissao} onChange={campo("dataEmissao")} {...desabilitado} />
              {mostrar("dataEmissao") && <div style={msgErro}>{erros.dataEmissao}</div>}
            </div>
            <div>
              <label style={lbl}>Data de entrada *</label>
              <input type="date" style={estiloCampo("dataEntrada")} value={form.dataEntrada} onChange={campo("dataEntrada")} {...desabilitado} />
              {mostrar("dataEntrada") && <div style={msgErro}>{erros.dataEntrada}</div>}
            </div>
            <div>
              <label style={lbl}>Valor total da nota *</label>
              <input style={{ ...estiloCampo("valorTotal"), textAlign: "right" }} inputMode="decimal" placeholder="0,00" value={form.valorTotal} onChange={campo("valorTotal")} {...desabilitado} />
              {mostrar("valorTotal") && <div style={msgErro}>{erros.valorTotal}</div>}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0 12px" }}>
            <div>
              <label style={lbl} htmlFor="nota-fornecedor">Fornecedor *</label>
              <div style={{ display: "flex", gap: 8 }}>
                <select id="nota-fornecedor" style={{ ...estiloCampo("fornecedorId"), flex: 1, minWidth: 0 }} value={form.fornecedorId}
                  onChange={(e) => (e.target.value === NOVO_FORNECEDOR ? setNovoFornecedor(true) : setForm((p) => ({ ...p, fornecedorId: e.target.value })))}
                  {...desabilitado}>
                  <option value="">— Selecione —</option>
                  {fornecedores.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.documento ? ` — ${mascararDocumento(p.tipo_pessoa, p.documento)}` : ""}</option>)}
                  {editavel && <option value={NOVO_FORNECEDOR}>＋ Cadastrar novo fornecedor…</option>}
                </select>
                {editavel && (
                  <button type="button" className="btn btn-ghost" onClick={() => setNovoFornecedor(true)}
                    title="Cadastrar um novo fornecedor sem sair desta tela" style={{ flex: "none", padding: "8px 12px" }}>
                    <Icone nome="mais" tamanho={16} traco={2.2} /> Novo
                  </button>
                )}
              </div>
              {editavel && fornecedores.length === 0 && (
                <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
                  Nenhum fornecedor cadastrado ainda. Clique em <strong>Novo</strong> para cadastrar agora, sem sair desta tela.
                </div>
              )}
              {mostrar("fornecedorId") && <div style={msgErro}>{erros.fornecedorId}</div>}
            </div>
            <div>
              <label style={lbl}>Centro de custo</label>
              <select style={estiloCampo()} value={form.centroCustoId} onChange={campo("centroCustoId")} {...desabilitado}>
                <option value="">— Nenhum —</option>
                {cadastros.centros.filter((c) => c.ativo || String(c.id) === form.centroCustoId).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Fundo</label>
              <select style={estiloCampo()} value={form.fundoId} onChange={campo("fundoId")} {...desabilitado}>
                <option value="">— Nenhum —</option>
                {cadastros.fundos.filter((f) => f.ativo || String(f.id) === form.fundoId).map((f) => <option key={f.id} value={f.id}>{f.nome}{f.restrito ? " (restrito)" : ""}</option>)}
              </select>
            </div>
          </div>

          {form.tipo === "nfe" && (
            <>
              <label style={lbl}>Chave de acesso (44 caracteres)</label>
              <input style={{ ...estiloCampo("chaveAcesso"), fontFamily: "monospace", letterSpacing: 0.5 }} value={form.chaveAcesso}
                onChange={(e) => setForm((p) => ({ ...p, chaveAcesso: limparChave(e.target.value) }))} {...desabilitado} />
              {mostrar("chaveAcesso") && <div style={msgErro}>{erros.chaveAcesso}</div>}
            </>
          )}

          {/* Itens */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <h3 className="section-title">Itens da nota</h3>
            {editavel && <button type="button" onClick={() => setItens((p) => [...p, itemVazio()])} className="btn btn-ghost btn-sm">+ Adicionar item</button>}
          </div>
          <div style={{ overflowX: "auto", paddingBottom: 4 }}>
            <div style={{ minWidth: 820 }}>
              <div className="itens-cabecalho" style={{ display: "grid", gridTemplateColumns: colunas, gap: 6, margin: "4px 0 6px" }}>
                <span>Descrição</span><span>Qtd.</span><span style={{ textAlign: "right" }}>Valor unit.</span><span style={{ textAlign: "right" }}>Total</span><span>Conta contábil</span><span>Centro de custo</span><span />
              </div>
              {itens.map((i) => {
                const e = erros.itens[i.chave] || {};
                const b = (k) => (tentou && e[k] ? { borderColor: "var(--danger)" } : {});
                return (
                  <div key={i.chave} style={{ display: "grid", gridTemplateColumns: colunas, gap: 6, marginBottom: 6, alignItems: "center" }}>
                    <input style={{ ...estiloCampo(), ...b("descricao") }} value={i.descricao} onChange={(ev) => atualizarItem(i.chave, { descricao: ev.target.value })} {...desabilitado} aria-label="Descrição do item" />
                    <input style={{ ...estiloCampo(), ...b("quantidade"), textAlign: "right" }} inputMode="decimal" value={i.quantidade} onChange={(ev) => atualizarItem(i.chave, { quantidade: ev.target.value })} {...desabilitado} aria-label="Quantidade" />
                    <input style={{ ...estiloCampo(), ...b("valorUnitario"), textAlign: "right" }} inputMode="decimal" placeholder="0,00" value={i.valorUnitario} onChange={(ev) => atualizarItem(i.chave, { valorUnitario: ev.target.value })} {...desabilitado} aria-label="Valor unitário" />
                    <input style={{ ...estiloCampo(), ...b("valorTotal"), textAlign: "right" }} inputMode="decimal" placeholder="0,00" value={i.valorTotal} onChange={(ev) => atualizarItem(i.chave, { valorTotal: ev.target.value })} {...desabilitado} aria-label="Valor total do item" />
                    <select style={{ ...estiloCampo(), ...b("contaId") }} value={i.contaId} onChange={(ev) => atualizarItem(i.chave, { contaId: ev.target.value })} {...desabilitado} aria-label="Conta contábil">
                      <option value="">— Selecione —</option>
                      {contasDisponiveis.map((c) => <option key={c.id} value={c.id}>{c.codigo} — {c.nome}</option>)}
                    </select>
                    <select style={estiloCampo()} value={i.centroCustoId} onChange={(ev) => atualizarItem(i.chave, { centroCustoId: ev.target.value })} {...desabilitado} aria-label="Centro de custo do item">
                      <option value="">Da nota</option>
                      {cadastros.centros.filter((c) => c.ativo || String(c.id) === i.centroCustoId).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                    {editavel ? (
                      <button type="button" className="icon-btn perigo" aria-label="Remover item" onClick={() => setItens((p) => (p.length > 1 ? p.filter((x) => x.chave !== i.chave) : [itemVazio()]))}>
                        <Icone nome="lixeira" tamanho={16} />
                      </button>
                    ) : <span />}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 18, flexWrap: "wrap", marginTop: 8, fontSize: 13, color: "var(--text-2)" }}>
            <span>Soma dos itens: <strong>{formatarMoeda(somaItens)}</strong></span>
            <span>Total da nota: <strong>{Number.isFinite(valorTotalNum) ? formatarMoeda(valorTotalNum) : "—"}</strong></span>
            {Number.isFinite(diferenca) && diferenca === 0 && itensAtivos.length > 0 && <Pill tone="ok">Confere</Pill>}
            {Number.isFinite(diferenca) && diferenca !== 0 && (
              <>
                <Pill tone="warn">Diferença de {formatarMoeda(Math.abs(diferenca) / 100)}</Pill>
                {editavel && <button type="button" onClick={() => setForm((p) => ({ ...p, valorTotal: numeroParaCampo(somaItens) }))} className="btn btn-ghost btn-sm">Usar soma dos itens como total</button>}
              </>
            )}
          </div>

          <label style={lbl}>Observações</label>
          <textarea style={{ ...estiloCampo(), minHeight: 52, resize: "vertical", fontFamily: "inherit" }} value={form.observacoes} onChange={campo("observacoes")} {...desabilitado} />

          {/* Anexos */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <h3 className="section-title">Anexos <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: "none" }}>(PDF, XML, PNG ou JPG — até 10 MB)</span></h3>
            {podeAnexar && (
              <>
                <button type="button" onClick={() => inputArquivo.current?.click()} disabled={ocupadoQualquer} className="btn btn-ghost btn-sm">
                  {ocupado === "enviando" ? "Enviando..." : "+ Anexar arquivo"}
                </button>
                <input ref={inputArquivo} type="file" multiple accept=".pdf,.xml,.png,.jpg,.jpeg" style={{ display: "none" }} onChange={aoEscolherArquivos} />
              </>
            )}
          </div>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {anexos.length === 0 && pendentes.length === 0 && <div style={{ fontSize: 12.5, color: "var(--faint)" }}>Nenhum arquivo anexado.</div>}
            {anexos.map((a) => (
              <div key={a.id} className="file-row">
                <span className="nome"><Icone nome="clipe" tamanho={15} style={{ verticalAlign: "-3px", marginRight: 6, color: "var(--muted)" }} />{a.nome_arquivo}</span>
                <span className="meta">{formatarTamanho(a.tamanho)}</span>
                <button type="button" className="link-btn" onClick={() => baixar(a)}>Abrir</button>
                {editavel && <button type="button" className="icon-btn perigo" aria-label={`Remover ${a.nome_arquivo}`} onClick={() => apagarAnexo(a)} disabled={ocupadoQualquer}><Icone nome="lixeira" tamanho={16} /></button>}
              </div>
            ))}
            {pendentes.map((f, idx) => (
              <div key={`${f.name}-${idx}`} className="file-row pendente">
                <span className="nome"><Icone nome="clipe" tamanho={15} style={{ verticalAlign: "-3px", marginRight: 6 }} />{f.name}</span>
                <span className="meta" style={{ color: "var(--warn-text)" }}>será enviado ao salvar · {formatarTamanho(f.size)}</span>
                <button type="button" className="icon-btn perigo" aria-label={`Remover ${f.name}`} onClick={() => setPendentes((p) => p.filter((x) => x !== f))}><Icone nome="fechar" tamanho={16} /></button>
              </div>
            ))}
          </div>

          {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
          <div style={{ height: 8 }} />
        </>
      )}

      {novoFornecedor && <PessoaModal onSalvo={aoSalvarFornecedor} onFechar={() => setNovoFornecedor(false)} />}

      {confirmacao === "aprovar" && (
        <Modal titulo="Aprovar nota?" largura={440} nivel={400} onFechar={() => setConfirmacao(null)}
          rodape={<><button className="btn btn-ghost" onClick={() => setConfirmacao(null)}>Voltar</button><button className="btn btn-primary" onClick={aprovar}>Sim, aprovar</button></>}>
          <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "4px 0 12px" }}>
            Depois de aprovada, a nota <strong>não poderá mais ser editada</strong> — só cancelada, com motivo. Confira fornecedor, valores e contas.
          </p>
        </Modal>
      )}
      {confirmacao === "excluir" && (
        <Modal titulo="Excluir rascunho?" largura={420} nivel={400} onFechar={() => setConfirmacao(null)}
          rodape={<><button className="btn btn-ghost" onClick={() => setConfirmacao(null)}>Voltar</button><button className="btn btn-danger" onClick={excluir} disabled={ocupado === "excluindo"}>Excluir</button></>}>
          <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "4px 0 12px" }}>O rascunho, os itens e os anexos serão apagados definitivamente.</p>
        </Modal>
      )}
      {confirmacao === "cancelar" && (
        <Modal titulo="Cancelar nota aprovada" largura={460} nivel={400} onFechar={() => setConfirmacao(null)}
          rodape={<><button className="btn btn-ghost" onClick={() => setConfirmacao(null)}>Voltar</button>
            <button className="btn btn-danger" style={{ opacity: motivoCancel.trim().length < 5 ? 0.5 : 1 }} disabled={motivoCancel.trim().length < 5 || ocupado === "cancelando"} onClick={cancelar}>Cancelar nota</button></>}>
          <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "4px 0 0" }}>O cancelamento é permanente e fica registrado. Informe o motivo:</p>
          <textarea autoFocus style={{ ...inp, minHeight: 70, marginTop: 8, marginBottom: 8, fontFamily: "inherit" }} value={motivoCancel} onChange={(e) => setMotivoCancel(e.target.value)} placeholder="Ex.: lançada em duplicidade (mín. 5 caracteres)" />
        </Modal>
      )}
    </Modal>
  );
}
