import { paraCentavos } from "../format";

// Contas puras do frente de loja (v27). O banco refaz tudo em registrar_venda: mudou uma, mude a outra.

// Total de um item em centavos (quantidade × preço, arredondado como o round(…, 2) do banco).
export const centavosItem = (i) => Math.round(paraCentavos(i.preco) * Number(i.quantidade));
export const centavosCarrinho = (itens) => itens.reduce((a, i) => a + centavosItem(i), 0);

// Formas que servem para venda no caixa (boleto não).
export const formasDeVenda = (formas) => (formas ?? []).filter((f) => f.ativo && f.tipo !== "boleto");

// O usuário pode 'abrir' (abrir e fechar o caixa, cancelar venda) ou 'vender' no local?
// Administrador pode tudo; os demais, conforme o cadastro do usuário (pontos_venda_usuarios).
export function podeNoLocal(admin, acessos, pontoId, acao) {
  if (admin) return true;
  const a = acessos.find((x) => x.ponto_venda_id === pontoId);
  if (!a) return false;
  return acao === "abrir" ? a.pode_abrir : a.pode_abrir || a.pode_vender;
}

// Produto vendido no local? (lista vazia = em todos)
export const vendidoNoLocal = (produto, pontoId) => !produto.pontos_venda?.length || produto.pontos_venda.includes(pontoId);

// Soma por chave, em centavos: [{ chave, rotulo, c, qtd }] do maior para o menor.
export function somarPor(linhas, chave, rotulo, valor, qtd = () => 1) {
  const m = new Map();
  for (const l of linhas) {
    const k = chave(l);
    if (!m.has(k)) m.set(k, { chave: k, rotulo: rotulo(l), c: 0, qtd: 0 });
    const g = m.get(k);
    g.c += valor(l);
    g.qtd += qtd(l);
  }
  return [...m.values()].sort((a, b) => b.c - a.c);
}

export const horaDe = (ts) => (ts ? new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "");
export const quantidadeTexto = (q) => String(Number(q)).replace(".", ",");
