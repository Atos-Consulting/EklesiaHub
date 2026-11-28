import ContasCaixa from "./ContasCaixa";
import CondicoesPagamento from "./CondicoesPagamento";
import Campanhas from "./Campanhas";
import FormasPagamento from "./FormasPagamento";
import PlanoContas from "./PlanoContas";
import TiposContabeis from "./TiposContabeis";
import CentrosCusto from "./CentrosCusto";
import RegrasContabeis from "./RegrasContabeis";
import Orientacoes from "./Orientacoes";
import NumeroNotas from "./NumeroNotas";
import DadosIgreja from "./DadosIgreja";
import Layout from "./Layout";
import Modulos from "./Modulos";
import PontosVenda from "./PontosVenda";

// Parâmetros da empresa (só o Administrador acessa), organizados por área.
// Para um novo parâmetro: acrescente uma aba no grupo certo (e, se for do sistema, o catálogo em catalogoParametros.js).
export const GRUPOS_PARAMETROS = [
  { id: "financeiro", rotulo: "Financeiro", abas: [
    { id: "caixas", rotulo: "Contas caixa", Tela: ContasCaixa },
    { id: "formas", rotulo: "Formas de pagamento", Tela: FormasPagamento },
    { id: "condicoes", rotulo: "Condições de pagamento", Tela: CondicoesPagamento },
    { id: "campanhas", rotulo: "Campanhas", Tela: Campanhas },
  ] },
  { id: "comercial", rotulo: "Comercial", abas: [
    { id: "locais", rotulo: "Locais de venda", Tela: PontosVenda },
  ] },
  { id: "contabil", rotulo: "Contábil", abas: [
    { id: "contas", rotulo: "Plano de contas", Tela: PlanoContas },
    { id: "tipos", rotulo: "Tipos contábeis", Tela: TiposContabeis },
    { id: "centros", rotulo: "Centros de custo", Tela: CentrosCusto },
    { id: "regras", rotulo: "Regras de contabilização", Tela: RegrasContabeis },
    { id: "orientacoes", rotulo: "Orientações contábeis", Tela: Orientacoes },
  ] },
  { id: "sistema", rotulo: "Sistema", abas: [
    { id: "igreja", rotulo: "Dados da igreja", Tela: DadosIgreja },
    { id: "layout", rotulo: "Layout", Tela: Layout },
    { id: "modulos", rotulo: "Módulos", Tela: Modulos },
    { id: "campos", rotulo: "Tamanho dos campos", Tela: NumeroNotas },
  ] },
];

export const ABAS_PARAMETROS = GRUPOS_PARAMETROS.flatMap((g) => g.abas.map((a) => ({ id: a.id, rotulo: a.rotulo, grupo: g.rotulo })));

