import { useState } from "react";
import { inp } from "../../estilos";
import Icone from "../Icone";
import ThOrdenavel from "../ThOrdenavel";
import { useOrdenacao } from "../useOrdenacao";
import { salvarParametros, mensagemErro } from "../db";
import { TIPOS_NOTA } from "../format";
import { TAMANHO_NUMERO_PADRAO, TAMANHO_NUMERO_MIN, TAMANHO_NUMERO_MAX, chaveTamanhoNumero, tamanhoNumero } from "../catalogoParametros";
import { CabecalhoAba } from "./comum";

const COLUNAS = { tipo: (t) => TIPOS_NOTA[t], padrao: (t) => TAMANHO_NUMERO_PADRAO[t] };
const TIPOS = Object.keys(TIPOS_NOTA);

// Sistema → Tamanho dos campos. Para novos parâmetros do sistema, acrescente blocos aqui
// (e o catálogo em catalogoParametros.js + a regra no banco).
export default function NumeroNotas({ cadastros, onCadastrosMudaram }) {
  const salvos = Object.fromEntries(TIPOS.map((t) => [t, String(tamanhoNumero(cadastros.parametros, t))]));
  const [valores, setValores] = useState(salvos);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);
  const ordenacao = useOrdenacao(TIPOS, COLUNAS, null);

  const invalido = (t) => {
    const n = Number(valores[t]);
    return !/^\d+$/.test(valores[t]) || n < TAMANHO_NUMERO_MIN || n > TAMANHO_NUMERO_MAX;
  };
  const alterados = TIPOS.filter((t) => valores[t] !== salvos[t]);
  const temInvalido = TIPOS.some(invalido);

  async function salvar() {
    setErro("");
    setOk(false);
    setSalvando(true);
    try {
      // Valor igual ao padrão remove o parâmetro (a empresa volta a acompanhar o padrão do sistema).
      await salvarParametros(alterados.map((t) => ({
        chave: chaveTamanhoNumero(t),
        valor: Number(valores[t]) === TAMANHO_NUMERO_PADRAO[t] ? null : valores[t],
      })));
      await onCadastrosMudaram();
      setOk(true);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <CabecalhoAba titulo="Tamanho dos campos — Notas de entrada"
        descricao="Tamanho máximo do campo Número para cada tipo de nota. Vale para notas novas e para edições de rascunho; notas já lançadas não são alteradas." />
      <div className="table-wrap">
        <table className="table">
          <thead><tr>
            <ThOrdenavel chave="tipo" ordenacao={ordenacao}>Tipo de nota</ThOrdenavel>
            <ThOrdenavel chave="padrao" ordenacao={ordenacao}>Padrão do sistema</ThOrdenavel>
            <th>Tamanho máximo do número</th>
          </tr></thead>
          <tbody>
            {ordenacao.ordenadas.map((t) => (
              <tr key={t}>
                <td style={{ fontWeight: 550 }}>{TIPOS_NOTA[t]}</td>
                <td className="muted">{TAMANHO_NUMERO_PADRAO[t]} caracteres</td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <input type="number" inputMode="numeric" min={TAMANHO_NUMERO_MIN} max={TAMANHO_NUMERO_MAX}
                      aria-label={`Tamanho máximo do número — ${TIPOS_NOTA[t]}`}
                      value={valores[t]} onChange={(e) => { setValores((p) => ({ ...p, [t]: e.target.value })); setOk(false); }}
                      style={{ ...inp, width: 96, ...(invalido(t) ? { borderColor: "var(--danger)" } : {}) }} />
                    <span className="muted">caracteres</span>
                    {valores[t] !== salvos[t] && !invalido(t) && <span className="pill pill-warn">alterado</span>}
                    {invalido(t) && <span style={{ color: "var(--danger)", fontSize: 12.5 }}>Use de {TAMANHO_NUMERO_MIN} a {TAMANHO_NUMERO_MAX}</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: "16px 24px 20px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={salvar} disabled={salvando || alterados.length === 0 || temInvalido}>{salvando ? "Salvando..." : "Salvar alterações"}</button>
        {alterados.length > 0 && <button className="btn btn-ghost" onClick={() => { setValores(salvos); setErro(""); }} disabled={salvando}>Desfazer</button>}
        {ok && <span className="pill pill-ok"><Icone nome="check" tamanho={13} traco={2.4} />Parâmetros salvos</span>}
        {erro && <div className="alert alert-danger" role="alert" style={{ flex: "1 1 100%" }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
      </div>
    </>
  );
}
