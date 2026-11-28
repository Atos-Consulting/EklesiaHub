// Leitura de XML de NF-e (modelo 55) e NFC-e (modelo 65), layout 3.10/4.00, e decodificação da chave de acesso.
// Funções puras: recebem texto e devolvem objetos. Nada aqui acessa o banco nem a rede.
import { paraCentavos, deCentavos, limparCnpj, soDigitos, validarCNPJ, validarCPF } from "./format.js";

export const TAMANHO_MAX_XML = 2 * 1024 * 1024; // 2 MB: uma NF-e comum tem poucos KB

const UF_POR_CODIGO = {
  11: "RO", 12: "AC", 13: "AM", 14: "RR", 15: "PA", 16: "AP", 17: "TO", 21: "MA", 22: "PI", 23: "CE", 24: "RN",
  25: "PB", 26: "PE", 27: "AL", 28: "SE", 29: "BA", 31: "MG", 32: "ES", 33: "RJ", 35: "SP", 41: "PR", 42: "SC",
  43: "RS", 50: "MS", 51: "MT", 52: "GO", 53: "DF",
};
const MODELOS = { 55: "NF-e", 65: "NFC-e" };
const STATUS_AUTORIZADO = ["100", "150"]; // 100 = autorizada; 150 = autorizada fora do prazo

const analisarXml = (texto) => new DOMParser().parseFromString(texto, "application/xml");
const falha = (erro) => ({ ok: false, erro, avisos: [] });

// Primeiro descendente com esse nome local (ignora o namespace do XML).
const achar = (no, nome) => (no ? no.getElementsByTagNameNS("*", nome)[0] ?? null : null);
const texto = (no, nome) => achar(no, nome)?.textContent.trim() ?? "";
const cent = (no, nome) => paraCentavos(Number(texto(no, nome)) || 0);

