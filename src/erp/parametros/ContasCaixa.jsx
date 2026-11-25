import { useMemo, useState } from "react";
import { lbl, inp, msgErro } from "../../estilos";
import ThOrdenavel from "../ThOrdenavel";
import { useOrdenacao } from "../useOrdenacao";
import { salvarContaCaixa, mensagemErro } from "../db";
import { formatarMoeda, formatarData, hojeISO, lerNumero, numeroParaCampo, somarValores } from "../format";
import { CabecalhoAba, FormModal, CampoAtivo, Situacao, BotaoEditar } from "./comum";
import { rotuloConta } from "./rotulos";

export default function ContasCaixa({ cadastros, onCadastrosMudaram }) {
  const [editando, setEditando] = useState(null);
  const [busca, setBusca] = useState("");
  const conta = useMemo(() => new Map(cadastros.contas.map((c) => [c.id, c])), [cadastros.contas]);
  const colunas = useMemo(() => ({
    nome: (c) => c.nome,
    banco: (c) => c.banco,
    agencia: (c) => [c.agencia, c.numero_conta].filter(Boolean).join(" / "),
    conta: (c) => conta.get(c.conta_contabil_id)?.codigo,
    inicial: (c) => Number(c.saldo_inicial),
    saidas: (c) => Number(c.total_saidas),
    saldo: (c) => Number(c.saldo_atual),
    situacao: (c) => (c.ativo ? "Ativo" : "Inativo"),
  }), [conta]);

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return cadastros.caixas.filter((c) => !t || c.nome.toLowerCase().includes(t) || (c.banco || "").toLowerCase().includes(t));
  }, [cadastros.caixas, busca]);
  const ordenacao = useOrdenacao(filtradas, colunas, { chave: "nome", dir: "asc" });
  const saldoTotal = somarValores(filtradas.filter((c) => c.ativo).map((c) => Number(c.saldo_atual)));

  return (
    <>
      <CabecalhoAba titulo="Contas caixa" acaoRotulo="Nova conta caixa" onAcao={() => setEditando("novo")}
        descricao="Caixas e contas bancárias de onde saem os pagamentos das notas. Cada uma tem saldo inicial e dados do banco; o saldo atual desconta as notas aprovadas a partir da data do saldo inicial." />
      <div className="toolbar">
        <label style={{ flex: "1 1 240px", maxWidth: 340 }}>Buscar
          <input placeholder="Nome da conta ou banco" value={busca} onChange={(e) => setBusca(e.target.value)} style={inp} />
        </label>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <ThOrdenavel chave="nome" ordenacao={ordenacao}>Conta caixa</ThOrdenavel>
            <ThOrdenavel chave="banco" ordenacao={ordenacao}>Banco</ThOrdenavel>
            <ThOrdenavel chave="agencia" ordenacao={ordenacao}>Agência / Conta</ThOrdenavel>
            <ThOrdenavel chave="conta" ordenacao={ordenacao}>Conta contábil</ThOrdenavel>
            <ThOrdenavel chave="inicial" ordenacao={ordenacao} className="num">Saldo inicial</ThOrdenavel>
            <ThOrdenavel chave="saidas" ordenacao={ordenacao} className="num">Saídas (notas)</ThOrdenavel>
            <ThOrdenavel chave="saldo" ordenacao={ordenacao} className="num">Saldo atual</ThOrdenavel>
            <ThOrdenavel chave="situacao" ordenacao={ordenacao}>Situação</ThOrdenavel>
            <th className="acoes"><span className="sr-only">Ações</span></th>
          </tr></thead>
          <tbody>
            {ordenacao.ordenadas.length === 0 && <tr><td className="vazio" colSpan={9}>Nenhuma conta caixa encontrada.</td></tr>}
            {ordenacao.ordenadas.map((c) => (
              <tr key={c.id} style={!c.ativo ? { color: "var(--faint)" } : undefined}>
                <td style={{ fontWeight: 550 }}>{c.nome}<div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>desde {formatarData(c.data_saldo_inicial)}</div></td>
                <td>{c.banco || "—"}</td>
                <td>{[c.agencia, c.numero_conta].filter(Boolean).join(" / ") || "—"}</td>
                <td>{rotuloConta(conta.get(c.conta_contabil_id))}</td>
                <td className="num">{formatarMoeda(c.saldo_inicial)}</td>
                <td className="num">{formatarMoeda(c.total_saidas)}</td>
                <td className="num" style={{ fontWeight: 650, color: Number(c.saldo_atual) < 0 ? "var(--danger)" : undefined }}>{formatarMoeda(c.saldo_atual)}</td>
                <td><Situacao ativo={c.ativo} /></td>
                <td className="acoes"><BotaoEditar rotulo={c.nome} onClick={() => setEditando(c)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtradas.length > 0 && <div className="table-footer"><span>{filtradas.length} conta(s)</span><span>Saldo das contas ativas: <strong>{formatarMoeda(saldoTotal)}</strong></span></div>}
      {editando && <CaixaForm caixa={editando === "novo" ? null : editando} contas={cadastros.contas} onFechar={() => setEditando(null)}
        onSalvo={async () => { setEditando(null); await onCadastrosMudaram(); }} />}
    </>
  );
}

function CaixaForm({ caixa, contas, onFechar, onSalvo }) {
  const [f, setF] = useState({
    nome: caixa?.nome ?? "", banco: caixa?.banco ?? "", agencia: caixa?.agencia ?? "", numeroConta: caixa?.numero_conta ?? "",
    saldoInicial: caixa ? numeroParaCampo(Number(caixa.saldo_inicial)) : "0,00", dataSaldoInicial: caixa?.data_saldo_inicial ?? hojeISO(),
    contaContabilId: caixa?.conta_contabil_id ? String(caixa.conta_contabil_id) : "", ativo: caixa?.ativo ?? true,
  });
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const opcoes = contas.filter((c) => c.analitica && c.natureza === "ativo" && (c.ativo || String(c.id) === f.contaContabilId));
  const saldo = lerNumero(f.saldoInicial);
  const erros = {};
  if (!f.nome.trim()) erros.nome = "Informe o nome da conta caixa";
  if (!Number.isFinite(saldo)) erros.saldoInicial = "Valor inválido";
  if (!f.dataSaldoInicial) erros.dataSaldoInicial = "Informe a data";

  async function salvar() {
    setTentou(true);
    setErro("");
    if (Object.keys(erros).length) return;
    setSalvando(true);
    try { await salvarContaCaixa(caixa?.id ?? null, { ...f, saldoInicial: saldo }); await onSalvo(); }
    catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }
  const borda = (k) => (tentou && erros[k] ? { borderColor: "var(--danger)" } : {});

  return (
    <FormModal titulo={caixa ? "Editar conta caixa" : "Nova conta caixa"} largura={620} onFechar={onFechar} onSalvar={salvar} salvando={salvando} erro={erro}>
      <label style={{ ...lbl, marginTop: 4 }} htmlFor="cx-nome">Nome da conta caixa *</label>
      <input id="cx-nome" autoFocus style={{ ...inp, ...borda("nome") }} value={f.nome} maxLength={80} onChange={set("nome")} placeholder="Ex.: Caixa geral, Banco do Brasil c/c" />
      {tentou && erros.nome && <div style={msgErro}>{erros.nome}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0 12px" }}>
        <div><label style={lbl} htmlFor="cx-banco">Banco</label><input id="cx-banco" style={inp} value={f.banco} maxLength={60} onChange={set("banco")} placeholder="Ex.: Banco do Brasil" /></div>
        <div><label style={lbl} htmlFor="cx-ag">Agência</label><input id="cx-ag" style={inp} value={f.agencia} maxLength={20} onChange={set("agencia")} /></div>
        <div><label style={lbl} htmlFor="cx-conta">Conta</label><input id="cx-conta" style={inp} value={f.numeroConta} maxLength={30} onChange={set("numeroConta")} /></div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0 12px" }}>
        <div>
          <label style={lbl} htmlFor="cx-saldo">Saldo inicial (R$) *</label>
          <input id="cx-saldo" inputMode="decimal" style={{ ...inp, textAlign: "right", ...borda("saldoInicial") }} value={f.saldoInicial} onChange={set("saldoInicial")} />
          {tentou && erros.saldoInicial && <div style={msgErro}>{erros.saldoInicial}</div>}
        </div>
        <div>
          <label style={lbl} htmlFor="cx-data">Data do saldo inicial *</label>
          <input id="cx-data" type="date" style={{ ...inp, ...borda("dataSaldoInicial") }} value={f.dataSaldoInicial} onChange={set("dataSaldoInicial")} />
          {tentou && erros.dataSaldoInicial && <div style={msgErro}>{erros.dataSaldoInicial}</div>}
        </div>
      </div>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
        O saldo atual = saldo inicial − notas aprovadas com data de entrada a partir desta data. {caixa && "Alterar estes dois campos recalcula o saldo."}
      </div>

      <label style={lbl} htmlFor="cx-contabil">Conta contábil vinculada</label>
      <select id="cx-contabil" style={inp} value={f.contaContabilId} onChange={set("contaContabilId")}>
        <option value="">— Nenhuma —</option>
        {opcoes.map((c) => <option key={c.id} value={c.id}>{c.codigo} — {c.nome}</option>)}
      </select>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 5 }}>Conta do plano (ativo) que representa este caixa ou banco, ex.: 1.1.01 Caixa, 1.1.02 Bancos.</div>
      <CampoAtivo ativo={f.ativo} onChange={(v) => setF((p) => ({ ...p, ativo: v }))} dica="contas inativas não aceitam novas notas" />
    </FormModal>
  );
}
