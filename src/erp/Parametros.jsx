import { Header } from "../ui";
import { GRUPOS_PARAMETROS, ABAS_PARAMETROS } from "./parametros/grupos";

export default function Parametros({ aba, cadastros, onCadastrosMudaram }) {
  const atual = ABAS_PARAMETROS.find((a) => a.id === aba) ?? ABAS_PARAMETROS[0];
  const { Tela } = GRUPOS_PARAMETROS.flatMap((g) => g.abas).find((a) => a.id === atual.id);

  return (
    <div>
      <div className="page-header">
        <Header title="Parâmetros" subtitle="Configurações desta empresa, por área. Apenas administradores têm acesso." />
      </div>
      <div className="param-layout">
        <nav className="param-nav" aria-label="Áreas dos parâmetros">
          {GRUPOS_PARAMETROS.map((g) => (
            <div key={g.id}>
              <div className="param-grupo">{g.rotulo}</div>
              {g.abas.map((a) => (
                <a key={a.id} href={`#/parametros/${a.id}`} className={`param-item${a.id === atual.id ? " ativo" : ""}`}
                  aria-current={a.id === atual.id ? "page" : undefined}>{a.rotulo}</a>
              ))}
            </div>
          ))}
        </nav>
        <div className="card param-conteudo">
          <Tela cadastros={cadastros} onCadastrosMudaram={onCadastrosMudaram} />
        </div>
      </div>
    </div>
  );
}
