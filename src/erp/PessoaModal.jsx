import { useState } from "react";
import Modal from "./Modal";
import { lbl, inp, msgErro, maskTelefone } from "../estilos";
import Icone from "./Icone";
import { salvarPessoa, mensagemErro } from "./db";
import { mascararDocumento, limparDocumento, validarDocumento } from "./format";

// Cadastro de pessoa/empresa (usado por Fornecedores e pelo "+ Novo fornecedor" da nota).
export default function PessoaModal({ inicial, papelPadrao = "fornecedor", onSalvo, onFechar }) {
  const [form, setForm] = useState(() => ({
    tipoPessoa: inicial?.tipo_pessoa || "PJ",
    nome: inicial?.nome || "",
    documento: inicial ? mascararDocumento(inicial.tipo_pessoa, inicial.documento || "") : "",
    email: inicial?.email || "",
    telefone: inicial?.telefone || "",
    observacoes: inicial?.observacoes || "",
    ativo: inicial?.ativo ?? true,
  }));
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const campo = (nome) => (e) => setForm((p) => ({ ...p, [nome]: e.target.value }));
  const rotuloDoc = form.tipoPessoa === "PF" ? "CPF" : "CNPJ";

  const erros = {
    nome: !form.nome.trim(),
    documento: !validarDocumento(form.tipoPessoa, form.documento),
    email: form.email.trim() !== "" && !/^\S+@\S+\.\S+$/.test(form.email.trim()),
  };
  const mostrar = (k) => tentou && erros[k];
  const borda = (k) => (mostrar(k) ? { borderColor: "var(--danger)" } : {});

  async function salvar() {
    setTentou(true);
    setErro("");
    if (Object.values(erros).some(Boolean)) return;
    setSalvando(true);
    try {
      const papeis = Array.from(new Set([...(inicial?.papeis || []), papelPadrao]));
      const pessoa = await salvarPessoa(inicial?.id, {
        ...form,
        documento: limparDocumento(form.tipoPessoa, form.documento),
        papeis,
      });
      onSalvo(pessoa);
    } catch (e) {
      setErro(mensagemErro(e));
      setSalvando(false);
    }
  }

  return (
    <Modal
      titulo={inicial ? "Editar fornecedor" : "Novo fornecedor"}
      onFechar={onFechar}
      fecharFora={false}
      nivel={300}
      rodape={
        <>
          <button onClick={onFechar} className="btn btn-ghost" disabled={salvando}>Cancelar</button>
          <button onClick={salvar} disabled={salvando} className="btn btn-primary">
            {salvando ? "Salvando..." : "Salvar"}
          </button>
        </>
      }
    >
      <label style={lbl}>Tipo</label>
      <div className="segmented">
        {[["PJ", "Empresa (CNPJ)"], ["PF", "Pessoa física (CPF)"]].map(([v, rotulo]) => (
          <button key={v} type="button" aria-pressed={form.tipoPessoa === v}
            onClick={() => setForm((p) => ({ ...p, tipoPessoa: v, documento: "" }))}>
            {rotulo}
          </button>
        ))}
      </div>

      <label style={lbl}>{form.tipoPessoa === "PF" ? "Nome completo *" : "Razão social / nome *"}</label>
      <input style={{ ...inp, ...borda("nome") }} value={form.nome} onChange={campo("nome")} autoFocus />
      {mostrar("nome") && <div style={msgErro}>Campo obrigatório</div>}

      <label style={lbl}>{rotuloDoc} *</label>
      <input style={{ ...inp, ...borda("documento") }} value={form.documento}
        placeholder={form.tipoPessoa === "PF" ? "000.000.000-00" : "00.000.000/0000-00"}
        onChange={(e) => setForm((p) => ({ ...p, documento: mascararDocumento(p.tipoPessoa, e.target.value) }))} />
      {mostrar("documento") && <div style={msgErro}>{rotuloDoc} inválido. Confira os números.</div>}

      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <label style={lbl}>E-mail</label>
          <input style={{ ...inp, ...borda("email") }} type="email" value={form.email} onChange={campo("email")} />
          {mostrar("email") && <div style={msgErro}>E-mail inválido</div>}
        </div>
        <div style={{ flex: 1 }}>
          <label style={lbl}>Telefone</label>
          <input style={inp} value={form.telefone} placeholder="(00) 00000-0000"
            onChange={(e) => setForm((p) => ({ ...p, telefone: maskTelefone(e.target.value) }))} />
        </div>
      </div>

      <label style={lbl}>Observações</label>
      <textarea style={{ ...inp, minHeight: 60, resize: "vertical", fontFamily: "inherit" }} value={form.observacoes} onChange={campo("observacoes")} />

      {inicial && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18, fontSize: 13.5, color: "var(--text-2)", cursor: "pointer" }}>
          <input type="checkbox" checked={form.ativo} onChange={(e) => setForm((p) => ({ ...p, ativo: e.target.checked }))} />
          Cadastro ativo (inativos não aparecem para novas notas)
        </label>
      )}

      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}
