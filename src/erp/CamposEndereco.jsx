import { lbl, inp, maskTelefone } from "../estilos";
import { UFS, mascararCep } from "./endereco";

// Campos de endereço e contato (valor = enderecoDe(...); onChange(novoValor)).
export default function CamposEndereco({ valor: f, onChange, erros = {}, tentou, prefixo = "end" }) {
  const set = (k, v) => onChange({ ...f, [k]: v });
  const campo = (k, rotulo, extra = {}) => (
    <div style={extra.span ? { gridColumn: `span ${extra.span}` } : undefined}>
      <label style={lbl} htmlFor={`${prefixo}-${k}`}>{rotulo}</label>
      <input id={`${prefixo}-${k}`} style={{ ...inp, ...(tentou && erros[k] ? { borderColor: "var(--danger)" } : {}) }} value={f[k]} maxLength={extra.max ?? 120}
        onChange={(e) => set(k, extra.mascara ? extra.mascara(e.target.value) : e.target.value)} placeholder={extra.placeholder} inputMode={extra.inputMode} />
      {tentou && erros[k] && <div style={{ fontSize: 12.5, color: "var(--danger)", marginTop: 5 }}>{erros[k]}</div>}
    </div>
  );
  const grade = (min) => ({ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: "0 12px" });
  return (
    <>
      <div style={grade(150)}>
        {campo("cep", "CEP", { max: 9, inputMode: "numeric", placeholder: "00000-000", mascara: mascararCep })}
        {campo("logradouro", "Logradouro", { span: 2, placeholder: "Rua, avenida..." })}
        {campo("numero", "Número", { max: 20 })}
      </div>
      <div style={grade(150)}>
        {campo("complemento", "Complemento")}
        {campo("bairro", "Bairro")}
        {campo("cidade", "Cidade")}
        <div>
          <label style={lbl} htmlFor={`${prefixo}-uf`}>UF</label>
          <select id={`${prefixo}-uf`} style={inp} value={f.uf} onChange={(e) => set("uf", e.target.value)}>
            <option value="">—</option>
            {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </div>
      <div style={grade(220)}>
        {campo("telefone", "Telefone", { max: 20, inputMode: "tel", mascara: maskTelefone })}
        {campo("email", "E-mail", { inputMode: "email", placeholder: "contato@igreja.org" })}
      </div>
    </>
  );
}
