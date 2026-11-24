import { useState } from "react";
import { Pill } from "../ui";
import { lbl, inp, msgErro } from "../estilos";
import Icone from "./Icone";
import Modal from "./Modal";
import { alterarMinhaSenha } from "../auth";
import { rotuloNivel } from "./permissoes";
import { SENHA_MINIMA } from "./senha";

export default function MinhaConta({ perfil, onFechar }) {
  const [nova, setNova] = useState("");
  const [confirma, setConfirma] = useState("");
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);

  const erros = {
    nova: nova.length < SENHA_MINIMA ? `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres` : "",
    confirma: confirma !== nova ? "As senhas não são iguais" : "",
  };

  async function trocar() {
    setTentou(true);
    setErro("");
    setOk(false);
    if (erros.nova || erros.confirma) return;
    setSalvando(true);
    try {
      await alterarMinhaSenha(nova);
      setOk(true);
      setNova("");
      setConfirma("");
      setTentou(false);
    } catch (e) {
      setErro(/same password|different from the old/i.test(e?.message || "") ? "A nova senha precisa ser diferente da atual." : e?.message || "Não foi possível trocar a senha.");
    } finally {
      setSalvando(false);
    }
  }

  const linha = (rotulo, valor) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
      <span className="muted">{rotulo}</span><span style={{ fontWeight: 550, textAlign: "right" }}>{valor}</span>
    </div>
  );

  return (
    <Modal titulo="Minha conta" largura={480} onFechar={onFechar} fecharFora={false}
      rodape={<button className="btn btn-ghost" onClick={onFechar}>Fechar</button>}>
      <div style={{ marginTop: 8 }}>
        {linha("Nome", perfil.nome)}
        {linha("E-mail", perfil.email)}
        {linha("Empresa", perfil.empresa_nome)}
        {linha("Nível de acesso", <Pill tone="neutral">{rotuloNivel(perfil.nivel)}</Pill>)}
      </div>

      <h3 className="section-title">Trocar senha</h3>
      <label style={{ ...lbl, marginTop: 0 }} htmlFor="c-nova">Nova senha</label>
      <input id="c-nova" type="password" autoComplete="new-password" style={{ ...inp, ...(tentou && erros.nova ? { borderColor: "var(--danger)" } : {}) }}
        value={nova} onChange={(e) => { setNova(e.target.value); setOk(false); }} />
      {tentou && erros.nova && <div style={msgErro}>{erros.nova}</div>}
      <label style={lbl} htmlFor="c-conf">Repita a nova senha</label>
      <input id="c-conf" type="password" autoComplete="new-password" style={{ ...inp, ...(tentou && erros.confirma ? { borderColor: "var(--danger)" } : {}) }}
        value={confirma} onChange={(e) => { setConfirma(e.target.value); setOk(false); }} />
      {tentou && erros.confirma && <div style={msgErro}>{erros.confirma}</div>}

      <button className="btn btn-primary" onClick={trocar} disabled={salvando} style={{ marginTop: 18 }}>{salvando ? "Salvando..." : "Trocar senha"}</button>
      {ok && <div className="alert alert-ok" role="status" style={{ marginTop: 14 }}><Icone nome="check" tamanho={16} /><span>Senha alterada com sucesso.</span></div>}
      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 14 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}
