import { useMemo, useState } from "react";
import { Header, Pill } from "../ui";
import { inp, lbl } from "../estilos";
import Icone from "./Icone";
import Modal from "./Modal";
import ThOrdenavel from "./ThOrdenavel";
import { useOrdenacao } from "./useOrdenacao";
import { useCarga } from "./useCarga";
import { Indicador } from "./ContasPagar";
import { carregarOrcamento, listarOrcamento, salvarOrcamento, mensagemErro } from "./db";
import { formatarMoeda, formatarData, hojeISO, lerNumero, numeroParaCampo, paraCentavos, deCentavos } from "./format";
import {
  CATEGORIAS_RECEITA, rotuloCategoria, SEM_CENTRO, MESES_CURTOS, MESES_LONGOS, SITUACOES,
  juntarOrcamento, medirLinha, mesPadrao, dividirAno, reajustar, somaMeses, chaveLinha,
} from "./calculoOrcamento";

// Financeiro → Orçamento (v23): quanto a igreja prevê gastar por centro de custo e receber por tipo no ano,
// comparado com o que já entrou e saiu (regime de caixa, como o Relatório do mês) e com o que está em aberto.
// Só avisa: nada é bloqueado quando um centro passa do previsto. Só o Administrador monta o orçamento.

const moeda = (c) => formatarMoeda(deCentavos(c));
const moedaOuTraco = (c) => (c ? moeda(c) : "—");
const ORDEM_SITUACAO = { estourado: 0, acima: 1, abaixo: 1, sem_orcamento: 2, ok: 3, vazio: 4 };

const COLUNAS = {
  nome: (l) => l.nome,
  orcAno: (l) => l.m.orcAno,
  orcAte: (l) => l.m.orcAte,
  realAte: (l) => l.m.realAte,
  aberto: (l) => l.m.abertoAno,
  disponivel: (l) => l.m.disponivel,
  pct: (l) => l.m.pct,
  situacao: (l) => ORDEM_SITUACAO[l.m.situacao],
};

function Barra({ pct, situacao }) {
  if (pct === null) return <span className="muted">—</span>;
  const tom = situacao === "estourado" ? "perigo" : situacao === "acima" || situacao === "abaixo" ? "alerta" : "";
  return (
    <div className="orc-uso" title={`${Math.round(pct * 100)}%`}>
      <div className="orc-barra"><i className={tom} style={{ width: `${Math.min(100, Math.round(pct * 100))}%` }} /></div>
      <span>{Math.round(pct * 100)}%</span>
    </div>
  );
}

