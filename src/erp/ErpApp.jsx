import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Header } from "../ui";
import Icone from "./Icone";
import Marca from "./Marca";
import NotasEntrada from "./NotasEntrada";
import ContasPagar from "./ContasPagar";
import Entradas from "./Entradas";
import MovimentosCaixa from "./MovimentosCaixa";
import FluxoCaixa from "./FluxoCaixa";
import RelatorioMes from "./RelatorioMes";
import AbasTela from "./AbasTela";
import Conciliacao from "./Conciliacao";
import ImportarOfx from "./ImportarOfx";
import ContasFixas from "./ContasFixas";
import PainelFinanceiro from "./PainelFinanceiro";
import Orcamento from "./Orcamento";
import FechamentoMes from "./FechamentoMes";
import Diario from "./contabil/Diario";
import { Razao, Balancete, Dre, Balanco } from "./contabil/Relatorios";
import InformeAnual from "./InformeAnual";
import Logs from "./Logs";
import Fornecedores from "./Fornecedores";
import ImportarXml from "./ImportarXml";
import Parametros from "./Parametros";
import { ABAS_PARAMETROS } from "./parametros/grupos";
import Usuarios from "./Usuarios";
import Empresas from "./Empresas";
import MinhaConta from "./MinhaConta";
import { fetchCadastros, listarEmpresasAtivas, trocarEmpresa, mensagemErro, urlLogo } from "./db";
import { aplicarTema } from "./tema";
import { permissoes, rotuloNivel } from "./permissoes";
import { usaContabilidade } from "./catalogoParametros";

// Módulos do ERP. `visivel(perm)` decide quem enxerga; `pronto` indica o que já foi construído.
// O grupo "Sistema" fica sempre no fim do menu.
const MODULOS = [
  { id: "dashboard", grupo: "Visão geral", rotulo: "Dashboard", icone: "dashboard", pronto: false,
    descricao: "Indicadores consolidados da empresa em uma única tela.",
    previsto: ["Saldo de caixa e bancos", "Contas a pagar e a receber da semana", "Entradas x saídas do mês", "Resultado do período (superávit/déficit)", "Vendas da livraria e do bazar"] },
  { id: "administrativo", grupo: "Gestão", rotulo: "Administrativo", icone: "pasta", pronto: true,
    telas: [{ id: "notas", rotulo: "Notas de entrada" }, { id: "fornecedores", rotulo: "Fornecedores" }, { id: "importar", rotulo: "Importar XML" }] },
  // Contas a pagar e a receber (mesma tela, por aba de situação), entradas (dízimos, ofertas, campanhas) e caixa (extrato e movimentos).
  { id: "financeiro", grupo: "Gestão", rotulo: "Financeiro", icone: "carteira", pronto: true,
    telas: [{ id: "painel", rotulo: "Painel" }, { id: "lancamentos", rotulo: "Lançamentos" }, { id: "entradas", rotulo: "Dízimos e ofertas" }, { id: "caixa", rotulo: "Caixa" }, { id: "orcamento", rotulo: "Orçamento" }] },
  { id: "contabil", grupo: "Gestão", rotulo: "Contábil", icone: "calculadora", pronto: true, contabil: true,
    telas: [{ id: "lancamentos", rotulo: "Lançamentos" }, { id: "razao", rotulo: "Razão" }, { id: "balancete", rotulo: "Balancete" }, { id: "dre", rotulo: "DRE" }, { id: "balanco", rotulo: "Balanço" }] },
  { id: "comercial", grupo: "Gestão", rotulo: "Comercial", icone: "sacola", pronto: false,
    descricao: "Livraria, bazar e demais vendas.",
    previsto: ["Produtos e controle de estoque", "Vendas e ponto de venda (PDV)", "Compras via notas de entrada", "Custo das mercadorias vendidas"] },
  // Grupo Sistema, nesta ordem: Igrejas (administrador da plataforma), Usuários, Parâmetros e Logs (administrador da igreja).
  { id: "empresas", grupo: "Sistema", rotulo: "Igrejas", icone: "predio", pronto: true, visivel: (p) => p.plataforma },
  { id: "usuarios", grupo: "Sistema", rotulo: "Usuários", icone: "pessoas", pronto: true, visivel: (p) => p.gerirUsuarios },
  { id: "parametros", grupo: "Sistema", rotulo: "Parâmetros", icone: "ajustes", pronto: true, abas: true, telas: ABAS_PARAMETROS, visivel: (p) => p.administrar },
  { id: "logs", grupo: "Sistema", rotulo: "Logs", icone: "relogio", pronto: true, visivel: (p) => p.administrar },
];

