import { carregarExportacao } from "./db";
import { ORIGENS_EXTRATO, TIPOS_ENTRADA, TIPOS_MOVIMENTO, nomeForma } from "./financeiro";
import { mascararDocumento, paraCentavos } from "./format";

// Exportação para o contador (Excel): uma planilha do mês com as abas Resumo, Extrato, Pagamentos,
// Recebimentos, Entradas (dízimos, ofertas, campanhas) e Movimentos de caixa. Só lê; a biblioteca
// (write-excel-file) é carregada só quando o botão é usado, para não pesar a abertura do sistema.

const DINHEIRO = "#,##0.00";
const DATA = "dd/mm/yyyy";
const data = (iso) => (iso ? { value: new Date(`${String(iso).slice(0, 10)}T00:00:00Z`), type: Date, format: DATA } : null);
const valor = (v) => (v === null || v === undefined || v === "" ? null : { value: Number(v), type: Number, format: DINHEIRO });
const texto = (v) => (v === null || v === undefined || v === "" ? null : String(v));
const cab = (titulos) => titulos.map((t) => ({ value: t, fontWeight: "bold", backgroundColor: "#E8EEF4" }));
const total = (rotulo, colunaRotulo, valores) => valores.map((v, i) => (i === colunaRotulo ? { value: rotulo, fontWeight: "bold" } : v === undefined ? null : { ...valor(v), fontWeight: "bold" }));
const larguras = (ws) => ws.map((width) => ({ width }));
const doc = (tipo, numero) => (numero ? mascararDocumento(tipo === "PF" ? "PF" : "PJ", numero) : null);
const somar = (lista, campo) => lista.reduce((a, x) => a + paraCentavos(x[campo]), 0) / 100;

