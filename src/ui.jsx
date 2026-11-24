// Componentes visuais compartilhados. Os estilos ficam em src/index.css.

export function Pill({ children, tone = "neutral" }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export function Card({ children, style, onClick, className = "" }) {
  return (
    <div className={`card ${className}`.trim()} onClick={onClick} style={style}>
      {children}
    </div>
  );
}

// Título de página. Quem usa coloca o botão de ação ao lado, dentro de <div className="page-header">.
export function Header({ title, subtitle }) {
  return (
    <div>
      <h1 className="page-title">{title}</h1>
      {subtitle && <p className="page-sub">{subtitle}</p>}
    </div>
  );
}
