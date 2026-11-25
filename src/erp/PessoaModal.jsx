import { useState } from "react";
import Modal from "./Modal";
import { lbl, inp, msgErro, maskTelefone } from "../estilos";
import Icone from "./Icone";
import { salvarPessoa, mensagemErro } from "./db";
import { mascararDocumento, mascararDocumentoLivre, classificarDocumento } from "./format";

// Cadastro de pessoa/empresa (usado por Fornecedores, pelo "+ Novo fornecedor" da nota e pelo "+ Nova pessoa" das entradas).
const ROTULO_PAPEL = { fornecedor: "fornecedor", membro: "membro", doador: "doador", cliente: "cliente" };
export default function PessoaModal({ inicial, sugestao, papelPadrao = "fornecedor", onSalvo, onFechar }) {
  const [form, setForm] = useState(() => ({
    nome: inicial?.nome || sugestao?.nome || "",
    documento: inicial ? mascararDocumento(inicial.tipo_pessoa, inicial.documento || "") : mascararDocumentoLivre(sugestao?.documento || ""),
    email: inicial?.email || "",
    telefone: inicial?.telefone || "",
    observacoes: inicial?.observacoes || "",
    ativo: inicial?.ativo ?? true,
  }));
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const campo = (nome) => (e) => setForm((p) => ({ ...p, [nome]: e.target.value }));
  const doc = classificarDocumento(form.documento); // o tipo (PF/PJ) é deduzido do tamanho do documento
  const msgDoc = !doc.tipo ? "Digite os 11 dígitos do CPF ou os 14 caracteres do CNPJ." : `${doc.tipo === "PF" ? "CPF" : "CNPJ"} inválido. Confira os números.`;

  const erros = {
    nome: !form.nome.trim(),
    documento: !doc.valido,
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
        tipoPessoa: doc.tipo,
        documento: doc.limpo,
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
      titulo={`${inicial ? "Editar" : "Novo"} ${ROTULO_PAPEL[papelPadrao] ?? "cadastro"}`}
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
      <label style={{ ...lbl, marginTop: 4 }} htmlFor="pessoa-doc">CPF / CNPJ *</label>
      <input id="pessoa-doc" style={{ ...inp, ...borda("documento") }} value={form.documento} autoFocus inputMode="text" autoComplete="off"
        placeholder="Digite o CPF ou o CNPJ" aria-describedby="pessoa-doc-tipo"
        onChange={(e) => setForm((p) => ({ ...p, documento: mascararDocumentoLivre(e.target.value) }))} />
      <div id="pessoa-doc-tipo" style={{ marginTop: 6, fontSize: 12.5, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {doc.tipo
          ? <span className={`pill ${doc.valido ? "pill-ok" : "pill-warn"}`}>{doc.tipo === "PF" ? "Pessoa física (CPF)" : "Empresa (CNPJ)"}</span>
          : <span className="muted">O tipo (pessoa física ou empresa) é identificado pelo tamanho do documento.</span>}
        <span className="muted">Não pode haver dois cadastros com o mesmo documento na empresa.</span>
      </div>
      {mostrar("documento") && <div style={msgErro}>{msgDoc}</div>}

      <label style={lbl}>{doc.tipo === "PF" ? "Nome completo *" : "Razão social / nome *"}</label>
      <input style={{ ...inp, ...borda("nome") }} value={form.nome} onChange={campo("nome")} />
      {mostrar("nome") && <div style={msgErro}>Campo obrigatório</div>}

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
