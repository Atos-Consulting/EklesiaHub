import { useMemo, useState } from "react";
import { lbl, inp, msgErro } from "../../estilos";
import ThOrdenavel from "../ThOrdenavel";
import { useOrdenacao } from "../useOrdenacao";
import { salvarPontoVenda, mensagemErro } from "../db";
import { CabecalhoAba, FormModal, CampoAtivo, Situacao, BotaoEditar } from "./comum";

// Parâmetros → Comercial → Locais de venda (v27): Cafeteria, Livraria, Bazar... Cada local diz em que conta caixa
// entra o dinheiro e em qual entram PIX, cartões e transferências quando o caixa do frente de loja é fechado.
// Quem pode abrir o caixa ou vender em cada local fica no cadastro do usuário (Sistema → Usuários).

const COLUNAS = {
  nome: (p) => p.nome,
  dinheiro: (p) => p.contaNome,
  eletronico: (p) => p.eletronicaNome,
  centro: (p) => p.centroNome,
  situacao: (p) => (p.ativo ? "Ativo" : "Inativo"),
};

export default function PontosVenda({ cadastros, onCadastrosMudaram }) {
  const [editando, setEditando] = useState(null);
  const nomeConta = useMemo(() => Object.fromEntries(cadastros.caixas.map((c) => [c.id, c.nome])), [cadastros.caixas]);
  const nomeCentro = useMemo(() => Object.fromEntries(cadastros.centros.map((c) => [c.id, c.nome])), [cadastros.centros]);
  const lista = useMemo(() => (cadastros.pontos || []).map((p) => ({
    ...p, contaNome: nomeConta[p.conta_caixa_id] ?? "—",
    eletronicaNome: p.conta_eletronica_id ? nomeConta[p.conta_eletronica_id] ?? "—" : "A mesma do dinheiro",
    centroNome: p.centro_custo_id ? nomeCentro[p.centro_custo_id] ?? "—" : "—",
  })), [cadastros.pontos, nomeConta, nomeCentro]);
  const ordenacao = useOrdenacao(lista, COLUNAS, { chave: "nome", dir: "asc" });

  return (
    <>
      <CabecalhoAba titulo="Locais de venda" acaoRotulo="Novo local" onAcao={() => setEditando("novo")}
        descricao="Onde o frente de loja funciona: cafeteria, livraria, bazar... Ao abrir o caixa, a pessoa escolhe o local e o dia. No fechamento, as vendas em dinheiro entram na conta caixa do dinheiro e as demais (PIX, cartões, transferência) na outra conta, se houver. Quem abre o caixa e quem vende em cada local é definido no cadastro de cada usuário, em Sistema → Usuários." />
      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <ThOrdenavel chave="nome" ordenacao={ordenacao}>Local</ThOrdenavel>
            <ThOrdenavel chave="dinheiro" ordenacao={ordenacao}>Dinheiro entra em</ThOrdenavel>
            <ThOrdenavel chave="eletronico" ordenacao={ordenacao}>PIX e cartões entram em</ThOrdenavel>
            <ThOrdenavel chave="centro" ordenacao={ordenacao}>Centro de custo</ThOrdenavel>
            <ThOrdenavel chave="situacao" ordenacao={ordenacao}>Situação</ThOrdenavel>
            <th className="acoes"><span className="sr-only">Ações</span></th>
          </tr></thead>
          <tbody>
            {ordenacao.ordenadas.length === 0 && <tr><td className="vazio" colSpan={6}>Nenhum local cadastrado. Cadastre a cafeteria, a livraria ou o bazar para usar o frente de loja.</td></tr>}
            {ordenacao.ordenadas.map((p) => (
              <tr key={p.id} style={!p.ativo ? { color: "var(--faint)" } : undefined}>
                <td style={{ fontWeight: 550 }}>{p.nome}</td>
                <td>{p.contaNome}</td>
                <td>{p.eletronicaNome}</td>
                <td>{p.centroNome}</td>
                <td><Situacao ativo={p.ativo} /></td>
                <td className="acoes"><BotaoEditar rotulo={p.nome} onClick={() => setEditando(p)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editando && <PontoForm ponto={editando === "novo" ? null : editando} cadastros={cadastros} onFechar={() => setEditando(null)}
        onSalvo={async () => { setEditando(null); await onCadastrosMudaram(); }} />}
    </>
  );
}

function PontoForm({ ponto, cadastros, onFechar, onSalvo }) {
  const [f, setF] = useState({
    nome: ponto?.nome ?? "", contaCaixaId: String(ponto?.conta_caixa_id ?? ""), contaEletronicaId: String(ponto?.conta_eletronica_id ?? ""),
    centroCustoId: String(ponto?.centro_custo_id ?? ""), ativo: ponto?.ativo ?? true,
  });
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const contas = cadastros.caixas.filter((c) => c.ativo || [f.contaCaixaId, f.contaEletronicaId].includes(String(c.id)));

  const erros = {};
  if (!f.nome.trim()) erros.nome = "Informe o nome do local";
  if (!f.contaCaixaId) erros.contaCaixaId = "Escolha a conta caixa do dinheiro";
  const borda = (k) => (tentou && erros[k] ? { borderColor: "var(--danger)" } : {});

  async function salvar() {
    setTentou(true);
    setErro("");
    if (Object.keys(erros).length) return;
    setSalvando(true);
    try { await onSalvo(await salvarPontoVenda(ponto?.id ?? null, f)); }
    catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }

  return (
    <FormModal titulo={ponto ? "Editar local de venda" : "Novo local de venda"} largura={560} onFechar={onFechar} onSalvar={salvar} salvando={salvando} erro={erro}>
      <label style={{ ...lbl, marginTop: 4 }} htmlFor="pv-nome">Nome *</label>
      <input id="pv-nome" autoFocus maxLength={80} style={{ ...inp, ...borda("nome") }} value={f.nome} onChange={set("nome")} placeholder="Ex.: Cafeteria, Livraria, Bazar" />
      {tentou && erros.nome && <div style={msgErro}>{erros.nome}</div>}

      <label style={lbl} htmlFor="pv-caixa">Conta caixa do dinheiro *</label>
      <select id="pv-caixa" style={{ ...inp, ...borda("contaCaixaId") }} value={f.contaCaixaId} onChange={set("contaCaixaId")}>
        <option value="">— Selecione —</option>
        {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.ativo ? "" : " (inativa)"}</option>)}
      </select>
      {tentou && erros.contaCaixaId && <div style={msgErro}>{erros.contaCaixaId}</div>}
      <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>Ex.: uma conta “Gaveta da cafeteria”, que depois você transfere para o cofre ou o banco.</div>

      <label style={lbl} htmlFor="pv-eletronica">Conta de PIX, cartões e transferências</label>
      <select id="pv-eletronica" style={inp} value={f.contaEletronicaId} onChange={set("contaEletronicaId")}>
        <option value="">A mesma do dinheiro</option>
        {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.ativo ? "" : " (inativa)"}</option>)}
      </select>

      <label style={lbl} htmlFor="pv-centro">Centro de custo</label>
      <select id="pv-centro" style={inp} value={f.centroCustoId} onChange={set("centroCustoId")}>
        <option value="">— Nenhum —</option>
        {cadastros.centros.filter((c) => c.ativo || String(c.id) === f.centroCustoId).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
      </select>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>Opcional. Na contabilidade, as vendas e o custo das mercadorias deste local saem com este centro.</div>

      <CampoAtivo ativo={f.ativo} onChange={(v) => setF((p) => ({ ...p, ativo: v }))} dica="local inativo não abre caixa" />
    </FormModal>
  );
}
