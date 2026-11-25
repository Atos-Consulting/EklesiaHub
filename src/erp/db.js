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
  const [contas, centros, fundos, pessoas, parametros, tipos, caixas, condicoes] = await Promise.all([
    supabase.from("plano_contas").select("id,codigo,nome,natureza,analitica,pai_id,ativo").order("codigo"),
    supabase.from("centros_custo").select("id,nome,ativo").order("nome"),
    supabase.from("fundos").select("id,nome,restrito,ativo").order("nome"),
    supabase.from("pessoas").select("*").order("nome"),
    supabase.from("parametros").select("chave,valor"),
    supabase.from("tipos_contabeis").select("*").order("nome"),
    supabase.from("contas_caixa_saldo").select("*").order("nome"),
    supabase.from("condicoes_pagamento").select("*").order("nome"),
  ]);
  const erro = [contas, centros, fundos, pessoas, parametros, tipos, caixas, condicoes].find((r) => r.error)?.error;
  if (erro) throw erro;
  return {
    contas: contas.data, centros: centros.data, fundos: fundos.data, pessoas: pessoas.data,
    tipos: tipos.data, caixas: caixas.data, condicoes: condicoes.data,
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

export const salvarCondicaoPagamento = (id, { nome, tipo, formaPagamento, parcelas, diasPrimeira, intervaloDias, ativo }) =>
  gravar("condicoes_pagamento", id, {
    nome: nome.trim(), tipo, forma_pagamento: formaPagamento || null,
    parcelas: tipo === "a_vista" ? 1 : parcelas, dias_primeira: tipo === "a_vista" ? 0 : diasPrimeira, intervalo_dias: intervaloDias, ativo,
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

export async function listarPagamentos() {
  const { data, error } = await supabase.from("pagamentos_lista").select("*")
    .order("data_pagamento", { ascending: false }).order("id", { ascending: false }).limit(2000);
  if (error) throw error;
  return data;
}

export async function pagarTitulo(tituloId, { contaCaixaId, data, juros, multa, desconto, observacao }) {
  const { data: id, error } = await supabase.rpc("pagar_titulo", {
    p_titulo: tituloId, p_conta_caixa: Number(contaCaixaId), p_data: data,
    p_juros: juros, p_multa: multa, p_desconto: desconto, p_observacao: observacao,
  });
  if (error) throw error;
  return id;
}

export async function estornarPagamento(pagamentoId, motivo) {
  const { error } = await supabase.rpc("estornar_pagamento", { p_pagamento: pagamentoId, p_motivo: motivo.trim() });
  if (error) throw error;
}

export async function alterarVencimento(tituloId, vencimento) {
  const { error } = await supabase.rpc("alterar_vencimento", { p_titulo: tituloId, p_vencimento: vencimento });
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
