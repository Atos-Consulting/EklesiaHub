import { useCallback, useEffect, useMemo, useState } from "react";
import { Header, Pill } from "../ui";
import { lbl, inp, msgErro } from "../estilos";
import Icone from "./Icone";
import Modal from "./Modal";
import { listarEmpresas, criarEmpresa, atualizarEmpresa, mensagemErro } from "./db";
import { mascararCnpj, limparCnpj, validarCNPJ } from "./format";
import { gerarSenha, SENHA_MINIMA } from "./senha";
import ThOrdenavel from "./ThOrdenavel";
import { useOrdenacao } from "./useOrdenacao";

const COLUNAS = {
  empresa: (e) => e.nome_fantasia || e.razao_social, cnpj: (e) => e.cnpj,
  usuarios: (e) => e.usuarios_ativos, situacao: (e) => (e.ativo ? "Ativa" : "Inativa"),
};

function EmpresaModal({ inicial, ehMinha, onSalvo, onFechar }) {
  const novo = !inicial;
  const [form, setForm] = useState(() => ({
    razaoSocial: inicial?.razao_social || "", nomeFantasia: inicial?.nome_fantasia || "",
    cnpj: inicial?.cnpj ? mascararCnpj(inicial.cnpj) : "", ativo: inicial?.ativo ?? true,
    adminNome: "", adminEmail: "", adminSenha: "",
  }));
  const [verSenha, setVerSenha] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const campo = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const erros = {
    razaoSocial: !form.razaoSocial.trim() ? "Informe a razão social" : "",
    cnpj: form.cnpj && !validarCNPJ(form.cnpj) ? "CNPJ inválido. Confira os números." : "",
    adminNome: novo && !form.adminNome.trim() ? "Informe o nome do administrador" : "",
    adminEmail: novo && !/^\S+@\S+\.\S+$/.test(form.adminEmail.trim()) ? "E-mail inválido" : "",
    adminSenha: novo && form.adminSenha.length < SENHA_MINIMA ? `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres` : "",
  };
  const borda = (k) => (tentou && erros[k] ? { borderColor: "var(--danger)" } : {});
  const msg = (k) => tentou && erros[k] && <div style={msgErro}>{erros[k]}</div>;

  async function salvar() {
    setTentou(true);
    setErro("");
    if (Object.values(erros).some(Boolean)) return;
    setSalvando(true);
    try {
      const dados = { razaoSocial: form.razaoSocial.trim(), nomeFantasia: form.nomeFantasia.trim(), cnpj: limparCnpj(form.cnpj) };
      if (novo) await criarEmpresa({ ...dados, adminNome: form.adminNome.trim(), adminEmail: form.adminEmail.trim(), adminSenha: form.adminSenha });
      else await atualizarEmpresa(inicial.id, { ...dados, ativo: form.ativo });
      onSalvo();
    } catch (e) {
      setErro(mensagemErro(e));
      setSalvando(false);
    }
  }

  return (
    <Modal titulo={novo ? "Nova igreja" : "Editar igreja"} largura={600} onFechar={onFechar} fecharFora={false}
      rodape={<>
        <button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Cancelar</button>
        <button className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : novo ? "Criar igreja" : "Salvar"}</button>
      </>}>
      <h3 className="section-title" style={{ marginTop: 14 }}>Dados da igreja</h3>
      <label style={{ ...lbl, marginTop: 0 }} htmlFor="e-razao">Razão social *</label>
      <input id="e-razao" style={{ ...inp, ...borda("razaoSocial") }} value={form.razaoSocial} onChange={campo("razaoSocial")} autoFocus />
      {msg("razaoSocial")}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0 12px" }}>
        <div>
          <label style={lbl} htmlFor="e-fantasia">Nome fantasia</label>
          <input id="e-fantasia" style={inp} value={form.nomeFantasia} onChange={campo("nomeFantasia")} />
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Aparece no menu do sistema.</div>
        </div>
        <div>
          <label style={lbl} htmlFor="e-cnpj">CNPJ</label>
          <input id="e-cnpj" style={{ ...inp, ...borda("cnpj") }} placeholder="00.000.000/0000-00" value={form.cnpj}
            onChange={(e) => setForm((p) => ({ ...p, cnpj: mascararCnpj(e.target.value) }))} />
          {msg("cnpj")}
        </div>
      </div>

      {novo ? (
        <>
          <h3 className="section-title">Administrador inicial</h3>
          <p className="muted" style={{ marginTop: -4 }}>Primeiro acesso da igreja. Depois ele cria os demais usuários.</p>
          <label style={lbl} htmlFor="e-anome">Nome *</label>
          <input id="e-anome" style={{ ...inp, ...borda("adminNome") }} value={form.adminNome} onChange={campo("adminNome")} />
          {msg("adminNome")}
          <label style={lbl} htmlFor="e-aemail">E-mail (usado para entrar) *</label>
          <input id="e-aemail" type="email" style={{ ...inp, ...borda("adminEmail") }} value={form.adminEmail} onChange={campo("adminEmail")} />
          {msg("adminEmail")}
          <label style={lbl} htmlFor="e-asenha">Senha inicial *</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input id="e-asenha" type={verSenha ? "text" : "password"} autoComplete="new-password" style={{ ...inp, flex: 1, minWidth: 0, ...borda("adminSenha") }}
              value={form.adminSenha} onChange={campo("adminSenha")} />
            <button type="button" className="btn btn-ghost" onClick={() => setVerSenha((v) => !v)}>{verSenha ? "Ocultar" : "Mostrar"}</button>
            <button type="button" className="btn btn-ghost" onClick={() => { setForm((p) => ({ ...p, adminSenha: gerarSenha() })); setVerSenha(true); }}>Gerar</button>
          </div>
          {msg("adminSenha")}
        </>
      ) : (
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20, fontSize: 13.5, color: "var(--text-2)", cursor: ehMinha ? "not-allowed" : "pointer" }}>
          <input type="checkbox" checked={form.ativo} disabled={ehMinha} onChange={(e) => setForm((p) => ({ ...p, ativo: e.target.checked }))} />
          Igreja ativa (desativada: ninguém dela consegue entrar; os dados são preservados)
        </label>
      )}
      {!novo && ehMinha && <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>Esta é a igreja em que você está trabalhando; ela não pode ser desativada.</div>}

      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}

