import { useEffect, useMemo, useState } from "react";
import { Header, Pill } from "../ui";
import { lbl, inp, msgErro } from "../estilos";
import Icone from "./Icone";
import Modal from "./Modal";
import PessoaModal from "./PessoaModal";
import ThOrdenavel from "./ThOrdenavel";
import { useOrdenacao } from "./useOrdenacao";
import { listarEntradas, registrarEntrada, estornarEntrada, mensagemErro, buscarEmpresa } from "./db";
import { formatarMoeda, formatarData, hojeISO, lerNumero, somarValores, mascararDocumento } from "./format";
import { TIPOS_ENTRADA, TIPOS_ENTRADA_NOVA, nomeForma } from "./financeiro";
import FormaSelect from "./FormaSelect";
import Impressao from "./Impressao";
import { ComprovanteEntrada } from "./DocumentosEntrada";
import { useCarga } from "./useCarga";

const SITUACOES = [{ id: "validas", rotulo: "Válidas" }, { id: "estornadas", rotulo: "Estornadas" }, { id: "todas", rotulo: "Todas" }];
const naSituacao = (e, s) => s === "todas" || (s === "validas" ? !e.estornado : e.estornado);
const inicioDoMes = () => `${hojeISO().slice(0, 8)}01`;

const COLUNAS = {
  data: (e) => `${e.data}${String(e.id).padStart(12, "0")}`,
  tipo: (e) => TIPOS_ENTRADA[e.tipo],
  quem: (e) => e.pessoa_nome || e.descricao || "",
  caixa: (e) => e.conta_caixa_nome,
  forma: (e) => e.forma_pagamento_nome ?? nomeForma(null, null, e.forma_pagamento),
  valor: (e) => Number(e.valor),
};

// Título de cada linha: quem deu (se informado) e, abaixo, campanha e descrição.
const detalheLinha = (e) => [e.campanha_nome, e.descricao].filter(Boolean).join(" · ");

function Indicador({ icone, rotulo, valor, sub }) {
  return (
    <div className="card stat">
      <div>
        <div className="stat-label">{rotulo}</div>
        <div className="stat-value">{valor}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
      <div className="stat-icon"><Icone nome={icone} tamanho={19} /></div>
    </div>
  );
}

