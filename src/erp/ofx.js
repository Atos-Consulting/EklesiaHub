// Leitor de extrato bancário OFX (1.x SGML ou 2.x XML) e conferência com o extrato do sistema.
// Funções puras: sem React e sem banco, para dar para testar isoladamente.

// Lê os bytes do arquivo: bancos brasileiros costumam mandar em Windows-1252 (CHARSET:1252).
export function decodificarOfx(buffer) {
  const inicio = new TextDecoder("latin1").decode(buffer.slice(0, 400));
  const latin = /CHARSET:\s*1252|ENCODING:\s*USASCII|encoding="(windows-1252|iso-8859-1)"/i.test(inicio) && !/CHARSET:\s*(UTF-?8|NONE)\b/i.test(inicio);
  return new TextDecoder(latin ? "windows-1252" : "utf-8").decode(buffer);
}

const campo = (bloco, tag) => {
  const m = bloco.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"));
  return m ? m[1].trim() : "";
};
const dataOfx = (v) => (/^\d{8}/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null);
function valorOfx(v) {
  let t = String(v ?? "").trim().replace(/\s/g, "");
  if (!t) return NaN;
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (t.includes(",")) t = t.replace(",", ".");
  return Math.round(Number(t) * 100); // centavos
}
const limparTexto = (t) => t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

// → { banco, agencia, conta, inicio, fim, saldo: { centavos, data } | null, transacoes: [{ id, data, centavos, tipo, descricao, documento }] }
export function lerOfx(texto) {
  const corpo = texto.slice(Math.max(0, texto.search(/<OFX>/i)));
  if (!/<OFX>/i.test(corpo)) throw new Error("Este arquivo não parece ser um extrato OFX.");
  const blocos = corpo.match(/<STMTTRN>[\s\S]*?(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi) || [];
  const vistos = new Set();
  const transacoes = [];
  for (const b of blocos) {
    const data = dataOfx(campo(b, "DTPOSTED"));
    const centavos = valorOfx(campo(b, "TRNAMT"));
    if (!data || !Number.isFinite(centavos) || centavos === 0) continue;
    let id = campo(b, "FITID") || `${data}|${centavos}|${transacoes.length}`;
    if (vistos.has(id)) id = `${id}#${transacoes.length}`; // alguns bancos repetem o FITID
    vistos.add(id);
    const memo = limparTexto(campo(b, "MEMO"));
    const nome = limparTexto(campo(b, "NAME"));
    transacoes.push({
      id, data, centavos, tipo: campo(b, "TRNTYPE").toUpperCase(),
      descricao: [nome, memo].filter((x, i, a) => x && a.indexOf(x) === i).join(" · ") || (centavos > 0 ? "Crédito" : "Débito"),
      documento: campo(b, "CHECKNUM") || campo(b, "REFNUM"),
    });
  }
  if (!transacoes.length) throw new Error("Nenhum lançamento encontrado no arquivo OFX.");
  transacoes.sort((a, b) => a.data.localeCompare(b.data));
  const ledger = corpo.match(/<LEDGERBAL>[\s\S]*?(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>)/i)?.[0] ?? "";
  const saldoC = valorOfx(campo(ledger, "BALAMT"));
  return {
    banco: campo(corpo, "BANKID"), agencia: campo(corpo, "BRANCHID"), conta: campo(corpo, "ACCTID"),
    inicio: dataOfx(campo(corpo, "DTSTART")) ?? transacoes[0].data,
    fim: dataOfx(campo(corpo, "DTEND")) ?? transacoes[transacoes.length - 1].data,
    saldo: Number.isFinite(saldoC) && ledger ? { centavos: saldoC, data: dataOfx(campo(ledger, "DTASOF")) } : null,
    transacoes,
  };
}

const dias = (a, b) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000;

// Casa cada lançamento do banco com um do sistema de mesmo valor (e sinal), na data mais próxima
// dentro de `tolerancia` dias. Cada lançamento do sistema casa uma vez só.
// sistema: linhas do extrato_caixa ({ origem, ref_id, data, valor }) → { casados, soBanco, soSistema }
export function conferirExtrato(transacoes, sistema, { tolerancia = 3, de, ate } = {}) {
  const livres = sistema.map((l, i) => ({ ...l, i, centavos: Math.round(Number(l.valor) * 100) }));
  const usados = new Set();
  const casados = [];
  const pendentes = [];
  for (const passo of Array.from({ length: tolerancia + 1 }, (_, k) => k)) {
    for (const t of passo === 0 ? transacoes : pendentes.splice(0)) {
      const candidato = livres.filter((l) => !usados.has(l.i) && l.centavos === t.centavos && dias(l.data, t.data) <= passo)
        .sort((a, b) => dias(a.data, t.data) - dias(b.data, t.data))[0];
      if (candidato) { usados.add(candidato.i); casados.push({ banco: t, sistema: candidato, diferencaDias: dias(candidato.data, t.data) }); }
      else pendentes.push(t);
    }
  }
  const soSistema = livres.filter((l) => !usados.has(l.i) && (!de || l.data >= de) && (!ate || l.data <= ate));
  casados.sort((a, b) => a.banco.data.localeCompare(b.banco.data));
  return { casados, soBanco: pendentes.sort((a, b) => a.data.localeCompare(b.data)), soSistema };
}
