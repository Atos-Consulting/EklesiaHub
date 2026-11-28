import { useEffect, useState } from "react";
import { inp } from "../../estilos";
import Icone from "../Icone";
import { listarRegrasContabeis, salvarRegraContabil, listarGuiasTributos, salvarGuiaTributo, mensagemErro } from "../db";
import { ContaSelect } from "../contabil/comum";
import { CabecalhoAba } from "./comum";

// Parâmetros → Contábil → Regras de contabilização (v25): em que conta cai cada lançamento automático.
// Trocar uma regra vale para o que entrar daqui para frente; o que já está no diário não muda.

const REGRAS = [
  { grupo: "Patrimônio e obrigações", itens: [
    { chave: "patrimonio", rotulo: "Patrimônio social", ajuda: "Contrapartida do saldo inicial das contas caixa.", naturezas: ["patrimonio_social"] },
    { chave: "fornecedores", rotulo: "Fornecedores a pagar", ajuda: "Crédito da nota aprovada e das contas a pagar; débito no pagamento.", naturezas: ["passivo"] },
    { chave: "contas_receber", rotulo: "Contas a receber", ajuda: "Débito ao lançar a conta a receber; crédito no recebimento.", naturezas: ["ativo"] },
  ] },
  { grupo: "Tributos retidos a recolher", itens: [
    { chave: "ret_inss", rotulo: "INSS retido", naturezas: ["passivo"] },
    { chave: "ret_irrf", rotulo: "IRRF retido", naturezas: ["passivo"] },
    { chave: "ret_csll", rotulo: "CSLL retida", naturezas: ["passivo"] },
    { chave: "ret_pis", rotulo: "PIS retido", naturezas: ["passivo"] },
    { chave: "ret_cofins", rotulo: "COFINS retida", naturezas: ["passivo"] },
    { chave: "ret_iss", rotulo: "ISS retido", naturezas: ["passivo"] },
    { chave: "retencoes", rotulo: "Outras retenções", ajuda: "O campo “Outras retenções” da nota.", naturezas: ["passivo"] },
  ] },
  { grupo: "Comercial (frente de loja e estoque)", itens: [
    { chave: "estoque", rotulo: "Estoque de mercadorias", ajuda: "Débito na compra (item da nota ligado a produto com estoque); crédito no custo da venda e nas perdas.", naturezas: ["ativo"] },
    { chave: "vendas", rotulo: "Vendas", ajuda: "Crédito das vendas do frente de loja, no fechamento do caixa.", naturezas: ["receita"] },
    { chave: "cmv", rotulo: "Custo das mercadorias vendidas", ajuda: "Débito do custo médio dos produtos vendidos.", naturezas: ["despesa"] },
    { chave: "ajuste_estoque", rotulo: "Perdas e ajustes de estoque", ajuda: "Avarias, uso interno, doações recebidas e acertos de inventário.", naturezas: ["despesa"] },
    { chave: "quebra_caixa", rotulo: "Quebra de caixa", ajuda: "Sobra ou falta do dinheiro no fechamento do caixa do frente de loja.", naturezas: ["despesa"] },
  ] },
  { grupo: "Receitas", itens: [
    { chave: "dizimo", rotulo: "Dízimos", naturezas: ["receita"] },
    { chave: "oferta", rotulo: "Ofertas", naturezas: ["receita"] },
    { chave: "campanha", rotulo: "Campanhas", naturezas: ["receita"] },
    { chave: "receita_receber", rotulo: "Receita de contas a receber", ajuda: "Aluguéis, vendas e outras contas a receber.", naturezas: ["receita"] },
    { chave: "entrada_avulsa", rotulo: "Entradas avulsas", ajuda: "Entradas avulsas do Caixa (ex.: rendimento) e entradas antigas do tipo “outra”.", naturezas: ["receita"] },
    { chave: "receitas_financeiras", rotulo: "Receitas financeiras", ajuda: "Juros e multa recebidos; descontos obtidos nos pagamentos.", naturezas: ["receita"] },
  ] },
  { grupo: "Despesas", itens: [
    { chave: "despesa_sem_nota", rotulo: "Contas a pagar sem nota", ajuda: "Contas fixas e contas a pagar lançadas sem nota de entrada. (Nas notas, vale a conta de cada item.)", naturezas: ["despesa"] },
    { chave: "saida_avulsa", rotulo: "Saídas avulsas", ajuda: "Saídas avulsas do Caixa (ex.: tarifa bancária).", naturezas: ["despesa"] },
    { chave: "despesas_financeiras", rotulo: "Despesas financeiras", ajuda: "Juros e multa pagos; descontos concedidos nos recebimentos.", naturezas: ["despesa"] },
  ] },
];

