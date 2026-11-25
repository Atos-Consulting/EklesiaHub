import { useEffect, useState } from "react";
import { lbl, inp, maskTelefone } from "../../estilos";
import Icone from "../Icone";
import { buscarEmpresa, atualizarDadosEmpresa, mensagemErro } from "../db";
import { mascararCnpj, soDigitos } from "../format";
import { CabecalhoAba } from "./comum";

const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];
const VAZIO = { nome_fantasia: "", cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", telefone: "", email: "" };
const mascararCep = (v) => { const d = soDigitos(v).slice(0, 8); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };

// Sistema → Dados da igreja: endereço e contatos. Razão social e CNPJ são do cadastro da plataforma (tela Igrejas).
export default function DadosIgreja({ perfil }) {
  const [empresa, setEmpresa] = useState(null);
  const [f, setF] = useState(VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);
  const [tentou, setTentou] = useState(false);

  useEffect(() => {
    let ativo = true;
    buscarEmpresa(perfil.empresa_id)
      .then((e) => {
        if (!ativo) return;
        setEmpresa(e);
        setF(Object.fromEntries(Object.keys(VAZIO).map((k) => [k, k === "cep" ? mascararCep(e[k] || "") : e[k] ?? ""])));
      })
      .catch((e) => { if (ativo) setErro(mensagemErro(e)); });
    return () => { ativo = false; };
  }, [perfil.empresa_id]);

  const set = (k) => (e) => { setOk(false); setF((p) => ({ ...p, [k]: e.target.value })); };
  const erros = {};
  if (f.cep && soDigitos(f.cep).length !== 8) erros.cep = "O CEP tem 8 números";
  if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) erros.email = "E-mail inválido";

  async function salvar() {
    setTentou(true);
    setErro("");
    setOk(false);
    if (Object.keys(erros).length) return;
    setSalvando(true);
    try { await atualizarDadosEmpresa({ ...f, cep: soDigitos(f.cep) }); setOk(true); }
    catch (e) { setErro(mensagemErro(e)); }
    finally { setSalvando(false); }
  }

  const campo = (k, rotulo, extra = {}) => (
    <div style={extra.span ? { gridColumn: `span ${extra.span}` } : undefined}>
      <label style={lbl} htmlFor={`ig-${k}`}>{rotulo}</label>
      <input id={`ig-${k}`} style={{ ...inp, ...(tentou && erros[k] ? { borderColor: "var(--danger)" } : {}) }} value={f[k]} maxLength={extra.max ?? 120}
        onChange={extra.onChange ?? set(k)} placeholder={extra.placeholder} inputMode={extra.inputMode} />
      {tentou && erros[k] && <div style={{ fontSize: 12.5, color: "var(--danger)", marginTop: 5 }}>{erros[k]}</div>}
    </div>
  );
  const grade = (min) => ({ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: "0 12px" });

  return (
    <>
      <CabecalhoAba titulo="Dados da igreja" descricao="Endereço e contatos da igreja, usados nos documentos e relatórios. A razão social e o CNPJ são definidos pelo administrador da plataforma." />
      <div style={{ padding: "0 24px 24px" }}>
        {!empresa && !erro && <div className="carregando-linha"><div className="spinner" /> Carregando...</div>}
        {empresa && (
          <form onSubmit={(e) => { e.preventDefault(); salvar(); }} noValidate>
            <div className="resumo-pagar" style={{ marginTop: 0 }}>
              <span>Razão social: <strong>{empresa.razao_social}</strong></span>
              <span>CNPJ: <strong>{empresa.cnpj ? mascararCnpj(empresa.cnpj) : "não informado"}</strong></span>
            </div>
            <div style={grade(220)}>{campo("nome_fantasia", "Nome da igreja (como aparece no sistema)", { placeholder: empresa.razao_social })}</div>

            <h3 className="section-title">Endereço</h3>
            <div style={grade(150)}>
              {campo("cep", "CEP", { max: 9, inputMode: "numeric", placeholder: "00000-000", onChange: (e) => { setOk(false); setF((p) => ({ ...p, cep: mascararCep(e.target.value) })); } })}
              {campo("logradouro", "Logradouro", { span: 2, placeholder: "Rua, avenida..." })}
              {campo("numero", "Número", { max: 20 })}
            </div>
            <div style={grade(150)}>
              {campo("complemento", "Complemento")}
              {campo("bairro", "Bairro")}
              {campo("cidade", "Cidade")}
              <div>
                <label style={lbl} htmlFor="ig-uf">UF</label>
                <select id="ig-uf" style={inp} value={f.uf} onChange={set("uf")}>
                  <option value="">—</option>
                  {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            <h3 className="section-title">Contato</h3>
            <div style={grade(220)}>
              {campo("telefone", "Telefone", { max: 20, inputMode: "tel", onChange: (e) => { setOk(false); setF((p) => ({ ...p, telefone: maskTelefone(e.target.value) })); } })}
              {campo("email", "E-mail", { inputMode: "email", placeholder: "contato@igreja.org" })}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 20 }}>
              {ok && <span className="pill pill-ok">Dados salvos</span>}
              <button type="submit" className="btn btn-primary" disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</button>
            </div>
          </form>
        )}
        {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
      </div>
    </>
  );
}
