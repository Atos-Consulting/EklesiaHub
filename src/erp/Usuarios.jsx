import { useCallback, useEffect, useMemo, useState } from "react";
import { Header, Pill } from "../ui";
import { lbl, inp, msgErro } from "../estilos";
import Icone from "./Icone";
import Modal from "./Modal";
import { listarUsuarios, criarUsuario, atualizarUsuario, redefinirSenhaUsuario, mensagemErro } from "./db";
import { NIVEIS, NIVEIS_ORDEM, rotuloNivel } from "./permissoes";
import { gerarSenha, SENHA_MINIMA } from "./senha";

const TOM_NIVEL = { administrador: "ok", supervisor: "warn", usuario: "neutral" };

// Campo de senha com "Mostrar", "Gerar" e "Copiar" — o administrador repassa a senha ao usuário.
function CampoSenha({ id, valor, onChange, erro }) {
  const [ver, setVer] = useState(false);
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try { await navigator.clipboard.writeText(valor); setCopiado(true); setTimeout(() => setCopiado(false), 1800); } catch { /* sem permissão de área de transferência */ }
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8 }}>
        <input id={id} type={ver ? "text" : "password"} autoComplete="new-password" value={valor}
          onChange={(e) => onChange(e.target.value)} style={{ ...inp, flex: 1, minWidth: 0, ...(erro ? { borderColor: "var(--danger)" } : {}) }} />
        <button type="button" className="btn btn-ghost" onClick={() => setVer((v) => !v)}>{ver ? "Ocultar" : "Mostrar"}</button>
        <button type="button" className="btn btn-ghost" onClick={() => { onChange(gerarSenha()); setVer(true); }}>Gerar</button>
        {valor && <button type="button" className="btn btn-ghost" onClick={copiar}>{copiado ? "Copiado!" : "Copiar"}</button>}
      </div>
      {erro && <div style={msgErro}>{erro}</div>}
    </>
  );
}

function UsuarioModal({ inicial, empresaId, souEu, onSalvo, onFechar }) {
  const novo = !inicial;
  const [form, setForm] = useState(() => ({
    nome: inicial?.nome || "", email: inicial?.email || "", nivel: inicial?.nivel || "usuario",
    ativo: inicial?.ativo ?? true, senha: "",
  }));
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const campo = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const erros = {
    nome: !form.nome.trim() ? "Informe o nome" : "",
    email: novo && !/^\S+@\S+\.\S+$/.test(form.email.trim()) ? "E-mail inválido" : "",
    senha: novo && form.senha.length < SENHA_MINIMA ? `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres` : "",
  };
  const borda = (k) => (tentou && erros[k] ? { borderColor: "var(--danger)" } : {});

  async function salvar() {
    setTentou(true);
    setErro("");
    if (Object.values(erros).some(Boolean)) return;
    setSalvando(true);
    try {
      if (novo) await criarUsuario(empresaId, { nome: form.nome.trim(), email: form.email.trim(), senha: form.senha, nivel: form.nivel });
      else await atualizarUsuario(inicial.user_id, { nome: form.nome.trim(), nivel: form.nivel, ativo: form.ativo });
      onSalvo();
    } catch (e) {
      setErro(mensagemErro(e));
      setSalvando(false);
    }
  }

  return (
    <Modal titulo={novo ? "Novo usuário" : "Editar usuário"} onFechar={onFechar} fecharFora={false}
      rodape={<>
        <button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Cancelar</button>
        <button className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : novo ? "Criar usuário" : "Salvar"}</button>
      </>}>
      <label style={lbl} htmlFor="u-nome">Nome completo *</label>
      <input id="u-nome" style={{ ...inp, ...borda("nome") }} value={form.nome} onChange={campo("nome")} autoFocus />
      {tentou && erros.nome && <div style={msgErro}>{erros.nome}</div>}

      <label style={lbl} htmlFor="u-email">E-mail (usado para entrar) *</label>
      <input id="u-email" type="email" style={{ ...inp, ...borda("email") }} value={form.email} onChange={campo("email")} disabled={!novo} />
      {tentou && erros.email && <div style={msgErro}>{erros.email}</div>}

      <label style={lbl} htmlFor="u-nivel">Nível de acesso *</label>
      <select id="u-nivel" style={inp} value={form.nivel} onChange={campo("nivel")} disabled={souEu}>
        {NIVEIS_ORDEM.map((n) => <option key={n} value={n}>{NIVEIS[n].rotulo}</option>)}
      </select>
      <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>{NIVEIS[form.nivel].descricao}</div>
      {souEu && <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>Você não pode alterar o seu próprio nível nem se desativar.</div>}

      {novo ? (
        <>
          <label style={lbl} htmlFor="u-senha">Senha inicial *</label>
          <CampoSenha id="u-senha" valor={form.senha} onChange={(v) => setForm((p) => ({ ...p, senha: v }))} erro={tentou ? erros.senha : ""} />
          <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
            Repasse a senha ao usuário. Ele pode trocá-la depois em <strong>Minha conta</strong>.
          </div>
        </>
      ) : (
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18, fontSize: 13.5, color: "var(--text-2)", cursor: souEu ? "not-allowed" : "pointer" }}>
          <input type="checkbox" checked={form.ativo} disabled={souEu} onChange={(e) => setForm((p) => ({ ...p, ativo: e.target.checked }))} />
          Usuário ativo (desativado não consegue entrar nem ver dados)
        </label>
      )}

      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}

