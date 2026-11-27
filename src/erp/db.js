import { supabase } from "../supabase";
import { extensaoDe, TIPOS_ANEXO, validarAnexo } from "./format";

const BUCKET = "notas-anexos";

// Traduz erros do Supabase/Postgres para mensagens que a equipe entende.
export function mensagemErro(e) {
  const msg = e?.message || String(e || "");
  if (msg.includes("pessoas_documento_uq")) return "Já existe um cadastro com este CPF/CNPJ nesta empresa.";
  if (msg.includes("documentos_entrada_nota_uq")) return "Esta nota já foi lançada para este fornecedor (mesmo tipo, série e número).";
  if (msg.includes("documentos_entrada_chave_uq")) return "Já existe uma nota com esta chave de acesso.";
  if (msg.includes("empresas_cnpj_uq")) return "Já existe uma empresa cadastrada com este CNPJ.";
  if (msg.includes("plano_contas_empresa_codigo_uq")) return "Já existe uma conta com este código.";
  if (msg.includes("centros_custo_empresa_nome_uq")) return "Já existe um centro de custo com este nome.";
  if (msg.includes("tipos_contabeis_empresa_nome_uq")) return "Já existe um tipo contábil com este nome.";
  if (msg.includes("contas_caixa_empresa_nome_uq")) return "Já existe uma conta caixa com este nome.";
  if (msg.includes("condicoes_pagamento_empresa_nome_uq")) return "Já existe uma condição de pagamento com este nome.";
  if (msg.includes("condicoes_pagamento_a_vista_ck")) return "Condição à vista tem uma parcela só, paga no ato.";
  if (msg.includes("pagamentos_ativo_uq")) return "Este título já foi pago.";
  if (msg.includes("formas_pagamento_empresa_nome_uq")) return "Já existe uma forma de pagamento com este nome.";
  if (/(condicoes_pagamento|titulos_financeiros|entradas)_forma_fk/.test(msg)) return "Esta forma de pagamento já foi usada e não pode ser excluída. Desative-a.";
  if (msg.includes("comprovantes_tipo_mime_check")) return "Comprovante deve ser PDF, PNG ou JPG.";
  if (msg.includes("comprovantes_tamanho_check")) return "O comprovante passa de 10 MB.";
  if (msg.includes("conciliacoes_caixa_ativa_uq")) return "Este dia já está conciliado nesta conta.";
  if (msg.includes("contas_fixas_centro_ck")) return "Conta fixa a pagar precisa de centro de custo.";
  if (msg.includes("contas_fixas_periodo_ck")) return "O mês final não pode ser antes do mês inicial.";
  if (msg.includes("titulos_financeiros_conta_fixa_fk")) return "Esta conta fixa já gerou lançamentos e não pode ser excluída. Desative-a.";
  if (msg.includes("campanhas_empresa_nome_uq")) return "Já existe uma campanha com este nome.";
  if (msg.includes("campanhas_periodo_ck")) return "A data de fim da campanha não pode ser antes do início.";
  if (msg.includes("entradas_campanha_fk")) return "Esta campanha já recebeu entradas e não pode ser excluída. Desative-a.";
  if (msg.includes("empresas_cep_check")) return "CEP inválido: informe os 8 números.";
  if (msg.includes("empresas_email_check")) return "E-mail inválido.";
  if (msg.includes("empresas_uf_check")) return "UF inválida: use a sigla do estado (ex.: SP).";
  if (msg.includes("tipos_contabeis_check")) return "A conta de débito e a de crédito precisam ser diferentes.";
  if (e?.code === "23503" && /(debito|credito|conta|caixa|tipo|condicao)_fk/.test(msg)) return "A conta escolhida não pertence a esta empresa. Atualize a página e tente de novo.";
  if (e?.code === "42501" || msg.includes("row-level security") || msg.includes("permission denied")) {
    return "Você não tem permissão para esta ação.";
  }
  if (e?.code === "23503") return "Este registro está em uso e não pode ser removido ou referenciado.";
  if (e?.code === "23514") return "Algum dado está fora do permitido. Confira os campos e tente de novo.";
  if (/failed to fetch|networkerror/i.test(msg)) return "Sem conexão com o servidor. Tente novamente.";
  return msg || "Erro inesperado.";
}

// ── Cadastros-base ───────────────────────────────────────────────

export async function fetchCadastros() {
  const [contas, centros, fundos, pessoas, parametros, tipos, caixas, condicoes, campanhas, formas] = await Promise.all([
    supabase.from("plano_contas").select("id,codigo,nome,natureza,analitica,pai_id,ativo").order("codigo"),
    supabase.from("centros_custo").select("id,nome,ativo").order("nome"),
    supabase.from("fundos").select("id,nome,restrito,ativo").order("nome"),
    supabase.from("pessoas").select("*").order("nome"),
    supabase.from("parametros").select("chave,valor"),
    supabase.from("tipos_contabeis").select("*").order("nome"),
    supabase.from("contas_caixa_saldo").select("*").order("nome"),
    supabase.from("condicoes_pagamento").select("*").order("nome"),
    supabase.from("campanhas_saldo").select("*").order("nome"),
    supabase.from("formas_pagamento").select("*").order("nome"),
  ]);
  const erro = [contas, centros, fundos, pessoas, parametros, tipos, caixas, condicoes, campanhas, formas].find((r) => r.error)?.error;
  if (erro) throw erro;
  return {
    contas: contas.data, centros: centros.data, fundos: fundos.data, pessoas: pessoas.data,
    tipos: tipos.data, caixas: caixas.data, condicoes: condicoes.data, campanhas: campanhas.data, formas: formas.data,
    // { chave: valor } — ex.: { "nota.numero_tamanho.nfe": "9" }
    parametros: Object.fromEntries(parametros.data.map((p) => [p.chave, p.valor])),
  };
}

