// Seletor de forma de pagamento (cadastro da igreja, v18). value/onChange trabalham com o id da forma (texto).
// Mostra as formas ativas e, se for o caso, a forma já gravada mesmo que inativa. semBoleto: para recebimentos de entradas.
export default function FormaSelect({ formas, value, onChange, semBoleto = false, vazio, ...resto }) {
  const opcoes = (formas || []).filter((f) => (f.ativo || String(f.id) === String(value ?? "")) && !(semBoleto && f.tipo === "boleto"));
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} {...resto}>
      {vazio !== undefined && <option value="">{vazio}</option>}
      {opcoes.map((f) => <option key={f.id} value={f.id}>{f.nome}{f.ativo ? "" : " (inativa)"}</option>)}
    </select>
  );
}