const TRIBUTOS_GUIA = [
  { id: "inss", rotulo: "INSS retido" }, { id: "irrf", rotulo: "IRRF retido" }, { id: "csll", rotulo: "CSLL retida" },
  { id: "pis", rotulo: "PIS retido" }, { id: "cofins", rotulo: "COFINS retida" }, { id: "iss", rotulo: "ISS retido" },
];

// Guias a recolher (v26): órgão (fornecedor) e dia de vencimento no mês seguinte, por tributo.
function GuiasTributos({ cadastros }) {
  const [guias, setGuias] = useState(null);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  useEffect(() => {
    let ativo = true;
    listarGuiasTributos().then((d) => { if (ativo) setGuias(Object.fromEntries(d.map((g) => [g.tributo, g]))); }).catch((e) => { if (ativo) setErro(mensagemErro(e)); });
    return () => { ativo = false; };
  }, []);
  const orgaos = cadastros.pessoas.filter((p) => p.papeis?.includes("fornecedor") && p.ativo !== false).sort((a, b) => a.nome.localeCompare(b.nome));
  async function salvar(t, mudanca) {
    const atual = { pessoa_id: null, dia_vencimento: t.id === "iss" ? 10 : 20, ...guias[t.id], ...mudanca };
    if (!(atual.dia_vencimento >= 1 && atual.dia_vencimento <= 31)) return;
    setErro(""); setOk("");
    try { await salvarGuiaTributo(t.id, atual.pessoa_id, atual.dia_vencimento); setGuias((g) => ({ ...g, [t.id]: { ...atual, tributo: t.id } })); setOk(`Guia do ${t.rotulo} salva.`); }
    catch (e) { setErro(mensagemErro(e)); }
  }
  if (!guias) return erro ? <div className="alert alert-danger" role="alert"><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div> : null;
  return (
    <div>
      <h3 className="section-title">Guias dos tributos retidos</h3>
      <p className="muted" style={{ fontSize: 13, margin: "0 0 8px" }}>
        As retenções das notas aprovadas viram, a cada mês de emissão, uma conta a pagar por tributo para o órgão abaixo, vencendo no dia escolhido do mês seguinte (confira com o contador; em fim de semana ou feriado, ajuste o vencimento na conta a pagar). Sem órgão, a guia não é gerada.
      </p>
      <div className="regras-grade">
        {TRIBUTOS_GUIA.map((t) => (
          <div key={t.id} className="regra-linha" style={{ gridTemplateColumns: "minmax(160px, 1fr) minmax(220px, 320px) 110px" }}>
            <label htmlFor={`gt-${t.id}`} style={{ fontWeight: 600, fontSize: 13.5 }}>{t.rotulo}</label>
            <select id={`gt-${t.id}`} style={inp} value={guias[t.id]?.pessoa_id ?? ""} onChange={(e) => salvar(t, { pessoa_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">— Sem órgão (não gera guia) —</option>
              {orgaos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>Dia
              <input type="number" min={1} max={31} style={{ ...inp, width: 64 }} aria-label={`Dia de vencimento — ${t.rotulo}`}
                defaultValue={guias[t.id]?.dia_vencimento ?? (t.id === "iss" ? 10 : 20)}
                onBlur={(e) => { const d = Number(e.target.value); if (d !== guias[t.id]?.dia_vencimento) salvar(t, { dia_vencimento: d }); }} />
            </label>
          </div>
        ))}
      </div>
      {!guias.iss?.pessoa_id && <div className="muted" style={{ fontSize: 12.5 }}>ISS: cadastre a prefeitura como fornecedor (em Administrativo → Fornecedores) e escolha acima.</div>}
      {ok && <div className="alert alert-ok" style={{ marginTop: 8 }}><Icone nome="check" tamanho={16} /><span>{ok}</span></div>}
      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 8 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </div>
  );
}

export default function RegrasContabeis({ cadastros }) {
  const [regras, setRegras] = useState(null);
  const [salvando, setSalvando] = useState("");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    let ativo = true;
    listarRegrasContabeis().then((d) => { if (ativo) setRegras(Object.fromEntries(d.map((r) => [r.chave, r.conta_id]))); }).catch((e) => { if (ativo) setErro(mensagemErro(e)); });
    return () => { ativo = false; };
  }, []);

  async function mudar(chave, contaId, rotulo) {
    if (!contaId) return;
    setSalvando(chave); setErro(""); setOk("");
    try { await salvarRegraContabil(chave, contaId); setRegras((r) => ({ ...r, [chave]: contaId })); setOk(`Regra “${rotulo}” salva.`); }
    catch (e) { setErro(mensagemErro(e)); }
    finally { setSalvando(""); }
  }

  const faltando = regras ? REGRAS.flatMap((g) => g.itens).filter((i) => !regras[i.chave]).length : 0;

  return (
    <>
      <CabecalhoAba titulo="Regras de contabilização"
        descricao="Em que conta contábil cai cada lançamento automático (notas, pagamentos, dízimos e ofertas, contas a receber e movimentos de caixa), e o órgão e o vencimento das guias dos tributos retidos. A conta de débito das notas vem do tipo contábil de cada item; a conta das contas caixa, do cadastro de cada uma. Trocar uma regra vale daqui para frente: o que já está no diário não muda." />
      <div style={{ padding: "0 24px 24px" }}>
        {!regras && !erro && <div className="carregando-linha"><div className="spinner" /> Carregando...</div>}
        {faltando > 0 && <div className="alert alert-warn" style={{ marginBottom: 12 }}><Icone nome="alerta" tamanho={16} /><span>{faltando} regra(s) sem conta: os lançamentos que dependem delas ficam pendentes no Contábil até a conta ser escolhida.</span></div>}
        {regras && REGRAS.map((g) => (
          <div key={g.grupo}>
            <h3 className="section-title">{g.grupo}</h3>
            <div className="regras-grade">
              {g.itens.map((i) => (
                <div key={i.chave} className="regra-linha">
                  <div>
                    <label htmlFor={`rg-${i.chave}`} style={{ fontWeight: 600, fontSize: 13.5 }}>{i.rotulo}</label>
                    {i.ajuda && <div className="muted" style={{ fontSize: 12 }}>{i.ajuda}</div>}
                  </div>
                  <ContaSelect id={`rg-${i.chave}`} contas={cadastros.contas} naturezas={i.naturezas} valor={regras[i.chave] ?? null}
                    vazio="— Escolha a conta —" disabled={salvando === i.chave} onChange={(v) => mudar(i.chave, v, i.rotulo)} />
                </div>
              ))}
            </div>
          </div>
        ))}
        {ok && <div className="alert alert-ok" style={{ marginTop: 12 }}><Icone nome="check" tamanho={16} /><span>{ok}</span></div>}
        {regras && <GuiasTributos cadastros={cadastros} />}
        {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 12 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
      </div>
    </>
  );
}
