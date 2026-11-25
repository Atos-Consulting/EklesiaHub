import { useCallback, useEffect, useMemo, useState } from "react";
import { Header } from "../ui";
import Icone from "./Icone";
import Marca from "./Marca";
import NotasEntrada from "./NotasEntrada";
import ContasPagar from "./ContasPagar";
import Pagamentos from "./Pagamentos";
import Fornecedores from "./Fornecedores";
import ImportarXml from "./ImportarXml";
import Parametros from "./Parametros";
import { ABAS_PARAMETROS } from "./parametros/grupos";
import Usuarios from "./Usuarios";
import Empresas from "./Empresas";
import MinhaConta from "./MinhaConta";
import { fetchCadastros, mensagemErro } from "./db";
import { permissoes, rotuloNivel } from "./permissoes";

// Módulos do ERP. `visivel(perm)` decide quem enxerga; `pronto` indica o que já foi construído.
// O grupo "Sistema" fica sempre no fim do menu.
const MODULOS = [
  { id: "dashboard", grupo: "Visão geral", rotulo: "Dashboard", icone: "dashboard", pronto: false,
    descricao: "Indicadores consolidados da empresa em uma única tela.",
    previsto: ["Saldo de caixa e bancos", "Contas a pagar e a receber da semana", "Entradas x saídas do mês", "Resultado do período (superávit/déficit)", "Vendas da livraria e do bazar"] },
  { id: "administrativo", grupo: "Gestão", rotulo: "Administrativo", icone: "pasta", pronto: true,
    telas: [{ id: "notas", rotulo: "Notas de entrada" }, { id: "fornecedores", rotulo: "Fornecedores" }, { id: "importar", rotulo: "Importar XML" }] },
  { id: "financeiro", grupo: "Gestão", rotulo: "Financeiro", icone: "carteira", pronto: true,
    telas: [{ id: "pagar", rotulo: "Contas a pagar" }, { id: "pagamentos", rotulo: "Pagamentos" }] },
  { id: "contabil", grupo: "Gestão", rotulo: "Contábil", icone: "calculadora", pronto: false,
    descricao: "Escrituração contábil integrada aos demais módulos.",
    previsto: ["Plano de contas editável", "Lançamentos em partidas dobradas", "Razão e balancete", "DRE e balanço patrimonial", "Contabilização automática das notas aprovadas"] },
  { id: "comercial", grupo: "Gestão", rotulo: "Comercial", icone: "sacola", pronto: false,
    descricao: "Livraria, bazar e demais vendas.",
    previsto: ["Produtos e controle de estoque", "Vendas e ponto de venda (PDV)", "Compras via notas de entrada", "Custo das mercadorias vendidas"] },
  // Grupo Sistema, nesta ordem: Empresas (administrador da plataforma), Usuários, Parâmetros (administrador da empresa).
  { id: "empresas", grupo: "Sistema", rotulo: "Empresas", icone: "predio", pronto: true, visivel: (p) => p.plataforma },
  { id: "usuarios", grupo: "Sistema", rotulo: "Usuários", icone: "pessoas", pronto: true, visivel: (p) => p.gerirUsuarios },
  { id: "parametros", grupo: "Sistema", rotulo: "Parâmetros", icone: "ajustes", pronto: true, abas: true, telas: ABAS_PARAMETROS, visivel: (p) => p.administrar },
];