// ── Parâmetros da empresa (só o Administrador altera) ────────────

// `alteracoes`: [{ chave, valor }] — valor null/"" remove o parâmetro (volta ao padrão).
export async function salvarParametros(alteracoes) {
  for (const { chave, valor } of alteracoes) {
    if (valor === null || valor === "") {
      const { error } = await supabase.from("parametros").delete().eq("chave", chave);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("parametros").upsert({ chave, valor: String(valor) }, { onConflict: "empresa_id,chave" });
      if (error) throw error;
    }
  }
}

// ── Usuários (funções do banco checam a permissão por dentro) ────

export async function listarUsuarios(empresaId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id,nome,email,nivel,ativo,plataforma_admin")
    .eq("empresa_id", empresaId)
    .order("nome");
  if (error) throw error;
  return data;
}

export async function criarUsuario(empresaId, { nome, email, senha, nivel }) {
  const { data, error } = await supabase.rpc("criar_usuario", {
    p_empresa_id: empresaId, p_email: email, p_senha: senha, p_nome: nome, p_nivel: nivel,
  });
  if (error) throw error;
  return data;
}

export async function atualizarUsuario(userId, { nome, nivel, ativo }) {
  const { error } = await supabase.rpc("atualizar_usuario", { p_user_id: userId, p_nome: nome, p_nivel: nivel, p_ativo: ativo });
  if (error) throw error;
}

export async function redefinirSenhaUsuario(userId, senha) {
  const { error } = await supabase.rpc("redefinir_senha_usuario", { p_user_id: userId, p_senha: senha });
  if (error) throw error;
}

// ── Empresas (só o administrador da plataforma) ──────────────────

export async function listarEmpresas() {
  const [empresas, perfis] = await Promise.all([
    supabase.from("empresas").select("*").order("razao_social"),
    supabase.from("profiles").select("empresa_id,ativo,nivel"),
  ]);
  const erro = [empresas, perfis].find((r) => r.error)?.error;
  if (erro) throw erro;
  return empresas.data.map((e) => {
    const deles = perfis.data.filter((p) => p.empresa_id === e.id);
    return { ...e, usuarios_ativos: deles.filter((p) => p.ativo).length, administradores: deles.filter((p) => p.ativo && p.nivel === "administrador").length };
  });
}

// Cadastro da igreja em que se está trabalhando.
export async function buscarEmpresa(empresaId) {
  const { data, error } = await supabase.from("empresas").select("*").eq("id", empresaId).single();
  if (error) throw error;
  return data;
}

// Nome fantasia, endereço e contatos da igreja atual (só o Administrador; o banco confere).
export async function atualizarDadosEmpresa(dados) {
  const { error } = await supabase.rpc("atualizar_dados_empresa", { p_dados: dados });
  if (error) throw error;
}

