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
  if (msg.includes("caixas_pdv_aberto_uq")) return "Já existe um caixa aberto neste local. Feche-o antes de abrir outro.";
  if (msg.includes("pontos_venda_empresa_nome_uq")) return "Já existe um local de venda com este nome.";
  if (msg.includes("produtos_empresa_codigo_uq")) return "Já existe um produto com este código.";
  if (/(caixas_pdv_ponto|pontos_venda_caixa|pontos_venda_eletronica)_fk/.test(msg) && e?.code === "23503") return "Este local já tem caixas e não pode ser excluído. Desative-o.";
  if (/(venda_itens|estoque_movimentos|documento_entrada_itens)_produto_fk/.test(msg)) return "Este produto já foi vendido ou comprado e não pode ser excluído. Desative-o.";
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
  const [contas, centros, fundos, pessoas, parametros, tipos, caixas, condicoes, campanhas, formas, produtos, pontos] = await Promise.all([
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
    supabase.from("produtos").select("id,nome,codigo,unidade,controla_estoque,ativo").order("nome"),
    supabase.from("pontos_venda").select("*").order("nome"),
  ]);
  const erro = [contas, centros, fundos, pessoas, parametros, tipos, caixas, condicoes, campanhas, formas, produtos, pontos].find((r) => r.error)?.error;
  if (erro) throw erro;
  return {
    contas: contas.data, centros: centros.data, fundos: fundos.data, pessoas: pessoas.data,
    tipos: tipos.data, caixas: caixas.data, condicoes: condicoes.data, campanhas: campanhas.data, formas: formas.data,
    produtos: produtos.data, pontos: pontos.data,
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

// Forma preferida, PIX e conta bancária da pessoa (v29). Lançamento novo dela sem forma recebe a preferida,
// e PIX/transferência sem dados recebem estes (gatilho titulos_dados_da_pessoa).
function linhaPagamentoPessoa(d) {
  const txt = (k) => String(d[k] ?? "").trim() || null;
  return {
    ...("forma_pagamento_id" in d ? { forma_pagamento_id: d.forma_pagamento_id ? Number(d.forma_pagamento_id) : null } : {}),
    pix_tipo: txt("pix_tipo"), pix_chave: txt("pix_chave"), banco: txt("banco"), agencia: txt("agencia"), conta: txt("conta"),
    tipo_conta: txt("tipo_conta"), titular: txt("titular"),
    titular_documento: String(d.titular_documento ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase() || null,
  };
}

// Guarda no cadastro da pessoa os dados de PIX/conta digitados num lançamento (botão "Guardar no cadastro").
export async function guardarDadosNaPessoa(pessoaId, dados) {
  const { data, error } = await supabase.from("pessoas").update(linhaPagamentoPessoa(dados)).eq("id", pessoaId).select().single();
  if (error) throw error;
  return data;
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
    // Dados de pagamento (v29): só vão quando a tela os edita (o cadastro de fornecedores).
    ...(dados.pagamento ? linhaPagamentoPessoa(dados.pagamento) : {}),
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

// tributosRecuperar (v28): { icms: idConta, cbs: idConta, ... } — vazio = o item inteiro vai para a conta de débito.
export const salvarTipoContabil = (id, { nome, descricao, contaDebitoId, contaCreditoId, ativo, tributosRecuperar }) =>
  gravar("tipos_contabeis", id, {
    nome: nome.trim(), descricao: descricao.trim() || null, conta_debito_id: Number(contaDebitoId), conta_credito_id: Number(contaCreditoId), ativo,
    ...(tributosRecuperar ? { tributos_recuperar: tributosRecuperar } : {}),
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

// Locais de venda do frente de loja (v27).
export const salvarPontoVenda = (id, { nome, contaCaixaId, contaEletronicaId, centroCustoId, ativo }) =>
  gravar("pontos_venda", id, {
    nome: nome.trim(), conta_caixa_id: Number(contaCaixaId), conta_eletronica_id: contaEletronicaId ? Number(contaEletronicaId) : null,
    centro_custo_id: centroCustoId ? Number(centroCustoId) : null, ativo,
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
// Conta a pagar sem nota (v29), mesmos dados de criar_contas_receber.
export async function criarContasPagar(dados) {
  const { data, error } = await supabase.rpc("criar_contas_pagar", { p_dados: dados });
  if (error) throw error;
  return data;
}

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

// ── Contabilidade (v25) ──

// Gera no diário o que falta (eventos do sistema) e estorna o que deixou de valer. Devolve quantos entraram.
export async function contabilizar() {
  const { data, error } = await supabase.rpc("contabilizar");
  if (error) throw error;
  return data;
}

export async function listarPendenciasContabeis() {
  const { data, error } = await supabase.rpc("pendencias_contabeis");
  if (error) throw error;
  return data;
}

// Partidas do período (uma linha por partida, com o lançamento). Filtros opcionais: conta, centro.
export async function listarRazao({ de, ate, contaId, centroId }) {
  return todasAsPaginas(() => {
    let c = supabase.from("razao_contabil").select("*").gte("data", de).lte("data", ate);
    if (contaId) c = c.eq("conta_id", contaId);
    if (centroId) c = c.eq("centro_custo_id", centroId);
    return c.order("data").order("lancamento_id").order("partida_id");
  });
}

export async function carregarBalancete(de, ate, centroId = null) {
  const { data, error } = await supabase.rpc("balancete", { p_de: de, p_ate: ate, p_centro: centroId });
  if (error) throw error;
  return data;
}

// partidas: [{ conta_id, centro_custo_id, debito, credito }]
export async function lancarContabil(data, historico, partidas) {
  const { data: id, error } = await supabase.rpc("lancar_contabil", { p_data: data, p_historico: historico, p_partidas: partidas });
  if (error) throw error;
  return id;
}

export async function estornarLancamento(id, motivo) {
  const { error } = await supabase.rpc("estornar_lancamento", { p_lancamento: id, p_motivo: motivo.trim() });
  if (error) throw error;
}

export async function listarRegrasContabeis() {
  const { data, error } = await supabase.from("regras_contabeis").select("chave, conta_id, atualizado_em");
  if (error) throw error;
  return data;
}

export async function salvarRegraContabil(chave, contaId) {
  const { error } = await supabase.from("regras_contabeis").upsert({ chave, conta_id: contaId }, { onConflict: "empresa_id,chave" });
  if (error) throw error;
}

// ── Tributos retidos (v26) ──

export async function listarGuiasTributos() {
  const { data, error } = await supabase.from("tributos_guias").select("tributo, pessoa_id, dia_vencimento");
  if (error) throw error;
  return data;
}

export async function salvarGuiaTributo(tributo, pessoaId, dia) {
  const { error } = await supabase.from("tributos_guias").upsert({ tributo, pessoa_id: pessoaId, dia_vencimento: dia }, { onConflict: "empresa_id,tributo" });
  if (error) throw error;
}

// Retenções das notas do mês (mes: qualquer dia do mês) e as guias da competência.
export async function carregarRetencoesMes(mes) {
  const comp = `${mes.slice(0, 7)}-01`;
  const [notas, guias] = await Promise.all([
    supabase.rpc("retencoes_mes", { p_mes: comp }),
    supabase.from("titulos_financeiros").select("id, tributo_retido, descricao, valor, vencimento, status")
      .not("tributo_retido", "is", null).eq("competencia", comp).order("id"),
  ]);
  if (notas.error) throw notas.error;
  if (guias.error) throw guias.error;
  return { notas: notas.data, guias: guias.data };
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

// ── Comercial: frente de loja, produtos e estoque (v27) ──────────

const rpc = async (nome, args) => {
  const { data, error } = await supabase.rpc(nome, args);
  if (error) throw error;
  return data;
};

// Acessos de um usuário aos locais de venda (cadastro do usuário). Sem userId: os do próprio usuário.
export async function listarAcessosPdv(userId) {
  const { data, error } = await supabase.from("pontos_venda_usuarios").select("ponto_venda_id,user_id,pode_abrir,pode_vender").eq("user_id", userId);
  if (error) throw error;
  return data;
}
export async function listarPontosVenda() {
  const { data, error } = await supabase.from("pontos_venda").select("*").order("nome");
  if (error) throw error;
  return data;
}
export async function listarTodosAcessosPdv() {
  const { data, error } = await supabase.from("pontos_venda_usuarios").select("ponto_venda_id,user_id,pode_abrir,pode_vender");
  if (error) throw error;
  return data;
}
export const salvarAcessosPdv = (userId, acessos) => rpc("salvar_acessos_pdv", { p_user: userId, p_acessos: acessos });

export async function listarProdutos() {
  const { data, error } = await supabase.from("produtos_estoque").select("*").order("nome");
  if (error) throw error;
  return data;
}
export const salvarProduto = (id, p) =>
  gravar("produtos", id, {
    nome: p.nome.trim(), codigo: p.codigo.trim() || null, categoria: p.categoria.trim() || null, unidade: p.unidade.trim() || "UN",
    preco: p.preco, controla_estoque: p.controlaEstoque, estoque_minimo: p.controlaEstoque ? p.estoqueMinimo : null,
    pontos_venda: p.pontosVenda, ativo: p.ativo,
  });
export async function listarMovimentosEstoque(produtoId) {
  const { data, error } = await supabase.from("estoque_movimentos").select("*").eq("produto_id", produtoId)
    .order("data", { ascending: false }).order("id", { ascending: false }).limit(300);
  if (error) throw error;
  return data;
}
export const ajustarEstoque = (produtoId, data, quantidade, custoUnitario, motivo) =>
  rpc("ajustar_estoque", { p_produto: produtoId, p_data: data, p_quantidade: quantidade, p_custo_unitario: custoUnitario, p_motivo: motivo });

// Caixas: abertos (para vender) ou de um período (histórico).
export async function listarCaixasPdv({ abertos = false, de, ate, pontoId } = {}) {
  let c = supabase.from("caixas_pdv").select("*").order("data", { ascending: false }).order("id", { ascending: false });
  if (abertos) c = c.eq("status", "aberto");
  if (de) c = c.gte("data", de);
  if (ate) c = c.lte("data", ate);
  if (pontoId) c = c.eq("ponto_venda_id", pontoId);
  const { data, error } = await c.limit(500);
  if (error) throw error;
  return data;
}
export const abrirCaixaPdv = (pontoId, data, troco, observacao) =>
  rpc("abrir_caixa_pdv", { p_ponto: pontoId, p_data: data, p_troco: troco, p_observacao: observacao || null });
export const resumoCaixaPdv = (caixaId) => rpc("resumo_caixa_pdv", { p_caixa: caixaId });
export const fecharCaixaPdv = (caixaId, contado, observacao) =>
  rpc("fechar_caixa_pdv", { p_caixa: caixaId, p_dinheiro_contado: contado, p_observacao: observacao || null });
export const registrarVenda = (caixaId, itens, pagamentos, desconto, pessoaId, observacao) =>
  rpc("registrar_venda", { p_caixa: caixaId, p_itens: itens, p_pagamentos: pagamentos, p_desconto: desconto, p_pessoa: pessoaId || null, p_observacao: observacao || null });
// Registra e devolve o número da venda no caixa (para a confirmação na tela).
export async function registrarVendaComNumero(caixaId, itens, pagamentos, desconto) {
  const id = await registrarVenda(caixaId, itens, pagamentos, desconto, null, null);
  const { data } = await supabase.from("vendas").select("numero").eq("id", id).maybeSingle();
  return data?.numero ?? id;
}
export const cancelarVenda = (vendaId, motivo) => rpc("cancelar_venda", { p_venda: vendaId, p_motivo: motivo });

// Vendas de um ou mais caixas, com itens e pagamentos.
export async function listarVendas(caixaIds) {
  if (!caixaIds.length) return [];
  const { data, error } = await supabase.from("vendas")
    .select("*, venda_itens!venda_itens_venda_fk(id,produto_id,descricao,quantidade,preco_unitario,total), venda_pagamentos!venda_pagamentos_venda_fk(id,forma_pagamento_id,valor,valor_recebido)")
    .in("caixa_id", caixaIds).order("id", { ascending: false });
  if (error) throw error;
  return data;
}

// ── Vínculos (v29, sem migration): nota ↔ lançamentos do Financeiro ↔ contabilidade ──
// origem = { tipo: "nota" | "titulo" | "contabil", id, origem?, origem_id? } (contabil = lançamento do diário).
// Devolve { nota, itens, titulos, pagamentos, lancamentos } a partir da nota (se houver) ou do lançamento financeiro.
export async function carregarVinculos(origem) {
  let notaId = null;
  let tituloId = null;
  if (origem.tipo === "nota") notaId = origem.id;
  else if (origem.tipo === "titulo") tituloId = origem.id;
  else if (origem.origem === "nota") notaId = origem.origem_id;
  else if (origem.origem === "titulo_pagar" || origem.origem === "titulo_receber") tituloId = origem.origem_id;
  else if (origem.origem === "pagamento") {
    const { data, error } = await supabase.from("pagamentos").select("titulo_id").eq("id", origem.origem_id).maybeSingle();
    if (error) throw error;
    tituloId = data?.titulo_id ?? null;
  }

  let titulo = null;
  if (tituloId) {
    const { data, error } = await supabase.from("titulos_financeiros")
      .select("id, natureza, documento_id, pessoa_id, descricao, emissao, total_parcelas, conta_fixa_id").eq("id", tituloId).maybeSingle();
    if (error) throw error;
    titulo = data;
    if (titulo?.documento_id) notaId = titulo.documento_id;
  }

  let nota = null;
  let itens = [];
  let titulos = [];
  if (notaId) {
    const [d, i, t] = await Promise.all([
      supabase.from("documentos_entrada").select("id, tipo, numero, serie, data_emissao, data_entrada, valor_total, status, motivo_cancelamento, fornecedor:pessoas!documentos_entrada_fornecedor_fk(nome)").eq("id", notaId).maybeSingle(),
      supabase.from("documento_entrada_itens").select("id, descricao, quantidade, valor_total").eq("documento_id", notaId).order("id"),
      supabase.from("titulos_pagar").select("*").eq("documento_id", notaId).order("parcela").order("id"),
    ]);
    const erro = [d, i, t].find((r) => r.error)?.error;
    if (erro) throw erro;
    nota = d.data;
    itens = i.data;
    titulos = t.data.map((x) => ({ ...x, natureza: "pagar" }));
  } else if (titulo) {
    // Lançamento sem nota: traz as outras parcelas do mesmo lançamento (mesma pessoa, descrição e emissão).
    const visao = titulo.natureza === "pagar" ? "titulos_pagar" : "titulos_receber";
    let c = supabase.from(visao).select("*");
    c = titulo.total_parcelas > 1 && !titulo.conta_fixa_id
      ? c.eq("pessoa_id", titulo.pessoa_id).eq("descricao", titulo.descricao).eq("emissao", titulo.emissao).eq("total_parcelas", titulo.total_parcelas).is("documento_id", null)
      : c.eq("id", titulo.id);
    const { data, error } = await c.order("parcela").order("id");
    if (error) throw error;
    titulos = data.map((x) => ({ ...x, natureza: titulo.natureza }));
  }

  const ids = titulos.map((x) => x.id);
  let pagamentos = [];
  if (ids.length) {
    const { data, error } = await supabase.from("pagamentos_lista").select("*").in("titulo_id", ids).order("data_pagamento").order("id");
    if (error) throw error;
    pagamentos = data;
  }

  const filtros = [];
  if (notaId) filtros.push(`and(origem.eq.nota,origem_id.eq.${Number(notaId)})`);
  if (ids.length) filtros.push(`and(origem.in.(titulo_pagar,titulo_receber),origem_id.in.(${ids.map(Number).join(",")}))`);
  if (pagamentos.length) filtros.push(`and(origem.eq.pagamento,origem_id.in.(${pagamentos.map((x) => Number(x.id)).join(",")}))`);
  if (origem.tipo === "contabil" && !filtros.length) filtros.push(`lancamento_id.eq.${Number(origem.id)}`);
  let partidas = [];
  if (filtros.length) {
    const { data, error } = await supabase.from("razao_contabil").select("*").or(filtros.join(","))
      .order("data").order("lancamento_id").order("partida_id").limit(2000);
    if (error) throw error;
    partidas = data;
  }
  const porLanc = new Map();
  for (const p of partidas) {
    if (!porLanc.has(p.lancamento_id)) porLanc.set(p.lancamento_id, { ...p, id: p.lancamento_id, partidas: [], valor: 0 });
    const l = porLanc.get(p.lancamento_id);
    l.partidas.push(p);
    l.valor += Math.round(Number(p.debito) * 100);
  }
  return { nota, itens, titulos, pagamentos, lancamentos: [...porLanc.values()] };
}