// Rota por URL (#/modulo/tela): botão voltar, atualizar a página e links diretos funcionam.
function lerRota() {
  const [, modulo = "", tela = "", aba = "", filtro = ""] = window.location.hash.replace(/^#/, "").split("/");
  if (modulo === "financeiro" && tela === "contas") return { modulo, tela: "lancamentos", aba, filtro }; // nome anterior da tela
  const antiga = modulo === "financeiro" && ROTAS_ANTIGAS_FINANCEIRO[tela];
  return antiga ? { modulo, tela: antiga[0], aba: antiga[1], filtro: "" } : { modulo, tela, aba, filtro };
}

// Financeiro (reorganizado de 5 para 3 telas): endereços antigos continuam abrindo a aba certa.
const ROTAS_ANTIGAS_FINANCEIRO = { pagar: ["lancamentos", "pagar"], receber: ["lancamentos", "receber"], fluxo: ["caixa", "fluxo"], relatorio: ["caixa", "relatorio"] };
const ABAS_ENTRADAS = [{ id: "lista", rotulo: "Entradas" }, { id: "informe", rotulo: "Informe anual" }];
const ABAS_CONTAS = [{ id: "pagar", rotulo: "A pagar" }, { id: "receber", rotulo: "A receber" }, { id: "fixas", rotulo: "Contas fixas" }];
const ABAS_CAIXA = [{ id: "extrato", rotulo: "Extrato de Caixa" }, { id: "conciliacao", rotulo: "Fechamento do dia" }, { id: "ofx", rotulo: "Extrato do banco (OFX)" }, { id: "fluxo", rotulo: "Fluxo de caixa" }, { id: "relatorio", rotulo: "Relatório do mês" }, { id: "fechamento", rotulo: "Fechamento do mês" }];

const iniciais = (nome) => {
  const partes = (nome || "?").trim().split(/\s+/);
  return (partes.length > 1 ? partes[0][0] + partes[1][0] : partes[0].slice(0, 2)).toUpperCase();
};
const dataHoje = () => {
  const texto = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

// Nome da igreja no topo do menu. Para o administrador da plataforma vira um seletor: clica e troca de igreja.
function SeletorEmpresa({ perfil, plataforma, onTrocada }) {
  const [aberto, setAberto] = useState(false);
  const [empresas, setEmpresas] = useState(null);
  const [trocando, setTrocando] = useState(null);
  const [erro, setErro] = useState("");
  const raiz = useRef(null);
  const nomeDe = (e) => e.nome_fantasia || e.razao_social;

  useEffect(() => {
    if (!aberto) return undefined;
    listarEmpresasAtivas().then(setEmpresas).catch((e) => setErro(mensagemErro(e)));
    const fora = (ev) => { if (raiz.current && !raiz.current.contains(ev.target)) setAberto(false); };
    const esc = (ev) => { if (ev.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);

  async function escolher(id) {
    if (id === perfil.empresa_id) { setAberto(false); return; }
    setTrocando(id);
    setErro("");
    try { await trocarEmpresa(id); onTrocada(); }
    catch (e) { setErro(mensagemErro(e)); setTrocando(null); }
  }

  const conteudo = (
    <>
      <Marca logo={urlLogo(perfil.empresa_logo)} />
      <div style={{ minWidth: 0 }}>
        <div className="brand-name">EklesiaHub</div>
        <div className="brand-empresa" title={perfil.empresa_nome}>{perfil.empresa_nome}</div>
      </div>
    </>
  );
  if (!plataforma) return <div className="brand">{conteudo}</div>;

  return (
    <div className="brand" ref={raiz}>
      <button type="button" className="brand-trocar" aria-haspopup="menu" aria-expanded={aberto}
        title="Trocar de igreja" onClick={() => setAberto((v) => !v)}>
        {conteudo}
        <Icone nome="chevronBaixo" tamanho={16} className="seta" />
      </button>
      {aberto && (
        <div className="empresas-menu" role="menu" aria-label="Igrejas">
          <div className="titulo">Trabalhar na igreja</div>
          {empresas === null && !erro && <div className="muted" style={{ padding: "8px 10px", fontSize: 13 }}>Carregando...</div>}
          {(empresas || []).map((e) => (
            <button key={e.id} type="button" role="menuitem" aria-current={e.id === perfil.empresa_id}
              disabled={trocando !== null} onClick={() => escolher(e.id)}>
              <span className="nome" title={e.razao_social}>{nomeDe(e)}</span>
              {trocando === e.id ? <span className="muted" style={{ fontSize: 12 }}>abrindo…</span>
                : e.id === perfil.empresa_id && <Icone nome="check" tamanho={15} traco={2.4} />}
            </button>
          ))}
          {erro && <div className="alert alert-danger" style={{ margin: 6, fontSize: 12.5 }}><span>{erro}</span></div>}
          <div className="sep" />
          <a href="#/empresas" role="menuitem" onClick={() => setAberto(false)}><Icone nome="predio" tamanho={15} /> Gerenciar igrejas</a>
        </div>
      )}
    </div>
  );
}

export default function ErpApp({ perfil: perfilInicial, onSair, onEmpresaTrocada }) {
  // Logo, cores e nome da igreja podem mudar em Parâmetros sem recarregar o perfil (v22).
  const [identidade, setIdentidade] = useState({});
  const perfil = useMemo(() => ({ ...perfilInicial, ...identidade }), [perfilInicial, identidade]);
  const mudarIdentidade = useCallback((novo) => setIdentidade((x) => ({ ...x, ...novo })), []);
  useEffect(() => { aplicarTema(perfil); }, [perfil]);
  useEffect(() => () => aplicarTema({}), []); // saiu ou trocou de igreja: volta às cores do sistema
  const perm = useMemo(() => permissoes(perfil), [perfil]);
  const [cadastros, setCadastros] = useState(null);
  // Parâmetro da igreja "usar contabilidade": desligado, o módulo Contábil some do menu.
  const contabilAtivo = usaContabilidade(cadastros?.parametros);
  const visiveis = useMemo(() => MODULOS.filter((m) => (!m.visivel || m.visivel(perm)) && (!m.contabil || contabilAtivo)), [perm, contabilAtivo]);
  const [rota, setRota] = useState(lerRota);
  const [menuAberto, setMenuAberto] = useState(false);
  const [minhaConta, setMinhaConta] = useState(false);
  const [erro, setErro] = useState("");
  const nomeUsuario = perfil.nome || perfil.email;

  useEffect(() => {
    const aoMudar = () => setRota(lerRota());
    window.addEventListener("hashchange", aoMudar);
    return () => window.removeEventListener("hashchange", aoMudar);
  }, []);

  const modulo = visiveis.find((m) => m.id === rota.modulo) || visiveis.find((m) => m.pronto) || visiveis[0];
  const tela = modulo?.telas?.find((t) => t.id === rota.tela) || modulo?.telas?.[0];
  const precisaCadastros = ["administrativo", "financeiro", "contabil", "parametros", "logs"].includes(modulo?.id);

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
    if (modulo.id === "parametros") return <Parametros aba={tela?.id} perfil={perfil} cadastros={cadastros} onCadastrosMudaram={recarregarCadastros} onIdentidadeMudou={mudarIdentidade} />;
    if (modulo.id === "logs") return <Logs />;
    if (modulo.id === "contabil") {
      const p = { cadastros, perfil, podeConfigurar: perm.administrar };
      if (tela?.id === "razao") return <Razao {...p} />;
      if (tela?.id === "balancete") return <Balancete {...p} />;
      if (tela?.id === "dre") return <Dre {...p} />;
      if (tela?.id === "balanco") return <Balanco {...p} />;
      return <Diario {...p} podeLancar={perm.pagar} />;
    }
    if (modulo.id === "financeiro") {
      if (tela?.id === "painel") return <PainelFinanceiro cadastros={cadastros} />;
      if (tela?.id === "orcamento") return <Orcamento cadastros={cadastros} podeEditar={perm.administrar} />;
      if (tela?.id === "entradas") {
        const abaEnt = rota.aba === "informe" ? "informe" : "lista";
        return (
          <>
            <AbasTela base="#/financeiro/entradas" abas={ABAS_ENTRADAS} atual={abaEnt} rotulo="Dízimos e ofertas" />
            {abaEnt === "informe"
              ? <InformeAnual cadastros={cadastros} perfil={perfil} />
              : <Entradas cadastros={cadastros} perfil={perfil} podeRegistrar={perm.registrarEntrada} podeEstornar={perm.pagar} onCadastrosMudaram={recarregarCadastros} />}
          </>
        );
      }
      if (tela?.id === "caixa") {
        const aba = ABAS_CAIXA.some((a) => a.id === rota.aba) ? rota.aba : "extrato";
        return (
          <>
            <AbasTela base="#/financeiro/caixa" abas={ABAS_CAIXA} atual={aba} rotulo="Visões do caixa" />
            {aba === "conciliacao" && <Conciliacao cadastros={cadastros} podeConciliar={perm.pagar} podeDesfazer={perm.administrar} />}
            {aba === "ofx" && <ImportarOfx cadastros={cadastros} podeRegistrar={perm.pagar} onCadastrosMudaram={recarregarCadastros} />}
            {aba === "fluxo" && <FluxoCaixa cadastros={cadastros} />}
            {aba === "relatorio" && <RelatorioMes cadastros={cadastros} perfil={perfil} />}
            {aba === "fechamento" && <FechamentoMes podeFechar={perm.pagar} podeReabrir={perm.administrar} />}
            {aba === "extrato" && <MovimentosCaixa cadastros={cadastros} podeRegistrar={perm.pagar} onCadastrosMudaram={recarregarCadastros} />}
          </>
        );
      }
      const abaLanc = ABAS_CONTAS.some((a) => a.id === rota.aba) ? rota.aba : "pagar";
      return (
        <>
          <AbasTela base="#/financeiro/lancamentos" abas={ABAS_CONTAS} atual={abaLanc} rotulo="Lançamentos" />
          {abaLanc === "fixas"
            ? <ContasFixas cadastros={cadastros} podeEditar={perm.pagar} onCadastrosMudaram={recarregarCadastros} />
            : <ContasPagar key={`${abaLanc}|${rota.filtro}`} natureza={abaLanc} situacaoInicial={rota.filtro} cadastros={cadastros} podePagar={perm.pagar} onCadastrosMudaram={recarregarCadastros} />}
        </>
      );
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
        <SeletorEmpresa perfil={perfil} plataforma={perm.plataforma} onTrocada={onEmpresaTrocada} />

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