// Financeiro → Dízimos e ofertas. Cada entrada soma no saldo da conta caixa; errou, estorna e lança de novo.
export default function Entradas({ cadastros, perfil, podeRegistrar, podeEstornar, onCadastrosMudaram }) {
  const [comprovante, setComprovante] = useState(null); // entrada sendo impressa
  const empresa = useCarga(comprovante && perfil?.empresa_id ? `emp|${perfil.empresa_id}` : null, () => buscarEmpresa(perfil.empresa_id));
  const [filtros, setFiltros] = useState(() => ({ de: inicioDoMes(), ate: hojeISO(), busca: "", tipo: "", caixa: "" }));
  const [situacao, setSituacao] = useState("validas");
  const [resultado, setResultado] = useState({ chave: null, lista: [], erro: "" });
  const [versao, setVersao] = useState(0); // muda depois de registrar/estornar, para recarregar
  const [acao, setAcao] = useState(null); // { tipo: "nova" | "ver" | "estornar", entrada }

  const chave = `${filtros.de}|${filtros.ate}|${versao}`;
  useEffect(() => {
    let ativo = true;
    listarEntradas({ de: filtros.de, ate: filtros.ate })
      .then((d) => { if (ativo) setResultado({ chave, lista: d, erro: "" }); })
      .catch((e) => { if (ativo) setResultado({ chave, lista: [], erro: mensagemErro(e) }); });
    return () => { ativo = false; };
  }, [chave, filtros.de, filtros.ate]);
  // Enquanto a nova consulta não chega, mostra a anterior (evita a tabela piscar depois de registrar).
  const entradas = resultado.chave === null ? null : resultado.lista;
  const erro = resultado.erro;
  const atualizar = async () => { setVersao((v) => v + 1); await onCadastrosMudaram(); };

  const porFiltro = useMemo(() => {
    const t = filtros.busca.trim().toLowerCase();
    return (entradas || []).filter((e) =>
      (!filtros.tipo || e.tipo === filtros.tipo)
      && (!filtros.caixa || String(e.conta_caixa_id) === filtros.caixa)
      && (!t || [e.pessoa_nome, e.descricao, e.campanha_nome].some((v) => (v || "").toLowerCase().includes(t))));
  }, [entradas, filtros]);
  const filtradas = useMemo(() => porFiltro.filter((e) => naSituacao(e, situacao)), [porFiltro, situacao]);
  const ordenacao = useOrdenacao(filtradas, COLUNAS, { chave: "data", dir: "desc" });

  // Indicadores: só entradas válidas, respeitando os filtros (período, tipo, conta, busca).
  const indicadores = useMemo(() => {
    const validas = porFiltro.filter((e) => !e.estornado);
    const soma = (l) => somarValores(l.map((e) => Number(e.valor)));
    const doTipo = (t) => validas.filter((e) => e.tipo === t);
    const resumo = (l) => ({ qtd: l.length, valor: formatarMoeda(soma(l)) });
    return {
      dizimo: resumo(doTipo("dizimo")), oferta: resumo(doTipo("oferta")),
      campanha: resumo(doTipo("campanha")), total: resumo(validas), outras: doTipo("outra").length,
    };
  }, [porFiltro]);

  const f = (k) => (e) => setFiltros((p) => ({ ...p, [k]: e.target.value }));
  const totalLista = somarValores(filtradas.filter((e) => !e.estornado).map((e) => Number(e.valor)));
  const colunas = podeEstornar ? 7 : 6;

  return (
    <div>
      <div className="page-header">
        <Header title="Dízimos e ofertas" subtitle="Dízimos, ofertas e campanhas. Cada entrada soma no saldo da conta caixa que recebeu. Uma entrada registrada não é editada: se houver erro, um Supervisor ou Administrador estorna (com motivo) e ela é lançada de novo. Outros valores (rendimento, venda, reembolso) entram em Caixa, como entrada avulsa." />
        {podeRegistrar && (
          <button className="btn btn-primary" onClick={() => setAcao({ tipo: "nova" })}><Icone nome="mais" tamanho={16} traco={2.2} /> Nova entrada</button>
        )}
      </div>

      <div className="stat-grid">
        <Indicador icone="carteira" rotulo="Dízimos" valor={indicadores.dizimo.valor} sub={`${indicadores.dizimo.qtd} entrada(s)`} />
        <Indicador icone="pessoas" rotulo="Ofertas" valor={indicadores.oferta.valor} sub={`${indicadores.oferta.qtd} entrada(s)`} />
        <Indicador icone="grafico" rotulo="Campanhas" valor={indicadores.campanha.valor} sub={`${indicadores.campanha.qtd} entrada(s)`} />
        <Indicador icone="check" rotulo="Total no período" valor={indicadores.total.valor}
          sub={`${indicadores.total.qtd} entrada(s)${indicadores.outras ? ` · ${indicadores.outras} outra(s)` : ""}`} />
      </div>

      {erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}

      <div className="card">
        <div className="toolbar">
          <label style={{ flex: "1 1 200px", maxWidth: 300 }}>Buscar
            <input placeholder="Pessoa, campanha ou descrição" value={filtros.busca} onChange={f("busca")} style={inp} />
          </label>
          <label>Tipo
            <select value={filtros.tipo} onChange={f("tipo")} style={{ ...inp, width: 150 }}>
              <option value="">Todos</option>
              {Object.entries(TIPOS_ENTRADA).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </select>
          </label>
          <label>Conta caixa
            <select value={filtros.caixa} onChange={f("caixa")} style={{ ...inp, width: 180 }}>
              <option value="">Todas</option>
              {cadastros.caixas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <label>De
            <input type="date" value={filtros.de} onChange={f("de")} style={{ ...inp, width: 156 }} />
          </label>
          <label>até
            <input type="date" value={filtros.ate} onChange={f("ate")} style={{ ...inp, width: 156 }} />
          </label>
        </div>

        <div className="abas" role="tablist" aria-label="Situação das entradas">
          {SITUACOES.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={situacao === s.id} className={`aba${situacao === s.id ? " ativa" : ""}`} onClick={() => setSituacao(s.id)}>
              {s.rotulo}<span className="contador">{porFiltro.filter((e) => naSituacao(e, s.id)).length}</span>
            </button>
          ))}
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <ThOrdenavel chave="data" ordenacao={ordenacao}>Data</ThOrdenavel>
              <ThOrdenavel chave="tipo" ordenacao={ordenacao}>Tipo</ThOrdenavel>
              <ThOrdenavel chave="quem" ordenacao={ordenacao}>Pessoa / descrição</ThOrdenavel>
              <ThOrdenavel chave="caixa" ordenacao={ordenacao}>Conta caixa</ThOrdenavel>
              <ThOrdenavel chave="forma" ordenacao={ordenacao}>Forma</ThOrdenavel>
              <ThOrdenavel chave="valor" ordenacao={ordenacao} className="num">Valor</ThOrdenavel>
              {podeEstornar && <th className="acoes"><span className="sr-only">Ações</span></th>}
            </tr></thead>
            <tbody>
              {entradas === null && !erro && <tr><td className="vazio" colSpan={colunas}>Carregando...</td></tr>}
              {entradas && filtradas.length === 0 && (
                <tr><td className="vazio" colSpan={colunas}>{entradas.length === 0 ? "Nenhuma entrada neste período." : "Nenhuma entrada encontrada com esses filtros."}</td></tr>
              )}
              {ordenacao.ordenadas.map((e) => (
                <tr key={e.id} className="clicavel" tabIndex={0} style={e.estornado ? { color: "var(--faint)" } : undefined}
                  onClick={() => setAcao({ tipo: "ver", entrada: e })} onKeyDown={(ev) => { if (ev.key === "Enter" && ev.target === ev.currentTarget) setAcao({ tipo: "ver", entrada: e }); }}>
                  <td>{formatarData(e.data)}</td>
                  <td>{e.estornado ? <Pill tone="danger">Estornada</Pill> : <Pill tone={e.tipo === "dizimo" ? "ok" : "neutral"}>{TIPOS_ENTRADA[e.tipo]}</Pill>}</td>
                  <td className="truncate" style={{ maxWidth: 320 }}>
                    <span style={{ fontWeight: 550 }}>{e.pessoa_nome || (e.descricao && !e.campanha_nome ? e.descricao : <span className="muted" style={{ fontWeight: 400 }}>Sem identificação</span>)}</span>
                    {(e.pessoa_nome || e.campanha_nome) && detalheLinha(e) && <div className="muted" style={{ fontSize: 12 }}>{detalheLinha(e)}</div>}
                  </td>
                  <td>{e.conta_caixa_nome}</td>
                  <td>{e.forma_pagamento_nome ?? nomeForma(null, null, e.forma_pagamento)}</td>
                  <td className="num" style={e.estornado ? { textDecoration: "line-through" } : { fontWeight: 550 }}>{formatarMoeda(e.valor)}</td>
                  {podeEstornar && (
                    <td className="acoes" onClick={(ev) => ev.stopPropagation()}>
                      {!e.estornado && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAcao({ tipo: "estornar", entrada: e })}>Estornar</button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entradas && filtradas.length > 0 && (
          <div className="table-footer">
            <span>{filtradas.length} entrada(s){entradas.length >= 3000 && " · exibindo as 3000 mais recentes do período"}</span>
            <span>Total: <strong>{formatarMoeda(totalLista)}</strong></span>
          </div>
        )}
      </div>

      {acao?.tipo === "nova" && <EntradaModal cadastros={cadastros} onFechar={() => setAcao(null)} onRegistrada={atualizar} onCadastrosMudaram={onCadastrosMudaram} />}
      {acao?.tipo === "ver" && (
        <DetalheModal entrada={acao.entrada} cadastros={cadastros} podeEstornar={podeEstornar} onFechar={() => setAcao(null)} onComprovante={() => setComprovante(acao.entrada)}
          onEstornar={() => setAcao({ tipo: "estornar", entrada: acao.entrada })} />
      )}
      {comprovante && (empresa.dados || empresa.erro) && (
        <Impressao onFim={() => setComprovante(null)}>
          <ComprovanteEntrada entrada={comprovante} pessoa={cadastros.pessoas.find((p) => p.id === comprovante.pessoa_id)} empresa={empresa.dados} nomeIgreja={perfil?.empresa_nome} />
        </Impressao>
      )}
      {acao?.tipo === "estornar" && (
        <EstornoEntradaModal entrada={acao.entrada} onFechar={() => setAcao(null)} onConcluido={async () => { setAcao(null); await atualizar(); }} />
      )}
    </div>
  );
}

// Nova entrada. "Salvar e lançar outra" mantém tipo, data, conta e forma (útil para lançar os dízimos de um culto em sequência).
function EntradaModal({ cadastros, onFechar, onRegistrada, onCadastrosMudaram }) {
  const caixasAtivas = cadastros.caixas.filter((c) => c.ativo);
  const campanhasAtivas = (cadastros.campanhas || []).filter((c) => c.ativo);
  const vazio = (p = {}) => ({
    tipo: p.tipo ?? "dizimo", data: p.data ?? hojeISO(), valor: "", contaCaixaId: p.contaCaixaId ?? (caixasAtivas.length === 1 ? String(caixasAtivas[0].id) : ""),
    forma: p.forma ?? String((cadastros.formas || []).find((x) => x.ativo && x.tipo === "dinheiro")?.id ?? ""), pessoaId: "", campanhaId: p.campanhaId ?? (campanhasAtivas.length === 1 ? String(campanhasAtivas[0].id) : ""), centroCustoId: p.centroCustoId ?? "", descricao: "",
  });
  const [f, setF] = useState(() => vazio());
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [registradas, setRegistradas] = useState([]); // lançadas nesta janela (com "lançar outra")
  const [novaPessoa, setNovaPessoa] = useState(false);
  const [pessoasExtras, setPessoasExtras] = useState([]); // criadas aqui, antes de os cadastros recarregarem
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  // Membros e doadores primeiro; os demais cadastros (fornecedores etc.) ficam num grupo à parte.
  const pessoas = useMemo(() => {
    const todas = [...cadastros.pessoas, ...pessoasExtras.filter((x) => !cadastros.pessoas.some((p) => p.id === x.id))].filter((p) => p.ativo);
    const ehMembro = (p) => (p.papeis || []).some((x) => x === "membro" || x === "doador");
    const ordem = (a, b) => a.nome.localeCompare(b.nome);
    return { membros: todas.filter(ehMembro).sort(ordem), outros: todas.filter((p) => !ehMembro(p)).sort(ordem) };
  }, [cadastros.pessoas, pessoasExtras]);

  const valor = lerNumero(f.valor);
  const caixa = cadastros.caixas.find((c) => String(c.id) === f.contaCaixaId);
  const erros = {};
  if (!(valor > 0)) erros.valor = "Informe um valor maior que zero";
  if (!f.data) erros.data = "Informe a data";
  else if (f.data > hojeISO()) erros.data = "A data não pode ser futura";
  else if (caixa && f.data < caixa.data_saldo_inicial) erros.data = `Antes do saldo inicial da conta (${formatarData(caixa.data_saldo_inicial)})`;
  if (!f.contaCaixaId) erros.contaCaixaId = "Escolha a conta que recebeu";
  if (f.tipo === "campanha" && !f.campanhaId) erros.campanhaId = "Escolha a campanha";
  if (!f.forma) erros.forma = "Escolha a forma de recebimento";
  const borda = (k) => (tentou && erros[k] ? { borderColor: "var(--danger)" } : {});
  const msg = (k) => tentou && erros[k] && <div style={msgErro}>{erros[k]}</div>;

  async function salvar(outra) {
    setTentou(true);
    setErro("");
    if (Object.keys(erros).length) return;
    setSalvando(true);
    try {
      await registrarEntrada({
        tipo: f.tipo, data: f.data, valor, conta_caixa_id: Number(f.contaCaixaId), forma_pagamento_id: f.forma ? Number(f.forma) : null,
        pessoa_id: f.pessoaId ? Number(f.pessoaId) : null, campanha_id: f.tipo === "campanha" ? Number(f.campanhaId) : null,
        centro_custo_id: f.centroCustoId ? Number(f.centroCustoId) : null, descricao: f.descricao.trim(),
      });
      const nome = [...pessoas.membros, ...pessoas.outros].find((p) => String(p.id) === f.pessoaId)?.nome;
      await onRegistrada();
      if (!outra) { onFechar(); return; }
      setRegistradas((r) => [...r, { tipo: f.tipo, valor, nome }]);
      setF((p) => vazio(p));
      setTentou(false);
      setSalvando(false);
    } catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }

  const totalRegistradas = somarValores(registradas.map((r) => r.valor));
  return (
    <Modal titulo="Nova entrada" largura={620} fecharFora={false} onFechar={onFechar}
      rodape={<>
        <button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>{registradas.length ? "Fechar" : "Cancelar"}</button>
        <button className="btn btn-ghost" onClick={() => salvar(true)} disabled={salvando}>Salvar e lançar outra</button>
        <button className="btn btn-primary" onClick={() => salvar(false)} disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</button>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); salvar(false); }} noValidate>
        {registradas.length > 0 && (
          <div className="alert alert-ok" role="status" style={{ marginBottom: 12 }}>
            <Icone nome="check" tamanho={16} />
            <span>{registradas.length} entrada(s) registrada(s) nesta janela, somando <strong>{formatarMoeda(totalRegistradas)}</strong>. Última: {TIPOS_ENTRADA[registradas.at(-1).tipo]} de {formatarMoeda(registradas.at(-1).valor)}{registradas.at(-1).nome ? ` (${registradas.at(-1).nome})` : ""}.</span>
          </div>
        )}
        <div className="abas" role="radiogroup" aria-label="Tipo de entrada" style={{ margin: "0 0 4px", padding: 0 }}>
          {Object.entries(TIPOS_ENTRADA_NOVA).map(([v, r]) => (
            <button key={v} type="button" role="radio" aria-checked={f.tipo === v} className={`aba${f.tipo === v ? " ativa" : ""}`} onClick={() => setF((p) => ({ ...p, tipo: v }))}>{r}</button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0 12px" }}>
          <div>
            <label style={lbl} htmlFor="en-valor">Valor *</label>
            <input id="en-valor" autoFocus inputMode="decimal" placeholder="0,00" style={{ ...inp, textAlign: "right", ...borda("valor") }} value={f.valor} onChange={set("valor")} />
            {msg("valor")}
          </div>
          <div>
            <label style={lbl} htmlFor="en-data">Data *</label>
            <input id="en-data" type="date" max={hojeISO()} style={{ ...inp, ...borda("data") }} value={f.data} onChange={set("data")} />
            {msg("data")}
          </div>
          <div>
            <label style={lbl} htmlFor="en-forma">Forma *</label>
            <FormaSelect id="en-forma" style={{ ...inp, ...(tentou && !f.forma ? { borderColor: "var(--danger)" } : {}) }} formas={cadastros.formas} semBoleto vazio="— Selecione —"
              value={f.forma} onChange={(v) => setF((p) => ({ ...p, forma: v }))} />
          </div>
        </div>

        <label style={lbl} htmlFor="en-caixa">Conta caixa que recebeu *</label>
        <select id="en-caixa" style={{ ...inp, ...borda("contaCaixaId") }} value={f.contaCaixaId} onChange={set("contaCaixaId")}>
          <option value="">— Selecione —</option>
          {caixasAtivas.map((c) => <option key={c.id} value={c.id}>{c.nome} · saldo {formatarMoeda(c.saldo_atual)}</option>)}
        </select>
        {msg("contaCaixaId")}
        {caixasAtivas.length === 0 && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Cadastre uma conta caixa em Parâmetros → Financeiro → Contas caixa.</div>}

        {f.tipo === "campanha" && (
          <>
            <label style={lbl} htmlFor="en-campanha">Campanha *</label>
            <select id="en-campanha" style={{ ...inp, ...borda("campanhaId") }} value={f.campanhaId} onChange={set("campanhaId")}>
              <option value="">— Selecione —</option>
              {campanhasAtivas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            {msg("campanhaId")}
            {campanhasAtivas.length === 0 && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Nenhuma campanha ativa. Um Administrador cadastra em Parâmetros → Financeiro → Campanhas.</div>}
          </>
        )}

        <label style={lbl} htmlFor="en-pessoa">{f.tipo === "dizimo" ? "Dizimista" : "Quem contribuiu"} <span className="muted">(opcional)</span></label>
        <div style={{ display: "flex", gap: 8 }}>
          <select id="en-pessoa" style={{ ...inp, flex: 1, minWidth: 0 }} value={f.pessoaId} onChange={set("pessoaId")}>
            <option value="">— Sem identificação —</option>
            {pessoas.membros.length > 0 && <optgroup label="Membros e doadores">{pessoas.membros.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.documento ? ` · ${mascararDocumento(p.tipo_pessoa, p.documento)}` : ""}</option>)}</optgroup>}
            {pessoas.outros.length > 0 && <optgroup label="Outros cadastros">{pessoas.outros.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</optgroup>}
          </select>
          <button type="button" className="btn btn-ghost" style={{ flex: "none" }} onClick={() => setNovaPessoa(true)}>+ Nova pessoa</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 12px" }}>
          <div>
            <label style={lbl} htmlFor="en-centro">Centro de custo <span className="muted">(opcional)</span></label>
            <select id="en-centro" style={inp} value={f.centroCustoId} onChange={set("centroCustoId")}>
              <option value="">— Nenhum —</option>
              {cadastros.centros.filter((c) => c.ativo).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl} htmlFor="en-desc">Descrição <span className="muted">(opcional)</span></label>
            <input id="en-desc" maxLength={200} style={inp} value={f.descricao} onChange={set("descricao")} placeholder="Ex.: culto de domingo à noite" />
          </div>
        </div>
        <button type="submit" hidden />
      </form>
      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
      {novaPessoa && (
        <PessoaModal papelPadrao="membro" onFechar={() => setNovaPessoa(false)}
          onSalvo={(p) => { setNovaPessoa(false); setPessoasExtras((l) => [...l, p]); setF((x) => ({ ...x, pessoaId: String(p.id) })); onCadastrosMudaram(); }} />
      )}
    </Modal>
  );
}

function Campo({ rotulo, children }) {
  return (
    <div className="tributo">
      <span className="tributo-rotulo">{rotulo}</span>
      <span className="tributo-valor" style={{ fontWeight: 500 }}>{children || "—"}</span>
    </div>
  );
}

function DetalheModal({ entrada: e, cadastros, podeEstornar, onFechar, onEstornar, onComprovante }) {
  const pessoa = cadastros.pessoas.find((p) => p.id === e.pessoa_id);
  return (
    <Modal titulo={`${TIPOS_ENTRADA[e.tipo]} de ${formatarMoeda(e.valor)}`} largura={560} onFechar={onFechar}
      extra={e.estornado ? <Pill tone="danger">Estornada</Pill> : <Pill tone="ok">Válida</Pill>}
      rodape={<>
        {podeEstornar && !e.estornado && <button className="btn btn-danger" style={{ marginRight: "auto" }} onClick={onEstornar}>Estornar</button>}
        <button className="btn btn-ghost" onClick={onFechar}>Fechar</button>
        {!e.estornado && <button className="btn btn-primary" onClick={onComprovante}><Icone nome="impressora" tamanho={15} /> Comprovante</button>}
      </>}>
      {e.estornado && (
        <div className="alert alert-danger" style={{ marginBottom: 12 }}>
          <Icone nome="alerta" tamanho={16} />
          <span>Estornada em {new Date(e.estornado_em).toLocaleString("pt-BR")}: {e.motivo_estorno}. Não soma no saldo da conta caixa.</span>
        </div>
      )}
      <div className="tributos-grid">
        <Campo rotulo="Data">{formatarData(e.data)}</Campo>
        <Campo rotulo="Valor">{formatarMoeda(e.valor)}</Campo>
        <Campo rotulo="Forma">{e.forma_pagamento_nome ?? nomeForma(cadastros.formas, e.forma_pagamento_id, e.forma_pagamento)}</Campo>
        <Campo rotulo="Conta caixa">{e.conta_caixa_nome}</Campo>
        <Campo rotulo={e.tipo === "dizimo" ? "Dizimista" : "Quem contribuiu"}>{e.pessoa_nome ? `${e.pessoa_nome}${pessoa?.documento ? ` · ${mascararDocumento(pessoa.tipo_pessoa, pessoa.documento)}` : ""}` : "Sem identificação"}</Campo>
        {e.campanha_nome && <Campo rotulo="Campanha">{e.campanha_nome}</Campo>}
        <Campo rotulo="Centro de custo">{e.centro_custo_nome}</Campo>
        <Campo rotulo="Registrada por">{e.registrado_por_nome ? `${e.registrado_por_nome}, em ${new Date(e.criado_em).toLocaleString("pt-BR")}` : new Date(e.criado_em).toLocaleString("pt-BR")}</Campo>
      </div>
      {e.descricao && <p style={{ marginTop: 12, fontSize: 13.5, color: "var(--text-2)" }}><strong>Descrição:</strong> {e.descricao}</p>}
    </Modal>
  );
}

function EstornoEntradaModal({ entrada, onFechar, onConcluido }) {
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const valido = motivo.trim().length >= 5;
  async function confirmar() {
    if (!valido) return;
    setSalvando(true);
    setErro("");
    try { await estornarEntrada(entrada.id, motivo); await onConcluido(); }
    catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }
  return (
    <Modal titulo="Estornar entrada" largura={480} nivel={400} fecharFora={false} onFechar={onFechar}
      rodape={<>
        <button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Voltar</button>
        <button className="btn btn-danger" style={{ opacity: valido ? 1 : 0.5 }} disabled={!valido || salvando} onClick={confirmar}>{salvando ? "Estornando..." : "Estornar"}</button>
      </>}>
      <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "4px 0 0" }}>
        <strong>{TIPOS_ENTRADA[entrada.tipo]} de {formatarMoeda(entrada.valor)}</strong> em {formatarData(entrada.data)}{entrada.pessoa_nome ? ` (${entrada.pessoa_nome})` : ""}.
        O valor deixa de somar no saldo de {entrada.conta_caixa_nome}. O estorno fica registrado e não pode ser desfeito; se precisar, lance a entrada de novo. Informe o motivo:
      </p>
      <textarea autoFocus maxLength={300} style={{ ...inp, minHeight: 70, marginTop: 8, marginBottom: 8, fontFamily: "inherit" }} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: valor contado errado (mín. 5 caracteres)" />
      {erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 8 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}
