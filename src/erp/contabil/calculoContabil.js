// Contabilidade (v25): contas puras para balancete, DRE e balanço. Valores em centavos inteiros.
// Saldo "D − C" positivo = devedor. Ativo e despesa são de natureza devedora; passivo, patrimônio social e
// receita, credora.

import { formatarMoeda, paraCentavos, deCentavos } from "../format";

export const DEVEDORAS = new Set(["ativo", "despesa"]);
export const NATUREZAS = { ativo: "Ativo", passivo: "Passivo", patrimonio_social: "Patrimônio social", receita: "Receita", despesa: "Despesa" };
export const ORIGENS = {
  manual: "Manual", abertura: "Saldo inicial", nota: "Nota de entrada", titulo_pagar: "Conta a pagar",
  titulo_receber: "Conta a receber", pagamento: "Pagamento/recebimento", entrada: "Dízimo/oferta", movimento: "Movimento de caixa",
  caixa_pdv: "Frente de loja", estoque: "Estoque",
};

export const moeda = (c) => formatarMoeda(deCentavos(c));
export const rotuloConta = (c) => (c ? `${c.codigo} - ${c.nome}` : "—");
// Saldo com indicação D (devedor) ou C (credor).
export const saldoDC = (c) => (c === 0 ? moeda(0) : `${moeda(Math.abs(c))} ${c > 0 ? "D" : "C"}`);
// Saldo pelo lado natural da conta (positivo = normal para a natureza).
export const saldoNatural = (natureza, dMenosC) => (DEVEDORAS.has(natureza) ? dMenosC : -dMenosC);

const nivel = (codigo) => codigo.split(".").length;
const ordemCodigo = (a, b) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1);
  }
  return 0;
};

// linhas: retorno de balancete(de, ate) — { conta_id, debito_anterior, credito_anterior, debito, credito }.
// Devolve todas as contas do plano em ordem de código, com os valores somados nas sintéticas (pelos pais).
export function montarBalancete(contas, linhas) {
  const porId = new Map(contas.map((c) => [c.id, { conta: c, nivel: nivel(c.codigo), antD: 0, antC: 0, d: 0, c: 0 }]));
  for (const l of linhas ?? []) {
    const v = { antD: paraCentavos(l.debito_anterior), antC: paraCentavos(l.credito_anterior), d: paraCentavos(l.debito), c: paraCentavos(l.credito) };
    let atual = porId.get(l.conta_id);
    const vistos = new Set();
    while (atual && !vistos.has(atual.conta.id)) {
      vistos.add(atual.conta.id);
      atual.antD += v.antD; atual.antC += v.antC; atual.d += v.d; atual.c += v.c;
      atual = atual.conta.pai_id ? porId.get(atual.conta.pai_id) : null;
    }
  }
  return [...porId.values()]
    .map((r) => ({ ...r, saldoAnt: r.antD - r.antC, saldo: r.antD - r.antC + r.d - r.c, movimento: r.d - r.c }))
    .sort((a, b) => ordemCodigo(a.conta.codigo, b.conta.codigo));
}

export const temValor = (r) => r.antD || r.antC || r.d || r.c;

// DRE do período: contas de receita e despesa com o movimento pelo lado natural; resultado = receitas − despesas.
export function montarDre(balancete) {
  const linhas = balancete.filter((r) => (r.conta.natureza === "receita" || r.conta.natureza === "despesa") && (r.d || r.c));
  const valor = (r) => saldoNatural(r.conta.natureza, r.movimento);
  const raiz = (nat) => linhas.filter((r) => r.conta.natureza === nat && !r.conta.pai_id).reduce((a, r) => a + valor(r), 0);
  const receitas = raiz("receita");
  const despesas = raiz("despesa");
  return {
    receitas: linhas.filter((r) => r.conta.natureza === "receita").map((r) => ({ ...r, valor: valor(r) })),
    despesas: linhas.filter((r) => r.conta.natureza === "despesa").map((r) => ({ ...r, valor: valor(r) })),
    totalReceitas: receitas, totalDespesas: despesas, resultado: receitas - despesas,
  };
}

// Balanço em `ate`, a partir de balancete(1º de janeiro do ano, ate): saldo = anterior + movimento.
// Sem lançamentos de encerramento, o resultado aparece no patrimônio social: anos anteriores + exercício.
export function montarBalanco(balancete) {
  const comSaldo = (nat) => balancete.filter((r) => r.conta.natureza === nat && r.saldo !== 0).map((r) => ({ ...r, valor: saldoNatural(nat, r.saldo) }));
  const raiz = (nat, campo) => balancete.filter((r) => r.conta.natureza === nat && !r.conta.pai_id).reduce((a, r) => a + saldoNatural(nat, r[campo]), 0);
  const resultadoAnterior = raiz("receita", "saldoAnt") - raiz("despesa", "saldoAnt");
  const resultadoExercicio = raiz("receita", "movimento") - raiz("despesa", "movimento");
  const ativo = raiz("ativo", "saldo");
  const passivo = raiz("passivo", "saldo");
  const patrimonio = raiz("patrimonio_social", "saldo");
  return {
    ativo: comSaldo("ativo"), passivo: comSaldo("passivo"), patrimonio: comSaldo("patrimonio_social"),
    totalAtivo: ativo, totalPassivo: passivo, totalPatrimonio: patrimonio + resultadoAnterior + resultadoExercicio,
    patrimonioContas: patrimonio, resultadoAnterior, resultadoExercicio,
    diferenca: ativo - (passivo + patrimonio + resultadoAnterior + resultadoExercicio),
  };
}
