import { useMemo, useState } from "react";
import { Pill } from "../../ui";
import { lbl, inp, msgErro } from "../../estilos";
import ThOrdenavel from "../ThOrdenavel";
import { useOrdenacao } from "../useOrdenacao";
import { salvarCondicaoPagamento, mensagemErro } from "../db";
import { formatarMoeda, formatarData, hojeISO } from "../format";
import { TIPOS_CONDICAO, nomeForma, resumoCondicao, gerarParcelas } from "../financeiro";
import FormaSelect from "../FormaSelect";
import { CabecalhoAba, FormModal, CampoAtivo, Situacao, BotaoEditar } from "./comum";

const COLUNAS = {
  nome: (c) => c.nome,
  tipo: (c) => TIPOS_CONDICAO[c.tipo],
  forma: (c) => c.forma_nome,
  parcelas: (c) => c.parcelas,
  prazo: (c) => c.dias_primeira,
  intervalo: (c) => (c.parcelas > 1 ? c.intervalo_dias : null),
  situacao: (c) => (c.ativo ? "Ativo" : "Inativo"),
};

export default function CondicoesPagamento({ cadastros, onCadastrosMudaram }) {
  const [editando, setEditando] = useState(null);
  const [busca, setBusca] = useState("");
  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return cadastros.condicoes.filter((c) => !t || c.nome.toLowerCase().includes(t))
      .map((c) => ({ ...c, forma_nome: nomeForma(cadastros.formas, c.forma_pagamento_id, c.forma_pagamento) }));
  }, [cadastros.condicoes, cadastros.formas, busca]);
  const ordenacao = useOrdenacao(filtradas, COLUNAS, { chave: "nome", dir: "asc" });

  return (
    <>
      <CabecalhoAba titulo="Condições de pagamento" acaoRotulo="Nova condição" onAcao={() => setEditando("novo")}
        descricao="Como as notas de entrada são pagas: à vista (sai da conta caixa na aprovação) ou parcelado (gera as parcelas em Financeiro → Lançamentos (a pagar), com vencimentos contados a partir da emissão da nota)." />
      <div className="toolbar">
        <label style={{ flex: "1 1 240px", maxWidth: 340 }}>Buscar
          <input placeholder="Nome da condição" value={busca} onChange={(e) => setBusca(e.target.value)} style={inp} />
        </label>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <ThOrdenavel chave="nome" ordenacao={ordenacao}>Condição</ThOrdenavel>
            <ThOrdenavel chave="tipo" ordenacao={ordenacao}>Tipo</ThOrdenavel>
            <ThOrdenavel chave="forma" ordenacao={ordenacao}>Forma</ThOrdenavel>
            <ThOrdenavel chave="parcelas" ordenacao={ordenacao} className="num">Parcelas</ThOrdenavel>
            <ThOrdenavel chave="prazo" ordenacao={ordenacao} className="num">1ª parcela</ThOrdenavel>
            <ThOrdenavel chave="intervalo" ordenacao={ordenacao} className="num">Intervalo</ThOrdenavel>
            <ThOrdenavel chave="situacao" ordenacao={ordenacao}>Situação</ThOrdenavel>
            <th className="acoes"><span className="sr-only">Ações</span></th>
          </tr></thead>
          <tbody>
            {ordenacao.ordenadas.length === 0 && <tr><td className="vazio" colSpan={8}>Nenhuma condição de pagamento encontrada.</td></tr>}
            {ordenacao.ordenadas.map((c) => (
              <tr key={c.id} style={!c.ativo ? { color: "var(--faint)" } : undefined}>
                <td style={{ fontWeight: 550 }}>{c.nome}<div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{resumoCondicao(c)}</div></td>
                <td><Pill tone={c.tipo === "a_vista" ? "ok" : "neutral"}>{TIPOS_CONDICAO[c.tipo]}</Pill></td>
                <td>{c.forma_nome || "—"}</td>
                <td className="num">{c.parcelas}</td>
                <td className="num">{c.tipo === "a_vista" ? "no ato" : `${c.dias_primeira} dia(s)`}</td>
                <td className="num">{c.parcelas > 1 ? `${c.intervalo_dias} dia(s)` : "—"}</td>
                <td><Situacao ativo={c.ativo} /></td>
                <td className="acoes"><BotaoEditar rotulo={c.nome} onClick={() => setEditando(c)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtradas.length > 0 && <div className="table-footer"><span>{filtradas.length} condição(ões)</span></div>}
      {editando && <CondicaoForm condicao={editando === "novo" ? null : editando} formas={cadastros.formas} onFechar={() => setEditando(null)}
        onSalvo={async () => { setEditando(null); await onCadastrosMudaram(); }} />}
    </>
  );
}

// Também usado direto da nota de entrada (botão "Nova"), para não sair da tela.
export function CondicaoForm({ condicao, formas, onFechar, onSalvo }) {
  const formaDoTipo = (tipo) => (formas || []).find((x) => x.ativo && x.tipo === tipo);
  const [f, setF] = useState({
    nome: condicao?.nome ?? "", tipo: condicao?.tipo ?? "parcelado", formaPagamento: condicao ? String(condicao.forma_pagamento_id ?? "") : String(formaDoTipo("boleto")?.id ?? ""),
    parcelas: String(condicao?.parcelas ?? 1), diasPrimeira: String(condicao?.dias_primeira ?? 30),
    intervaloDias: String(condicao?.intervalo_dias ?? 30), ativo: condicao?.ativo ?? true,
  });
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const aVista = f.tipo === "a_vista";
  const inteiro = (v) => (/^\d+$/.test(String(v).trim()) ? Number(v) : NaN);
  const parcelas = aVista ? 1 : inteiro(f.parcelas);
  const dias = aVista ? 0 : inteiro(f.diasPrimeira);
  const intervalo = inteiro(f.intervaloDias);

  const erros = {};
  if (!f.nome.trim()) erros.nome = "Informe o nome da condição";
  if (!aVista && !(parcelas >= 1 && parcelas <= 120)) erros.parcelas = "De 1 a 120 parcelas";
  if (!aVista && !(dias >= 0 && dias <= 3650)) erros.diasPrimeira = "De 0 a 3650 dias";
  if (!aVista && parcelas > 1 && !(intervalo >= 1 && intervalo <= 365)) erros.intervaloDias = "De 1 a 365 dias";

  const exemplo = Object.keys(erros).length || aVista ? [] : gerarParcelas(
    { tipo: f.tipo, parcelas, dias_primeira: dias, intervalo_dias: parcelas > 1 ? intervalo : 30 },
    { emissao: hojeISO(), entrada: hojeISO(), centavos: 100000 });

  // À vista raramente é boleto: troca a forma sugerida para dinheiro.
  function mudarTipo(tipo) {
    const ehBoleto = (formas || []).find((x) => String(x.id) === String(f.formaPagamento))?.tipo === "boleto";
    setF((p) => ({ ...p, tipo, ...(tipo === "a_vista" && ehBoleto ? { formaPagamento: String(formaDoTipo("dinheiro")?.id ?? "") } : {}) }));
  }

  async function salvar() {
    setTentou(true);
    setErro("");
    if (Object.keys(erros).length) return;
    setSalvando(true);
    try {
      const salvo = await salvarCondicaoPagamento(condicao?.id ?? null, {
        ...f, parcelas, diasPrimeira: dias, intervaloDias: parcelas > 1 ? intervalo : (condicao?.intervalo_dias ?? 30),
      });
      await onSalvo(salvo);
    } catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }
  const borda = (k) => (tentou && erros[k] ? { borderColor: "var(--danger)" } : {});
  const ajuda = { fontSize: 12, marginTop: 4 };

  return (
    <FormModal titulo={condicao ? "Editar condição de pagamento" : "Nova condição de pagamento"} largura={600} onFechar={onFechar} onSalvar={salvar} salvando={salvando} erro={erro}>
      <label style={{ ...lbl, marginTop: 4 }} htmlFor="cp-nome">Nome *</label>
      <input id="cp-nome" autoFocus style={{ ...inp, ...borda("nome") }} value={f.nome} maxLength={60} onChange={set("nome")} placeholder="Ex.: À vista, 30 dias, 3x boleto" />
      {tentou && erros.nome && <div style={msgErro}>{erros.nome}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 12px" }}>
        <div>
          <label style={lbl} htmlFor="cp-tipo">Tipo *</label>
          <select id="cp-tipo" style={inp} value={f.tipo} onChange={(e) => mudarTipo(e.target.value)}>
            {Object.entries(TIPOS_CONDICAO).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl} htmlFor="cp-forma">Forma de pagamento</label>
          <FormaSelect id="cp-forma" style={inp} formas={formas} value={f.formaPagamento} onChange={(v) => setF((p) => ({ ...p, formaPagamento: v }))} vazio="— Não informada —" />
        </div>
      </div>

      {aVista ? (
        <div className="alert alert-ok" style={{ marginTop: 14 }}>
          <span>À vista: uma parcela, considerada <strong>paga na aprovação da nota</strong>, saindo da conta caixa informada na nota.</span>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0 12px" }}>
            <div>
              <label style={lbl} htmlFor="cp-parcelas">Quantidade de parcelas *</label>
              <input id="cp-parcelas" inputMode="numeric" style={{ ...inp, textAlign: "right", ...borda("parcelas") }} value={f.parcelas} onChange={set("parcelas")} />
              {tentou && erros.parcelas && <div style={msgErro}>{erros.parcelas}</div>}
            </div>
            <div>
              <label style={lbl} htmlFor="cp-dias">1ª parcela em (dias) *</label>
              <input id="cp-dias" inputMode="numeric" style={{ ...inp, textAlign: "right", ...borda("diasPrimeira") }} value={f.diasPrimeira} onChange={set("diasPrimeira")} />
              {tentou && erros.diasPrimeira ? <div style={msgErro}>{erros.diasPrimeira}</div> : <div className="muted" style={ajuda}>contados da emissão da nota</div>}
            </div>
            <div>
              <label style={lbl} htmlFor="cp-intervalo">Intervalo entre parcelas (dias)</label>
              <input id="cp-intervalo" inputMode="numeric" disabled={parcelas === 1} style={{ ...inp, textAlign: "right", ...borda("intervaloDias") }} value={parcelas === 1 ? "—" : f.intervaloDias} onChange={set("intervaloDias")} />
              {tentou && erros.intervaloDias && <div style={msgErro}>{erros.intervaloDias}</div>}
            </div>
          </div>
          {exemplo.length > 0 && (
            <div className="painel" style={{ paddingTop: 10 }}>
              <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>Exemplo: nota de {formatarMoeda(1000)} emitida hoje</div>
              <table className="parcelas">
                <thead><tr><th>Parcela</th><th>Vencimento</th><th className="num">Valor</th></tr></thead>
                <tbody>
                  {exemplo.slice(0, 6).map((p) => <tr key={p.parcela}><td>{p.parcela}/{exemplo.length}</td><td>{formatarData(p.vencimento)}</td><td className="num">{formatarMoeda(p.valor)}</td></tr>)}
                  {exemplo.length > 6 && <tr><td colSpan={3} className="muted">… mais {exemplo.length - 6} parcela(s)</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <CampoAtivo ativo={f.ativo} onChange={(v) => setF((p) => ({ ...p, ativo: v }))} dica="condições inativas não aparecem em notas novas" />
    </FormModal>
  );
}
