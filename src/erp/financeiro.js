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
  recebimento: "Recebimento",
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
  return c("inss") + c("irrf") + c("csll") + c("outras_retencoes") + (fiscal.iss_retido === true ? c("iss") : 0);
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
