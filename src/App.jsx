import { useEffect, useState } from "react";
import { getSession, getPerfil, signIn, signOut, onAuthChange } from "./auth";
import { listarEmpresasAtivas, trocarEmpresa, mensagemErro } from "./erp/db";
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

// O administrador da plataforma não pertence a nenhuma igreja: se nenhuma estiver escolhida, escolhe aqui.
function EscolherIgreja({ onEscolhida, botaoSair }) {
  const [igrejas, setIgrejas] = useState(null);
  const [erro, setErro] = useState("");
  const [abrindo, setAbrindo] = useState(null);
  useEffect(() => { listarEmpresasAtivas().then(setIgrejas).catch((e) => setErro(mensagemErro(e))); }, []);
  async function escolher(id) {
    setAbrindo(id);
    try { await trocarEmpresa(id); onEscolhida(); } catch (e) { setErro(mensagemErro(e)); setAbrindo(null); }
  }
  return (
    <div className="splash" style={{ padding: 16 }}>
      <div className="card" style={{ maxWidth: 440, width: "100%", padding: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}><Marca /><h2 style={{ fontSize: 18 }}>Em qual igreja vai trabalhar?</h2></div>
        <p className="muted" style={{ marginBottom: 14 }}>Como administrador da plataforma, você escolhe a igreja. Dá para trocar depois clicando no nome dela no menu.</p>
        {igrejas === null && !erro && <div className="carregando-linha"><div className="spinner" /> Carregando...</div>}
        {igrejas && igrejas.length === 0 && <p className="muted">Nenhuma igreja ativa cadastrada.</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(igrejas || []).map((i) => (
            <button key={i.id} className="btn btn-ghost" style={{ justifyContent: "space-between" }} disabled={abrindo !== null} onClick={() => escolher(i.id)}>
              <span>{i.nome_fantasia || i.razao_social}</span>{abrindo === i.id ? <span className="muted">abrindo…</span> : <Icone nome="seta" tamanho={16} />}
            </button>
          ))}
        </div>
        {erro && <div className="alert alert-danger" style={{ marginTop: 12 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
        <div style={{ marginTop: 18 }}>{botaoSair}</div>
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
  const recarregarPerfil = () => { setPerfilInfo(null); setTentativa((t) => t + 1); };
  if (perfil?.plataforma_admin && !perfil.empresa_id) {
    return <EscolherIgreja onEscolhida={recarregarPerfil} botaoSair={botaoSair} />;
  }
  if (!perfil || !permissoes(perfil).lancar) {
    return <AvisoTela icone="cadeado" titulo="Sem acesso ao sistema"
      texto={`A conta ${email} ainda não foi liberada. Peça a um administrador para cadastrá-la em uma empresa.`} acoes={botaoSair} />;
  }

  // key: ao trocar de empresa, a tela inteira recomeça do zero (nada da empresa anterior fica em memória)
  return <ErpApp key={perfil.empresa_id} perfil={perfil} onSair={() => signOut()}
    onEmpresaTrocada={recarregarPerfil} />;
}
