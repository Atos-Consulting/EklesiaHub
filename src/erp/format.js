// Formatação, máscaras e validações usadas no ERP.

// ── Rótulos ──────────────────────────────────────────────────────
export const TIPOS_NOTA = { nfe: "NF-e", nfse: "NFS-e", recibo: "Recibo", fatura: "Fatura", outro: "Outro" };
export const STATUS_NOTA = { rascunho: "Rascunho", aprovada: "Aprovada", lancada: "Lançada", cancelada: "Cancelada" };
export const TOM_STATUS = { rascunho: "neutral", aprovada: "ok", lancada: "ok", cancelada: "danger" };

// ── Dinheiro ─────────────────────────────────────────────────────
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatarMoeda(valor) {
  return brl.format(Number(valor) || 0);
}

// Aceita "1.234,56", "1234,56", "1234.56" e "1.234" (milhar). Retorna NaN se não for número.
export function lerNumero(texto) {
  const t = String(texto ?? "").trim().replace(/[^\d.,-]/g, "");
  if (!t) return NaN;
  let normal;
  if (t.includes(",")) normal = t.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) normal = t.replace(/\./g, "");
  else normal = t;
  const n = Number(normal);
  return Number.isFinite(n) ? n : NaN;
}

// Cálculos monetários em centavos inteiros: evita erro de ponto flutuante (0,1 + 0,2).
export const paraCentavos = (n) => Math.round((Number(n) || 0) * 100);
export const deCentavos = (c) => c / 100;
export const somarValores = (valores) => deCentavos(valores.reduce((acc, v) => acc + paraCentavos(v), 0));
export const totalItem = (quantidade, valorUnitario) =>
  deCentavos(Math.round((Number(quantidade) || 0) * (Number(valorUnitario) || 0) * 100));

// Para exibir em campo de texto: 1234.5 -> "1234,50"
export const numeroParaCampo = (n) => (Number.isFinite(n) ? n.toFixed(2).replace(".", ",") : "");

// ── Datas (sem fuso: trabalhamos com "AAAA-MM-DD") ───────────────
export function formatarData(iso) {
  if (!iso) return "—";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export function hojeISO() {
  const h = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${h.getFullYear()}-${p(h.getMonth() + 1)}-${p(h.getDate())}`;
}

// ── Documentos (CPF / CNPJ numérico e alfanumérico) ──────────────
export const soDigitos = (v) => String(v ?? "").replace(/\D/g, "");
export const limparCnpj = (v) => String(v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

export function mascararCpf(v) {
  const d = soDigitos(v).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function mascararCnpj(v) {
  const c = limparCnpj(v).slice(0, 14);
  let out = c.slice(0, 2);
  if (c.length > 2) out += "." + c.slice(2, 5);
  if (c.length > 5) out += "." + c.slice(5, 8);
  if (c.length > 8) out += "/" + c.slice(8, 12);
  if (c.length > 12) out += "-" + c.slice(12, 14);
  return out;
}

export const mascararDocumento = (tipoPessoa, v) => (tipoPessoa === "PF" ? mascararCpf(v) : mascararCnpj(v));
export const limparDocumento = (tipoPessoa, v) => (tipoPessoa === "PF" ? soDigitos(v).slice(0, 11) : limparCnpj(v).slice(0, 14));

export function validarCPF(v) {
  const c = soDigitos(v);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (base, pesoInicial) => {
    const soma = [...base].reduce((acc, ch, i) => acc + Number(ch) * (pesoInicial - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(c.slice(0, 9), 10) === Number(c[9]) && dv(c.slice(0, 10), 11) === Number(c[10]);
}

// CNPJ alfanumérico (a partir de 2026): valor de cada caractere = código ASCII − 48.
// Para CNPJs só numéricos o resultado é idêntico ao cálculo tradicional.
export function validarCNPJ(v) {
  const c = limparCnpj(v);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(c) || /^(.)\1{13}$/.test(c)) return false;
  const dv = (base) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = [...base].reduce((acc, ch, i) => acc + (ch.charCodeAt(0) - 48) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(c.slice(0, 12));
  const d2 = dv(c.slice(0, 12) + d1);
  return c.endsWith(`${d1}${d2}`);
}

export const validarDocumento = (tipoPessoa, v) => (tipoPessoa === "PF" ? validarCPF(v) : validarCNPJ(v));

// ── Arquivos ─────────────────────────────────────────────────────
export const TAMANHO_MAX_ANEXO = 10 * 1024 * 1024;
export const TIPOS_ANEXO = {
  pdf: "application/pdf",
  xml: "text/xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

export function extensaoDe(nome) {
  const m = /\.([a-z0-9]+)$/i.exec(nome || "");
  return m ? m[1].toLowerCase() : "";
}

// Retorna a mensagem de erro ou "" se o arquivo é aceito.
export function validarAnexo(arquivo) {
  if (!TIPOS_ANEXO[extensaoDe(arquivo.name)]) return `"${arquivo.name}": use PDF, XML, PNG ou JPG.`;
  if (arquivo.size > TAMANHO_MAX_ANEXO) return `"${arquivo.name}" passa de 10 MB.`;
  if (arquivo.size === 0) return `"${arquivo.name}" está vazio.`;
  return "";
}

export function formatarTamanho(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
