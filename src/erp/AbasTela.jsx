// Abas de uma tela que junta várias visões (ex.: Financeiro → Caixa). Cada aba é um link (#/modulo/tela/aba),
// então voltar, atualizar a página e links diretos continuam funcionando.
export default function AbasTela({ base, abas, atual, rotulo }) {
  return (
    <nav className="segmented abas-tela no-print" aria-label={rotulo}>
      {abas.map((a) => (
        <a key={a.id} href={`${base}/${a.id}`} aria-current={a.id === atual ? "page" : undefined}>{a.rotulo}</a>
      ))}
    </nav>
  );
}
