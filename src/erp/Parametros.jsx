import { useState } from "react";
import { Header } from "../ui";
import { inp } from "../estilos";
import Icone from "./Icone";
import { salvarParametros, mensagemErro } from "./db";
import { TIPOS_NOTA } from "./format";
import {
  TAMANHO_NUMERO_PADRAO, TAMANHO_NUMERO_MIN, TAMANHO_NUMERO_MAX, chaveTamanhoNumero, tamanhoNumero,
} from "./catalogoParametros";

// Parâmetros da empresa. Só o Administrador acessa. Para novos parâmetros, acrescente um bloco aqui
// (e o catálogo em parametros.js + a regra no banco).
export default function Parametros({ cadastros, onCadastrosMudaram }) {
  const tipos = Object.keys(TIPOS_NOTA);
  const salvos = Object.fromEntries(tipos.map((t) => [t, String(tamanhoNumero(cadastros.parametros, t))]));
  const [valores, setValores] = useState(salvos);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);

  const invalido = (t) => {
    const n = Number(valores[t]);
    return !/^\d+$/.test(valores[t]) || n < TAMANHO_NUMERO_MIN || n > TAMANHO_NUMERO_MAX;
  };
  const alterados = tipos.filter((t) => valores[t] !== salvos[t]);
  const temInvalido = tipos.some(invalido);

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
    <div>
      <div className="page-header">
        <Header title="Parâmetros" subtitle="Configurações desta empresa. Apenas administradores têm acesso." />
      </div>

      <div className="card" style={{ maxWidth: 760 }}>
        <div style={{ padding: "20px 24px 4px" }}>
          <h2 style={{ fontSize: 16, fontWeight: 650 }}>Notas de entrada</h2>
          <p className="muted" style={{ marginTop: 4 }}>
            Tamanho máximo do campo <strong>Número</strong> para cada tipo de nota. Vale para notas novas e para edições de
            rascunho; notas já lançadas não são alteradas.
          </p>
        </div>

        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr><th>Tipo de nota</th><th>Padrão do sistema</th><th>Tamanho máximo do número</th></tr>
            </thead>
            <tbody>
              {tipos.map((t) => (
                <tr key={t}>
                  <td style={{ fontWeight: 550 }}>{TIPOS_NOTA[t]}</td>
                  <td className="muted">{TAMANHO_NUMERO_PADRAO[t]} caracteres</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
          <button className="btn btn-primary" onClick={salvar} disabled={salvando || alterados.length === 0 || temInvalido}>
            {salvando ? "Salvando..." : "Salvar alterações"}
          </button>
          {alterados.length > 0 && (
            <button className="btn btn-ghost" onClick={() => { setValores(salvos); setErro(""); }} disabled={salvando}>Desfazer</button>
          )}
          {ok && <span className="pill pill-ok"><Icone nome="check" tamanho={13} traco={2.4} />Parâmetros salvos</span>}
          {erro && <div className="alert alert-danger" role="alert" style={{ flex: "1 1 100%" }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
        </div>
      </div>
    </div>
  );
}
