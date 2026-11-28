// Catálogo de tributos da nota (e de cada item), no mesmo espírito do totvs-portal:
// campos de NF-e (ICMS, IPI, ICMS-ST, PIS, COFINS) e de NFS-e (ISS, INSS, IR, CSLL, retenções).
// As chaves precisam ser as mesmas aceitas por fiscal_valido() no banco (migration_v6_parametros_fiscal.sql).
import { lerNumero, paraCentavos, deCentavos } from "./format";

// Tributos que SOMAM ao total da nota (além dos itens, frete, seguro e outras despesas, e menos o desconto).
export const SOMAM_NO_TOTAL = ["ipi", "icms_st"];

// Cabeçalho da nota. `soma`: entra no total da nota; `retencao`: sai do valor pago ao fornecedor.
export const GRUPOS_TRIBUTOS_NOTA = [
  { titulo: "ICMS", campos: [
    { chave: "icms_base", rotulo: "Base de cálculo do ICMS" },
    { chave: "icms", rotulo: "ICMS" },
    { chave: "icms_st_base", rotulo: "Base de cálculo do ICMS ST" },
    { chave: "icms_st", rotulo: "ICMS ST", soma: true },
  ] },
  { titulo: "IPI", campos: [
    { chave: "ipi_base", rotulo: "Base de cálculo do IPI" },
    { chave: "ipi", rotulo: "IPI", soma: true },
  ] },
  { titulo: "PIS e COFINS", campos: [
    { chave: "pis_base", rotulo: "Base de cálculo do PIS" },
    { chave: "pis", rotulo: "PIS" },
    { chave: "cofins_base", rotulo: "Base de cálculo da COFINS" },
    { chave: "cofins", rotulo: "COFINS" },
  ] },
  { titulo: "ISS (serviços)", campos: [
    { chave: "iss_base", rotulo: "Base de cálculo do ISS" },
    { chave: "iss_aliquota", rotulo: "Alíquota do ISS", percentual: true },
    { chave: "iss", rotulo: "ISS" },
  ], marcas: [{ chave: "iss_retido", rotulo: "ISS retido pelo tomador" }] },
  { titulo: "Retenções", campos: [
    { chave: "inss", rotulo: "INSS retido", retencao: true },
    { chave: "irrf", rotulo: "IRRF retido", retencao: true },
    { chave: "csll", rotulo: "CSLL retida", retencao: true },
    { chave: "pis_retido", rotulo: "PIS retido", retencao: true },
    { chave: "cofins_retido", rotulo: "COFINS retida", retencao: true },
    { chave: "outras_retencoes", rotulo: "Outras retenções", retencao: true },
  ] },
  { titulo: "Outras informações", campos: [{ chave: "total_tributos", rotulo: "Total aproximado de tributos (Lei 12.741)" }], textos: [{ chave: "protocolo", rotulo: "Protocolo de autorização" }] },
];

// Cada item
export const CAMPOS_TEXTO_ITEM = [
  { chave: "ncm", rotulo: "NCM", tamanho: 8 },
  { chave: "cfop", rotulo: "CFOP", tamanho: 4 },
  { chave: "unidade", rotulo: "Unidade", tamanho: 6 },
  { chave: "cst", rotulo: "CST / CSOSN", tamanho: 4 },
];
export const GRUPOS_TRIBUTOS_ITEM = [
  { titulo: "ICMS", campos: [
    { chave: "icms_base", rotulo: "Base ICMS" },
    { chave: "icms_aliquota", rotulo: "Alíquota ICMS", percentual: true },
    { chave: "icms", rotulo: "ICMS" },
    { chave: "icms_st_base", rotulo: "Base ICMS ST" },
    { chave: "icms_st", rotulo: "ICMS ST" },
  ] },
  { titulo: "IPI", campos: [
    { chave: "ipi_base", rotulo: "Base IPI" },
    { chave: "ipi_aliquota", rotulo: "Alíquota IPI", percentual: true },
    { chave: "ipi", rotulo: "IPI" },
  ] },
  { titulo: "PIS e COFINS", campos: [
    { chave: "pis_aliquota", rotulo: "Alíquota PIS", percentual: true },
    { chave: "pis", rotulo: "PIS" },
    { chave: "cofins_aliquota", rotulo: "Alíquota COFINS", percentual: true },
    { chave: "cofins", rotulo: "COFINS" },
  ] },
  { titulo: "Serviços e retenções", campos: [
    { chave: "iss_aliquota", rotulo: "Alíquota ISS", percentual: true },
    { chave: "iss", rotulo: "ISS" },
    { chave: "inss", rotulo: "INSS" },
    { chave: "irrf", rotulo: "IRRF" },
    { chave: "csll", rotulo: "CSLL" },
  ] },
];

const CHAVES_SOMAVEIS = ["icms_base", "icms", "icms_st_base", "icms_st", "ipi_base", "ipi", "pis", "cofins", "iss", "inss", "irrf", "csll"];

// Lê um objeto { chave: "texto digitado" } e devolve só o que tem valor, no formato do banco.
// Números: > 0 (zero e vazio são omitidos). Textos: não vazios. Marcas: só quando verdadeiras.
export function fiscalParaBanco(estado, { numeros = [], textos = [], marcas = [] }) {
  const saida = {};
  for (const k of numeros) {
    const n = lerNumero(estado?.[k]);
    if (Number.isFinite(n) && n > 0) saida[k] = n;
  }
  for (const k of textos) {
    const t = String(estado?.[k] ?? "").trim();
    if (t) saida[k] = t;
  }
  for (const k of marcas) if (estado?.[k] === true) saida[k] = true;
  return saida;
}

// Banco → campos de formulário (números viram texto "1234,50").
export function fiscalDoBanco(json = {}) {
  const saida = {};
  for (const [k, v] of Object.entries(json ?? {})) {
    // dinheiro com 2 casas (109,90); alíquotas como vieram (1,65)
    saida[k] = typeof v === "number" ? (k.endsWith("_aliquota") ? String(v) : v.toFixed(2)).replace(".", ",") : v;
  }
  return saida;
}

export const chavesNumericasNota = GRUPOS_TRIBUTOS_NOTA.flatMap((g) => g.campos.map((c) => c.chave));
export const chavesTextoNota = GRUPOS_TRIBUTOS_NOTA.flatMap((g) => (g.textos ?? []).map((c) => c.chave));
export const chavesMarcaNota = GRUPOS_TRIBUTOS_NOTA.flatMap((g) => (g.marcas ?? []).map((c) => c.chave));
export const chavesNumericasItem = GRUPOS_TRIBUTOS_ITEM.flatMap((g) => g.campos.map((c) => c.chave));
export const chavesTextoItem = CAMPOS_TEXTO_ITEM.map((c) => c.chave);

// Quantos campos fiscais têm valor (para o botão "Tributos (3)" do item).
export const contarFiscal = (f) => Object.values(f ?? {}).filter((v) => v === true || (String(v ?? "").trim() !== "" && v !== false)).length;

// Soma os tributos dos itens para sugerir os totais do cabeçalho.
export function somarTributosDosItens(itens) {
  const saida = {};
  for (const k of CHAVES_SOMAVEIS) {
    const centavos = itens.reduce((acc, i) => acc + paraCentavos(Number.isFinite(lerNumero(i.fiscal?.[k])) ? lerNumero(i.fiscal[k]) : 0), 0);
    if (centavos > 0) saida[k] = deCentavos(centavos).toFixed(2).replace(".", ",");
  }
  return saida;
}
