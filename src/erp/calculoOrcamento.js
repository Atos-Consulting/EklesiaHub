// Orçamento anual (v23): contas puras, sem acesso ao banco. Valores em centavos inteiros.
// Despesas por centro de custo, receitas por tipo. O realizado vem de orcamento_realizado(ano) no banco
// (mesmo critério do Relatório do mês: o que entrou e saiu das contas caixa, sem transferências).

import { paraCentavos } from "./format";

export const CATEGORIAS_RECEITA = [
  { id: "dizimo", rotulo: "Dízimos" },
  { id: "oferta", rotulo: "Ofertas" },
  { id: "campanha", rotulo: "Campanhas" },
  { id: "recebimento", rotulo: "Recebimentos (contas a receber)" },
  { id: "outras", rotulo: "Outras entradas" },
];
export const rotuloCategoria = (id) => CATEGORIAS_RECEITA.find((c) => c.id === id)?.rotulo ?? id;
export const SEM_CENTRO = "sem";
export const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const zeros = () => Array(12).fill(0);
const somaAte = (arr, n) => arr.slice(0, n).reduce((a, v) => a + v, 0);
export const somaMeses = (arr) => somaAte(arr, 12);
export const chaveLinha = (natureza, id) => `${natureza}:${id ?? SEM_CENTRO}`;

// Divide o valor do ano em 12 meses iguais; os centavos que sobram vão para os primeiros meses.
export function dividirAno(centavos) {
  const base = Math.floor(centavos / 12);
  const sobra = centavos - base * 12;
  return Array.from({ length: 12 }, (_, i) => base + (i < sobra ? 1 : 0));
}

// Reajusta cada mês pelo percentual (ex.: 5 = +5%), arredondando no centavo.
export const reajustar = (meses, pct) => meses.map((c) => Math.max(0, Math.round(c * (1 + (Number(pct) || 0) / 100))));

// Junta o orçamento gravado e o realizado do banco em linhas { natureza, id, orc[12], real[12], aberto[12] }.
export function juntarOrcamento(orcamentos, realizado) {
  const linhas = new Map();
  const linha = (natureza, id) => {
    const k = chaveLinha(natureza, id);
    if (!linhas.has(k)) linhas.set(k, { chave: k, natureza, id: id ?? SEM_CENTRO, orc: zeros(), real: zeros(), aberto: zeros() });
    return linhas.get(k);
  };
  for (const o of orcamentos ?? []) {
    const l = linha(o.natureza, o.natureza === "despesa" ? o.centro_custo_id : o.categoria);
    l.orc = o.valores.map((v) => paraCentavos(v));
  }
  for (const r of realizado ?? []) {
    const l = linha(r.natureza, r.natureza === "despesa" ? r.centro_custo_id : r.categoria);
    l.real[r.mes - 1] += paraCentavos(r.realizado);
    l.aberto[r.mes - 1] += paraCentavos(r.aberto);
  }
  return linhas;
}

// Números de uma linha até o mês `ateMes` (1 a 12) e no ano todo, e a situação dela.
export function medirLinha(l, ateMes) {
  const orcAno = somaMeses(l.orc);
  const orcAte = somaAte(l.orc, ateMes);
  const realAte = somaAte(l.real, ateMes);
  const realAno = somaMeses(l.real);
  const abertoAno = somaMeses(l.aberto);
  const usado = realAno + abertoAno;
  const despesa = l.natureza === "despesa";
  let situacao = "ok";
  if (despesa) {
    if (!orcAno) situacao = usado ? "sem_orcamento" : "vazio";
    else if (usado > orcAno) situacao = "estourado";
    else if (realAte > orcAte) situacao = "acima";
  } else if (!orcAno) situacao = realAno || abertoAno ? "sem_orcamento" : "vazio";
  else if (realAte < orcAte) situacao = "abaixo";
  return {
    orcAno, orcAte, realAte, realAno, abertoAno, usado,
    disponivel: orcAno - usado,
    pct: orcAno ? (despesa ? usado : realAno) / orcAno : null,
    situacao,
  };
}

export const SITUACOES = {
  estourado: { rotulo: "Passou do orçado", tom: "danger" },
  acima: { rotulo: "Acima do previsto", tom: "warn" },
  sem_orcamento: { rotulo: "Sem orçamento", tom: "neutral" },
  abaixo: { rotulo: "Abaixo do previsto", tom: "warn" },
  ok: { rotulo: "No previsto", tom: "ok" },
  vazio: { rotulo: "—", tom: "neutral" },
};

// Mês de referência padrão: o mês atual no ano corrente, dezembro nos outros.
export const mesPadrao = (ano, hoje) => (Number(hoje.slice(0, 4)) === ano ? Number(hoje.slice(5, 7)) : 12);

// Avisos ao aprovar uma nota: centros cujo uso no ano (pago + a pagar + esta nota) passa do orçado.
// partes: [{ centro, c }] da nota (centavos). Só avisa centros que têm orçamento no ano.
export function avisosDaNota(linhas, partes, nomeCentro) {
  const porCentro = new Map();
  for (const p of partes) if (p.centro) porCentro.set(p.centro, (porCentro.get(p.centro) ?? 0) + p.c);
  const avisos = [];
  for (const [centro, c] of porCentro) {
    const l = linhas.get(chaveLinha("despesa", centro));
    if (!l) continue;
    const m = medirLinha(l, 12);
    if (!m.orcAno || m.usado + c <= m.orcAno) continue;
    avisos.push({ centro, nome: nomeCentro(centro), orcado: m.orcAno, usado: m.usado, nota: c, excesso: m.usado + c - m.orcAno });
  }
  return avisos.sort((a, b) => b.excesso - a.excesso);
}

// Divide um valor (centavos) entre partes com pesos, na proporção; a sobra vai para a maior parte.
export function dividirProporcional(centavos, pesos) {
  const total = pesos.reduce((a, p) => a + p.peso, 0);
  if (!pesos.length || total <= 0) return [];
  const partes = pesos.map((p) => ({ centro: p.centro, c: Math.floor((centavos * p.peso) / total) }));
  const sobra = centavos - partes.reduce((a, p) => a + p.c, 0);
  partes.slice().sort((a, b) => b.c - a.c)[0].c += sobra;
  return partes;
}