export default function Empresas({ perfil }) {
  const [empresas, setEmpresas] = useState(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState(null); // null | "nova" | empresa
  const [aviso, setAviso] = useState("");

  const recarregar = useCallback(
    () => listarEmpresas().then((d) => { setEmpresas(d); setErro(""); }).catch((e) => setErro(mensagemErro(e))),
    [],
  );
  useEffect(() => { recarregar(); }, [recarregar]);

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const digitos = t.replace(/[^0-9a-z]/g, "");
    return (empresas || []).filter((e) => !t || e.razao_social.toLowerCase().includes(t) || e.nome_fantasia?.toLowerCase().includes(t) || (digitos && (e.cnpj || "").toLowerCase().includes(digitos)));
  }, [empresas, busca]);
  const ordenacao = useOrdenacao(filtradas, COLUNAS, { chave: "empresa", dir: "asc" });

  return (
    <div>
      <div className="page-header">
        <Header title="Igrejas" subtitle="Cada igreja tem seus próprios dados, usuários e parâmetros — uma não enxerga a outra." />
        <button className="btn btn-primary" onClick={() => setEditando("nova")}><Icone nome="mais" tamanho={16} traco={2.2} /> Nova igreja</button>
      </div>

      <div className="alert alert-warn" style={{ marginBottom: 16 }}>
        <Icone nome="escudo" tamanho={16} />
        <span>Como administrador da plataforma você cria e gerencia as igrejas. Para trabalhar em uma delas (notas, fornecedores, financeiro), <strong>clique no nome da igreja no topo do menu</strong> e escolha: lá dentro você age como Administrador.</span>
      </div>
      {aviso && <div className="alert alert-ok" role="status" style={{ marginBottom: 16 }}><Icone nome="check" tamanho={16} /><span>{aviso}</span></div>}
      {erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}

      <div className="card">
        <div className="toolbar">
          <label style={{ flex: "1 1 260px", maxWidth: 380 }}>Buscar
            <input placeholder="Razão social, fantasia ou CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} style={inp} />
          </label>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <ThOrdenavel chave="empresa" ordenacao={ordenacao}>Igreja</ThOrdenavel>
              <ThOrdenavel chave="cnpj" ordenacao={ordenacao}>CNPJ</ThOrdenavel>
              <ThOrdenavel chave="usuarios" ordenacao={ordenacao} className="num">Usuários ativos</ThOrdenavel>
              <ThOrdenavel chave="situacao" ordenacao={ordenacao}>Situação</ThOrdenavel>
              <th />
            </tr></thead>
            <tbody>
              {empresas === null && !erro && <tr><td className="vazio" colSpan={5}>Carregando igrejas...</td></tr>}
              {empresas && filtradas.length === 0 && <tr><td className="vazio" colSpan={5}>Nenhuma igreja encontrada.</td></tr>}
              {ordenacao.ordenadas.map((e) => (
                <tr key={e.id}>
                  <td className="truncate">
                    <div style={{ fontWeight: 550 }}>{e.nome_fantasia || e.razao_social}{e.id === perfil.empresa_id && <span className="muted" style={{ fontWeight: 400 }}> (em uso agora)</span>}</div>
                    {e.nome_fantasia && <div className="muted" style={{ fontSize: 12.5 }}>{e.razao_social}</div>}
                  </td>
                  <td className="muted">{e.cnpj ? mascararCnpj(e.cnpj) : "—"}</td>
                  <td className="num">{e.usuarios_ativos}</td>
                  <td><Pill tone={e.ativo ? "ok" : "neutral"}>{e.ativo ? "Ativa" : "Inativa"}</Pill></td>
                  <td style={{ textAlign: "right" }}><button className="btn btn-ghost btn-sm" onClick={() => setEditando(e)}>Editar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {empresas && empresas.length > 0 && <div className="table-footer"><span>{empresas.length} igreja(s)</span></div>}
      </div>

      {editando && (
        <EmpresaModal inicial={editando === "nova" ? null : editando} ehMinha={editando !== "nova" && editando.id === perfil.empresa_id}
          onSalvo={() => { setAviso(editando === "nova" ? "Igreja criada. Passe o e-mail e a senha ao administrador dela." : "Igreja atualizada."); setEditando(null); recarregar(); }}
          onFechar={() => setEditando(null)} />
      )}
    </div>
  );
}
