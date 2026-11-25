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
export const FORMAS_RECEBIMENTO = Object.fromEntries(Object.entries(FORMAS_PAGAMENTO).filter(([k]) => k !== "boleto"));

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
export function situacaoTitulo(t, hoje) {
  if (t.status === "pago") return { id: "pago", rotulo: "Pago", tom: "ok" };
  if (t.status === "cancelado") return { id: "cancelado", rotulo: "Cancelado", tom: "neutral" };
  if (t.vencimento < hoje) return { id: "vencido", rotulo: "Vencido", tom: "danger" };
  if (t.vencimento === hoje) return { id: "hoje", rotulo: "Vence hoje", tom: "warn" };
  return { id: "aberto", rotulo: "Em aberto", tom: "neutral" };
}
