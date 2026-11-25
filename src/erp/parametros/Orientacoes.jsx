import { Pill } from "../../ui";
import Icone from "../Icone";
import { CabecalhoAba } from "./comum";

// Guia rápido de contabilidade para quem cadastra contas, tipos contábeis e notas.
const GRUPOS = [
  { natureza: "Ativo", codigo: "1", tom: "ok", oQue: "O que a igreja tem e o que tem a receber: dinheiro, bancos, estoque, imóveis, equipamentos.",
    aumenta: "Débito", diminui: "Crédito", exemplos: "1.1.01 Caixa · 1.1.02 Bancos · 1.1.03 Estoques · 1.2.01 Imobilizado" },
  { natureza: "Passivo", codigo: "2", tom: "warn", oQue: "O que a igreja deve: fornecedores a pagar, salários, impostos e contribuições a recolher.",
    aumenta: "Crédito", diminui: "Débito", exemplos: "2.1.01 Fornecedores a pagar · 2.1.02 Obrigações trabalhistas e tributárias" },
  { natureza: "Patrimônio social", codigo: "3", tom: "neutral", oQue: "O patrimônio da igreja: o que sobra depois de pagar o que deve. Recebe o superávit (ou déficit) de cada exercício.",
    aumenta: "Crédito", diminui: "Débito", exemplos: "3.1 Patrimônio social · 3.2 Superávit/Déficit do exercício" },
  { natureza: "Receita", codigo: "4", tom: "ok", oQue: "Tudo que entra e aumenta o patrimônio: dízimos, ofertas, campanhas, vendas da livraria e do bazar.",
    aumenta: "Crédito", diminui: "Débito", exemplos: "4.1.01 Dízimos · 4.1.02 Ofertas · 4.2.01 Vendas livraria e bazar" },
  { natureza: "Despesa", codigo: "5", tom: "danger", oQue: "Tudo que se gasta para manter a igreja funcionando: consumo, serviços, pessoal, eventos, missões.",
    aumenta: "Débito", diminui: "Crédito", exemplos: "5.1.01 Água, luz e telefone · 5.2.01 Prebendas e salários · 5.3.02 Missões e ação social" },
];

const EXEMPLOS = [
  { titulo: "Conta de luz de R$ 500, paga do caixa", tipo: "Água, luz e telefone", debito: "5.1.01 Água, luz e telefone", credito: "1.1.01 Caixa",
    texto: "A despesa aumenta (débito) e o dinheiro do caixa diminui (crédito)." },
  { titulo: "Compra de livros para a livraria, R$ 2.000", tipo: "Compra de mercadorias para revenda", debito: "1.1.03 Estoques", credito: "1.1.01 Caixa",
    texto: "Mercadoria para revenda não é despesa: vai para o estoque (ativo) e só vira custo quando for vendida." },
  { titulo: "Compra de uma mesa de som, R$ 8.000", tipo: "Aquisição de bens (imobilizado)", debito: "1.2.01 Imobilizado", credito: "1.1.01 Caixa",
    texto: "Bem de uso duradouro também entra no ativo, não na despesa." },
  { titulo: "Serviço contratado para pagar no mês seguinte", tipo: "Serviços de terceiros (crédito em Fornecedores a pagar)", debito: "5.1.03 Serviços de terceiros", credito: "2.1.01 Fornecedores a pagar",
    texto: "A despesa existe já, mas o dinheiro ainda não saiu: a dívida fica no passivo até o pagamento." },
];

export default function Orientacoes() {
  return (
    <>
      <CabecalhoAba titulo="Orientações contábeis"
        descricao="Guia de apoio para montar o plano de contas e os tipos contábeis. Em caso de dúvida sobre o tratamento de uma operação, confirme com o contador da igreja." />

      <div style={{ padding: "0 24px 24px" }}>
        <h3 className="section-title" style={{ marginTop: 4 }}>Como ler uma conta</h3>
        <p style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.6, maxWidth: 760 }}>
          Todo fato contábil é registrado duas vezes (partidas dobradas): em uma conta que é <strong>debitada</strong> e em outra que é{" "}
          <strong>creditada</strong>, pelo mesmo valor. Débito e crédito não significam &quot;ruim&quot; ou &quot;bom&quot;: cada grupo de contas aumenta de um lado.
          O <strong>tipo contábil</strong> escolhido em cada item da nota define quais são essas duas contas, e a conta caixa da nota mostra de onde o dinheiro sai.
        </p>

        <h3 className="section-title">Grupos de contas</h3>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Grupo</th><th>O que é</th><th>Aumenta com</th><th>Diminui com</th><th>Exemplos</th></tr></thead>
            <tbody>
              {GRUPOS.map((g) => (
                <tr key={g.natureza}>
                  <td style={{ whiteSpace: "nowrap" }}><Pill tone={g.tom}>{g.codigo} · {g.natureza}</Pill></td>
                  <td style={{ minWidth: 260 }}>{g.oQue}</td>
                  <td style={{ fontWeight: 600 }}>{g.aumenta}</td>
                  <td style={{ fontWeight: 600 }}>{g.diminui}</td>
                  <td className="muted" style={{ minWidth: 220 }}>{g.exemplos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="section-title">Conta sintética e conta analítica</h3>
        <p style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.6, maxWidth: 760 }}>
          <strong>Sintética</strong> é uma conta de agrupamento (ex.: 5.1 Despesas administrativas) — só soma o que está abaixo dela.{" "}
          <strong>Analítica</strong> é a conta que recebe os lançamentos (ex.: 5.1.01 Água, luz e telefone). Só contas analíticas aparecem nos tipos contábeis e nas contas caixa.
          O código segue a hierarquia: filhas começam com o código do pai (5.1 → 5.1.01).
        </p>

        <h3 className="section-title">Exemplos de contabilização das notas</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
          {EXEMPLOS.map((e) => (
            <div key={e.titulo} className="card" style={{ padding: 16 }}>
              <div style={{ fontWeight: 650, fontSize: 14 }}>{e.titulo}</div>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>Tipo contábil: {e.tipo}</div>
              <div style={{ display: "grid", gap: 6, marginTop: 10, fontSize: 13.5 }}>
                <div><Pill tone="neutral">Débito</Pill> <span style={{ marginLeft: 6 }}>{e.debito}</span></div>
                <div><Pill tone="neutral">Crédito</Pill> <span style={{ marginLeft: 6 }}>{e.credito}</span></div>
              </div>
              <p className="muted" style={{ fontSize: 12.5, margin: "10px 0 0", lineHeight: 1.5 }}>{e.texto}</p>
            </div>
          ))}
        </div>

        <div className="alert alert-warn" style={{ marginTop: 20 }}>
          <Icone nome="livro" tamanho={16} />
          <span>Este guia é uma orientação geral e não substitui o contador. Ajuste o plano de contas ao padrão adotado pela sua igreja (ITG 2002 para entidades sem fins lucrativos).</span>
        </div>
      </div>
    </>
  );
}