function SenhaModal({ usuario, onSalvo, onFechar }) {
  const [senha, setSenha] = useState("");
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const curta = senha.length < SENHA_MINIMA;

  async function salvar() {
    setTentou(true);
    setErro("");
    if (curta) return;
    setSalvando(true);
    try { await redefinirSenhaUsuario(usuario.user_id, senha); onSalvo(); }
    catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }

  return (
    <Modal titulo="Redefinir senha" largura={460} onFechar={onFechar} fecharFora={false}
      rodape={<>
        <button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Cancelar</button>
        <button className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : "Redefinir senha"}</button>
      </>}>
      <p className="muted" style={{ marginTop: 8 }}>
        Nova senha para <strong style={{ color: "var(--text)" }}>{usuario.nome}</strong>. As sessões abertas dele serão encerradas.
      </p>
      <label style={lbl} htmlFor="s-nova">Nova senha *</label>
      <CampoSenha id="s-nova" valor={senha} onChange={setSenha} erro={tentou && curta ? `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres` : ""} />
      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}

export default function Usuarios({ perfil }) {
  const [usuarios, setUsuarios] = useState(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState(null); // null | "novo" | usuário
  const [senhaDe, setSenhaDe] = useState(null);
  const [aviso, setAviso] = useState("");

  const recarregar = useCallback(
    () => listarUsuarios(perfil.empresa_id).then((d) => { setUsuarios(d); setErro(""); }).catch((e) => setErro(mensagemErro(e))),
    [perfil.empresa_id],
  );
  useEffect(() => { recarregar(); }, [recarregar]);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (usuarios || []).filter((u) => !t || u.nome?.toLowerCase().includes(t) || u.email?.toLowerCase().includes(t));
  }, [usuarios, busca]);

  function depoisDeSalvar(mensagem) {
    setEditando(null);
    setSenhaDe(null);
    setAviso(mensagem);
    recarregar();
  }

  return (
    <div>
      <div className="page-header">
        <Header title="Usuários" subtitle={`Quem acessa o sistema de ${perfil.empresa_nome}, e com qual nível.`} />
        <button className="btn btn-primary" onClick={() => setEditando("novo")}><Icone nome="mais" tamanho={16} traco={2.2} /> Novo usuário</button>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        {NIVEIS_ORDEM.map((n) => (
          <div key={n} className="card" style={{ padding: "14px 18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Pill tone={TOM_NIVEL[n]}>{NIVEIS[n].rotulo}</Pill>
              <strong style={{ fontSize: 18 }}>{(usuarios || []).filter((u) => u.nivel === n && u.ativo).length}</strong>
            </div>
            <div className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>{NIVEIS[n].descricao}</div>
          </div>
        ))}
      </div>

      {aviso && <div className="alert alert-ok" role="status" style={{ marginBottom: 16 }}><Icone nome="check" tamanho={16} /><span>{aviso}</span></div>}
      {erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}

      <div className="card">
        <div className="toolbar">
          <label style={{ flex: "1 1 260px", maxWidth: 380 }}>Buscar
            <input placeholder="Nome ou e-mail" value={busca} onChange={(e) => setBusca(e.target.value)} style={inp} />
          </label>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Nome</th><th>E-mail</th><th>Nível</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {usuarios === null && !erro && <tr><td className="vazio" colSpan={5}>Carregando usuários...</td></tr>}
              {usuarios && filtrados.length === 0 && <tr><td className="vazio" colSpan={5}>Nenhum usuário encontrado.</td></tr>}
              {filtrados.map((u) => (
                <tr key={u.user_id}>
                  <td className="truncate" style={{ fontWeight: 550 }}>
                    {u.nome}{u.user_id === perfil.user_id && <span className="muted" style={{ fontWeight: 400 }}> (você)</span>}
                  </td>
                  <td className="muted">{u.email}</td>
                  <td><Pill tone={TOM_NIVEL[u.nivel]}>{rotuloNivel(u.nivel)}</Pill></td>
                  <td><Pill tone={u.ativo ? "ok" : "neutral"}>{u.ativo ? "Ativo" : "Inativo"}</Pill></td>
                  <td style={{ textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditando(u)}>Editar</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setSenhaDe(u)}>Redefinir senha</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {usuarios && usuarios.length > 0 && <div className="table-footer"><span>{usuarios.length} usuário(s) nesta empresa</span></div>}
      </div>

      {editando && (
        <UsuarioModal inicial={editando === "novo" ? null : editando} empresaId={perfil.empresa_id}
          souEu={editando !== "novo" && editando.user_id === perfil.user_id}
          onSalvo={() => depoisDeSalvar(editando === "novo" ? "Usuário criado. Repasse a senha inicial a ele." : "Usuário atualizado.")}
          onFechar={() => setEditando(null)} />
      )}
      {senhaDe && <SenhaModal usuario={senhaDe} onSalvo={() => depoisDeSalvar(`Senha de ${senhaDe.nome} redefinida.`)} onFechar={() => setSenhaDe(null)} />}
    </div>
  );
}
