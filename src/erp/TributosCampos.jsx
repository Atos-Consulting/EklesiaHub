import { lbl, inp } from "../estilos";
import { GRUPOS_TRIBUTOS_NOTA, GRUPOS_TRIBUTOS_ITEM, CAMPOS_TEXTO_ITEM } from "./tributos";

const grade = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0 12px" };

function CampoNumero({ campo, valor, onChange, disabled }) {
  return (
    <div>
      <label style={{ ...lbl, marginTop: 8, fontSize: 12.5 }}>
        {campo.rotulo}
        {campo.soma && <span className="pill pill-warn" style={{ marginLeft: 6, padding: "0 7px", fontSize: 10.5 }}>soma no total</span>}
      </label>
      <input style={{ ...inp, textAlign: "right" }} inputMode="decimal" placeholder="0,00" value={valor ?? ""}
        onChange={(e) => onChange(campo.chave, e.target.value)} disabled={disabled} aria-label={campo.rotulo} />
    </div>
  );
}

// Tributos do cabeçalho da nota (totais). IPI e ICMS ST somam ao total; o resto é informativo/retenções.
export function TributosNota({ fiscal, onChange, disabled }) {
  return (
    <div>
      {GRUPOS_TRIBUTOS_NOTA.map((g) => (
        <div key={g.titulo}>
          <div className="grupo-titulo">{g.titulo}</div>
          <div style={grade}>
            {g.campos.map((c) => <CampoNumero key={c.chave} campo={c} valor={fiscal[c.chave]} onChange={onChange} disabled={disabled} />)}
            {(g.textos ?? []).map((t) => (
              <div key={t.chave}>
                <label style={{ ...lbl, marginTop: 8, fontSize: 12.5 }}>{t.rotulo}</label>
                <input style={inp} maxLength={60} value={fiscal[t.chave] ?? ""} onChange={(e) => onChange(t.chave, e.target.value)} disabled={disabled} />
              </div>
            ))}
            {(g.marcas ?? []).map((m) => (
              <label key={m.chave} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 30, fontSize: 13, color: "var(--text-2)" }}>
                <input type="checkbox" checked={fiscal[m.chave] === true} disabled={disabled} onChange={(e) => onChange(m.chave, e.target.checked)} />
                {m.rotulo}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Tributos e dados fiscais de UM item (NCM, CFOP, ICMS, IPI, PIS, COFINS, ISS, retenções).
export function TributosItem({ fiscal, onChange, disabled }) {
  return (
    <div>
      <div className="grupo-titulo" style={{ marginTop: 0 }}>Classificação fiscal</div>
      <div style={grade}>
        {CAMPOS_TEXTO_ITEM.map((c) => (
          <div key={c.chave}>
            <label style={{ ...lbl, marginTop: 8, fontSize: 12.5 }}>{c.rotulo}</label>
            <input style={inp} maxLength={c.tamanho} value={fiscal[c.chave] ?? ""} onChange={(e) => onChange(c.chave, e.target.value)} disabled={disabled} aria-label={c.rotulo} />
          </div>
        ))}
      </div>
      {GRUPOS_TRIBUTOS_ITEM.map((g) => (
        <div key={g.titulo}>
          <div className="grupo-titulo">{g.titulo}</div>
          <div style={grade}>
            {g.campos.map((c) => <CampoNumero key={c.chave} campo={c} valor={fiscal[c.chave]} onChange={onChange} disabled={disabled} />)}
          </div>
        </div>
      ))}
    </div>
  );
}
