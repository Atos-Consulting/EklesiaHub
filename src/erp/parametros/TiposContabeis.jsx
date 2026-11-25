import { useMemo, useState } from "react";
import { lbl, inp, msgErro } from "../../estilos";
import ThOrdenavel from "../ThOrdenavel";
import { useOrdenacao } from "../useOrdenacao";
import { salvarTipoContabil, mensagemErro } from "../db";
import { CabecalhoAba, FormModal, CampoAtivo, Situacao, BotaoEditar } from "./comum";
import { rotuloConta } from "./rotulos";

export default function TiposContabeis({ cadastros, onCadastrosMudaram }) {
  const [editando, setEditando] = useState(null);
  const [busca, setBusca] = useState("");
  const conta = useMemo(() => new Map(cadastros.contas.map((c) => [c.id, c])), [cadastros.contas]);

  // Colunas dependem do plano de contas (para ordenar pelo código da conta, não pelo id).
  const colunas = useMemo(() => ({
    nome: (t) => t.nome,
    debito: (t) => conta.get(t.conta_debito_id)?.codigo,
    credito: (t) => conta.get(t.conta_credito_id)?.codigo,
    descricao: (t) => t.descricao,
    situacao: (t) => (t.ativo ? "Ativo" : "Inativo"),
  }), [conta]);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return cadastros.tipos.filter((x) => !t || x.nome.toLowerCase().includes(t) || (x.descricao || "").toLowerCase().includes(t));
  }, [cadastros.tipos, busca]);
  const ordenacao = useOrdenacao(filtrados, colunas, { chave: "nome", dir: "asc" });

  return (
    <>
      <CabecalhoAba titulo="Tipos contábeis" acaoRotulo="Novo tipo contábil" onAcao={() => setEditando("novo")}
        descricao="Cada item de nota escolhe um tipo contábil. O tipo define a contabilização: a conta debitada (onde o gasto é registrado) e a conta creditada (de onde sai o valor, em geral Caixa/Bancos ou Fornecedores a pagar)." />
      <div className="toolbar">
        <label style={{ flex: "1 1 240px", maxWidth: 340 }}>Buscar
          <input placeholder="Nome ou descrição" value={busca} onChange={(e) => setBusca(e.target.value)} style={inp} />
        </label>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <ThOrdenavel chave="nome" ordenacao={ordenacao}>Tipo</ThOrdenavel>
            <ThOrdenavel chave="debito" ordenacao={ordenacao}>Conta de débito</ThOrdenavel>
            <ThOrdenavel chave="credito" ordenacao={ordenacao}>Conta de crédito</ThOrdenavel>
            <ThOrdenavel chave="descricao" ordenacao={ordenacao}>Descrição</ThOrdenavel>
            <ThOrdenavel chave="situacao" ordenacao={ordenacao}>Situação</ThOrdenavel>
            <th className="acoes"><span className="sr-only">Ações</span></th>
          </tr></thead>
          <tbody>
            {ordenacao.ordenadas.length === 0 && <tr><td className="vazio" colSpan={6}>Nenhum tipo contábil encontrado.</td></tr>}
            {ordenacao.ordenadas.map((t) => (
              <tr key={t.id} style={!t.ativo ? { color: "var(--faint)" } : undefined}>
                <td style={{ fontWeight: 550 }}>{t.nome}</td>
                <td>{rotuloConta(conta.get(t.conta_debito_id))}</td>
                <td>{rotuloConta(conta.get(t.conta_credito_id))}</td>
                <td className="truncate muted">{t.descricao}</td>
                <td><Situacao ativo={t.ativo} /></td>
                <td className="acoes"><BotaoEditar rotulo={t.nome} onClick={() => setEditando(t)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editando && <TipoForm tipo={editando === "novo" ? null : editando} contas={cadastros.contas} onFechar={() => setEditando(null)}
        onSalvo={async () => { setEditando(null); await onCadastrosMudaram(); }} />}
    </>
  );
}

function TipoForm({ tipo, contas, onFechar, onSalvo }) {
  const [f, setF] = useState({
    nome: tipo?.nome ?? "", descricao: tipo?.descricao ?? "", ativo: tipo?.ativo ?? true,
    contaDebitoId: tipo ? String(tipo.conta_debito_id) : "", contaCreditoId: tipo ? String(tipo.conta_credito_id) : "",
  });
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  // Débito: onde o gasto é registrado (despesa ou ativo, como estoque/imobilizado). Crédito: de onde sai o valor (ativo ou passivo).
  const analiticas = contas.filter((c) => c.analitica && (c.ativo || [String(tipo?.conta_debito_id), String(tipo?.conta_credito_id)].includes(String(c.id))));
  const opcoesDebito = analiticas.filter((c) => c.natureza === "despesa" || c.natureza === "ativo");
  const opcoesCredito = analiticas.filter((c) => c.natureza === "ativo" || c.natureza === "passivo");

  const erros = {};
  if (!f.nome.trim()) erros.nome = "Informe o nome";
  if (!f.contaDebitoId) erros.contaDebitoId = "Escolha a conta de débito";
  if (!f.contaCreditoId) erros.contaCreditoId = "Escolha a conta de crédito";
  else if (f.contaDebitoId === f.contaCreditoId) erros.contaCreditoId = "Débito e crédito precisam ser contas diferentes";

  async function salvar() {
    setTentou(true);
    setErro("");
    if (Object.keys(erros).length) return;
    setSalvando(true);
    try { await salvarTipoContabil(tipo?.id ?? null, f); await onSalvo(); }
    catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }

  const borda = (k) => (tentou && erros[k] ? { borderColor: "var(--danger)" } : {});
  const seletor = (k, id, rotulo, opcoes, dica) => (
    <>
      <label style={lbl} htmlFor={id}>{rotulo} *</label>
      <select id={id} style={{ ...inp, ...borda(k) }} value={f[k]} onChange={(e) => setF((p) => ({ ...p, [k]: e.target.value }))}>
        <option value="">— Selecione —</option>
        {opcoes.map((c) => <option key={c.id} value={c.id}>{c.codigo} — {c.nome}{c.ativo ? "" : " (inativa)"}</option>)}
      </select>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 5 }}>{dica}</div>
      {tentou && erros[k] && <div style={msgErro}>{erros[k]}</div>}
    </>
  );

  return (
    <FormModal titulo={tipo ? "Editar tipo contábil" : "Novo tipo contábil"} largura={600} onFechar={onFechar} onSalvar={salvar} salvando={salvando} erro={erro}>
      <label style={{ ...lbl, marginTop: 4 }} htmlFor="tc-nome">Nome *</label>
      <input id="tc-nome" autoFocus style={{ ...inp, ...borda("nome") }} value={f.nome} maxLength={80} onChange={(e) => setF((p) => ({ ...p, nome: e.target.value }))} />
      {tentou && erros.nome && <div style={msgErro}>{erros.nome}</div>}

      <label style={lbl} htmlFor="tc-desc">Descrição</label>
      <input id="tc-desc" style={inp} value={f.descricao} maxLength={160} onChange={(e) => setF((p) => ({ ...p, descricao: e.target.value }))} placeholder="Quando usar este tipo" />

      {seletor("contaDebitoId", "tc-debito", "Conta de débito", opcoesDebito, "Onde o gasto é registrado: despesa (consumo) ou ativo (estoque, imobilizado).")}
      {seletor("contaCreditoId", "tc-credito", "Conta de crédito", opcoesCredito, "De onde sai o valor: Caixa/Bancos (ativo) ou Fornecedores a pagar (passivo).")}
      <CampoAtivo ativo={f.ativo} onChange={(v) => setF((p) => ({ ...p, ativo: v }))} dica="tipos inativos não podem ser escolhidos em novas notas" />
      <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
        Mudar as contas de um tipo vale para notas novas; itens de notas já lançadas guardam as contas da época.
      </div>
    </FormModal>
  );
}
