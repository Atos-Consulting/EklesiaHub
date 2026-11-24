// Estilos de campo compartilhados (usam as variáveis de cor de src/index.css).
// Botões usam classes CSS (.btn .btn-primary .btn-ghost .btn-danger); hover/foco ficam no CSS.

export const lbl = { display: "block", fontSize: 13, fontWeight: 500, color: "var(--text-2)", margin: "16px 0 6px" };
export const inp = {
  width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border-strong)",
  fontSize: 14, background: "#fff", color: "var(--text)", boxSizing: "border-box",
};
export const msgErro = { fontSize: 12.5, color: "var(--danger)", marginTop: 5 };

export function maskTelefone(v) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0,2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
}