export async function exportarParaContador({ de, ate, cadastros, nomeIgreja }) {
  const [{ default: writeExcelFile }, d] = await Promise.all([import("write-excel-file/browser"), carregarExportacao(cadastros.caixas.map((c) => c.id), { de, ate })]);
  const conta = (id) => cadastros.caixas.find((c) => c.id === id)?.nome ?? null;
  const centro = (id) => cadastros.centros.find((c) => c.id === id)?.nome ?? null;
  const forma = (id, cod) => texto(nomeForma(cadastros.formas, id, cod));

  // Resumo por conta
  const resumo = [
    [{ value: `Prestação de contas — ${nomeIgreja ?? ""}`.trim(), fontWeight: "bold", fontSize: 14 }],
    [`Período: ${de.split("-").reverse().join("/")} a ${ate.split("-").reverse().join("/")}`],
    [`Gerado em ${new Date().toLocaleString("pt-BR")} pelo EklesiaHub. Transferências entre contas não são entrada nem saída.`],
    [],
    cab(["Conta caixa", "Saldo anterior", "Entradas", "Saídas", "Transferências (líquido)", "Saldo final", "Fechada até"]),
  ];
  for (const s of d.saldos) {
    const linhas = d.extrato.filter((l) => l.conta_caixa_id === s.conta_caixa_id);
    const transf = linhas.filter((l) => l.origem.startsWith("transferencia"));
    const outras = linhas.filter((l) => !l.origem.startsWith("transferencia"));
    resumo.push([texto(conta(s.conta_caixa_id)), valor(s.anterior), valor(somar(outras.filter((l) => l.valor > 0), "valor")),
      valor(-somar(outras.filter((l) => l.valor < 0), "valor")), valor(somar(transf, "valor")), valor(s.final), data(s.fechadaAte)]);
  }
  resumo.push(total("Total", 0, [undefined, somar(d.saldos, "anterior"), undefined, undefined, undefined, somar(d.saldos, "final")]));

  // Extrato com saldo corrido por conta
  const extrato = [cab(["Data", "Conta caixa", "Tipo", "Descrição", "Forma", "Entrada", "Saída", "Saldo da conta"])];
  for (const s of d.saldos) {
    let corrido = paraCentavos(s.anterior);
    const linhas = d.extrato.filter((l) => l.conta_caixa_id === s.conta_caixa_id);
    if (!linhas.length) continue;
    extrato.push([data(de), texto(conta(s.conta_caixa_id)), "Saldo anterior", null, null, null, null, valor(s.anterior)]);
    for (const l of linhas) {
      corrido += paraCentavos(l.valor);
      extrato.push([data(l.data), texto(conta(l.conta_caixa_id)), texto(ORIGENS_EXTRATO[l.origem] ?? l.origem), texto(l.descricao),
        l.forma_pagamento_id ? forma(l.forma_pagamento_id) : null, l.valor > 0 ? valor(l.valor) : null, l.valor < 0 ? valor(-l.valor) : null, valor(corrido / 100)]);
    }
  }

  const titulosAba = (lista, receber) => [
    cab(["Data", "Vencimento", receber ? "Pagador" : "Fornecedor", "CPF/CNPJ", "Documento", "Descrição", "Parcela", "Centro de custo", "Conta caixa", "Forma",
      "Valor", "Juros", "Multa", "Desconto", receber ? "Valor recebido" : "Valor pago", "Comprovantes"]),
    ...lista.map((t) => [data(t.data_pagamento), data(t.vencimento), texto(t.fornecedor_nome), texto(doc(t.fornecedor_tipo, t.fornecedor_documento)),
      texto(t.documento_numero ? `${{ nfe: "NF-e", nfse: "NFS-e", recibo: "Recibo", fatura: "Fatura" }[t.documento_tipo] ?? "Documento"} ${t.documento_numero}${t.documento_serie ? `/${t.documento_serie}` : ""}` : null),
      texto(t.descricao), `${t.parcela}/${t.total_parcelas}`, texto(centro(t.centro_custo_id)), texto(conta(t.pagamento_conta_caixa_id)), forma(t.pagamento_forma_id ?? t.forma_pagamento_id, t.forma_pagamento),
      valor(t.valor), valor(t.juros), valor(t.multa), valor(t.desconto), valor(t.valor_pago), { value: t.qtd_comprovantes ?? 0, type: Number }]),
    total("Total", 0, [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      somar(lista, "valor"), somar(lista, "juros"), somar(lista, "multa"), somar(lista, "desconto"), somar(lista, "valor_pago")]),
  ];

  const entradas = [
    cab(["Data", "Tipo", "Campanha", "Pessoa", "CPF/CNPJ", "Conta caixa", "Forma", "Centro de custo", "Descrição", "Valor"]),
    ...d.entradas.map((e) => {
      const p = cadastros.pessoas.find((x) => x.id === e.pessoa_id);
      return [data(e.data), texto(TIPOS_ENTRADA[e.tipo] ?? e.tipo), texto(e.campanha_nome), texto(e.pessoa_nome ?? "Não identificado"), texto(p ? doc(p.tipo_pessoa, p.documento) : null),
        texto(e.conta_caixa_nome), forma(e.forma_pagamento_id, e.forma_pagamento), texto(e.centro_custo_nome), texto(e.descricao), valor(e.valor)];
    }),
    total("Total", 0, [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, somar(d.entradas, "valor")]),
  ];

  const movimentos = [
    cab(["Data", "Tipo", "Sai de", "Entra em", "Descrição", "Centro de custo", "Valor", "Registrado por", "Comprovantes"]),
    ...d.movimentos.map((m) => [data(m.data), texto(TIPOS_MOVIMENTO[m.tipo] ?? m.tipo), texto(m.conta_origem_nome), texto(m.conta_destino_nome), texto(m.descricao),
      texto(m.centro_custo_nome), valor(m.valor), texto(m.registrado_por_nome), { value: m.qtd_comprovantes ?? 0, type: Number }]),
  ];

  const nomeArquivo = `prestacao-de-contas-${de.slice(0, 7)}.xlsx`;
  await writeExcelFile([
    { data: resumo, sheet: "Resumo", columns: larguras([28, 16, 16, 16, 22, 16, 14]) },
    { data: extrato, sheet: "Extrato", columns: larguras([12, 22, 22, 50, 18, 14, 14, 16]), stickyRowsCount: 1 },
    { data: titulosAba(d.pagos, false), sheet: "Pagamentos", columns: larguras([12, 12, 32, 20, 18, 36, 8, 20, 20, 18, 13, 10, 10, 10, 14, 13]), stickyRowsCount: 1 },
    { data: titulosAba(d.recebidos, true), sheet: "Recebimentos", columns: larguras([12, 12, 32, 20, 12, 36, 8, 20, 20, 18, 13, 10, 10, 10, 14, 13]), stickyRowsCount: 1 },
    { data: entradas, sheet: "Entradas", columns: larguras([12, 14, 22, 30, 20, 20, 18, 20, 36, 14]), stickyRowsCount: 1 },
    { data: movimentos, sheet: "Movimentos de caixa", columns: larguras([12, 16, 20, 20, 40, 20, 14, 20, 13]), stickyRowsCount: 1 },
  ]).toFile(nomeArquivo);
  return nomeArquivo;
}
