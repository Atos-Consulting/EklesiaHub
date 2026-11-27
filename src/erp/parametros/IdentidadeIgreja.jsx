import { useEffect, useRef, useState } from "react";
import { lbl } from "../../estilos";
import Icone from "../Icone";
import { urlLogo, enviarLogo, validarLogo, atualizarIdentidade, descartarLogo, mensagemErro } from "../db";
import { PALETAS, COR_PRIMARIA_PADRAO, COR_MENU_PADRAO, avisoCor, aplicarTema } from "../tema";

// Parâmetros → Dados da igreja → Identidade visual (v22): logo (aparece no menu e nos documentos
// impressos) e as cores do sistema. Enquanto escolhe, o sistema já mostra as cores (prévia);
// sem salvar, ao sair volta ao que estava.
function Cor({ id, rotulo, valor, onChange, aviso, ajuda }) {
  return (
    <div>
      <label style={lbl} htmlFor={id}>{rotulo}</label>
      <div className="cor-campo">
        <input id={id} type="color" value={valor} onChange={(e) => onChange(e.target.value.toLowerCase())} />
        <code>{valor}</code>
      </div>
      <div className={aviso ? "cor-aviso" : "muted"} style={{ fontSize: 12, marginTop: 4 }}>{aviso || ajuda}</div>
    </div>
  );
}

export default function IdentidadeIgreja({ empresa, onSalvo }) {
  const inicial = { logo: empresa.logo_caminho ?? "", pri: empresa.cor_primaria ?? COR_PRIMARIA_PADRAO, menu: empresa.cor_menu ?? COR_MENU_PADRAO };
  const [salvo, setSalvo] = useState(inicial);
  const [f, setF] = useState(inicial);
  const [enviando, setEnviando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);
  const entrada = useRef(null);
  const enviadas = useRef([]); // logos enviadas e não salvas: saem do Storage se a pessoa desistir
  const salvoRef = useRef(salvo);
  useEffect(() => { salvoRef.current = salvo; });

  // Prévia ao vivo; ao sair da tela, volta às cores salvas.
  useEffect(() => { aplicarTema({ cor_primaria: f.pri, cor_menu: f.menu }); }, [f.pri, f.menu]);
  useEffect(() => () => {
    aplicarTema({ cor_primaria: salvoRef.current.pri, cor_menu: salvoRef.current.menu });
    enviadas.current.filter((c) => c !== salvoRef.current.logo).forEach((c) => descartarLogo(c).catch(() => {}));
  }, []);

  const avisoPri = avisoCor(f.pri, "primaria");
  const avisoMenu = avisoCor(f.menu, "menu");
  const mudou = f.logo !== salvo.logo || f.pri !== salvo.pri || f.menu !== salvo.menu;
  const set = (k, v) => { setOk(false); setErro(""); setF((p) => ({ ...p, [k]: v })); };

  async function escolherLogo(arquivo) {
    if (!arquivo) return;
    const inv = validarLogo(arquivo);
    if (inv) { setErro(inv); return; }
    setEnviando(true); setErro("");
    try { const c = await enviarLogo(empresa.id, arquivo); enviadas.current.push(c); set("logo", c); }
    catch (e) { setErro(mensagemErro(e)); }
    finally { setEnviando(false); if (entrada.current) entrada.current.value = ""; }
  }

  async function salvar() {
    if (avisoPri || avisoMenu) return;
    setSalvando(true); setErro("");
    const padrao = (c, p) => (c === p ? null : c); // cor igual à do sistema fica nula (segue o padrão se ele mudar)
    try {
      await atualizarIdentidade({ logo: f.logo, corPrimaria: padrao(f.pri, COR_PRIMARIA_PADRAO), corMenu: padrao(f.menu, COR_MENU_PADRAO) }, salvo.logo);
      enviadas.current = enviadas.current.filter((c) => c !== f.logo);
      setSalvo(f); setOk(true);
      onSalvo({ empresa_logo: f.logo || null, cor_primaria: padrao(f.pri, COR_PRIMARIA_PADRAO), cor_menu: padrao(f.menu, COR_MENU_PADRAO) });
    } catch (e) { setErro(mensagemErro(e)); }
    finally { setSalvando(false); }
  }

  return (
    <div>
      <h3 className="section-title">Identidade visual</h3>
      <div className="identidade">
        <div>
          <label style={lbl}>Logo</label>
          <div className="logo-caixa">
            {f.logo ? <img src={urlLogo(f.logo)} alt="Logo da igreja" /> : <span className="muted">Sem logo</span>}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <label className={`btn btn-ghost btn-sm${enviando ? " desabilitado" : ""}`}>
              <Icone nome="mais" tamanho={14} /> {enviando ? "Enviando..." : f.logo ? "Trocar logo" : "Enviar logo"}
              <input ref={entrada} type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" hidden onChange={(e) => escolherLogo(e.target.files?.[0])} />
            </label>
            {f.logo && <button type="button" className="btn btn-ghost btn-sm" onClick={() => set("logo", "")}>Tirar logo</button>}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>PNG, JPG ou WebP até 2 MB. Prefira uma imagem quadrada, com fundo transparente ou branco.</div>
        </div>

        <div>
          <label style={lbl}>Combinações prontas</label>
          <div className="paletas">
            {PALETAS.map((p) => (
              <button key={p.nome} type="button" className={`paleta${f.pri === p.primaria && f.menu === p.menu ? " ativa" : ""}`} title={p.nome}
                onClick={() => { set("pri", p.primaria); set("menu", p.menu); }}>
                <span style={{ background: p.menu }}><i style={{ background: p.primaria }} /></span>{p.nome}
              </button>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0 16px" }}>
            <Cor id="cor-pri" rotulo="Cor principal" valor={f.pri} onChange={(v) => set("pri", v)} aviso={avisoPri} ajuda="Botões, links e destaques." />
            <Cor id="cor-menu" rotulo="Cor do menu lateral" valor={f.menu} onChange={(v) => set("menu", v)} aviso={avisoMenu} ajuda="Fundo do menu. Use um tom escuro." />
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>O sistema já mostra as cores enquanto você escolhe. Elas só ficam valendo para todos ao salvar.</div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
        {ok && <span className="pill pill-ok">Identidade salva</span>}
        {mudou && <button type="button" className="btn btn-ghost" onClick={() => { setF(salvo); setErro(""); }} disabled={salvando}>Desfazer</button>}
        <button type="button" className="btn btn-ghost" onClick={() => { set("pri", COR_PRIMARIA_PADRAO); set("menu", COR_MENU_PADRAO); }} disabled={salvando}>Cores do sistema</button>
        <button type="button" className="btn btn-primary" onClick={salvar} disabled={salvando || enviando || !mudou || Boolean(avisoPri || avisoMenu)}>{salvando ? "Salvando..." : "Salvar identidade"}</button>
      </div>
      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 12 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </div>
  );
}
