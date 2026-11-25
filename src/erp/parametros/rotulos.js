export const NATUREZAS = {
  ativo: "Ativo", passivo: "Passivo", patrimonio_social: "Patrimônio social", receita: "Receita", despesa: "Despesa",
};

export const rotuloConta = (c) => (c ? `${c.codigo} — ${c.nome}` : "—");