// ── Dígito verificador da chave (módulo 11, pesos 2..9 da direita para a esquerda) ──
export function calcularDvChave(chave43) {
  let soma = 0;
  let peso = 2;
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

// Lê o que a chave de acesso já informa. A chave NÃO traz valor, itens nem o dia da emissão.
export function decodificarChave(entrada) {
  const c = String(entrada ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (c.length !== 44) return { valida: false, chave: c, erro: `A chave de acesso tem 44 caracteres (${c.length} informados).` };

  const uf = UF_POR_CODIGO[Number(c.slice(0, 2))];
  const ano = 2000 + Number(c.slice(2, 4));
  const mes = Number(c.slice(4, 6));
  if (!/^[0-9]{2}$/.test(c.slice(0, 2)) || !uf) return { valida: false, chave: c, erro: "Chave inválida: código da UF desconhecido." };
  if (!/^[0-9]{4}$/.test(c.slice(2, 6)) || mes < 1 || mes > 12) return { valida: false, chave: c, erro: "Chave inválida: mês de emissão inexistente." };

  const somenteDigitos = /^[0-9]{44}$/.test(c);
  // Com letras (CNPJ alfanumérico) não verificamos o dígito: a regra de cálculo para esse caso não foi confirmada.
  const dvConfere = somenteDigitos ? calcularDvChave(c.slice(0, 43)) === Number(c[43]) : null;

  const campo = c.slice(6, 20);
  let tipoPessoa = "PJ";
  let documento = campo;
  if (!validarCNPJ(campo) && campo.startsWith("000") && validarCPF(campo.slice(3))) {
    tipoPessoa = "PF";
    documento = campo.slice(3);
  }

  const modelo = Number(c.slice(20, 22));
  return {
    valida: dvConfere !== false,
    chave: c,
    erro: dvConfere === false ? "Dígito verificador inválido: confira se a chave foi digitada corretamente." : "",
    dvConfere,
    uf, ano, mes,
    documento, tipoPessoa,
    modelo, modeloNome: MODELOS[modelo] ?? `modelo ${c.slice(20, 22)}`, suportado: Boolean(MODELOS[modelo]),
    serie: String(Number(c.slice(22, 25))),
    numero: String(Number(c.slice(25, 34))),
  };
}

// Tributos e classificação fiscal de um item (<det>). Só entra o que tem valor; chaves iguais às de fiscal_valido() no banco.
function fiscalDoItem(det, prod) {
  const f = {};
  const imposto = achar(det, "imposto");
  const grupoIcms = achar(imposto, "ICMS");
  const num = (chave, no, tag) => { const n = Number(texto(no, tag)); if (Number.isFinite(n) && n > 0) f[chave] = n; };
  const txt = (chave, valor, max) => { if (valor) f[chave] = valor.slice(0, max); };
  txt("ncm", texto(prod, "NCM"), 8);
  txt("cfop", texto(prod, "CFOP"), 4);
  txt("unidade", texto(prod, "uCom"), 6);
  txt("cst", texto(grupoIcms, "CST") || texto(grupoIcms, "CSOSN"), 4);
  num("icms_base", grupoIcms, "vBC"); num("icms_aliquota", grupoIcms, "pICMS"); num("icms", grupoIcms, "vICMS"); num("icms_st", grupoIcms, "vICMSST");
  const ipi = achar(imposto, "IPI");
  num("ipi_aliquota", ipi, "pIPI"); num("ipi", ipi, "vIPI");
  num("pis", achar(imposto, "PIS"), "vPIS"); num("cofins", achar(imposto, "COFINS"), "vCOFINS");
  // Reforma tributária (NT 2025.002): grupo IBSCBS com IBS da UF + do município e CBS
  const ibscbs = achar(achar(imposto, "IBSCBS"), "gIBSCBS");
  if (ibscbs) {
    num("ibs_cbs_base", ibscbs, "vBC");
    const pIbs = (Number(texto(achar(ibscbs, "gIBSUF"), "pIBSUF")) || 0) + (Number(texto(achar(ibscbs, "gIBSMun"), "pIBSMun")) || 0);
    if (pIbs > 0) f.ibs_aliquota = Math.round(pIbs * 10000) / 10000;
    const vIbs = Number(texto(ibscbs, "vIBS")) || (Number(texto(achar(ibscbs, "gIBSUF"), "vIBSUF")) || 0) + (Number(texto(achar(ibscbs, "gIBSMun"), "vIBSMun")) || 0);
    if (vIbs > 0) f.ibs = Math.round(vIbs * 100) / 100;
    const gCbs = achar(ibscbs, "gCBS");
    num("cbs_aliquota", gCbs, "pCBS"); num("cbs", gCbs, "vCBS");
  }
  return f;
}

// ── Leitura do XML da nota ───────────────────────────────────────────────────────
// Devolve { ok:false, erro } ou { ok:true, avisos:[...], dados:{...} }.
export function lerNfeXml(conteudo, parseXml = analisarXml) {
  const avisos = [];
  const bruto = String(conteudo ?? "").replace(/^\uFEFF/, "");
  if (!bruto.trim()) return falha("O arquivo está vazio.");
  if (bruto.length > TAMANHO_MAX_XML) return falha("O arquivo é grande demais para uma nota (máximo de 2 MB).");
  // Defesa em profundidade: nota fiscal nunca precisa de DTD/entidades externas.
  if (/<!DOCTYPE|<!ENTITY/i.test(bruto)) return falha("O XML contém declarações não permitidas (DOCTYPE/ENTITY).");

  const doc = parseXml(bruto);
  if (!doc?.documentElement || doc.getElementsByTagName("parsererror").length) return falha("O arquivo não é um XML válido.");

  const raiz = doc.documentElement.localName;
  if (/^(procEventoNFe|envEvento|retEnvEvento)$/.test(raiz)) {
    return falha("Este arquivo é um evento da nota (cancelamento, carta de correção...), não a nota. Importe o XML da nota.");
  }

  const inf = achar(doc, "infNFe");
  if (!inf) {
    if (achar(doc, "infCte") || achar(doc, "infCTe")) return falha("CT-e (conhecimento de transporte) ainda não é suportado.");
    if (achar(doc, "InfNfse") || achar(doc, "infNFSe") || achar(doc, "CompNfse")) {
      return falha("NFS-e ainda não é suportada: o layout varia por município. Envie um exemplo para adicionarmos.");
    }
    return falha("Não reconheci este XML como NF-e (modelo 55) ou NFC-e (modelo 65).");
  }

  const ide = achar(inf, "ide");
  const modelo = Number(texto(ide, "mod"));
  if (!MODELOS[modelo]) return falha(`Modelo ${texto(ide, "mod") || "desconhecido"} não suportado (apenas NF-e 55 e NFC-e 65).`);

  // Protocolo de autorização: sem ele o XML não comprova que a nota foi autorizada pela SEFAZ.
  const protocolo = achar(doc, "infProt");
  const cStat = texto(protocolo, "cStat");
  if (protocolo && !STATUS_AUTORIZADO.includes(cStat)) {
    return falha(`Nota não autorizada pela SEFAZ (${cStat}${texto(protocolo, "xMotivo") ? ` — ${texto(protocolo, "xMotivo")}` : ""}).`);
  }
  if (!protocolo) avisos.push("O arquivo não tem o protocolo de autorização da SEFAZ; baixe o XML completo (nfeProc) para ter essa comprovação.");

  const chave = (inf.getAttribute("Id") || "").replace(/^NFe/i, "").toUpperCase();
  const chaveProtocolo = texto(protocolo, "chNFe").toUpperCase();
  if (!/^[0-9A-Z]{44}$/.test(chave)) return falha("A chave de acesso da nota não foi encontrada no XML.");
  if (chaveProtocolo && chaveProtocolo !== chave) return falha("A chave do protocolo é diferente da chave da nota: arquivo inconsistente.");

  // Emitente = fornecedor
  const emit = achar(inf, "emit");
  const cnpj = limparCnpj(texto(emit, "CNPJ"));
  const cpf = soDigitos(texto(emit, "CPF"));
  let fornecedorDoc;
  let tipoPessoa;
  if (/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) { fornecedorDoc = cnpj; tipoPessoa = "PJ"; if (!validarCNPJ(cnpj)) avisos.push("O CNPJ do emitente não passou na validação dos dígitos."); }
  else if (/^[0-9]{11}$/.test(cpf)) { fornecedorDoc = cpf; tipoPessoa = "PF"; if (!validarCPF(cpf)) avisos.push("O CPF do emitente não passou na validação dos dígitos."); }
  else return falha("Não encontrei um CNPJ/CPF válido do emitente na nota.");
  const nomeFornecedor = texto(emit, "xNome");
  if (!nomeFornecedor) return falha("A nota não informa o nome do emitente.");

  const numero = texto(ide, "nNF");
  if (!numero) return falha("A nota não informa o número.");
  const emissao = (texto(ide, "dhEmi") || texto(ide, "dEmi")).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(emissao)) return falha("A nota não informa a data de emissão.");

  // Itens: cada linha vale o valor dos produtos (vProd). Frete, seguro, outras despesas, desconto e os tributos
  // que somam ao total (IPI, ICMS-ST) ficam nos campos próprios da nota — como no formulário de lançamento.
  const linhas = [...inf.getElementsByTagNameNS("*", "det")].map((det) => {
    const prod = achar(det, "prod");
    const quantidade = Number(texto(prod, "qCom"));
    const centavos = Math.max(cent(prod, "vProd"), 0);
    return {
      descricao: texto(prod, "xProd") || `Item ${det.getAttribute("nItem") || ""}`.trim(),
      quantidade: quantidade > 0 ? quantidade : 1,
      valorUnitario: Number(texto(prod, "vUnCom")) || 0,
      centavos,
      fiscal: fiscalDoItem(det, prod),
    };
  });
  if (linhas.length === 0) return falha("A nota não tem itens.");

  const tot = achar(achar(inf, "total"), "ICMSTot");
  const somaItens = linhas.reduce((a, l) => a + l.centavos, 0);
  const ajustes = { frete: cent(tot, "vFrete"), seguro: cent(tot, "vSeg"), outras: cent(tot, "vOutro"), desconto: cent(tot, "vDesc") };
  const fiscal = {};
  const numero_ = (chave, centavos) => { if (centavos > 0) fiscal[chave] = deCentavos(centavos); };
  numero_("icms_base", cent(tot, "vBC")); numero_("icms", cent(tot, "vICMS"));
  numero_("icms_st_base", cent(tot, "vBCST")); numero_("icms_st", cent(tot, "vST"));
  numero_("ipi", cent(tot, "vIPI")); numero_("pis", cent(tot, "vPIS")); numero_("cofins", cent(tot, "vCOFINS"));
  numero_("total_tributos", cent(tot, "vTotTrib"));
  const totRef = achar(achar(inf, "total"), "IBSCBSTot");
  if (totRef) {
    numero_("ibs_cbs_base", cent(totRef, "vBCIBSCBS"));
    numero_("ibs", cent(achar(totRef, "gIBS"), "vIBS"));
    numero_("cbs", cent(achar(totRef, "gCBS"), "vCBS"));
  }
  const nProt = texto(protocolo, "nProt");
  if (nProt) fiscal.protocolo = nProt.slice(0, 60);

  // Total do formulário = itens + frete + seguro + outras − desconto + IPI + ICMS-ST. Se o vNF da nota tiver algo a mais
  // ou a menos (FCP-ST, imposto de importação, desoneração, arredondamento), a diferença vai para "outras despesas" ou "desconto".
  const calculado = somaItens + ajustes.frete + ajustes.seguro + ajustes.outras - ajustes.desconto + cent(tot, "vIPI") + cent(tot, "vST");
  const totalNota = cent(achar(inf, "total"), "vNF") || calculado;
  if (totalNota <= 0) return falha("O valor total da nota é zero.");
  const diferenca = totalNota - calculado;
  if (diferenca !== 0) {
    if (diferenca > 0) ajustes.outras += diferenca; else ajustes.desconto += -diferenca;
    avisos.push(`O total da nota difere em R$ ${deCentavos(Math.abs(diferenca)).toFixed(2).replace(".", ",")} da soma dos itens e ajustes (ex.: FCP-ST, imposto de importação, desoneração, arredondamento); `
      + `a diferença foi lançada em "${diferenca > 0 ? "Outras despesas" : "Desconto"}" para o total fechar com a nota.`);
  }

  const dest = achar(inf, "dest");
  return {
    ok: true,
    avisos,
    dados: {
      tipo: "nfe", modelo, modeloNome: MODELOS[modelo],
      numero, serie: texto(ide, "serie"), chave,
      dataEmissao: emissao, valorTotal: deCentavos(totalNota),
      ajustes: { frete: deCentavos(ajustes.frete), seguro: deCentavos(ajustes.seguro), outras: deCentavos(ajustes.outras), desconto: deCentavos(ajustes.desconto) },
      fiscal,
      natOp: texto(ide, "natOp"),
      autorizada: Boolean(protocolo),
      fornecedor: { documento: fornecedorDoc, tipoPessoa, nome: nomeFornecedor, fantasia: texto(emit, "xFant"), telefone: texto(achar(emit, "enderEmit"), "fone") },
      destinatario: { documento: limparCnpj(texto(dest, "CNPJ")) || soDigitos(texto(dest, "CPF")), nome: texto(dest, "xNome") },
      itens: linhas.map((l) => ({ descricao: l.descricao, quantidade: l.quantidade, valorUnitario: l.valorUnitario, valorTotal: deCentavos(l.centavos), fiscal: l.fiscal })),
    },
  };
}