// Rota por URL (#/modulo/tela): botão voltar, atualizar a página e links diretos funcionam.
function lerRota() {
  const [, modulo = "", tela = ""] = window.location.hash.replace(/^#/, "").split("/");
  return { modulo, tela };
}

const iniciais = (nome) => {
  const partes = (nome || "?").trim().split(/\s+/);
  return (partes.length > 1 ? partes[0][0] + partes[1][0] : partes[0].slice(0, 2)).toUpperCase();
};
const dataHoje = () => {
  const texto = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

export default function ErpApp({ perfil, onSair }) {
  const perm = useMemo(() => permissoes(perfil), [perfil]);
  const visiveis = useMemo(() => MODULOS.filter((m) => !m.visivel || m.visivel(perm)), [perm]);
  const [rota, setRota] = useState(lerRota);
  const [menuAberto, setMenuAberto] = useState(false);
  const [minhaConta, setMinhaConta] = useState(false);
  const [cadastros, setCadastros] = useState(null);
  const [erro, setErro] = useState("");
  const nomeUsuario = perfil.nome || perfil.email;

  useEffect(() => {
    const aoMudar = () => setRota(lerRota());
    window.addEventListener("hashchange", aoMudar);
    return () => window.removeEventListener("hashchange", aoMudar);
  }, []);

  const modulo = visiveis.find((m) => m.id === rota.modulo) || visiveis.find((m) => m.pronto) || visiveis[0];
  const tela = modulo?.telas?.find((t) => t.id === rota.tela) || modulo?.telas?.[0];
  const precisaCadastros = ["administrativo", "financeiro", "parametros"].includes(modulo?.id);

  useEffect(() => {
    document.title = `${[tela?.rotulo, modulo?.rotulo].filter(Boolean).join(" · ") || "ERP"} — EklesiaHub`;
  }, [modulo, tela]);

  const recarregarCadastros = useCallback(
    () => fetchCadastros().then((dados) => { setCadastros(dados); setErro(""); }).catch((e) => setErro(mensagemErro(e))),
    [],
  );
  // Recarrega ao entrar em Administrativo/Financeiro/Parâmetros: saldos das contas caixa e cadastros podem ter mudado em outra tela.
  const moduloId = modulo?.id;
  useEffect(() => { if (precisaCadastros) recarregarCadastros(); }, [precisaCadastros, moduloId, recarregarCadastros]);

  const hrefModulo = (m) => `#/${m.id}${m.telas ? `/${m.telas[0].id}` : ""}`;
  const grupos = [...new Set(visiveis.map((m) => m.grupo))];

  function conteudo() {
    if (!modulo) {
      return (
        <div className="card"><div className="empty">
          <div className="empty-icon"><Icone nome="cadeado" tamanho={26} /></div>
          <h2>Sem módulos liberados</h2>
          <p>Seu nível ({rotuloNivel(perfil.nivel)}) não tem acesso a nenhum módulo. Peça a um administrador.</p>
        </div></div>
      );
    }
    if (!modulo.pronto) {
      return (
        <>
          <div className="page-header"><Header title={modulo.rotulo} subtitle={modulo.descricao} /><span className="pill pill-warn">Em construção</span></div>
          <div className="card"><div className="empty">
            <div className="empty-icon"><Icone nome={modulo.icone} tamanho={26} /></div>
            <h2>Este módulo ainda está sendo construído</h2>
            <p>O que está previsto para chegar:</p>
            <ul>{modulo.previsto.map((p) => <li key={p}><Icone nome="check" tamanho={16} />{p}</li>)}</ul>
          </div></div>
        </>
      );
    }
    if (modulo.id === "usuarios") return <Usuarios perfil={perfil} niveisQueGere={perm.niveisQueGere} />;
    if (modulo.id === "empresas") return <Empresas perfil={perfil} />;
    if (erro) return <div className="alert alert-danger" role="alert"><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>;
    if (!cadastros) return <div className="carregando-linha"><div className="spinner" /> Carregando...</div>;
    if (modulo.id === "parametros") return <Parametros aba={tela?.id} cadastros={cadastros} onCadastrosMudaram={recarregarCadastros} />;
    if (modulo.id === "financeiro") {
      const propsFin = { cadastros, podePagar: perm.pagar, onCadastrosMudaram: recarregarCadastros };
      return tela?.id === "pagamentos" ? <Pagamentos {...propsFin} /> : <ContasPagar {...propsFin} />;
    }
    const props = { cadastros, podeEditar: perm.lancar, podeAprovar: perm.aprovar, podeAdministrar: perm.administrar, onCadastrosMudaram: recarregarCadastros };
    if (tela?.id === "fornecedores") return <Fornecedores {...props} />;
    if (tela?.id === "importar") return <ImportarXml perfil={perfil} {...props} />;
    return <NotasEntrada {...props} />;
  }

  function item(m) {
    const ativo = m.id === modulo?.id;
    return (
      <div key={m.id}>
        <a href={hrefModulo(m)} className={`nav-item${ativo ? " ativo" : ""}`}
          aria-current={ativo && !m.telas ? "page" : undefined} onClick={() => setMenuAberto(false)}>
          <Icone nome={m.icone} />
          <span className="texto">{m.rotulo}</span>
          {!m.pronto && <span className="nav-soon">em breve</span>}
        </a>
        {ativo && m.telas && !m.abas && (
          <div className="nav-sub">
            {m.telas.map((t) => (
              <a key={t.id} href={`#/${m.id}/${t.id}`} className="nav-item"
                aria-current={t.id === tela?.id ? "page" : undefined} onClick={() => setMenuAberto(false)}>
                <span className="texto">{t.rotulo}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="shell">
      <div className={`sidebar-overlay${menuAberto ? " aberta" : ""}`} onClick={() => setMenuAberto(false)} />

      <aside className={`sidebar${menuAberto ? " aberta" : ""}`} aria-label="Menu principal">
        <div className="brand">
          <Marca />
          <div style={{ minWidth: 0 }}>
            <div className="brand-name">EklesiaHub</div>
            <div className="brand-empresa" title={perfil.empresa_nome}>{perfil.empresa_nome}</div>
          </div>
        </div>

        <nav className="nav">
          {grupos.filter((g) => g !== "Sistema").map((g) => (
            <div key={g}>
              <div className="nav-label">{g}</div>
              {visiveis.filter((m) => m.grupo === g).map(item)}
            </div>
          ))}
          {grupos.includes("Sistema") && (
            <div className="nav-bottom">
              <div className="nav-label">Sistema</div>
              {visiveis.filter((m) => m.grupo === "Sistema").map(item)}
            </div>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-card">
            <button className="user-info-btn" onClick={() => setMinhaConta(true)} title="Minha conta e senha">
              <div className="avatar">{iniciais(nomeUsuario)}</div>
              <div className="user-info">
                <div className="user-name">{nomeUsuario}</div>
                <div className="user-role">{rotuloNivel(perfil.nivel)}{perm.plataforma ? " · Plataforma" : ""}</div>
              </div>
            </button>
            <button className="icon-btn" onClick={onSair} aria-label="Sair" title="Sair"><Icone nome="sair" /></button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setMenuAberto(true)} aria-label="Abrir menu"><Icone nome="menu" tamanho={22} /></button>
          <div className="breadcrumb">
            {tela
              ? <><span>{modulo.rotulo}</span><Icone nome="seta" tamanho={14} /><span className="atual">{tela.rotulo}</span></>
              : modulo && <span className="atual">{modulo.rotulo}</span>}
          </div>
          <span className="topbar-data">{dataHoje()}</span>
        </header>

        <main className="content">{conteudo()}</main>
      </div>

      {minhaConta && <MinhaConta perfil={perfil} onFechar={() => setMinhaConta(false)} />}
    </div>
  );
}
