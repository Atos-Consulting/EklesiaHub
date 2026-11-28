// Regras do Financeiro usadas na tela. A conta que vale é a do banco (gerar_titulos_nota na migration v8);
// aqui ela só é repetida para mostrar a prévia das parcelas antes de aprovar a nota.
import { paraCentavos, deCentavos, lerNumero } from "./format";

export const TIPOS_CONDICAO = { a_vista: "À vista", parcelado: "Parcelado" };

export const FORMAS_PAGAMENTO = {
  dinheiro: "Dinheiro", pix: "PIX", boleto: "Boleto", transferencia: "Transferência", cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito", cheque: "Cheque", outro: "Outro",
};

// Entradas (v12): dízimos, ofertas, campanhas e outras. Boleto não entra (é forma de pagar, não de receber).
export const TIPOS_ENTRADA = { dizimo: "Dízimo", oferta: "Oferta", campanha: "Campanha", outra: "Outra entrada" };
// Tipos aceitos em entradas novas (v16): "outra" ficou só para as antigas; o resto vai como entrada avulsa em Caixa.
export const TIPOS_ENTRADA_NOVA = { dizimo: "Dízimo", oferta: "Oferta", campanha: "Campanha" };
// Formas de pagamento viraram cadastro (v18, Parâmetros → Financeiro → Formas de pagamento). FORMAS_PAGAMENTO acima
// agora são os COMPORTAMENTOS possíveis de uma forma (o que a tela pede: linha digitável, chave PIX, banco...).
export const COMPORTAMENTOS_FORMA = FORMAS_PAGAMENTO;
export const formaPorId = (formas, id) => (formas || []).find((f) => String(f.id) === String(id ?? ""));
// Nome para exibir: o da forma cadastrada; sem ela (dado antigo), o rótulo do comportamento.
export const nomeForma = (formas, id, codigo) => formaPorId(formas, id)?.nome ?? FORMAS_PAGAMENTO[codigo] ?? codigo ?? "";
// Contas fixas (v20): vencimento de uma competência (AAAA-MM-01) no dia escolhido, limitado ao último dia do mês.
// Repete a conta de gerar_contas_fixas no banco: mudou uma, mude a outra.
export function vencimentoFixa(competencia, dia) {
  const [a, m] = competencia.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${competencia.slice(0, 8)}${String(Math.min(dia, ultimo)).padStart(2, "0")}`;
}

export const FORMAS_RECEBIMENTO = Object.fromEntries(Object.entries(FORMAS_PAGAMENTO).filter(([k]) => k !== "boleto"));

// Movimentos de caixa (v13) e as origens das linhas do extrato (view extrato_caixa).
export const TIPOS_MOVIMENTO = { transferencia: "Transferência", saida: "Saída avulsa", entrada: "Entrada avulsa" };
export const ORIGENS_EXTRATO = {
  entrada: "Dízimo / oferta", pagamento: "Pagamento", transferencia_saida: "Transferência enviada",
  transferencia_entrada: "Transferência recebida", saida: "Saída avulsa", entrada_avulsa: "Entrada avulsa",
  recebimento: "Recebimento", venda_pdv: "Vendas (frente de loja)", diferenca_caixa: "Diferença de caixa (frente de loja)",
};

// Contas a receber (v14): mesma conta de criar_contas_receber no banco — mudou uma, mude a outra.
// Valor total: divide em centavos e a sobra vai para a 1ª parcela. Mensal: mesmo dia nos meses seguintes
// (dia 31 vira o último dia dos meses mais curtos), sempre contado a partir do 1º vencimento.
export function somarMeses(iso, meses) {
  const [a, m, d] = iso.split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}
export function parcelasReceber({ centavos, valorPor, parcelas, primeiroVencimento, periodicidade, intervaloDias }) {
  if (!(centavos > 0) || !(parcelas >= 1 && parcelas <= 120) || !primeiroVencimento) return [];
  if (periodicidade === "dias" && !(intervaloDias >= 1 && intervaloDias <= 365)) return [];
  const base = valorPor === "parcela" ? centavos : Math.floor(centavos / parcelas);
  if (base === 0) return [];
  const resto = valorPor === "parcela" ? 0 : centavos - base * parcelas;
  return Array.from({ length: parcelas }, (_, i) => ({
    parcela: i + 1,
    vencimento: periodicidade === "mensal" ? somarMeses(primeiroVencimento, i) : somarDias(primeiroVencimento, i * intervaloDias),
    valor: deCentavos(base + (i === 0 ? resto : 0)),
  }));
}

export const ORIGEM_PAGAMENTO = { manual: "Baixa no Financeiro", aprovacao: "À vista, na aprovação", migracao: "Nota anterior ao Financeiro" };

// "3x · 1ª em 30 dias, a cada 30 dias"
export function resumoCondicao(c) {
  if (!c) return "";
  if (c.tipo === "a_vista") return "Pago na aprovação, pela conta caixa da nota";
  const prazo = c.dias_primeira === 0 ? "1ª na emissão" : `1ª em ${c.dias_primeira} dia(s)`;
  return c.parcelas === 1 ? `Parcela única · ${prazo}` : `${c.parcelas}x · ${prazo}, a cada ${c.intervalo_dias} dia(s)`;
}

export function somarDias(iso, dias) {
  const [a, m, d] = iso.split("-").map(Number);
  const data = new Date(Date.UTC(a, m - 1, d + dias));
  return data.toISOString().slice(0, 10);
}

// Retenções que ficam com a igreja (para recolher ao governo): não são pagas ao fornecedor.
export function centavosRetencoes(fiscal = {}) {
  const c = (k) => paraCentavos(Number.isFinite(lerNumero(fiscal[k])) ? lerNumero(fiscal[k]) : 0);
  return c("inss") + c("irrf") + c("csll") + c("pis_retido") + c("cofins_retido") + c("outras_retencoes") + (fiscal.iss_retido === true ? c("iss") : 0); // = nota_retencoes() no banco (v26)
}

// Mesmo cálculo do banco: divide em centavos, a sobra vai para a 1ª parcela.
// À vista vence na data de entrada; parcelado conta os dias a partir da emissão.
export function gerarParcelas(condicao, { emissao, entrada, centavos }) {
  if (!condicao || !(centavos > 0) || !emissao || !entrada) return [];
  const n = condicao.parcelas;
  const base = Math.floor(centavos / n);
  if (base === 0) return [];
  const resto = centavos - base * n;
  return Array.from({ length: n }, (_, i) => ({
    parcela: i + 1,
    vencimento: condicao.tipo === "a_vista" ? entrada : somarDias(emissao, condicao.dias_primeira + i * condicao.intervalo_dias),
    valor: deCentavos(base + (i === 0 ? resto : 0)),
  }));
}

// Situação exibida de um título: em aberto vira "Vencido" depois do vencimento.
export function situacaoTitulo(t, hoje, natureza = "pagar") {
  if (t.status === "pago") return { id: "pago", rotulo: natureza === "receber" ? "Recebido" : "Pago", tom: "ok" };
  if (t.status === "cancelado") return { id: "cancelado", rotulo: "Cancelado", tom: "neutral" };
  if (t.vencimento < hoje) return { id: "vencido", rotulo: "Vencido", tom: "danger" };
  if (t.vencimento === hoje) return { id: "hoje", rotulo: "Vence hoje", tom: "warn" };
  return { id: "aberto", rotulo: "Em aberto", tom: "neutral" };
}

// ── Dados de pagamento de um lançamento (v21) ──
// Campos que a tela edita, conforme o comportamento da forma: boleto (linha digitável), PIX (tipo + chave),
// transferência (banco, agência, conta, tipo de conta, titular e CPF/CNPJ) e cheque (número).
export const TIPOS_CHAVE_PIX = { cpf: "CPF", cnpj: "CNPJ", email: "E-mail", telefone: "Telefone", aleatoria: "Chave aleatória" };
export const TIPOS_CONTA = { corrente: "Conta corrente", poupanca: "Poupança", pagamento: "Conta de pagamento" };
export const BANDEIRAS_CARTAO = { visa: "Visa", mastercard: "Mastercard", elo: "Elo", amex: "American Express", hipercard: "Hipercard", outra: "Outra" };
// Cartão (v29): bandeira, 4 últimos dígitos, parcelas no cartão (crédito) e autorização/NSU. O número inteiro nunca é guardado.
const CAMPOS_CARTAO = ["cartao_bandeira", "cartao_final", "cartao_parcelas", "cartao_autorizacao"];
const CAMPOS_PAGAMENTO = ["linha_digitavel", "pix_chave", "pix_tipo", "banco", "agencia", "conta", "tipo_conta", "titular", "titular_documento", "cheque_numero", ...CAMPOS_CARTAO];
// Dados de PIX/conta que também ficam no cadastro da pessoa (v29).
export const CAMPOS_CONTA_PESSOA = ["pix_tipo", "pix_chave", "banco", "agencia", "conta", "tipo_conta", "titular", "titular_documento"];

// Linha digitável no formato do boleto bancário (47 números); outros tamanhos ficam como vieram.
export function formatarLinha(l) {
  if (!l) return "";
  if (l.length !== 47) return l;
  return `${l.slice(0, 5)}.${l.slice(5, 10)} ${l.slice(10, 15)}.${l.slice(15, 21)} ${l.slice(21, 26)}.${l.slice(26, 32)} ${l[32]} ${l.slice(33)}`;
}
export function erroLinhaDigitavel(texto) {
  const d = String(texto ?? "").replace(/\D/g, "");
  return d && (d.length < 44 || d.length > 48) ? `A linha tem de 44 a 48 números (tem ${d.length})` : "";
}
export const temDadosPagamento = (t) => CAMPOS_PAGAMENTO.some((c) => t[c]);
export function dadosPagamentoDe(t) {
  const d = { forma_pagamento_id: String(t.forma_pagamento_id ?? "") };
  for (const c of CAMPOS_PAGAMENTO) d[c] = t[c] ?? "";
  d.linha_digitavel = formatarLinha(t.linha_digitavel);
  d.cartao_parcelas = t.cartao_parcelas ? String(t.cartao_parcelas) : "";
  return d;
}
// Para atualizar_titulo: vencimento e observação vêm do lançamento (ou da tela que edita).
export function dadosPagamentoParaSalvar(d, { vencimento, observacao }) {
  const r = { vencimento, observacao: observacao ?? "", forma_pagamento_id: d.forma_pagamento_id || null };
  for (const c of CAMPOS_PAGAMENTO) r[c] = String(d[c] ?? "").trim();
  r.linha_digitavel = r.linha_digitavel.replace(/\D/g, "");
  r.titular_documento = r.titular_documento.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  r.cartao_final = r.cartao_final.replace(/\D/g, "");
  return r;
}
export const mesmosDadosPagamento = (a, b) => ["forma_pagamento_id", ...CAMPOS_PAGAMENTO].every((c) => String(a[c] ?? "") === String(b[c] ?? ""));
// Dados de PIX/conta para reaproveitar ("usar os dados de ..."): primeiro os do cadastro da pessoa (v29),
// senão os do último lançamento da mesma pessoa. pessoa = registro de pessoas (opcional).
export function ultimosDadosDaPessoa(titulos, t, pessoa) {
  if (pessoa && (pessoa.pix_chave || pessoa.banco || pessoa.conta)) return { ...pessoa, doCadastro: true };
  return (titulos || []).filter((x) => x.id !== t.id && x.pessoa_id === t.pessoa_id && (x.pix_chave || x.banco || x.conta))
    .sort((a, b) => String(b.data_pagamento ?? b.vencimento).localeCompare(String(a.data_pagamento ?? a.vencimento)))[0] ?? null;
}

// Os dados de PIX/conta da tela são diferentes dos do cadastro da pessoa? (para oferecer "guardar no cadastro")
export function difereDaPessoa(dados, pessoa) {
  if (!pessoa || !(dados.pix_chave || dados.banco || dados.conta)) return false;
  const limpo = (k, v) => (k === "titular_documento" ? String(v ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase() : String(v ?? "").trim());
  return CAMPOS_CONTA_PESSOA.some((k) => limpo(k, dados[k]) !== limpo(k, pessoa[k]));
}
