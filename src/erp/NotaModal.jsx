import { useEffect, useMemo, useRef, useState } from "react";
import { Pill } from "../ui";
import { lbl, inp, msgErro } from "../estilos";
import Icone from "./Icone";
import Modal from "./Modal";
import PessoaModal from "./PessoaModal";
import { TributosNota, TributosItem } from "./TributosCampos";
import { CondicaoForm } from "./parametros/CondicoesPagamento";
import { TIPOS_CONDICAO, FORMAS_PAGAMENTO, resumoCondicao, gerarParcelas, centavosRetencoes, situacaoTitulo } from "./financeiro";
import {
  carregarNota, salvarNota, aprovarNota, cancelarNota, excluirRascunho,
  enviarAnexo, removerAnexo, urlAnexo, mensagemErro,
} from "./db";
import {
  TIPOS_NOTA, STATUS_NOTA, TOM_STATUS, formatarMoeda, formatarData, formatarTamanho, hojeISO,
  lerNumero, numeroParaCampo, paraCentavos, deCentavos, totalItem, validarAnexo, mascararDocumento,
} from "./format";
import { tamanhoNumero, usaContabilidade } from "./catalogoParametros";
import {
  fiscalParaBanco, fiscalDoBanco, somarTributosDosItens, contarFiscal,
  chavesNumericasNota, chavesTextoNota, chavesMarcaNota, chavesNumericasItem, chavesTextoItem,
} from "./tributos";

