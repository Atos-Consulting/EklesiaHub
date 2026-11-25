import { GRUPOS_TRIBUTOS_NOTA, GRUPOS_TRIBUTOS_ITEM, CAMPOS_TEXTO_ITEM } from "./tributos";
import { formatarMoeda, lerNumero } from "./format";

// Tributos em cartões (rótulo + valor), como no totvs-portal: mais fácil de ler que uma tabela alta.
// Em edição o cartão vira campo; só leitura mostra o valor e esmaece o que está zerado/vazio.

const temValor = (v) => v === true || (v !== false && String(v ?? "").trim() !== "");

function valorLegivel(campo, v) {
  if (!temValor(v)) return "—";
  if (campo.texto) return String(v);
  const n = lerNumero(v);
  if (!Number.isFinite(n)) return String(v);
  return campo.percentual ? `${n.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%` : formatarMoeda(n);
}

function Cartao({ campo, valor, onChange, disabled }) {
  const vazio = !temValor(valor);
  const marca = campo.soma ? <span className="tributo-tag soma" title="Entra no total da nota">soma no total</span>
    : campo.retencao ? <span className="tributo-tag retencao" title="Sai do valor pago ao fornecedor">retenção</span> : null;
  return (
    <div className={`tributo${disabled && vazio ? " tributo-zerado" : ""}${!disabled ? " tributo-editavel" : ""}`}>
      <span className="tributo-rotulo">{campo.rotulo}{marca}</span>
      {disabled ? (
        <span className="tributo-valor">{valorLegivel(campo, valor)}</span>
      ) : (
        <div className="tributo-campo">
          {!campo.texto && <span className="tributo-prefixo">{campo.percentual ? "%" : "R$"}</span>}
          <input className="tributo-input" value={valor ?? ""} aria-label={campo.rotulo}
            inputMode={campo.texto ? undefined : "decimal"} placeholder={campo.texto ? "" : "0,00"}
            maxLength={campo.tamanho ?? (campo.texto ? 60 : 20)}
            style={campo.texto ? { textAlign: "left" } : undefined}
            onChange={(e) => onChange(campo.chave, e.target.value)} />
        </div>
      )}
    </div>
  );
}

function Marca({ marca, valor, onChange, disabled }) {
  if (disabled) {
    return (
      <div className={`tributo${valor === true ? "" : " tributo-zerado"}`}>
        <span className="tributo-rotulo">{marca.rotulo}</span>
        <span className="tributo-valor">{valor === true ? "Sim" : "Não"}</span>
      </div>
    );
  }
  return (
    <label className="tributo tributo-editavel tributo-marca">
      <input type="checkbox" checked={valor === true} onChange={(e) => onChange(marca.chave, e.target.checked)} />
      <span>{marca.rotulo}<span className="tributo-tag retencao">sai do valor pago</span></span>
    </label>
  );
}

function Grupos({ grupos, fiscal, onChange, disabled }) {
  return grupos.map((g) => (
    <div key={g.titulo}>
      <div className="grupo-titulo">{g.titulo}</div>
      <div className="tributos-grid">
        {g.campos.map((c) => <Cartao key={c.chave} campo={c} valor={fiscal[c.chave]} onChange={onChange} disabled={disabled} />)}
        {(g.textos ?? []).map((t) => <Cartao key={t.chave} campo={{ ...t, texto: true }} valor={fiscal[t.chave]} onChange={onChange} disabled={disabled} />)}
        {(g.marcas ?? []).map((m) => <Marca key={m.chave} marca={m} valor={fiscal[m.chave]} onChange={onChange} disabled={disabled} />)}
      </div>
    </div>
  ));
}

// Tributos do cabeçalho da nota (totais). IPI e ICMS ST somam ao total; retenções saem do valor a pagar.
export function TributosNota({ fiscal, onChange, disabled }) {
  return <Grupos grupos={GRUPOS_TRIBUTOS_NOTA} fiscal={fiscal} onChange={onChange} disabled={disabled} />;
}

// Tributos e dados fiscais de UM item (NCM, CFOP, ICMS, IPI, PIS, COFINS, ISS, retenções).
export function TributosItem({ fiscal, onChange, disabled }) {
  if (disabled && !Object.values(fiscal ?? {}).some(temValor)) {
    return <p className="muted" style={{ fontSize: 13, margin: "12px 0 0" }}>Nenhum tributo informado para este item.</p>;
  }
  const classificacao = { titulo: "Classificação fiscal", campos: CAMPOS_TEXTO_ITEM.map((c) => ({ ...c, texto: true })) };
  return <Grupos grupos={[classificacao, ...GRUPOS_TRIBUTOS_ITEM]} fiscal={fiscal} onChange={onChange} disabled={disabled} />;
}