function TabelaOrcamento({ titulo, descricao, linhas, ateMes, natureza, onAbrir }) {
  const despesa = natureza === "despesa";
  const ordenacao = useOrdenacao(linhas, COLUNAS, { chave: "situacao", dir: "asc" });
  const mes = MESES_CURTOS[ateMes - 1];
  const tot = linhas.reduce((a, l) => {
    for (const k of ["orcAno", "orcAte", "realAte", "abertoAno"]) a[k] += l.m[k];
    if (l.m.orcAno) a.disponivel += l.m.disponivel; // sem orçamento não entra no disponível
    return a;
  }, { orcAno: 0, orcAte: 0, realAte: 0, abertoAno: 0, disponivel: 0 });
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="painel-cab" style={{ padding: "14px 16px 0" }}>
        <h3 style={{ margin: 0 }}>{titulo}</h3>
      </div>
      <p className="muted" style={{ margin: "4px 16px 10px", fontSize: 13 }}>{descricao}</p>
      <div className="table-wrap">
        <table className="table orc-tabela">
          <thead>
            <tr>
              <ThOrdenavel chave="nome" ordenacao={ordenacao}>{despesa ? "Centro de custo" : "Tipo de receita"}</ThOrdenavel>
              <ThOrdenavel chave="orcAno" ordenacao={ordenacao} className="num">Orçado no ano</ThOrdenavel>
              <ThOrdenavel chave="orcAte" ordenacao={ordenacao} className="num">Previsto até {mes}</ThOrdenavel>
              <ThOrdenavel chave="realAte" ordenacao={ordenacao} className="num">{despesa ? "Gasto" : "Recebido"} até {mes}</ThOrdenavel>
              <ThOrdenavel chave="aberto" ordenacao={ordenacao} className="num">{despesa ? "A pagar" : "A receber"}</ThOrdenavel>
              {despesa && <ThOrdenavel chave="disponivel" ordenacao={ordenacao} className="num">Disponível</ThOrdenavel>}
              <ThOrdenavel chave="pct" ordenacao={ordenacao}>{despesa ? "Uso no ano" : "Atingido"}</ThOrdenavel>
              <ThOrdenavel chave="situacao" ordenacao={ordenacao}>Situação</ThOrdenavel>
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 && <tr><td className="vazio" colSpan={despesa ? 8 : 7}>Nada orçado nem lançado neste ano.</td></tr>}
            {ordenacao.ordenadas.map((l) => (
              <tr key={l.chave} className="clicavel" tabIndex={0} onClick={() => onAbrir(l)} onKeyDown={(e) => { if (e.key === "Enter") onAbrir(l); }}>
                <td style={{ fontWeight: 550 }}>{l.nome}{l.inativo ? <span className="muted"> (inativo)</span> : null}</td>
                <td className="num">{moedaOuTraco(l.m.orcAno)}</td>
                <td className="num">{moedaOuTraco(l.m.orcAte)}</td>
                <td className="num" style={{ fontWeight: 550 }}>{moedaOuTraco(l.m.realAte)}</td>
                <td className="num" style={{ fontStyle: "italic" }}>{moedaOuTraco(l.m.abertoAno)}</td>
                {despesa && <td className="num" style={{ color: l.m.orcAno && l.m.disponivel < 0 ? "var(--danger-text)" : undefined, fontWeight: 550 }}>{l.m.orcAno ? moeda(l.m.disponivel) : "—"}</td>}
                <td><Barra pct={l.m.pct} situacao={l.m.situacao} /></td>
                <td>{l.m.situacao === "vazio" ? <span className="muted">—</span> : <Pill tone={SITUACOES[l.m.situacao].tom}>{SITUACOES[l.m.situacao].rotulo}</Pill>}</td>
              </tr>
            ))}
          </tbody>
          {linhas.length > 0 && (
            <tfoot>
              <tr className="orc-total">
                <td>Total</td>
                <td className="num">{moeda(tot.orcAno)}</td>
                <td className="num">{moeda(tot.orcAte)}</td>
                <td className="num">{moeda(tot.realAte)}</td>
                <td className="num">{moeda(tot.abertoAno)}</td>
                {despesa && <td className="num">{moeda(tot.disponivel)}</td>}
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

function DetalheModal({ linha, ano, onFechar }) {
  const despesa = linha.natureza === "despesa";
  const difs = MESES_LONGOS.map((_, i) => (despesa ? linha.orc[i] - linha.real[i] - linha.aberto[i] : linha.real[i] + linha.aberto[i] - linha.orc[i]));
  const acumulados = difs.map((_, i) => difs.slice(0, i + 1).reduce((a, v) => a + v, 0));
  const acumulado = acumulados[11];
  return (
    <Modal titulo={`${linha.nome} — ${ano}`} largura={720} onFechar={onFechar}
      rodape={<button className="btn btn-ghost" onClick={onFechar}>Fechar</button>}>
      <p className="muted" style={{ fontSize: 13, margin: "0 0 10px" }}>
        {despesa
          ? "Gasto = o que saiu das contas caixa no mês (pagamentos e saídas avulsas). A pagar = parcelas em aberto com vencimento no mês."
          : "Recebido = o que entrou nas contas caixa no mês. A receber = contas a receber em aberto com vencimento no mês."}
      </p>
      <div className="table-wrap">
        <table className="rel-tabela">
          <thead><tr><th>Mês</th><th className="num">Orçado</th><th className="num">{despesa ? "Gasto" : "Recebido"}</th><th className="num">{despesa ? "A pagar" : "A receber"}</th><th className="num">Diferença</th><th className="num">Diferença acumulada</th></tr></thead>
          <tbody>
            {MESES_LONGOS.map((nome, i) => {
              const dif = difs[i];
              return (
                <tr key={nome}>
                  <td style={{ textTransform: "capitalize" }}>{nome}</td>
                  <td className="num">{moedaOuTraco(linha.orc[i])}</td>
                  <td className="num">{moedaOuTraco(linha.real[i])}</td>
                  <td className="num" style={{ fontStyle: "italic" }}>{moedaOuTraco(linha.aberto[i])}</td>
                  <td className={`num ${dif < 0 ? "rel-neg" : ""}`}>{dif ? moeda(dif) : "—"}</td>
                  <td className={`num ${acumulados[i] < 0 ? "rel-neg" : ""}`}>{moeda(acumulados[i])}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr>
            <td>Ano</td><td className="num">{moeda(somaMeses(linha.orc))}</td><td className="num">{moeda(somaMeses(linha.real))}</td>
            <td className="num">{moeda(somaMeses(linha.aberto))}</td><td className="num" colSpan={2}>{moeda(acumulado)}</td>
          </tr></tfoot>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        {despesa ? "Diferença negativa = gastou (ou vai gastar) mais que o orçado." : "Diferença negativa = entrou menos que o previsto."}
      </p>
    </Modal>
  );
}

// Campo de valor em reais que guarda centavos; enquanto digita, mostra o texto como foi digitado.
function CampoValor({ valor, onChange, rotulo, largura = 130 }) {
  const [texto, setTexto] = useState(null);
  return (
    <input inputMode="decimal" aria-label={rotulo} placeholder="0,00" style={{ ...inp, textAlign: "right", width: largura, padding: "6px 8px" }}
      value={texto ?? (valor ? numeroParaCampo(deCentavos(valor)) : "")}
      onFocus={(e) => { setTexto(valor ? numeroParaCampo(deCentavos(valor)) : ""); e.target.select(); }}
      onChange={(e) => { setTexto(e.target.value); const n = lerNumero(e.target.value); onChange(Number.isFinite(n) && n > 0 ? paraCentavos(n) : 0); }}
      onBlur={() => setTexto(null)} />
  );
}

function LinhaEditor({ chave, nome, meses, aberto, onAbrir, onMudar }) {
  const ano = somaMeses(meses);
  const iguais = meses.every((m, i) => m === dividirAno(ano)[i]);
  return (
    <>
      <tr>
        <td style={{ fontWeight: 550 }}>{nome}</td>
        <td className="num"><CampoValor rotulo={`Valor do ano — ${nome}`} valor={ano} onChange={(c) => onMudar(dividirAno(c))} /></td>
        <td className="num muted">{ano ? (iguais ? `${moeda(meses[0])}/mês` : "varia por mês") : "—"}</td>
        <td className="acoes" style={{ width: 120 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onAbrir} aria-expanded={aberto} aria-controls={`meses-${chave}`}>
            {aberto ? "Fechar meses" : "Ajustar meses"}
          </button>
        </td>
      </tr>
      {aberto && (
        <tr id={`meses-${chave}`} className="orc-meses-linha">
          <td colSpan={4}>
            <div className="orc-meses">
              {MESES_CURTOS.map((m, i) => (
                <label key={m}>
                  <span>{m}</span>
                  <CampoValor rotulo={`${nome} — ${MESES_LONGOS[i]}`} largura="100%" valor={meses[i]}
                    onChange={(c) => onMudar(meses.map((v, j) => (j === i ? c : v)))} />
                </label>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function EditorOrcamento({ ano, cadastros, orcamentos, onSalvo, onFechar }) {
  const inicial = useMemo(() => {
    const v = {};
    for (const o of orcamentos) v[chaveLinha(o.natureza, o.natureza === "despesa" ? o.centro_custo_id : o.categoria)] = o.valores.map(paraCentavos);
    return v;
  }, [orcamentos]);
  const [valores, setValores] = useState(inicial);
  const [abertos, setAbertos] = useState(() => new Set());
  const [copiaFonte, setCopiaFonte] = useState("orcamento");
  const [reajuste, setReajuste] = useState("");
  const [copiando, setCopiando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const centros = cadastros.centros.filter((c) => c.ativo || inicial[chaveLinha("despesa", c.id)]);
  const meses = (k) => valores[k] ?? Array(12).fill(0);
  const mudar = (k, m) => { setAviso(""); setValores((v) => ({ ...v, [k]: m })); };
  const alternar = (k) => setAbertos((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const totalDe = (nat) => Object.entries(valores).filter(([k]) => k.startsWith(`${nat}:`)).reduce((a, [, m]) => a + somaMeses(m), 0);
  const totDesp = totalDe("despesa");
  const totRec = totalDe("receita");

  async function copiar() {
    setCopiando(true); setErro(""); setAviso("");
    try {
      const pct = lerNumero(reajuste || "0");
      const novo = {};
      if (copiaFonte === "orcamento") {
        for (const o of await listarOrcamento(ano - 1)) {
          novo[chaveLinha(o.natureza, o.natureza === "despesa" ? o.centro_custo_id : o.categoria)] = reajustar(o.valores.map(paraCentavos), pct);
        }
      } else {
        const { realizado } = await carregarOrcamento(ano - 1);
        for (const r of realizado) {
          if (r.natureza === "despesa" && r.centro_custo_id === null) continue; // sem centro não entra no orçamento
          const k = chaveLinha(r.natureza, r.natureza === "despesa" ? r.centro_custo_id : r.categoria);
          novo[k] = novo[k] ?? Array(12).fill(0);
          novo[k][r.mes - 1] += paraCentavos(r.realizado);
        }
        for (const k of Object.keys(novo)) novo[k] = reajustar(novo[k], pct);
      }
      const n = Object.values(novo).filter((m) => somaMeses(m) > 0).length;
      if (!n) setAviso(`Não há ${copiaFonte === "orcamento" ? "orçamento" : "movimento"} em ${ano - 1} para copiar.`);
      else { setValores(novo); setAviso(`${n} linha(s) copiada(s) de ${ano - 1}${pct ? ` com reajuste de ${numeroParaCampo(pct)}%` : ""}. Revise e salve.`); }
    } catch (e) { setErro(mensagemErro(e)); }
    finally { setCopiando(false); }
  }

  async function salvar() {
    setSalvando(true); setErro("");
    try {
      const linhas = Object.entries(valores).filter(([, m]) => somaMeses(m) > 0).map(([k, m]) => {
        const [natureza, id] = k.split(":");
        return natureza === "despesa"
          ? { natureza, centro_custo_id: Number(id), valores: m.map(deCentavos) }
          : { natureza, categoria: id, valores: m.map(deCentavos) };
      });
      await salvarOrcamento(ano, linhas);
      onSalvo();
    } catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }

  const bloco = (titulo, natureza, itens) => (
    <>
      <h3 className="section-title">{titulo}</h3>
      <div className="table-wrap">
        <table className="table orc-editor">
          <thead><tr><th>{natureza === "despesa" ? "Centro de custo" : "Tipo de receita"}</th><th className="num">Valor do ano</th><th className="num">Por mês</th><th className="acoes"><span className="sr-only">Meses</span></th></tr></thead>
          <tbody>
            {itens.length === 0 && <tr><td className="vazio" colSpan={4}>Cadastre centros de custo em Parâmetros → Contábil → Centros de custo.</td></tr>}
            {itens.map((it) => {
              const k = chaveLinha(natureza, it.id);
              return <LinhaEditor key={k} chave={k.replace(":", "-")} nome={it.nome} meses={meses(k)} aberto={abertos.has(k)} onAbrir={() => alternar(k)} onMudar={(m) => mudar(k, m)} />;
            })}
          </tbody>
        </table>
      </div>
    </>
  );

  return (
    <Modal titulo={`Orçamento de ${ano}`} largura={860} onFechar={onFechar} fecharFora={false}
      rodape={<>
        <span className="muted" style={{ marginRight: "auto", fontSize: 13 }}>
          Receitas {moeda(totRec)} − despesas {moeda(totDesp)} = <strong style={{ color: totRec - totDesp < 0 ? "var(--danger-text)" : "var(--ok-text)" }}>{moeda(totRec - totDesp)}</strong>
        </span>
        <button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Cancelar</button>
        <button className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar orçamento"}</button>
      </>}>
      <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}>
        Digite o valor do ano: o sistema divide por 12. Para um mês diferente (ex.: congresso em julho), use <strong>Ajustar meses</strong>. Deixe em branco o que não vai orçar.
      </p>
      <div className="orc-copiar">
        <label style={lbl} htmlFor="orc-fonte">Começar a partir de {ano - 1}</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select id="orc-fonte" style={{ ...inp, width: "auto" }} value={copiaFonte} onChange={(e) => setCopiaFonte(e.target.value)}>
            <option value="orcamento">o orçamento de {ano - 1}</option>
            <option value="realizado">o que foi gasto e recebido em {ano - 1}</option>
          </select>
          <span className="muted" style={{ fontSize: 13 }}>com reajuste de</span>
          <input aria-label="Reajuste em %" inputMode="decimal" style={{ ...inp, width: 70, textAlign: "right" }} placeholder="0" value={reajuste} onChange={(e) => setReajuste(e.target.value)} />
          <span className="muted" style={{ fontSize: 13 }}>%</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={copiar} disabled={copiando}>{copiando ? "Copiando..." : "Copiar"}</button>
        </div>
        {aviso && <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>{aviso}</div>}
      </div>
      {bloco("Despesas por centro de custo", "despesa", centros)}
      {bloco("Receitas", "receita", CATEGORIAS_RECEITA.map((c) => ({ id: c.id, nome: c.rotulo })))}
      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 12 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}

export default function Orcamento({ cadastros, podeEditar }) {
  const hoje = hojeISO();
  const [ano, setAno] = useState(() => Number(hoje.slice(0, 4)));
  const [ateMesEscolhido, setAteMes] = useState(null); // null = padrão do ano
  const [versao, setVersao] = useState(0);
  const [editando, setEditando] = useState(false);
  const [detalhe, setDetalhe] = useState(null);
  const ateMes = ateMesEscolhido ?? mesPadrao(ano, hoje);
  const carga = useCarga(`orc|${ano}|${versao}`, () => carregarOrcamento(ano));
  const d = carga.dados;

  const calc = useMemo(() => {
    if (!d) return null;
    const linhas = [...juntarOrcamento(d.orcamentos, d.realizado).values()];
    const centro = (id) => cadastros.centros.find((c) => c.id === id);
    const montar = (l) => ({
      ...l,
      nome: l.natureza === "receita" ? rotuloCategoria(l.id) : l.id === SEM_CENTRO ? "Sem centro de custo" : centro(l.id)?.nome ?? `Centro ${l.id}`,
      inativo: l.natureza === "despesa" && l.id !== SEM_CENTRO && centro(l.id)?.ativo === false,
      m: medirLinha(l, ateMes),
    });
    const desp = linhas.filter((l) => l.natureza === "despesa").map(montar).filter((l) => l.m.situacao !== "vazio");
    const rec = linhas.filter((l) => l.natureza === "receita").map(montar).filter((l) => l.m.situacao !== "vazio");
    const soma = (lista, k) => lista.reduce((a, l) => a + l.m[k], 0);
    const atualizado = d.orcamentos.reduce((u, o) => (!u || o.atualizado_em > u.atualizado_em ? o : u), null);
    return {
      desp, rec, atualizado,
      orcDesp: soma(desp, "orcAno"), orcRec: soma(rec, "orcAno"),
      prevDesp: soma(desp, "orcAte"), prevRec: soma(rec, "orcAte"),
      realDesp: soma(desp, "realAte"), realRec: soma(rec, "realAte"),
      estourados: desp.filter((l) => l.m.situacao === "estourado"),
    };
  }, [d, cadastros.centros, ateMes]);

  const temOrcamento = Boolean(d?.orcamentos.length);
  const mesNome = MESES_LONGOS[ateMes - 1];
  const pctDe = (a, b) => (b ? `${Math.round((a / b) * 100)}% do previsto até ${mesNome}` : "sem previsão");

  return (
    <div>
      <div className="page-header">
        <Header title="Orçamento" subtitle="O que a igreja prevê gastar por centro de custo e receber por tipo no ano, comparado com o que já entrou e saiu das contas caixa e com o que está em aberto." />
        {podeEditar && (
          <button className="btn btn-primary" onClick={() => setEditando(true)} disabled={!d}>
            <Icone nome="editar" tamanho={16} /> {temOrcamento ? "Editar orçamento" : `Montar orçamento de ${ano}`}
          </button>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="toolbar">
          <label>Ano
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="btn btn-ghost" onClick={() => { setAno((a) => a - 1); setAteMes(null); }} aria-label="Ano anterior">‹</button>
              <input type="number" min={2000} max={2100} value={ano} onChange={(e) => { const n = Number(e.target.value); if (n >= 2000 && n <= 2100) { setAno(n); setAteMes(null); } }} style={{ ...inp, width: 100 }} aria-label="Ano" />
              <button type="button" className="btn btn-ghost" onClick={() => { setAno((a) => a + 1); setAteMes(null); }} aria-label="Próximo ano">›</button>
            </div>
          </label>
          <label>Comparar até
            <select value={ateMes} onChange={(e) => setAteMes(Number(e.target.value))} style={{ ...inp, width: 150 }}>
              {MESES_LONGOS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>
          {calc?.atualizado && (
            <span className="muted" style={{ marginLeft: "auto", alignSelf: "flex-end", fontSize: 12.5 }}>
              Orçamento alterado em {formatarData(calc.atualizado.atualizado_em.slice(0, 10))}{calc.atualizado.atualizado_por_nome ? ` por ${calc.atualizado.atualizado_por_nome}` : ""}
            </span>
          )}
        </div>
      </div>

      {carga.erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{carga.erro}</span></div>}
      {!d && !carga.erro && <div className="carregando-linha"><div className="spinner" /> Carregando...</div>}

      {calc && (
        <>
          {!temOrcamento && (
            <div className="alert alert-warn" style={{ marginBottom: 16 }}>
              <Icone nome="alerta" tamanho={16} />
              <span>
                Ainda não há orçamento para {ano}. {podeEditar
                  ? <>Use <strong>Montar orçamento de {ano}</strong>: dá para começar do orçamento ou do que foi gasto em {ano - 1}.</>
                  : "Peça ao Administrador da igreja para montar."} Abaixo, só o que já entrou e saiu.
              </span>
            </div>
          )}

          <div className="stat-grid">
            <Indicador icone="carteira" rotulo={`Receitas até ${mesNome}`} valor={moeda(calc.realRec)} sub={pctDe(calc.realRec, calc.prevRec)} tom={calc.prevRec && calc.realRec < calc.prevRec ? "alerta" : ""} />
            <Indicador icone="sacola" rotulo={`Despesas até ${mesNome}`} valor={moeda(calc.realDesp)} sub={pctDe(calc.realDesp, calc.prevDesp)} tom={calc.prevDesp && calc.realDesp > calc.prevDesp ? "alerta" : ""} />
            <Indicador icone="grafico" rotulo={`Resultado até ${mesNome}`} valor={moeda(calc.realRec - calc.realDesp)}
              sub={temOrcamento ? `previsto: ${moeda(calc.prevRec - calc.prevDesp)}` : null} tom={calc.realRec - calc.realDesp < 0 ? "perigo" : ""} />
            <Indicador icone="alerta" rotulo="Centros acima do orçado" valor={String(calc.estourados.length)} tom={calc.estourados.length ? "perigo" : "neutro"}
              sub={calc.estourados.length ? calc.estourados.slice(0, 2).map((l) => l.nome).join(", ") + (calc.estourados.length > 2 ? "…" : "") : `orçado no ano: ${moeda(calc.orcDesp)}`} />
          </div>

          <TabelaOrcamento natureza="despesa" titulo="Despesas por centro de custo" ateMes={ateMes} linhas={calc.desp} onAbrir={setDetalhe}
            descricao="Uso no ano = já gasto + a pagar (vencimentos do ano), sobre o orçado do ano. Disponível = orçado − gasto − a pagar. Clique numa linha para ver mês a mês." />
          <TabelaOrcamento natureza="receita" titulo="Receitas" ateMes={ateMes} linhas={calc.rec} onAbrir={setDetalhe}
            descricao="Atingido = já recebido no ano sobre o orçado do ano. A receber = contas a receber com vencimento no ano. Transferências entre contas não contam." />
        </>
      )}

      {detalhe && <DetalheModal linha={detalhe} ano={ano} onFechar={() => setDetalhe(null)} />}
      {editando && d && (
        <EditorOrcamento ano={ano} cadastros={cadastros} orcamentos={d.orcamentos}
          onSalvo={() => { setEditando(false); setVersao((v) => v + 1); }} onFechar={() => setEditando(false)} />
      )}
    </div>
  );
}
