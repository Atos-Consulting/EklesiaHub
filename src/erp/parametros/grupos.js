import ContasCaixa from "./ContasCaixa";
import CondicoesPagamento from "./CondicoesPagamento";
import PlanoContas from "./PlanoContas";
import TiposContabeis from "./TiposContabeis";
import CentrosCusto from "./CentrosCusto";
import Orientacoes from "./Orientacoes";
import NumeroNotas from "./NumeroNotas";
import DadosIgreja from "./DadosIgreja";
import Modulos from "./Modulos";

// Parâmetros da empresa (só o Administrador acessa), organizados por área.
// Para um novo parâmetro: acrescente uma aba no grupo certo (e, se for do sistema, o catálogo em catalogoParametros.js).
export const GRUPOS_PARAMETROS = [
  { id: "financeiro", rotulo: "Financeiro", abas: [
    { id: "caixas", rotulo: "Contas caixa", Tela: ContasCaixa },
    { id: "condicoes", rotulo: "Condições de pagamento", Tela: CondicoesPagamento },
  ] },
  { id: "contabil", rotulo: "Contábil", abas: [
    { id: "contas", rotulo: "Plano de contas", Tela: PlanoContas },
    { id: "tipos", rotulo: "Tipos contábeis", Tela: TiposContabeis },
    { id: "centros", rotulo: "Centros de custo", Tela: CentrosCusto },
    { id: "orientacoes", rotulo: "Orientações contábeis", Tela: Orientacoes },
  ] },
  { id: "sistema", rotulo: "Sistema", abas: [
    { id: "igreja", rotulo: "Dados da igreja", Tela: DadosIgreja },
    { id: "modulos", rotulo: "Módulos", Tela: Modulos },
    { id: "campos", rotulo: "Tamanho dos campos", Tela: NumeroNotas },
  ] },
];

export const ABAS_PARAMETROS = GRUPOS_PARAMETROS.flatMap((g) => g.abas.map((a) => ({ id: a.id, rotulo: a.rotulo, grupo: g.rotulo })));

