// Níveis de acesso e o que cada um pode fazer. A regra de verdade está no banco (RLS e gatilhos);
// aqui só decidimos o que mostrar na tela. Para mudar o que um nível pode, ajuste os dois lados.

export const NIVEIS = {
  administrador: {
    rotulo: "Administrador",
    descricao: "Acesso total: lança, aprova e cancela notas, e gerencia usuários, parâmetros e plano de contas.",
  },
  supervisor: {
    rotulo: "Supervisor",
    descricao: "Lança, aprova e cancela notas. Não gerencia usuários nem parâmetros.",
  },
  usuario: {
    rotulo: "Usuário",
    descricao: "Lança e edita rascunhos e cadastra fornecedores. Não aprova nem cancela notas.",
  },
};

export const NIVEIS_ORDEM = ["administrador", "supervisor", "usuario"];
export const rotuloNivel = (nivel) => NIVEIS[nivel]?.rotulo ?? "Sem acesso";

export function permissoes(perfil) {
  const n = perfil?.nivel;
  const temNivel = n in NIVEIS;
  return {
    lancar: temNivel,                                  // criar/editar rascunhos e cadastrar fornecedores
    aprovar: n === "administrador" || n === "supervisor", // aprovar e cancelar notas
    administrar: n === "administrador",                // Usuários e Parâmetros da própria empresa
    plataforma: Boolean(perfil?.plataforma_admin),     // criar e gerenciar empresas
  };
}
