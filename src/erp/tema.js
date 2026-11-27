// Cores da igreja (v22): a cor principal e a do menu lateral viram variáveis CSS em <html>
// (os tokens de index.css). Sem cor escolhida, valem as do sistema (teal e azul-noite).

export const COR_PRIMARIA_PADRAO = "#0f766e";
export const COR_MENU_PADRAO = "#0b1220";

// Sugestões prontas: cor principal + menu que combinam e passam no contraste.
export const PALETAS = [
  { nome: "Padrão", primaria: COR_PRIMARIA_PADRAO, menu: COR_MENU_PADRAO },
  { nome: "Azul", primaria: "#1d4ed8", menu: "#0f172a" },
  { nome: "Índigo", primaria: "#4338ca", menu: "#1e1b4b" },
  { nome: "Vinho", primaria: "#9f1239", menu: "#1c0a10" },
  { nome: "Verde", primaria: "#15803d", menu: "#0a1f12" },
  { nome: "Laranja", primaria: "#c2410c", menu: "#1c1009" },
  { nome: "Roxo", primaria: "#7e22ce", menu: "#1a0b2e" },
  { nome: "Grafite", primaria: "#334155", menu: "#020617" },
];

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const misturar = (a, b, t) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t)); // t=0 → a, t=1 → b
export const corValida = (c) => /^#[0-9a-f]{6}$/i.test(c ?? "");

function luminancia(c) {
  const [r, g, b] = rgb(c).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// Contraste com texto branco (WCAG): 4.5 é o mínimo para texto comum.
export const contrasteComBranco = (c) => 1.05 / (luminancia(c) + 0.05);

// Problema de leitura com a cor, ou "" se estiver boa.
export function avisoCor(c, tipo) {
  if (!corValida(c)) return "Cor inválida";
  const k = contrasteComBranco(c);
  if (tipo === "menu" && k < 9) return "Escolha uma cor mais escura: o texto do menu é claro e ficaria difícil de ler.";
  if (tipo === "primaria" && k < 4.5) return "Escolha uma cor mais escura: o texto branco dos botões ficaria difícil de ler.";
  return "";
}

const VARIAVEIS = ["--primary", "--primary-hover", "--primary-soft", "--primary-bright", "--sidebar", "--sidebar-active"];

// Aplica (ou volta ao padrão, com nulos) as cores no documento.
export function aplicarTema({ cor_primaria: corPri, cor_menu: corMenu } = {}) {
  const raiz = document.documentElement.style;
  // Cor igual à do sistema = sem cor própria (mantém os tons originais de index.css).
  const pri = corPri && corPri.toLowerCase() !== COR_PRIMARIA_PADRAO ? corPri : null;
  const menu = corMenu && corMenu.toLowerCase() !== COR_MENU_PADRAO ? corMenu : null;
  if (!corValida(pri) && !corValida(menu)) { VARIAVEIS.forEach((v) => raiz.removeProperty(v)); return; }
  if (corValida(pri)) {
    const brilho = misturar(pri, "#ffffff", 0.45);
    raiz.setProperty("--primary", pri);
    raiz.setProperty("--primary-hover", misturar(pri, "#000000", 0.18));
    raiz.setProperty("--primary-soft", misturar(pri, "#ffffff", 0.86));
    raiz.setProperty("--primary-bright", brilho);
    raiz.setProperty("--sidebar-active", `rgba(${rgb(brilho).join(", ")}, 0.14)`);
  } else ["--primary", "--primary-hover", "--primary-soft", "--primary-bright", "--sidebar-active"].forEach((v) => raiz.removeProperty(v));
  if (corValida(menu)) raiz.setProperty("--sidebar", menu); else raiz.removeProperty("--sidebar");
}