const itemVazio = () => ({
  chave: crypto.randomUUID(), descricao: "", quantidade: "1", valorUnitario: "", valorTotal: "",
  tipoId: "", centroCustoId: "", fiscal: {}, aberto: false,
});
const itemEmBranco = (i) => !i.descricao.trim() && !i.valorUnitario.trim() && !i.valorTotal.trim() && !i.tipoId;
const limparChave = (v) => String(v || "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 44);
const NOVO_FORNECEDOR = "__novo__"; // opção especial do select: abre o cadastro de fornecedor
const campoTexto = (n) => String(n ?? "").replace(".", ",");
const dinheiro = (txt) => { const n = lerNumero(txt); return Number.isFinite(n) ? n : 0; };
const dinheiroInvalido = (txt) => String(txt ?? "").trim() !== "" && !(lerNumero(txt) >= 0);
const cent = (txt) => paraCentavos(dinheiro(txt));
const doBanco = (n) => (Number(n) > 0 ? numeroParaCampo(Number(n)) : "");
const NOVA_CONDICAO = "__nova__";

// Condição sugerida numa nota nova: a única ativa, ou a única "à vista" ativa.
function condicaoPadrao(condicoes) {
  const ativas = condicoes.filter((c) => c.ativo);
  if (ativas.length === 1) return String(ativas[0].id);
  const vista = ativas.filter((c) => c.tipo === "a_vista");
  return vista.length === 1 ? String(vista[0].id) : "";
}

export default function NotaModal({ notaId, cadastros, podeEditar, podeAprovar, podeAdministrar, prefill, onCadastrosMudaram, onMudou, onFechar }) {
  const [idAtual, setIdAtual] = useState(notaId);
  const [carregando, setCarregando] = useState(Boolean(notaId));
  const [nota, setNota] = useState(null); // registro do banco (status, datas de aprovação...)
  const [form, setForm] = useState(() => {
    const caixasAtivas = cadastros.caixas.filter((c) => c.ativo);
    return {
      tipo: "nfe", numero: "", serie: "", chaveAcesso: "", fornecedorId: "",
      dataEmissao: hojeISO(), dataEntrada: hojeISO(),
      contaCaixaId: caixasAtivas.length === 1 ? String(caixasAtivas[0].id) : "",
      condicaoId: condicaoPadrao(cadastros.condicoes),
      naturezaOperacao: "", observacoes: "",
      frete: "", seguro: "", outras: "", desconto: "", fiscal: {},
      ...prefill, // dados já conhecidos (ex.: lidos da chave de acesso)
    };
  });
  const [itens, setItens] = useState(() => [itemVazio()]);
  const [titulos, setTitulos] = useState([]); // parcelas geradas no Financeiro (nota aprovada/cancelada)
  const [novaCondicao, setNovaCondicao] = useState(false);
  const [anexos, setAnexos] = useState([]);
  const [pendentes, setPendentes] = useState([]);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [tentou, setTentou] = useState(false);
  const [confirmacao, setConfirmacao] = useState(null); // "aprovar" | "cancelar" | "excluir"
  const [motivoCancel, setMotivoCancel] = useState("");
  const [novoFornecedor, setNovoFornecedor] = useState(false);
  const [marcarCentro, setMarcarCentro] = useState(false); // destaca itens sem centro depois de tentar aprovar
  const inputArquivo = useRef(null);

  function aplicar({ nota: n, itens: its, anexos: ax, titulos: tts }) {
    setNota(n);
    setForm({
      tipo: n.tipo, numero: n.numero, serie: n.serie || "", chaveAcesso: n.chave_acesso || "",
      fornecedorId: String(n.fornecedor_id), dataEmissao: n.data_emissao, dataEntrada: n.data_entrada,
      contaCaixaId: n.conta_caixa_id ? String(n.conta_caixa_id) : "",
      condicaoId: n.condicao_pagamento_id ? String(n.condicao_pagamento_id) : "",
      naturezaOperacao: n.natureza_operacao || "", observacoes: n.observacoes || "",
      frete: doBanco(n.valor_frete), seguro: doBanco(n.valor_seguro), outras: doBanco(n.valor_outras), desconto: doBanco(n.valor_desconto),
      fiscal: fiscalDoBanco(n.fiscal),
    });
    setTitulos(tts ?? []);
    setItens(its.length
      ? its.map((i) => ({
          chave: crypto.randomUUID(), descricao: i.descricao, quantidade: campoTexto(Number(i.quantidade)),
          valorUnitario: numeroParaCampo(Number(i.valor_unitario)), valorTotal: numeroParaCampo(Number(i.valor_total)),
          tipoId: i.tipo_contabil_id ? String(i.tipo_contabil_id) : "",
          centroCustoId: String(i.centro_custo_id ?? n.centro_custo_id ?? ""), // antes da v17 o centro ficava no cabeçalho
          fiscal: fiscalDoBanco(i.fiscal), aberto: false,
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

  const contaPorId = useMemo(() => new Map(cadastros.contas.map((c) => [String(c.id), c])), [cadastros.contas]);
  const rotuloConta = (id) => { const c = contaPorId.get(String(id)); return c ? `${c.codigo} — ${c.nome}` : "?"; };
  const descricaoTipo = (t) => `Débito: ${rotuloConta(t.conta_debito_id)}  |  Crédito: ${rotuloConta(t.conta_credito_id)}`;
  const caixaSelecionada = cadastros.caixas.find((c) => String(c.id) === form.contaCaixaId);
  const condicao = cadastros.condicoes.find((c) => String(c.id) === form.condicaoId);

  const fornecedores = cadastros.pessoas.filter(
    (p) => p.papeis.includes("fornecedor") && (p.ativo || String(p.id) === form.fornecedorId));

  // ── Totais: o total da nota NÃO é digitado, é calculado ──
  const itensAtivos = itens.filter((i) => !itemEmBranco(i));
  const centrosDosItens = [...new Set(itensAtivos.map((i) => i.centroCustoId))];
  const centroComum = centrosDosItens.length === 1 ? centrosDosItens[0] : ""; // vai para o cabeçalho (o banco confere na aprovação)
  const centItens = itensAtivos.reduce((acc, i) => acc + paraCentavos(dinheiro(i.valorTotal)), 0);
  const centIpi = cent(form.fiscal.ipi);
  const centSt = cent(form.fiscal.icms_st);
  const totalCent = centItens + cent(form.frete) + cent(form.seguro) + cent(form.outras) - cent(form.desconto) + centIpi + centSt;
  const centRetencoes = cent(form.fiscal.inss) + cent(form.fiscal.irrf) + cent(form.fiscal.csll) + cent(form.fiscal.outras_retencoes)
    + (form.fiscal.iss_retido === true ? cent(form.fiscal.iss) : 0);
  const centLiquido = totalCent - centavosRetencoes(form.fiscal);
  const previa = gerarParcelas(condicao, { emissao: form.dataEmissao, entrada: form.dataEntrada, centavos: centLiquido });

  // ── Validação ──
  const erros = { itens: {} };
  const chave = limparChave(form.chaveAcesso);
  const tamNumero = tamanhoNumero(cadastros.parametros, form.tipo);
  // Com a contabilidade desligada (Parâmetros → Módulos), o tipo contábil do item é opcional.
  const contabil = usaContabilidade(cadastros.parametros);
  if (!form.numero.trim()) erros.numero = "Obrigatório";
  else if (form.numero.trim().length > tamNumero) erros.numero = `Máximo de ${tamNumero} caracteres para este tipo`;
  if (!form.fornecedorId) erros.fornecedorId = "Selecione o fornecedor";
  if (!form.dataEmissao) erros.dataEmissao = "Obrigatório";
  if (!form.dataEntrada) erros.dataEntrada = "Obrigatório";
  else if (form.dataEmissao && form.dataEntrada < form.dataEmissao) erros.dataEntrada = "Anterior à emissão";
  if (chave && chave.length !== 44) erros.chaveAcesso = `A chave tem 44 caracteres (${chave.length})`;
  for (const k of ["frete", "seguro", "outras", "desconto"]) if (dinheiroInvalido(form[k])) erros[k] = "Valor inválido";
  if (itensAtivos.length === 0) erros.itensVazios = "Inclua ao menos um item";
  else if (totalCent <= 0) erros.total = "O total da nota precisa ser maior que zero";
  itensAtivos.forEach((i) => {
    const e = {};
    if (!i.descricao.trim()) e.descricao = true;
    if (!(lerNumero(i.quantidade) > 0)) e.quantidade = true;
    if (!(lerNumero(i.valorUnitario) >= 0)) e.valorUnitario = true;
    if (!(lerNumero(i.valorTotal) >= 0)) e.valorTotal = true;
    if (contabil && !i.tipoId) e.tipoId = true;
    if (Object.keys(e).length) erros.itens[i.chave] = e;
  });
  const temErro = Object.keys(erros).some((k) => (k === "itens" ? Object.keys(erros.itens).length > 0 : erros[k]));
  const mostrar = (k) => tentou && erros[k];
  const borda = (k) => (mostrar(k) ? { borderColor: "var(--danger)" } : {});

  const campo = (nome) => (e) => setForm((p) => ({ ...p, [nome]: e.target.value }));
  const setFiscal = (k, v) => setForm((p) => ({ ...p, fiscal: { ...p.fiscal, [k]: v } }));

  function atualizarItem(chaveItem, patch) {
    setItens((prev) => prev.map((i) => {
      if (i.chave !== chaveItem) return i;
      const novoItem = { ...i, ...patch };
      if ("quantidade" in patch || "valorUnitario" in patch) {
        const q = lerNumero(novoItem.quantidade);
        const u = lerNumero(novoItem.valorUnitario);
        novoItem.valorTotal = Number.isFinite(q) && Number.isFinite(u) ? numeroParaCampo(totalItem(q, u)) : "";
      }
      return novoItem;
    }));
  }
  // Centro de custo do item: os itens de baixo ainda sem centro recebem o mesmo (não precisa repetir).
  function escolherCentro(chaveItem, centro) {
    setItens((prev) => {
      const pos = prev.findIndex((i) => i.chave === chaveItem);
      return prev.map((i, n) => (n === pos || (n > pos && !i.centroCustoId) ? { ...i, centroCustoId: centro } : i));
    });
  }
  const setFiscalItem = (chaveItem, k, v) => setItens((prev) => prev.map((i) => (i.chave === chaveItem ? { ...i, fiscal: { ...i.fiscal, [k]: v } } : i)));

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
        centro_custo_id: centroComum ? Number(centroComum) : null, conta_caixa_id: form.contaCaixaId || null,
        condicao_pagamento_id: form.condicaoId || null,
        natureza_operacao: form.naturezaOperacao.trim(), observacoes: form.observacoes.trim(),
        valor_frete: dinheiro(form.frete), valor_seguro: dinheiro(form.seguro), valor_outras: dinheiro(form.outras), valor_desconto: dinheiro(form.desconto),
        fiscal: fiscalParaBanco(form.fiscal, { numeros: chavesNumericasNota, textos: chavesTextoNota, marcas: chavesMarcaNota }),
      },
      itens: itensAtivos.map((i) => ({
        descricao: i.descricao.trim(), quantidade: lerNumero(i.quantidade), valor_unitario: lerNumero(i.valorUnitario),
        valor_total: lerNumero(i.valorTotal), tipo_contabil_id: i.tipoId ? Number(i.tipoId) : null, centro_custo_id: i.centroCustoId ? Number(i.centroCustoId) : null,
        fiscal: fiscalParaBanco(i.fiscal, { numeros: chavesNumericasItem, textos: chavesTextoItem }),
      })),
    };
  }

  // Salva cabeçalho + itens (atômico; o banco calcula o total) e envia anexos pendentes. Retorna o id ou null.
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

  function pedirAprovacao() {
    setTentou(true);
    setErro("");
    if (temErro) setErro("Revise os campos destacados em vermelho.");
    else if (itensAtivos.some((i) => !i.centroCustoId)) { setMarcarCentro(true); setErro("Informe o centro de custo de todos os itens para aprovar a nota."); }
    else if (itensAtivos.some((i) => !cadastros.centros.find((c) => String(c.id) === i.centroCustoId)?.ativo)) { setMarcarCentro(true); setErro("Há item com centro de custo inativo. Troque o centro para aprovar a nota."); }
    else if (!form.contaCaixaId) setErro("Informe a conta caixa da nota para aprová-la.");
    else if (!form.condicaoId) setErro("Informe a condição de pagamento da nota para aprová-la.");
    else if (centLiquido <= 0) setErro("As retenções não podem ser iguais ou maiores que o total da nota.");
    else if (previa.length === 0) setErro("O valor a pagar é pequeno demais para dividir nas parcelas desta condição.");
    else setConfirmacao("aprovar");
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

  async function aoSalvarCondicao(c) {
    setNovaCondicao(false);
    await onCadastrosMudaram();
    if (c?.id) setForm((p) => ({ ...p, condicaoId: String(c.id) }));
  }

  async function aoSalvarFornecedor(pessoa) {
    setNovoFornecedor(false);
    await onCadastrosMudaram();
    setForm((p) => ({ ...p, fornecedorId: String(pessoa.id) }));
  }

  // ── Interface ──
  const desabilitado = { disabled: !editavel };
  const estiloCampo = (k) => ({ ...inp, ...borda(k) });
  const somenteLeitura = { ...inp, background: "var(--surface-2)", textAlign: "right", fontWeight: 600 };
  const titulo = novo ? "Nova nota de entrada" : `${TIPOS_NOTA[form.tipo] || "Nota"} ${form.numero}${form.serie ? `/${form.serie}` : ""}`;
  const colunas = "minmax(150px,2fr) 64px 96px 100px minmax(170px,2fr) minmax(110px,1fr) 96px 32px";
  const tiposAtivos = cadastros.tipos.filter((t) => t.ativo);

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
          <button onClick={salvarEFechar} disabled={ocupadoQualquer}
            className={podeAprovar ? "btn btn-ghost" : "btn btn-primary"}
            style={podeAprovar ? { borderColor: "var(--primary)", color: "var(--primary-hover)" } : undefined}>
            {ocupado === "salvando" ? "Salvando..." : "Salvar"}
          </button>
          {podeAprovar && (
            <button onClick={pedirAprovacao} disabled={ocupadoQualquer} className="btn btn-primary">Salvar e aprovar</button>
          )}
        </>
      )}
    </>
  );

  const linhaTotal = (rotulo, centavos, sinal = "+") => centavos !== 0 && (
    <div><span>{sinal === "-" ? "(−)" : "(+)"} {rotulo}</span><span>{formatarMoeda(Math.abs(deCentavos(centavos)))}</span></div>
  );

  return (
    <Modal titulo={titulo} largura={1040} onFechar={onFechar} fecharFora={false}
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
            {form.naturezaOperacao && ( // só aparece quando veio do XML; não é preciso informar à mão
              <div style={{ gridColumn: "span 2" }}>
                <label style={lbl}>Natureza da operação (do XML)</label>
                <input style={{ ...inp, background: "var(--surface-2)" }} value={form.naturezaOperacao} readOnly tabIndex={-1} />
              </div>
            )}
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
            {editavel && <button type="button" onClick={() => setItens((p) => [...p, { ...itemVazio(), centroCustoId: p.at(-1)?.centroCustoId ?? "" }])} className="btn btn-ghost btn-sm">+ Adicionar item</button>}
          </div>
          {editavel && contabil && tiposAtivos.length === 0 && (
            <div className="alert alert-warn" style={{ marginBottom: 8 }}><Icone nome="alerta" tamanho={16} /><span>Não há tipos contábeis ativos. Um Administrador precisa cadastrá-los em <strong>Parâmetros → Tipos contábeis</strong>.</span></div>
          )}
          {mostrar("itensVazios") && <div style={msgErro}>{erros.itensVazios}</div>}
          <div style={{ overflowX: "auto", paddingBottom: 4 }}>
            <div style={{ minWidth: 900 }}>
              <div className="itens-cabecalho" style={{ display: "grid", gridTemplateColumns: colunas, gap: 6, margin: "4px 0 6px" }}>
                <span>Descrição</span><span>Qtd.</span><span style={{ textAlign: "right" }}>Valor unit.</span><span style={{ textAlign: "right" }}>Total</span><span>Tipo contábil{!contabil && " (opcional)"}</span><span>Centro de custo{podeAprovar ? " *" : ""}</span><span>Tributos</span><span />
              </div>
              {itens.map((i) => {
                const e = erros.itens[i.chave] || {};
                const b = (k) => (tentou && e[k] ? { borderColor: "var(--danger)" } : {});
                const tipoDoItem = cadastros.tipos.find((t) => String(t.id) === i.tipoId);
                return (
                  <div key={i.chave} style={{ marginBottom: 6 }}>
                    <div style={{ display: "grid", gridTemplateColumns: colunas, gap: 6, alignItems: "center" }}>
                      <input style={{ ...estiloCampo(), ...b("descricao") }} value={i.descricao} onChange={(ev) => atualizarItem(i.chave, { descricao: ev.target.value })} {...desabilitado} aria-label="Descrição do item" />
                      <input style={{ ...estiloCampo(), ...b("quantidade"), textAlign: "right" }} inputMode="decimal" value={i.quantidade} onChange={(ev) => atualizarItem(i.chave, { quantidade: ev.target.value })} {...desabilitado} aria-label="Quantidade" />
                      <input style={{ ...estiloCampo(), ...b("valorUnitario"), textAlign: "right" }} inputMode="decimal" placeholder="0,00" value={i.valorUnitario} onChange={(ev) => atualizarItem(i.chave, { valorUnitario: ev.target.value })} {...desabilitado} aria-label="Valor unitário" />
                      <input style={{ ...somenteLeitura, ...b("valorTotal") }} readOnly tabIndex={-1} placeholder="0,00" value={i.valorTotal} aria-label="Valor total do item (calculado)" title="Quantidade × valor unitário" />
                      <select style={{ ...estiloCampo(), ...b("tipoId") }} value={i.tipoId} onChange={(ev) => atualizarItem(i.chave, { tipoId: ev.target.value })} {...desabilitado}
                        aria-label="Tipo contábil" title={tipoDoItem ? descricaoTipo(tipoDoItem) : "Define as contas de débito e crédito da contabilização"}>
                        <option value="">{contabil ? "— Selecione —" : "— Nenhum —"}</option>
                        {cadastros.tipos.filter((t) => t.ativo || String(t.id) === i.tipoId).map((t) => <option key={t.id} value={t.id}>{t.nome}{t.ativo ? "" : " (inativo)"}</option>)}
                      </select>
                      <select style={{ ...estiloCampo(), ...(marcarCentro && !i.centroCustoId && !itemEmBranco(i) ? { borderColor: "var(--danger)" } : {}) }} value={i.centroCustoId}
                        onChange={(ev) => escolherCentro(i.chave, ev.target.value)} {...desabilitado} aria-label="Centro de custo do item">
                        <option value="">— Selecione —</option>
                        {cadastros.centros.filter((c) => c.ativo || String(c.id) === i.centroCustoId).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                      </select>
                      <button type="button" className={`btn btn-ghost btn-tributos${contarFiscal(i.fiscal) ? " preenchido" : ""}`} aria-expanded={i.aberto}
                        title="Tributos e dados fiscais do item (NCM, CFOP, ICMS, IPI, PIS, COFINS, ISS)" onClick={() => atualizarItem(i.chave, { aberto: !i.aberto })}>
                        {i.aberto ? "Ocultar" : "Tributos"}{!i.aberto && contarFiscal(i.fiscal) > 0 && ` (${contarFiscal(i.fiscal)})`}
                        <Icone nome="chevronBaixo" tamanho={13} style={{ transform: i.aberto ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
                      </button>
                      {editavel ? (
                        <button type="button" className="icon-btn perigo" aria-label="Remover item" onClick={() => setItens((p) => (p.length > 1 ? p.filter((x) => x.chave !== i.chave) : [itemVazio()]))}>
                          <Icone nome="lixeira" tamanho={16} />
                        </button>
                      ) : <span />}
                    </div>
                    {i.aberto && (
                      <div className="painel"><TributosItem fiscal={i.fiscal} onChange={(k, v) => setFiscalItem(i.chave, k, v)} disabled={!editavel} /></div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Ajustes do total e tributos da nota */}
          <h3 className="section-title">Frete, seguro e desconto</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0 12px" }}>
            {[["frete", "Frete"], ["seguro", "Seguro"], ["outras", "Outras despesas"], ["desconto", "Desconto"]].map(([k, rotulo]) => (
              <div key={k}>
                <label style={{ ...lbl, marginTop: 0 }}>{rotulo}</label>
                <input style={{ ...estiloCampo(k), textAlign: "right" }} inputMode="decimal" placeholder="0,00" value={form[k]} onChange={campo(k)} {...desabilitado} aria-label={rotulo} />
                {mostrar(k) && <div style={msgErro}>{erros[k]}</div>}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
            <h3 className="section-title">Tributos da nota</h3>
            {editavel && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm((p) => ({ ...p, fiscal: { ...p.fiscal, ...somarTributosDosItens(itens) } }))}
                title="Soma os tributos informados nos itens e preenche estes totais">Somar tributos dos itens</button>
            )}
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            IPI e ICMS ST <strong>somam no total</strong> da nota. Retenções (INSS, IRRF, CSLL, outras e ISS retido) <strong>saem do valor pago ao fornecedor</strong>. Os demais são informativos.
          </div>
          <TributosNota fiscal={form.fiscal} onChange={setFiscal} disabled={!editavel} />

          <div className="totais" aria-label="Totais da nota">
            <div><span>Total dos itens</span><span>{formatarMoeda(deCentavos(centItens))}</span></div>
            {linhaTotal("Frete", cent(form.frete))}
            {linhaTotal("Seguro", cent(form.seguro))}
            {linhaTotal("Outras despesas", cent(form.outras))}
            {linhaTotal("Desconto", cent(form.desconto), "-")}
            {linhaTotal("IPI", centIpi)}
            {linhaTotal("ICMS ST", centSt)}
            <div className="final"><span>Total da nota</span><span>{formatarMoeda(deCentavos(totalCent))}</span></div>
            {centRetencoes > 0 && (
              <>
                <div className="sub"><span>(−) Retenções</span><span>{formatarMoeda(deCentavos(centRetencoes))}</span></div>
                <div className="sub"><span>Valor líquido a pagar</span><span>{formatarMoeda(deCentavos(totalCent - centRetencoes))}</span></div>
              </>
            )}
          </div>
          {mostrar("total") && <div style={{ ...msgErro, textAlign: "right" }}>{erros.total}</div>}
          <div className="muted" style={{ fontSize: 12, textAlign: "right", marginTop: 6 }}>O total é calculado automaticamente: não pode ser digitado.</div>

          {/* Pagamento: condição + conta caixa → parcelas no Financeiro */}
          <h3 className="section-title">Pagamento</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0 12px" }}>
            <div>
              <label style={{ ...lbl, marginTop: 4 }} htmlFor="nota-condicao">Condição de pagamento{podeAprovar ? " *" : ""}</label>
              <div style={{ display: "flex", gap: 8 }}>
                <select id="nota-condicao" style={{ ...estiloCampo(), flex: 1, minWidth: 0 }} value={form.condicaoId} {...desabilitado}
                  onChange={(e) => (e.target.value === NOVA_CONDICAO ? setNovaCondicao(true) : setForm((p) => ({ ...p, condicaoId: e.target.value })))}>
                  <option value="">— Selecione —</option>
                  {cadastros.condicoes.filter((c) => c.ativo || String(c.id) === form.condicaoId).map((c) => (
                    <option key={c.id} value={c.id}>{c.nome}{c.ativo ? "" : " (inativa)"}</option>
                  ))}
                  {editavel && podeAdministrar && <option value={NOVA_CONDICAO}>＋ Cadastrar nova condição…</option>}
                </select>
                {editavel && podeAdministrar && (
                  <button type="button" className="btn btn-ghost" onClick={() => setNovaCondicao(true)}
                    title="Cadastrar uma nova condição de pagamento sem sair desta tela" style={{ flex: "none", padding: "8px 12px" }}>
                    <Icone nome="mais" tamanho={16} traco={2.2} /> Nova
                  </button>
                )}
              </div>
              {condicao
                ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{TIPOS_CONDICAO[condicao.tipo]}{condicao.forma_pagamento ? ` · ${FORMAS_PAGAMENTO[condicao.forma_pagamento]}` : ""} · {resumoCondicao(condicao)}</div>
                : editavel && cadastros.condicoes.length === 0 && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Cadastre em Parâmetros → Condições de pagamento.</div>}
            </div>
            <div>
              <label style={{ ...lbl, marginTop: 4 }}>Conta caixa (de onde sai o pagamento){podeAprovar ? " *" : ""}</label>
              <select style={estiloCampo()} value={form.contaCaixaId} onChange={campo("contaCaixaId")} {...desabilitado}>
                <option value="">— Selecione —</option>
                {cadastros.caixas.filter((c) => c.ativo || String(c.id) === form.contaCaixaId).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
              {caixaSelecionada
                ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Saldo atual: <strong style={{ color: Number(caixaSelecionada.saldo_atual) < 0 ? "var(--danger)" : "var(--text)" }}>{formatarMoeda(caixaSelecionada.saldo_atual)}</strong></div>
                : editavel && cadastros.caixas.length === 0 && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Cadastre em Parâmetros → Contas caixa.</div>}
            </div>
          </div>

          {titulos.length > 0 ? (
            <div className="painel" style={{ paddingTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
                <span className="muted" style={{ fontSize: 12.5 }}>Lançamentos gerados no Financeiro</span>
                <a href="#/financeiro/contas/pagar" className="link-btn" style={{ fontSize: 12.5 }}>Abrir Contas a pagar</a>
              </div>
              <table className="parcelas">
                <thead><tr><th>Parcela</th><th>Vencimento</th><th className="num">Valor</th><th>Situação</th><th>Pago em</th></tr></thead>
                <tbody>
                  {titulos.map((t) => {
                    const sit = situacaoTitulo(t, hojeISO());
                    return (
                      <tr key={t.id}>
                        <td>{t.parcela}/{t.total_parcelas}</td>
                        <td>{formatarData(t.vencimento)}</td>
                        <td className="num">{formatarMoeda(t.valor)}</td>
                        <td><Pill tone={sit.tom}>{sit.rotulo}</Pill></td>
                        <td>{t.data_pagamento ? `${formatarData(t.data_pagamento)} · ${formatarMoeda(t.valor_pago)}` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : status === "rascunho" && previa.length > 0 && (
            <div className="painel" style={{ paddingTop: 10 }}>
              <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
                {condicao.tipo === "a_vista"
                  ? "Prévia: ao aprovar, o valor é dado como pago pela conta caixa da nota."
                  : `Prévia: ao aprovar, ${previa.length === 1 ? "esta parcela vai" : `estas ${previa.length} parcelas vão`} para Financeiro → Contas a pagar.`}
                {centRetencoes > 0 && " O valor é o líquido (total − retenções)."}
              </div>
              <table className="parcelas">
                <thead><tr><th>Parcela</th><th>Vencimento</th><th className="num">Valor</th></tr></thead>
                <tbody>
                  {previa.slice(0, 12).map((p) => <tr key={p.parcela}><td>{p.parcela}/{previa.length}</td><td>{formatarData(p.vencimento)}</td><td className="num">{formatarMoeda(p.valor)}</td></tr>)}
                  {previa.length > 12 && <tr><td colSpan={3} className="muted">… mais {previa.length - 12} parcela(s)</td></tr>}
                </tbody>
              </table>
            </div>
          )}

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
      {novaCondicao && <CondicaoForm condicao={null} onSalvo={aoSalvarCondicao} onFechar={() => setNovaCondicao(false)} />}

      {confirmacao === "aprovar" && (
        <Modal titulo="Aprovar nota?" largura={440} nivel={400} onFechar={() => setConfirmacao(null)}
          rodape={<><button className="btn btn-ghost" onClick={() => setConfirmacao(null)}>Voltar</button><button className="btn btn-primary" onClick={aprovar}>Sim, aprovar</button></>}>
          <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "4px 0 12px" }}>
            Depois de aprovada, a nota <strong>não poderá mais ser editada</strong> — só cancelada, com motivo.{" "}
            {condicao?.tipo === "a_vista"
              ? <>O valor de <strong>{formatarMoeda(deCentavos(centLiquido))}</strong> sairá agora da conta caixa <strong>{caixaSelecionada?.nome}</strong>.</>
              : <>Serão geradas <strong>{previa.length} parcela(s)</strong> somando <strong>{formatarMoeda(deCentavos(centLiquido))}</strong> em Contas a pagar; o dinheiro sai da conta caixa quando cada parcela for paga.</>}
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
          <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "4px 0 0" }}>O cancelamento é permanente, fica registrado, cancela as parcelas em aberto e devolve à conta caixa o que foi pago na aprovação. Se alguma parcela já foi paga no Financeiro, estorne o pagamento antes. Informe o motivo:</p>
          <textarea autoFocus style={{ ...inp, minHeight: 70, marginTop: 8, marginBottom: 8, fontFamily: "inherit" }} value={motivoCancel} onChange={(e) => setMotivoCancel(e.target.value)} placeholder="Ex.: lançada em duplicidade (mín. 5 caracteres)" />
        </Modal>
      )}
    </Modal>
  );
}
