import { useEffect, useState } from "react";
import { getSession, getPerfil, signIn, signOut, onAuthChange } from "./auth";
import ErpApp from "./erp/ErpApp";
import Login from "./erp/Login";
import Marca from "./erp/Marca";
import Icone from "./erp/Icone";
import { permissoes } from "./erp/permissoes";

// O módulo Kids (check-in, salas, crianças...) está arquivado em src/kids/ — o produto é só o ERP por enquanto.

function Splash({ texto }) {
  return (
    <div className="splash">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
        <Marca tamanho={44} />
        <div className="spinner" />
        {texto && <div className="muted">{texto}</div>}
      </div>
    </div>
  );
}

function AvisoTela({ icone, titulo, texto, acoes }) {
  return (
    <div className="splash" style={{ padding: 16 }}>
      <div className="card" style={{ maxWidth: 440, width: "100%" }}>
        <div className="empty">
          <div className="empty-icon"><Icone nome={icone} tamanho={26} /></div>
          <h2>{titulo}</h2>
          <p>{texto}</p>
          <div style={{ display: "flex", gap: 10, marginTop: 22 }}>{acoes}</div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  // undefined = ainda verificando se existe sessão salva; null = sem sessão (precisa entrar)
  const [session, setSession] = useState(undefined);
  const [perfilInfo, setPerfilInfo] = useState(null);
  const [tentativa, setTentativa] = useState(0);
  const usuarioId = session?.user?.id;

  useEffect(() => {
    let ativo = true;
    getSession().then((s) => { if (ativo) setSession(s); }).catch(() => { if (ativo) setSession(null); });
    const inscricao = onAuthChange((s) => { if (ativo) setSession(s); });
    return () => { ativo = false; inscricao.unsubscribe(); };
  }, []);

  // O perfil (nível e empresa) vem do banco. Guardamos junto o id do usuário para nunca mostrar o de quem saiu.
  useEffect(() => {
    if (!usuarioId) return;
    let ativo = true;
    getPerfil()
      .then((perfil) => { if (ativo) setPerfilInfo({ usuarioId, perfil, erro: false }); })
      .catch(() => { if (ativo) setPerfilInfo({ usuarioId, perfil: null, erro: true }); });
    return () => { ativo = false; };
  }, [usuarioId, tentativa]);

  const info = usuarioId && perfilInfo?.usuarioId === usuarioId ? perfilInfo : null;

  if (session === undefined) return <Splash />;
  if (!session) return <Login onEntrar={signIn} />;
  if (!info) return <Splash texto="Carregando seu perfil..." />;

  const botaoSair = <button className="btn btn-ghost" onClick={() => signOut()}>Sair</button>;
  const email = session.user.email;

  if (info.erro) {
    return (
      <AvisoTela icone="alerta" titulo="Não foi possível carregar seu perfil"
        texto="Verifique sua conexão e tente novamente."
        acoes={<>
          <button className="btn btn-primary" onClick={() => { setPerfilInfo(null); setTentativa((t) => t + 1); }}>Tentar de novo</button>
          {botaoSair}
        </>} />
    );
  }

  const perfil = info.perfil;

  if (perfil?.empresa_ativa === false) {
    return <AvisoTela icone="cadeado" titulo="Empresa desativada"
      texto={`O acesso da empresa ${perfil.empresa_nome} está desativado. Fale com o administrador da plataforma.`} acoes={botaoSair} />;
  }
  if (perfil && perfil.ativo === false) {
    return <AvisoTela icone="cadeado" titulo="Usuário desativado"
      texto="O seu acesso foi desativado. Fale com o administrador da sua empresa." acoes={botaoSair} />;
  }
  if (!perfil || !permissoes(perfil).lancar) {
    return <AvisoTela icone="cadeado" titulo="Sem acesso ao sistema"
      texto={`A conta ${email} ainda não foi liberada. Peça a um administrador para cadastrá-la em uma empresa.`} acoes={botaoSair} />;
  }

  return <ErpApp perfil={perfil} onSair={() => signOut()} />;
}