// ── Identidade visual da igreja (v22): logo no bucket público "identidade" e cores ──
const BUCKET_IDENTIDADE = "identidade";
export const TIPOS_LOGO = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
export function validarLogo(a) {
  if (!TIPOS_LOGO[extensaoDe(a.name)]) return "Use uma imagem PNG, JPG ou WebP.";
  if (a.size > 2 * 1024 * 1024) return "A imagem passa de 2 MB.";
  return "";
}
export const urlLogo = (caminho) => (caminho ? supabase.storage.from(BUCKET_IDENTIDADE).getPublicUrl(caminho).data.publicUrl : null);
export async function enviarLogo(empresaId, arquivo) {
  const inv = validarLogo(arquivo);
  if (inv) throw new Error(inv);
  const ext = extensaoDe(arquivo.name) === "jpeg" ? "jpg" : extensaoDe(arquivo.name);
  const caminho = `${empresaId}/logo-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET_IDENTIDADE).upload(caminho, arquivo, { contentType: TIPOS_LOGO[extensaoDe(arquivo.name)], upsert: false, cacheControl: "31536000" });
  if (error) throw error;
  return caminho;
}
// Grava logo e cores; a logo antiga (se trocou) sai do Storage depois.
export async function atualizarIdentidade({ logo, corPrimaria, corMenu }, logoAntiga) {
  const { error } = await supabase.rpc("atualizar_identidade_empresa", { p_logo: logo || null, p_cor_primaria: corPrimaria || null, p_cor_menu: corMenu || null });
  if (error) throw error;
  if (logoAntiga && logoAntiga !== logo) await supabase.storage.from(BUCKET_IDENTIDADE).remove([logoAntiga]);
}
export async function descartarLogo(caminho) { if (caminho) await supabase.storage.from(BUCKET_IDENTIDADE).remove([caminho]); }

// Log de criação/alteração/exclusão da igreja atual (só o Administrador lê).
export async function listarLogs({ de, ate }) {
  let consulta = supabase.from("logs").select("*").order("criado_em", { ascending: false }).order("id", { ascending: false }).limit(1000);
  if (de) consulta = consulta.gte("criado_em", `${de}T00:00:00`);
  if (ate) consulta = consulta.lte("criado_em", `${ate}T23:59:59.999`);
  const { data, error } = await consulta;
  if (error) throw error;
  return data;
}

// Empresas ativas em que o administrador da plataforma pode trabalhar.
export async function listarEmpresasAtivas() {
  const { data, error } = await supabase.from("empresas").select("id,razao_social,nome_fantasia").eq("ativo", true).order("razao_social");
  if (error) throw error;
  return data;
}

// Muda a empresa em que o administrador da plataforma está trabalhando (o banco confere a permissão).
export async function trocarEmpresa(empresaId) {
  const { error } = await supabase.rpc("trocar_empresa", { p_empresa: empresaId });
  if (error) throw error;
}

export async function criarEmpresa({ razaoSocial, nomeFantasia, cnpj, adminNome, adminEmail, adminSenha }) {
  const { data, error } = await supabase.rpc("criar_empresa", {
    p_razao_social: razaoSocial, p_nome_fantasia: nomeFantasia, p_cnpj: cnpj,
    p_admin_nome: adminNome, p_admin_email: adminEmail, p_admin_senha: adminSenha,
  });
  if (error) throw error;
  return data;
}

export async function atualizarEmpresa(id, { razaoSocial, nomeFantasia, cnpj, ativo }) {
  const { error } = await supabase.rpc("atualizar_empresa", {
    p_id: id, p_razao_social: razaoSocial, p_nome_fantasia: nomeFantasia, p_cnpj: cnpj, p_ativo: ativo,
  });
  if (error) throw error;
}

export async function salvarPessoa(id, dados) {
  const linha = {
    tipo_pessoa: dados.tipoPessoa,
    nome: dados.nome.trim(),
    documento: dados.documento || null,
    email: dados.email.trim() || null,
    telefone: dados.telefone.trim() || null,
    observacoes: dados.observacoes.trim() || null,
    papeis: dados.papeis,
    ativo: dados.ativo,
  };
  const consulta = id
    ? supabase.from("pessoas").update(linha).eq("id", id)
    : supabase.from("pessoas").insert(linha);
  const { data, error } = await consulta.select().single();
  if (error) throw error;
  return data;
}

// ── Cadastros dos Parâmetros (só o Administrador grava; o banco confere) ─────

async function gravar(tabela, id, linha) {
  const consulta = id ? supabase.from(tabela).update(linha).eq("id", id) : supabase.from(tabela).insert(linha);
  const { data, error } = await consulta.select().single();
  if (error) throw error;
  return data;
}

export const salvarCentroCusto = (id, { nome, ativo }) => gravar("centros_custo", id, { nome: nome.trim(), ativo });

export const salvarContaContabil = (id, { codigo, nome, natureza, analitica, paiId, ativo }) =>
  gravar("plano_contas", id, { codigo: codigo.trim(), nome: nome.trim(), natureza, analitica, pai_id: paiId || null, ativo });

export const salvarTipoContabil = (id, { nome, descricao, contaDebitoId, contaCreditoId, ativo }) =>
  gravar("tipos_contabeis", id, {
    nome: nome.trim(), descricao: descricao.trim() || null, conta_debito_id: Number(contaDebitoId), conta_credito_id: Number(contaCreditoId), ativo,
  });

export const salvarContaCaixa = (id, { nome, banco, agencia, numeroConta, saldoInicial, dataSaldoInicial, contaContabilId, ativo }) =>
  gravar("contas_caixa", id, {
    nome: nome.trim(), banco: banco.trim() || null, agencia: agencia.trim() || null, numero_conta: numeroConta.trim() || null,
    saldo_inicial: saldoInicial, data_saldo_inicial: dataSaldoInicial, conta_contabil_id: contaContabilId ? Number(contaContabilId) : null, ativo,
  });

export const salvarFormaPagamento = (id, { nome, tipo, ativo }) => gravar("formas_pagamento", id, { nome: nome.trim(), tipo, ativo });

// formaPagamento = id da forma (v18); o banco grava o comportamento em forma_pagamento.
export const salvarCondicaoPagamento = (id, { nome, tipo, formaPagamento, parcelas, diasPrimeira, intervaloDias, ativo }) =>
  gravar("condicoes_pagamento", id, {
    nome: nome.trim(), tipo, forma_pagamento: null, forma_pagamento_id: formaPagamento ? Number(formaPagamento) : null,
    parcelas: tipo === "a_vista" ? 1 : parcelas, dias_primeira: tipo === "a_vista" ? 0 : diasPrimeira, intervalo_dias: intervaloDias, ativo,
  });

export const salvarCampanha = (id, { nome, descricao, meta, dataInicio, dataFim, ativo }) =>
  gravar("campanhas", id, {
    nome: nome.trim(), descricao: descricao.trim() || null, meta: meta || null,
    data_inicio: dataInicio || null, data_fim: dataFim || null, ativo,
  });

// ── Notas de entrada ─────────────────────────────────────────────

export async function listarNotas() {
  const { data, error } = await supabase
    .from("documentos_entrada")
    // A dica usa o NOME da chave estrangeira (composta com empresa_id desde a v5); pela coluna o PostgREST não a encontra.
    .select("id,tipo,numero,serie,fornecedor_id,data_emissao,data_entrada,valor_total,status,fornecedor:pessoas!documentos_entrada_fornecedor_fk(id,nome)")
    .order("data_entrada", { ascending: false })
    .order("id", { ascending: false })
    .limit(500);
  if (error) throw error;
  return data;
}

export async function carregarNota(id) {
  const [doc, itens, anexos, titulos] = await Promise.all([
    supabase.from("documentos_entrada").select("*").eq("id", id).single(),
    supabase.from("documento_entrada_itens").select("*").eq("documento_id", id).order("id"),
    supabase.from("documento_anexos").select("*").eq("documento_id", id).order("id"),
    supabase.from("titulos_pagar").select("*").eq("documento_id", id).order("parcela"),
  ]);
  const erro = [doc, itens, anexos, titulos].find((r) => r.error)?.error;
  if (erro) throw erro;
  return { nota: doc.data, itens: itens.data, anexos: anexos.data, titulos: titulos.data };
}

// Notas (não canceladas) que já existem com essas chaves de acesso OU esses números. Usado para
// avisar de duplicidade antes de importar; o banco continua barrando duplicadas de qualquer jeito.
export async function buscarNotasExistentes({ chaves = [], numeros = [] }) {
  const base = () => supabase.from("documentos_entrada").select("id,chave_acesso,fornecedor_id,tipo,serie,numero,status").neq("status", "cancelada");
  const consultas = [];
  if (chaves.length) consultas.push(base().in("chave_acesso", chaves));
  if (numeros.length) consultas.push(base().in("numero", numeros));
  const respostas = await Promise.all(consultas);
  const erro = respostas.find((r) => r.error)?.error;
  if (erro) throw erro;
  const porId = new Map(respostas.flatMap((r) => r.data).map((n) => [n.id, n]));
  return [...porId.values()];
}

export async function buscarCnpjEmpresa(empresaId) {
  const { data, error } = await supabase.from("empresas").select("cnpj").eq("id", empresaId).maybeSingle();
  if (error) throw error;
  return data?.cnpj ?? null;
}

// Cabeçalho + itens numa única transação (função salvar_nota_entrada).
export async function salvarNota(id, doc, itens) {
  const { data, error } = await supabase.rpc("salvar_nota_entrada", { p_id: id ?? null, p_doc: doc, p_itens: itens });
  if (error) throw error;
  return data;
}

export async function aprovarNota(id) {
  const { error } = await supabase.from("documentos_entrada").update({ status: "aprovada" }).eq("id", id).select("id").single();
  if (error) throw error;
}

export async function cancelarNota(id, motivo) {
  const { error } = await supabase
    .from("documentos_entrada")
    .update({ status: "cancelada", motivo_cancelamento: motivo.trim() })
    .eq("id", id)
    .select("id")
    .single();
  if (error) throw error;
}

// Só rascunhos podem ser excluídos (a RLS garante). Apaga a nota e depois os arquivos.
export async function excluirRascunho(id) {
  const { data: anexos, error: e1 } = await supabase.from("documento_anexos").select("caminho").eq("documento_id", id);
  if (e1) throw e1;
  const { error } = await supabase.from("documentos_entrada").delete().eq("id", id).select("id").single();
  if (error) throw error;
  if (anexos.length) await supabase.storage.from(BUCKET).remove(anexos.map((a) => a.caminho));
}

// ── Financeiro (contas a pagar) ──────────────────────────────────
// Os títulos nascem da aprovação da nota; baixa, estorno e vencimento passam por funções do banco.

export async function listarTitulosPagar() {
  const { data, error } = await supabase.from("titulos_pagar").select("*")
    .order("vencimento").order("id").limit(2000);
  if (error) throw error;
  return data;
}

// Histórico de pagamentos de um lançamento (inclusive os estornados).
export async function listarPagamentosDoTitulo(tituloId) {
  const { data, error } = await supabase.from("pagamentos_lista").select("*").eq("titulo_id", tituloId).order("id");
  if (error) throw error;
  return data;
}

// Vencimento e dados de pagamento (boleto, PIX, banco) de um lançamento em aberto.
export async function atualizarTitulo(tituloId, dados) {
  const { error } = await supabase.rpc("atualizar_titulo", { p_titulo: tituloId, p_dados: dados });
  if (error) throw error;
}

export async function pagarTitulo(tituloId, { contaCaixaId, data, juros, multa, desconto, observacao }) {
  const { data: id, error } = await supabase.rpc("pagar_titulo", {
    p_titulo: tituloId, p_conta_caixa: Number(contaCaixaId), p_data: data,
    p_juros: juros, p_multa: multa, p_desconto: desconto, p_observacao: observacao,
  });
  if (error) throw error;
  return id;
}

// ── Contas a receber (v14): mesmos títulos e baixas das contas a pagar ──

export async function listarTitulosReceber() {
  const { data, error } = await supabase.from("titulos_receber").select("*")
    .order("vencimento").order("id").limit(2000);
  if (error) throw error;
  return data;
}

// dados: { pessoa_id, descricao, emissao, valor, valor_por, parcelas, primeiro_vencimento, periodicidade, intervalo_dias,
//          forma_pagamento, conta_caixa_id, centro_custo_id, observacao }
export async function criarContasReceber(dados) {
  const { data, error } = await supabase.rpc("criar_contas_receber", { p_dados: dados });
  if (error) throw error;
  return data;
}

export async function receberTitulo(tituloId, { contaCaixaId, data, juros, multa, desconto, observacao }) {
  const { data: id, error } = await supabase.rpc("receber_titulo", {
    p_titulo: tituloId, p_conta_caixa: Number(contaCaixaId), p_data: data,
    p_juros: juros, p_multa: multa, p_desconto: desconto, p_observacao: observacao,
  });
  if (error) throw error;
  return id;
}

export async function cancelarTituloReceber(tituloId, motivo) {
  const { error } = await supabase.rpc("cancelar_titulo_receber", { p_titulo: tituloId, p_motivo: motivo.trim() });
  if (error) throw error;
}

export async function estornarPagamento(pagamentoId, motivo) {
  const { error } = await supabase.rpc("estornar_pagamento", { p_pagamento: pagamentoId, p_motivo: motivo.trim() });
  if (error) throw error;
}

// ── Entradas: dízimos, ofertas e campanhas (v12) ─────────────────

export async function listarEntradas({ de, ate }) {
  let consulta = supabase.from("entradas_lista").select("*");
  if (de) consulta = consulta.gte("data", de);
  if (ate) consulta = consulta.lte("data", ate);
  const { data, error } = await consulta.order("data", { ascending: false }).order("id", { ascending: false }).limit(3000);
  if (error) throw error;
  return data;
}

// Informe anual: entradas válidas do ano (só as colunas necessárias, sem o limite da lista da tela).
export async function listarContribuicoesAno(ano) {
  const linhas = [];
  for (let pagina = 0; ; pagina++) {
    const { data, error } = await supabase.from("entradas").select("id,pessoa_id,tipo,data,valor")
      .eq("estornado", false).gte("data", `${ano}-01-01`).lte("data", `${ano}-12-31`).order("id").range(pagina * 1000, pagina * 1000 + 999);
    if (error) throw error;
    linhas.push(...data);
    if (data.length < 1000) return linhas;
  }
}

// dados: { tipo, data, valor, conta_caixa_id, forma_pagamento, pessoa_id, campanha_id, centro_custo_id, descricao }
export async function registrarEntrada(dados) {
  const { data, error } = await supabase.rpc("registrar_entrada", { p_dados: dados });
  if (error) throw error;
  return data;
}

export async function estornarEntrada(entradaId, motivo) {
  const { error } = await supabase.rpc("estornar_entrada", { p_entrada: entradaId, p_motivo: motivo.trim() });
  if (error) throw error;
}

// ── Movimentos de caixa e extrato (v13) ──────────────────────────

// Extrato de uma conta no período, mais o saldo ao fim do dia anterior ao período.
export async function carregarExtrato(contaId, { de, ate }) {
  const diaAntes = new Date(`${de}T12:00:00Z`);
  diaAntes.setUTCDate(diaAntes.getUTCDate() - 1);
  const [linhas, anterior, conciliado] = await Promise.all([
    supabase.from("extrato_caixa").select("*").eq("conta_caixa_id", contaId).gte("data", de).lte("data", ate)
      .order("data").order("criado_em").order("ref_id").limit(5000),
    supabase.rpc("saldo_caixa_ate", { p_conta: contaId, p_data: diaAntes.toISOString().slice(0, 10) }),
    supabase.rpc("conciliado_ate", { p_conta: contaId }),
  ]);
  if (linhas.error) throw linhas.error;
  if (anterior.error) throw anterior.error;
  if (conciliado.error) throw conciliado.error;
  return { linhas: linhas.data, saldoAnterior: Number(anterior.data ?? 0), conciliadoAte: conciliado.data ?? null };
}

// ── Contas fixas mensais (v20) ──
export async function listarContasFixas() {
  const { data, error } = await supabase.from("contas_fixas").select("*, pessoa:pessoas!contas_fixas_pessoa_fk(nome)").order("descricao").limit(2000);
  if (error) throw error;
  return data;
}

// dados: { natureza, descricao, pessoaId, valor, dia, inicio (AAAA-MM), fim (AAAA-MM ou ""), formaId, caixaId, centroId, observacao, ativo }
export const salvarContaFixa = (id, d) => gravar("contas_fixas", id, {
  natureza: d.natureza, descricao: d.descricao.trim(), pessoa_id: Number(d.pessoaId), valor: d.valor, dia_vencimento: d.dia,
  inicio: `${d.inicio}-01`, fim: d.fim ? `${d.fim}-01` : null,
  forma_pagamento_id: d.formaId ? Number(d.formaId) : null, conta_caixa_id: d.caixaId ? Number(d.caixaId) : null,
  centro_custo_id: d.centroId ? Number(d.centroId) : null, observacao: d.observacao.trim() || null, ativo: d.ativo,
});

// Gera os lançamentos das contas fixas até o mês que vem (idempotente). Devolve quantos criou.
export async function gerarContasFixas() {
  const { data, error } = await supabase.rpc("gerar_contas_fixas");
  if (error) throw error;
  return data ?? 0;
}

// ── Conciliação de caixa (v19) ──
export async function listarConciliacoes(contaId) {
  const { data, error } = await supabase.from("conciliacoes_caixa").select("*").eq("conta_caixa_id", contaId)
    .order("data", { ascending: false }).order("id", { ascending: false }).limit(500);
  if (error) throw error;
  return data;
}

export async function saldoCaixaAte(contaId, data) {
  const { data: saldo, error } = await supabase.rpc("saldo_caixa_ate", { p_conta: contaId, p_data: data });
  if (error) throw error;
  return Number(saldo ?? 0);
}

// contagem (fechamento do dia, v21): { "200": 3, "0.50": 4, ... } ou null; com contagem, saldo = soma contada.
export async function conciliarCaixa(contaId, data, saldo, observacao, contagem = null) {
  const args = { p_conta: contaId, p_data: data, p_saldo: saldo, p_observacao: observacao?.trim() || null };
  if (contagem && Object.keys(contagem).length) args.p_contagem = contagem;
  const { data: id, error } = await supabase.rpc("conciliar_caixa", args);
  if (error) throw error;
  return id;
}

export async function desfazerConciliacao(id, motivo) {
  const { error } = await supabase.rpc("desfazer_conciliacao", { p_conciliacao: id, p_motivo: motivo.trim() });
  if (error) throw error;
}

// Painel do Financeiro: títulos em aberto (pagar e receber), extrato desde o 1º dia do mês anterior,
// até onde cada conta foi conciliada e quantas notas estão em rascunho. Só lê (gera antes os meses das contas fixas).
export async function carregarPainel(contaIds, { deAnt, ate }) {
  await gerarContasFixas().catch(() => 0);
  const colunas = "id, descricao, fornecedor_nome, vencimento, valor, parcela, total_parcelas, conta_fixa_id";
  const [pagar, receber, linhas, rascunhos, ...conciliadas] = await Promise.all([
    supabase.from("titulos_pagar").select(colunas).eq("status", "aberto").order("vencimento").limit(5000),
    supabase.from("titulos_receber").select(colunas).eq("status", "aberto").order("vencimento").limit(5000),
    supabase.from("extrato_caixa").select("conta_caixa_id, data, origem, subtipo, valor").gte("data", deAnt).lte("data", ate).limit(20000),
    supabase.from("documentos_entrada").select("id", { count: "exact", head: true }).eq("status", "rascunho"),
    ...contaIds.map((id) => supabase.rpc("conciliado_ate", { p_conta: id })),
  ]);
  const erro = [pagar, receber, linhas, rascunhos, ...conciliadas].find((r) => r.error)?.error;
  if (erro) throw erro;
  return {
    pagar: pagar.data, receber: receber.data, linhas: linhas.data, rascunhos: rascunhos.count ?? 0,
    conciliadoAte: Object.fromEntries(contaIds.map((id, i) => [id, conciliadas[i].data ?? null])),
  };
}

// Fluxo de caixa: realizado (extrato), saldo de cada conta antes do período e os títulos em aberto (previsto).
// contaIds: as contas consideradas (todas, ou uma só).
export async function carregarFluxo(contaIds, { de, ate }) {
  const diaAntes = new Date(`${de}T12:00:00Z`);
  diaAntes.setUTCDate(diaAntes.getUTCDate() - 1);
  const antes = diaAntes.toISOString().slice(0, 10);
  let extrato = supabase.from("extrato_caixa").select("*").gte("data", de).lte("data", ate);
  if (contaIds.length === 1) extrato = extrato.eq("conta_caixa_id", contaIds[0]);
  const [linhas, pagar, receber, fixas, ...saldos] = await Promise.all([
    extrato.order("data").order("criado_em").limit(10000),
    supabase.from("titulos_pagar").select("*").eq("status", "aberto").lte("vencimento", ate).order("vencimento").limit(5000),
    supabase.from("titulos_receber").select("*").eq("status", "aberto").lte("vencimento", ate).order("vencimento").limit(5000),
    // contas fixas: os meses ainda não gerados entram como previsão (v20)
    supabase.from("contas_fixas").select("id,natureza,descricao,valor,dia_vencimento,inicio,fim,gerado_ate,conta_caixa_id,pessoa:pessoas!contas_fixas_pessoa_fk(nome)").eq("ativo", true).limit(2000),
    ...contaIds.map((id) => supabase.rpc("saldo_caixa_ate", { p_conta: id, p_data: antes })),
  ]);
  const erro = [linhas, pagar, receber, fixas, ...saldos].find((r) => r.error)?.error;
  if (erro) throw erro;
  return {
    linhas: linhas.data, pagar: pagar.data, receber: receber.data, fixas: fixas.data,
    saldoInicial: saldos.reduce((acc, r) => acc + Math.round(Number(r.data ?? 0) * 100), 0) / 100,
  };
}

// Relatório do mês (prestação de contas): extrato do mês anterior + mês do relatório, os detalhes que o extrato
// não traz (centro de custo, fornecedor, campanha), saldos de cada conta e o que estava em aberto no fim do mês.
// deAnt = 1º dia do mês anterior; de/ate = mês do relatório.
export async function carregarRelatorioMes(contaIds, { deAnt, de, ate }) {
  const antes = new Date(`${de}T12:00:00Z`);
  antes.setUTCDate(antes.getUTCDate() - 1);
  const diaAntes = antes.toISOString().slice(0, 10);
  const depois = new Date(`${ate}T12:00:00Z`);
  depois.setUTCDate(depois.getUTCDate() + 1);
  const diaDepois = depois.toISOString().slice(0, 10);
  // Em aberto no fim do mês: emitido até lá e ainda aberto, ou pago só depois (os cancelados depois vêm abaixo).
  const emAberto = `status.eq.aberto,data_pagamento.gt.${ate}`;
  const [linhas, pagos, recebidos, movimentos, entradas, abPagar, abReceber, ...saldos] = await Promise.all([
    supabase.from("extrato_caixa").select("*").gte("data", deAnt).lte("data", ate).order("data").limit(20000),
    supabase.from("titulos_pagar").select("pagamento_id, documento_id, centro_custo_id, fornecedor_nome").not("pagamento_id", "is", null)
      .gte("data_pagamento", deAnt).lte("data_pagamento", ate).limit(20000),
    supabase.from("titulos_receber").select("pagamento_id, descricao, fornecedor_nome").not("pagamento_id", "is", null)
      .gte("data_pagamento", deAnt).lte("data_pagamento", ate).limit(20000),
    supabase.from("movimentos_caixa_lista").select("id, tipo, centro_custo_id, descricao").gte("data", deAnt).lte("data", ate).limit(20000),
    supabase.from("entradas_lista").select("id, tipo, campanha_id, campanha_nome").gte("data", deAnt).lte("data", ate).limit(20000),
    supabase.from("titulos_pagar").select("id, valor, vencimento").lte("emissao", ate).neq("status", "cancelado").or(emAberto).limit(20000),
    supabase.from("titulos_receber").select("id, valor, vencimento").lte("emissao", ate).neq("status", "cancelado").or(emAberto).limit(20000),
    ...contaIds.flatMap((id) => [
      supabase.rpc("saldo_caixa_ate", { p_conta: id, p_data: diaAntes }),
      supabase.rpc("saldo_caixa_ate", { p_conta: id, p_data: ate }),
    ]),
  ]);
  const erro = [linhas, pagos, recebidos, movimentos, entradas, abPagar, abReceber, ...saldos].find((r) => r.error)?.error;
  if (erro) throw erro;
  // Cancelado depois do fim do mês também estava em aberto naquele dia.
  const [cPagar, cReceber] = await Promise.all([
    supabase.from("titulos_pagar").select("id, valor, vencimento").lte("emissao", ate).eq("status", "cancelado").gte("cancelado_em", diaDepois).limit(20000),
    supabase.from("titulos_receber").select("id, valor, vencimento").lte("emissao", ate).eq("status", "cancelado").gte("cancelado_em", diaDepois).limit(20000),
  ]);
  if (cPagar.error) throw cPagar.error;
  if (cReceber.error) throw cReceber.error;
  // Itens das notas pagas no período: o centro de custo é por item (v17), e o pagamento se divide por eles.
  const docIds = [...new Set(pagos.data.map((t) => t.documento_id).filter(Boolean))];
  const itens = [];
  for (let i = 0; i < docIds.length; i += 200) {
    const r = await supabase.from("documento_entrada_itens").select("documento_id, centro_custo_id, valor_total").in("documento_id", docIds.slice(i, i + 200)).limit(20000);
    if (r.error) throw r.error;
    itens.push(...r.data);
  }
  return {
    itensNotas: itens,
    linhas: linhas.data, pagos: pagos.data, recebidos: recebidos.data, movimentos: movimentos.data, entradas: entradas.data,
    abertoPagar: [...abPagar.data, ...cPagar.data], abertoReceber: [...abReceber.data, ...cReceber.data],
    saldos: contaIds.map((id, i) => ({ conta_caixa_id: id, anterior: Number(saldos[2 * i].data ?? 0), final: Number(saldos[2 * i + 1].data ?? 0) })),
  };
}

export async function listarMovimentos({ de, ate }) {
  let consulta = supabase.from("movimentos_caixa_lista").select("*");
  if (de) consulta = consulta.gte("data", de);
  if (ate) consulta = consulta.lte("data", ate);
  const { data, error } = await consulta.order("data", { ascending: false }).order("id", { ascending: false }).limit(3000);
  if (error) throw error;
  return data;
}

// dados: { tipo, data, valor, conta_origem_id, conta_destino_id, descricao, centro_custo_id }
export async function registrarMovimento(dados) {
  const { data, error } = await supabase.rpc("registrar_movimento", { p_dados: dados });
  if (error) throw error;
  return data;
}

export async function estornarMovimento(movimentoId, motivo) {
  const { error } = await supabase.rpc("estornar_movimento", { p_movimento: movimentoId, p_motivo: motivo.trim() });
  if (error) throw error;
}


// ── Anexos ───────────────────────────────────────────────────────

const nomeSeguro = (nome) =>
  nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80);

export async function enviarAnexo(documentoId, arquivo) {
  const invalido = validarAnexo(arquivo);
  if (invalido) throw new Error(invalido);

  const caminho = `${documentoId}/${crypto.randomUUID()}-${nomeSeguro(arquivo.name)}`;
  const tipoMime = TIPOS_ANEXO[extensaoDe(arquivo.name)];

  const { error: e1 } = await supabase.storage.from(BUCKET).upload(caminho, arquivo, { contentType: tipoMime, upsert: false });
  if (e1) throw e1;

  const { data, error: e2 } = await supabase
    .from("documento_anexos")
    .insert({ documento_id: documentoId, caminho, nome_arquivo: arquivo.name, tipo_mime: tipoMime, tamanho: arquivo.size })
    .select()
    .single();
  if (e2) {
    await supabase.storage.from(BUCKET).remove([caminho]);
    throw e2;
  }
  return data;
}

// Primeiro a linha (a RLS só deixa em rascunho), depois o arquivo no Storage.
export async function removerAnexo(anexo) {
  const { error } = await supabase.from("documento_anexos").delete().eq("id", anexo.id).select("id").single();
  if (error) throw error;
  await supabase.storage.from(BUCKET).remove([anexo.caminho]);
}

export async function urlAnexo(caminho) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(caminho, 60);
  if (error) throw error;
  return data.signedUrl;
}

// ── Comprovantes de pagamentos e movimentos (v21) ──
// Arquivo no bucket "comprovantes", na pasta da igreja (<empresa_id>/<uuid>-<nome>); a linha em comprovantes
// liga ao pagamento ou ao movimento. Remover: primeiro a linha, depois o arquivo.
const BUCKET_COMPROVANTES = "comprovantes";
export const TIPOS_COMPROVANTE = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

export async function listarComprovantes({ pagamentoId, movimentoId }) {
  let c = supabase.from("comprovantes").select("*").order("id");
  c = pagamentoId ? c.eq("pagamento_id", pagamentoId) : c.eq("movimento_id", movimentoId);
  const { data, error } = await c;
  if (error) throw error;
  return data;
}

export function validarComprovante(arquivo) {
  if (!TIPOS_COMPROVANTE[extensaoDe(arquivo.name)]) return `"${arquivo.name}": use PDF, PNG ou JPG.`;
  if (arquivo.size > 10 * 1024 * 1024) return `"${arquivo.name}" passa de 10 MB.`;
  if (arquivo.size === 0) return `"${arquivo.name}" está vazio.`;
  return "";
}

export async function enviarComprovante({ pagamentoId, movimentoId }, arquivo) {
  const invalido = validarComprovante(arquivo);
  if (invalido) throw new Error(invalido);
  const { data: perfil, error: e0 } = await supabase.rpc("meu_perfil");
  if (e0) throw e0;
  const caminho = `${perfil.empresa_id}/${crypto.randomUUID()}-${nomeSeguro(arquivo.name)}`;
  const tipoMime = TIPOS_COMPROVANTE[extensaoDe(arquivo.name)];
  const { error: e1 } = await supabase.storage.from(BUCKET_COMPROVANTES).upload(caminho, arquivo, { contentType: tipoMime, upsert: false });
  if (e1) throw e1;
  const { data, error: e2 } = await supabase.from("comprovantes")
    .insert({ pagamento_id: pagamentoId ?? null, movimento_id: movimentoId ?? null, caminho, nome_arquivo: arquivo.name.slice(-200), tipo_mime: tipoMime, tamanho: arquivo.size })
    .select().single();
  if (e2) {
    await supabase.storage.from(BUCKET_COMPROVANTES).remove([caminho]);
    throw e2;
  }
  return data;
}

export async function removerComprovante(c) {
  const { error } = await supabase.from("comprovantes").delete().eq("id", c.id).select("id").single();
  if (error) throw error;
  await supabase.storage.from(BUCKET_COMPROVANTES).remove([c.caminho]);
}

export async function urlComprovante(caminho, baixar = false) {
  const { data, error } = await supabase.storage.from(BUCKET_COMPROVANTES).createSignedUrl(caminho, 120, baixar ? { download: true } : undefined);
  if (error) throw error;
  return data.signedUrl;
}

// ── Orçamento anual (v23) ──

// Orçamento gravado e realizado/em aberto do ano (por mês), para a tela de Orçamento, o Painel e o aviso da nota.
export async function carregarOrcamento(ano) {
  const [orc, real] = await Promise.all([
    supabase.from("orcamentos").select("natureza, centro_custo_id, categoria, valores, atualizado_em, atualizado_por_nome").eq("ano", ano).limit(1000),
    supabase.rpc("orcamento_realizado", { p_ano: ano }),
  ]);
  if (orc.error) throw orc.error;
  if (real.error) throw real.error;
  return { orcamentos: orc.data, realizado: real.data };
}

export async function listarOrcamento(ano) {
  const { data, error } = await supabase.from("orcamentos").select("natureza, centro_custo_id, categoria, valores").eq("ano", ano).limit(1000);
  if (error) throw error;
  return data;
}

// linhas: [{ natureza, centro_custo_id | categoria, valores: [12 números em reais] }]
export async function salvarOrcamento(ano, linhas) {
  const { error } = await supabase.rpc("salvar_orcamento", { p_ano: ano, p_linhas: linhas });
  if (error) throw error;
}

// ── Fechamento do mês (v24) ──

// O que falta para fechar o mês (contas sem Fechamento do dia, avisos) e o resumo dos saldos. mes: "AAAA-MM-01".
export async function conferirFechamentoMes(mes) {
  const { data, error } = await supabase.rpc("conferir_fechamento_mes", { p_mes: mes });
  if (error) throw error;
  return data;
}

export async function listarFechamentos() {
  const { data, error } = await supabase.from("fechamentos_mes").select("*").order("mes", { ascending: false }).order("id", { ascending: false }).limit(500);
  if (error) throw error;
  return data;
}

export async function fecharMes(mes, observacao) {
  const { data, error } = await supabase.rpc("fechar_mes", { p_mes: mes, p_observacao: observacao?.trim() || null });
  if (error) throw error;
  return data;
}

export async function reabrirMes(id, motivo) {
  const { error } = await supabase.rpc("reabrir_mes", { p_fechamento: id, p_motivo: motivo.trim() });
  if (error) throw error;
}

// ── Exportação para o contador (Excel) ──
// Tudo do período: extrato (todas as contas), pagamentos e recebimentos válidos (com os dados do lançamento),
// entradas e movimentos não estornados, e os saldos de cada conta antes e no fim do período.
async function todasAsPaginas(montar) {
  const linhas = [];
  for (let pagina = 0; ; pagina++) {
    const { data, error } = await montar().range(pagina * 1000, pagina * 1000 + 999);
    if (error) throw error;
    linhas.push(...data);
    if (data.length < 1000) return linhas;
  }
}
export async function carregarExportacao(contaIds, { de, ate }) {
  const antes = new Date(`${de}T12:00:00Z`);
  antes.setUTCDate(antes.getUTCDate() - 1);
  const diaAntes = antes.toISOString().slice(0, 10);
  const [extrato, pagos, recebidos, entradas, movimentos, saldos] = await Promise.all([
    todasAsPaginas(() => supabase.from("extrato_caixa").select("*").gte("data", de).lte("data", ate).order("conta_caixa_id").order("data").order("criado_em").order("ref_id")),
    todasAsPaginas(() => supabase.from("titulos_pagar").select("*").not("pagamento_id", "is", null).gte("data_pagamento", de).lte("data_pagamento", ate).order("data_pagamento").order("id")),
    todasAsPaginas(() => supabase.from("titulos_receber").select("*").not("pagamento_id", "is", null).gte("data_pagamento", de).lte("data_pagamento", ate).order("data_pagamento").order("id")),
    todasAsPaginas(() => supabase.from("entradas_lista").select("*").eq("estornado", false).gte("data", de).lte("data", ate).order("data").order("id")),
    todasAsPaginas(() => supabase.from("movimentos_caixa_lista").select("*").eq("estornado", false).gte("data", de).lte("data", ate).order("data").order("id")),
    Promise.all(contaIds.map(async (id) => {
      const [a, f, c] = await Promise.all([
        supabase.rpc("saldo_caixa_ate", { p_conta: id, p_data: diaAntes }),
        supabase.rpc("saldo_caixa_ate", { p_conta: id, p_data: ate }),
        supabase.rpc("conciliado_ate", { p_conta: id }),
      ]);
      const erro = [a, f, c].find((r) => r.error)?.error;
      if (erro) throw erro;
      return { conta_caixa_id: id, anterior: Number(a.data ?? 0), final: Number(f.data ?? 0), fechadaAte: c.data ?? null };
    })),
  ]);
  return { extrato: extrato.map((l) => ({ ...l, valor: Number(l.valor) })), pagos, recebidos, entradas, movimentos, saldos };
}
