import { useEffect, useState } from "react";
import Icone from "../Icone";
import { listarRegrasContabeis, salvarRegraContabil, mensagemErro } from "../db";
import { ContaSelect } from "../contabil/comum";
import { CabecalhoAba } from "./comum";

// Parâmetros → Contábil → Regras de contabilização (v25): em que conta cai cada lançamento automático.
// Trocar uma regra vale para o que entrar daqui para frente; o que já está no diário não muda.

const REGRAS = [
  { grupo: "Patrimônio e obrigações", itens: [
    { chave: "patrimonio", rotulo: "Patrimônio social", ajuda: "Contrapartida do saldo inicial das contas caixa.", naturezas: ["patrimonio_social"] },
    { chave: "fornecedores", rotulo: "Fornecedores a pagar", ajuda: "Crédito da nota aprovada e das contas a pagar; débito no pagamento.", naturezas: ["passivo"] },
    { chave: "retencoes", rotulo: "Retenções a recolher", ajuda: "INSS, IRRF, ISS retido e outras retenções da nota.", naturezas: ["passivo"] },
    { chave: "contas_receber", rotulo: "Contas a receber", ajuda: "Débito ao lançar a conta a receber; crédito no recebimento.", naturezas: ["ativo"] },
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
        descricao="Em que conta contábil cai cada lançamento automático (notas, pagamentos, dízimos e ofertas, contas a receber e movimentos de caixa). A conta de débito das notas vem do tipo contábil de cada item; a conta das contas caixa, do cadastro de cada uma. Trocar uma regra vale daqui para frente: o que já está no diário não muda." />
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
        {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 12 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
      </div>
    </>
  );
}
