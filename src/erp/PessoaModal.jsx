import { useState } from "react";
import Modal from "./Modal";
import { lbl, inp, msgErro, maskTelefone } from "../estilos";
import Icone from "./Icone";
import { salvarPessoa, mensagemErro } from "./db";
import { mascararDocumento, mascararDocumentoLivre, classificarDocumento } from "./format";
import FormaSelect from "./FormaSelect";
import { TIPOS_CHAVE_PIX, TIPOS_CONTA, CAMPOS_CONTA_PESSOA } from "./financeiro";

// Cadastro de pessoa/empresa (usado por Fornecedores, pelo "+ Novo fornecedor" da nota e pelo "+ Nova pessoa" das entradas).
// Com `formas` (v29), mostra também os dados para pagamento: forma preferida, PIX e conta bancária, que os
// lançamentos novos da pessoa recebem sozinhos.
const ROTULO_PAPEL = { fornecedor: "fornecedor", membro: "membro", doador: "doador", cliente: "cliente" };
export default function PessoaModal({ inicial, sugestao, papelPadrao = "fornecedor", formas, onSalvo, onFechar }) {
  const [form, setForm] = useState(() => ({
    nome: inicial?.nome || sugestao?.nome || "",
    documento: inicial ? mascararDocumento(inicial.tipo_pessoa, inicial.documento || "") : mascararDocumentoLivre(sugestao?.documento || ""),
    email: inicial?.email || "",
    telefone: inicial?.telefone || "",
    observacoes: inicial?.observacoes || "",
    ativo: inicial?.ativo ?? true,
  }));
  const [pag, setPag] = useState(() => ({
    forma_pagamento_id: inicial?.forma_pagamento_id ? String(inicial.forma_pagamento_id) : "",
    ...Object.fromEntries(CAMPOS_CONTA_PESSOA.map((k) => [k, inicial?.[k] ?? ""])),
  }));
  const [verPag, setVerPag] = useState(() => Boolean(inicial?.forma_pagamento_id || inicial?.pix_chave || inicial?.banco || inicial?.conta));
  const setP = (k) => (e) => setPag((x) => ({ ...x, [k]: e.target.value }));
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
    titularDoc: (() => { const d = pag.titular_documento.replace(/[^0-9A-Za-z]/g, ""); return d !== "" && d.length !== 11 && d.length !== 14; })(),
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
        ...(formas ? { pagamento: pag } : {}),
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

      {formas && (
        <>
          <button type="button" className="link-btn" style={{ marginTop: 16, fontSize: 13.5 }} onClick={() => setVerPag((v) => !v)} aria-expanded={verPag}>
            {verPag ? "▾" : "▸"} Dados para pagamento (forma preferida, PIX, conta bancária)
          </button>
          {verPag && (
            <div className="painel" style={{ marginTop: 6 }}>
              <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>Os lançamentos novos desta pessoa (notas, contas fixas e lançamentos à mão) já vêm com estes dados quando a forma for PIX ou transferência.</div>
              <label style={lbl} htmlFor="pessoa-forma">Forma preferida</label>
              <FormaSelect id="pessoa-forma" style={inp} formas={formas} value={pag.forma_pagamento_id} vazio="— Nenhuma —" onChange={(v) => setPag((x) => ({ ...x, forma_pagamento_id: v }))} />
              <div style={{ display: "grid", gridTemplateColumns: "minmax(130px, 170px) 1fr", gap: "0 10px" }}>
                <div>
                  <label style={lbl} htmlFor="pessoa-pixtipo">Tipo de chave</label>
                  <select id="pessoa-pixtipo" style={inp} value={pag.pix_tipo} onChange={setP("pix_tipo")}>
                    <option value="">—</option>
                    {Object.entries(TIPOS_CHAVE_PIX).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl} htmlFor="pessoa-pix">Chave PIX</label>
                  <input id="pessoa-pix" style={inp} maxLength={77} value={pag.pix_chave} onChange={setP("pix_chave")} placeholder="CPF/CNPJ, e-mail, telefone ou chave aleatória" />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "0 10px" }}>
                <div><label style={lbl} htmlFor="pessoa-banco">Banco</label><input id="pessoa-banco" style={inp} maxLength={60} value={pag.banco} onChange={setP("banco")} placeholder="Ex.: Itaú (341)" /></div>
                <div><label style={lbl} htmlFor="pessoa-ag">Agência</label><input id="pessoa-ag" style={inp} maxLength={20} value={pag.agencia} onChange={setP("agencia")} /></div>
                <div><label style={lbl} htmlFor="pessoa-conta">Conta</label><input id="pessoa-conta" style={inp} maxLength={30} value={pag.conta} onChange={setP("conta")} placeholder="Com o dígito" /></div>
                <div>
                  <label style={lbl} htmlFor="pessoa-tipoconta">Tipo de conta</label>
                  <select id="pessoa-tipoconta" style={inp} value={pag.tipo_conta} onChange={setP("tipo_conta")}>
                    <option value="">—</option>
                    {Object.entries(TIPOS_CONTA).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr minmax(150px, 1fr)", gap: "0 10px" }}>
                <div><label style={lbl} htmlFor="pessoa-titular">Titular da conta</label><input id="pessoa-titular" style={inp} maxLength={120} value={pag.titular} onChange={setP("titular")} placeholder="Se for outra pessoa" /></div>
                <div>
                  <label style={lbl} htmlFor="pessoa-titdoc">CPF/CNPJ do titular</label>
                  <input id="pessoa-titdoc" style={{ ...inp, ...borda("titularDoc") }} maxLength={18} value={mascararDocumentoLivre(pag.titular_documento)}
                    onChange={(e) => setPag((x) => ({ ...x, titular_documento: e.target.value.replace(/[^0-9A-Za-z]/g, "").toUpperCase() }))} />
                  {mostrar("titularDoc") && <div style={msgErro}>11 (CPF) ou 14 (CNPJ) caracteres</div>}
                </div>
              </div>
            </div>
          )}
        </>
      )}

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
