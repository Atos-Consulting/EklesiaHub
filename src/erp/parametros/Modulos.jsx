import { useState } from "react";
import Icone from "../Icone";
import { salvarParametros, mensagemErro } from "../db";
import { CHAVE_CONTABILIDADE, usaContabilidade } from "../catalogoParametros";
import { CabecalhoAba } from "./comum";

// Sistema → Módulos: liga/desliga partes do sistema para esta igreja.
export default function Modulos({ cadastros, onCadastrosMudaram }) {
  const salvo = usaContabilidade(cadastros.parametros);
  const [contabil, setContabil] = useState(salvo);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);

  async function salvar() {
    setErro("");
    setOk(false);
    setSalvando(true);
    try {
      // Ativo é o padrão: ligar de novo apaga o parâmetro.
      await salvarParametros([{ chave: CHAVE_CONTABILIDADE, valor: contabil ? null : "false" }]);
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
      <CabecalhoAba titulo="Módulos" descricao="Escolha o que esta igreja usa. O que for desligado sai do menu de todos os usuários da igreja; os dados já lançados são preservados." />
      <div style={{ padding: "0 24px 24px" }}>
        <label className="tributo tributo-marca" style={{ padding: "14px 16px", alignItems: "flex-start" }}>
          <input type="checkbox" checked={contabil} onChange={(e) => { setOk(false); setContabil(e.target.checked); }} style={{ marginTop: 3 }} />
          <span>
            <strong style={{ display: "block", color: "var(--text)" }}>Usar contabilidade</strong>
            <span className="muted" style={{ fontSize: 12.5 }}>Mostra o módulo Contábil no menu (plano de contas, lançamentos, razão e balancete). Desmarcado, o módulo some para esta igreja.</span>
          </span>
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 20 }}>
          {ok && <span className="pill pill-ok">Salvo</span>}
          <button className="btn btn-primary" onClick={salvar} disabled={salvando || contabil === salvo}>{salvando ? "Salvando..." : "Salvar"}</button>
        </div>
        {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
      </div>
    </>
  );
}
