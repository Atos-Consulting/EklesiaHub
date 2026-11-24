import { useState } from "react";
import Icone from "./Icone";
import Marca from "./Marca";
import { lbl, inp } from "../estilos";

function traduzirErro(e) {
  const msg = e?.message || "";
  if (/invalid login credentials/i.test(msg)) return "E-mail ou senha incorretos.";
  if (/email not confirmed/i.test(msg)) return "Este e-mail ainda não foi confirmado.";
  if (/failed to fetch|network/i.test(msg)) return "Sem conexão com o servidor. Verifique sua internet e tente de novo.";
  if (/rate limit|too many/i.test(msg)) return "Muitas tentativas. Aguarde um instante e tente de novo.";
  return msg || "Não foi possível entrar. Tente novamente.";
}

const DESTAQUES = [
  { icone: "arquivo", texto: "Notas de entrada com anexos, aprovação e cancelamento controlado" },
  { icone: "escudo", texto: "Acesso por perfil: administrador, financeiro, contador e comercial" },
  { icone: "grafico", texto: "Financeiro, contábil e comercial integrados em um só sistema" },
];

export default function Login({ onEntrar }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [verSenha, setVerSenha] = useState(false);
  const [entrando, setEntrando] = useState(false);
  const [erro, setErro] = useState("");

  async function enviar(e) {
    e.preventDefault();
    setErro("");
    setEntrando(true);
    try {
      await onEntrar(email.trim(), senha);
    } catch (err) {
      setErro(traduzirErro(err));
      setEntrando(false);
    }
  }

  return (
    <div className="login">
      <section className="login-brand">
        <div className="brand" style={{ padding: 0 }}>
          <Marca />
          <div>
            <div className="brand-name">EklesiaHub</div>
            <div className="brand-sub">ERP</div>
          </div>
        </div>
        <div>
          <h1>Gestão administrativa, financeira e contábil da sua igreja</h1>
          <p>Controle notas, fornecedores e, em breve, financeiro, contabilidade e comercial — tudo em um só lugar.</p>
          <ul className="login-features">
            {DESTAQUES.map((d) => (
              <li key={d.icone}><span className="ic"><Icone nome={d.icone} tamanho={17} /></span>{d.texto}</li>
            ))}
          </ul>
        </div>
        <div className="login-rodape">© {new Date().getFullYear()} EklesiaHub</div>
      </section>

      <main className="login-form-area">
        <form className="login-form" onSubmit={enviar}>
          <div className="login-logo-mobile">
            <Marca />
            <div>
              <div className="brand-name" style={{ color: "var(--text)" }}>EklesiaHub</div>
              <div className="brand-sub">ERP</div>
            </div>
          </div>
          <h2>Entrar</h2>
          <p className="sub">Acesse com o e-mail e a senha do seu usuário.</p>

          <label style={{ ...lbl, marginTop: 0 }} htmlFor="email">E-mail</label>
          <input id="email" type="email" required autoFocus autoComplete="username" style={inp}
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@igreja.com.br" />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <label style={lbl} htmlFor="senha">Senha</label>
            <button type="button" className="link-btn" style={{ fontSize: 13, marginTop: 10 }} onClick={() => setVerSenha((v) => !v)}>
              {verSenha ? "Ocultar" : "Mostrar"}
            </button>
          </div>
          <input id="senha" type={verSenha ? "text" : "password"} required autoComplete="current-password" style={inp}
            value={senha} onChange={(e) => setSenha(e.target.value)} />

          {erro && (
            <div className="alert alert-danger" role="alert" style={{ marginTop: 16 }}>
              <Icone nome="alerta" tamanho={16} /> <span>{erro}</span>
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={entrando}
            style={{ width: "100%", marginTop: 22, padding: "11px 14px", fontSize: 14.5 }}>
            {entrando ? "Entrando..." : "Entrar"}
          </button>

          <p className="muted" style={{ marginTop: 18, fontSize: 13, textAlign: "center" }}>
            Não tem acesso? Peça a um administrador para criar o seu usuário.
          </p>
        </form>
      </main>
    </div>
  );
}
