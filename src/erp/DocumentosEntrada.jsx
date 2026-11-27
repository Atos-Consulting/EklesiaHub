import { formatarMoeda, formatarData, hojeISO, mascararDocumento, mascararCnpj, valorPorExtenso, deCentavos } from "./format";
import { TIPOS_ENTRADA } from "./financeiro";
import { urlLogo } from "./db";

// Documentos impressos de Dízimos e ofertas: comprovante de uma entrada e informe anual de contribuições.
// Só exibem dados (sem regra de negócio); a impressão é feita por <Impressao>.

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const dataPorExtenso = (iso) => `${Number(iso.slice(8, 10))} de ${MESES[Number(iso.slice(5, 7)) - 1].toLowerCase()} de ${iso.slice(0, 4)}`;

function enderecoIgreja(e) {
  if (!e) return "";
  const rua = [e.logradouro, e.numero].filter(Boolean).join(", ");
  const local = [e.bairro, [e.cidade, e.uf].filter(Boolean).join("/")].filter(Boolean).join(" · ");
  return [rua, e.complemento, local, e.cep ? `CEP ${String(e.cep).replace(/^(\d{5})(\d{3})$/, "$1-$2")}` : ""].filter(Boolean).join(" — ");
}

export function CabecalhoIgreja({ empresa, nomeIgreja, titulo, subtitulo }) {
  const nome = empresa?.nome_fantasia || empresa?.razao_social || nomeIgreja;
  return (
    <header className="doc-cabecalho">
      {empresa?.logo_caminho && <img className="doc-logo" src={urlLogo(empresa.logo_caminho)} alt="" />}
      <div className="doc-igreja">{nome}</div>
      {empresa?.razao_social && empresa.razao_social !== nome && <div className="doc-linha">{empresa.razao_social}</div>}
      <div className="doc-linha">
        {[empresa?.cnpj ? `CNPJ ${mascararCnpj(empresa.cnpj)}` : "", enderecoIgreja(empresa), empresa?.telefone, empresa?.email].filter(Boolean).join(" · ")}
      </div>
      <h2 className="doc-titulo">{titulo}</h2>
      {subtitulo && <div className="doc-sub">{subtitulo}</div>}
    </header>
  );
}

function Assinatura({ cidade, data, quem }) {
  return (
    <footer className="doc-rodape">
      <p>{cidade ? `${cidade}, ` : ""}{dataPorExtenso(data)}.</p>
      <div className="doc-assinatura"><span className="rel-linha" />{quem}</div>
    </footer>
  );
}

// Comprovante de um dízimo, oferta ou campanha.
export function ComprovanteEntrada({ entrada: e, pessoa, empresa, nomeIgreja }) {
  const referente = e.tipo === "campanha" && e.campanha_nome ? `oferta para a campanha "${e.campanha_nome}"` : (TIPOS_ENTRADA[e.tipo] || "contribuição").toLowerCase();
  const quem = e.pessoa_nome
    ? <><strong>{e.pessoa_nome}</strong>{pessoa?.documento ? `, ${pessoa.tipo_pessoa === "PJ" ? "CNPJ" : "CPF"} ${mascararDocumento(pessoa.tipo_pessoa, pessoa.documento)}` : ""}</>
    : <strong>contribuinte não identificado</strong>;
  return (
    <article className="doc-folha doc-comprovante">
      <CabecalhoIgreja empresa={empresa} nomeIgreja={nomeIgreja} titulo="Comprovante de contribuição" subtitulo={`Nº ${String(e.id).padStart(6, "0")}`} />
      <div className="doc-valor">{formatarMoeda(e.valor)}</div>
      <p className="doc-texto">
        Recebemos de {quem}{e.pessoa_nome && pessoa?.documento ? "," : ""} a importância de <strong>{formatarMoeda(e.valor)}</strong> ({valorPorExtenso(e.valor)}),
        referente a <strong>{referente}</strong>, em {formatarData(e.data)}, por {e.forma_pagamento_nome ?? "—"}.
      </p>
      {e.descricao && <p className="doc-texto doc-pequeno">Observação: {e.descricao}</p>}
      <p className="doc-texto doc-pequeno">Registrado por {e.registrado_por_nome || "—"}{e.criado_em ? ` em ${new Date(e.criado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : ""}.</p>
      <Assinatura cidade={empresa?.cidade} data={hojeISO()} quem="Tesouraria" />
    </article>
  );
}

// Informe anual de uma pessoa: total e quebra mensal por tipo. resumo = { meses: [{dizimo, oferta, campanha}] x12 em centavos, total }
export function InformeContribuicoes({ ano, pessoa, resumo, empresa, nomeIgreja }) {
  const total = deCentavos(resumo.total);
  const doc = pessoa?.documento ? `, ${pessoa.tipo_pessoa === "PJ" ? "CNPJ" : "CPF"} ${mascararDocumento(pessoa.tipo_pessoa, pessoa.documento)}` : "";
  const soma = (k) => resumo.meses.reduce((a, m) => a + m[k], 0);
  return (
    <article className="doc-folha doc-informe">
      <CabecalhoIgreja empresa={empresa} nomeIgreja={nomeIgreja} titulo={`Declaração de contribuições — ${ano}`} />
      <p className="doc-texto">
        Declaramos, para os devidos fins, que <strong>{pessoa?.nome ?? "—"}</strong>{doc}{doc ? "," : ""} contribuiu voluntariamente com esta igreja
        durante o ano de {ano}, com o total de <strong>{formatarMoeda(total)}</strong> ({valorPorExtenso(total)}), conforme os
        registros da tesouraria discriminados abaixo.
      </p>
      <table className="rel-tabela">
        <thead><tr><th>Mês</th><th className="num">Dízimos</th><th className="num">Ofertas</th><th className="num">Campanhas</th><th className="num">Total</th></tr></thead>
        <tbody>
          {resumo.meses.map((m, i) => {
            const t = m.dizimo + m.oferta + m.campanha;
            return (
              <tr key={i} className={t ? undefined : "doc-mes-vazio"}>
                <td>{MESES[i]}</td>
                <td className="num">{m.dizimo ? formatarMoeda(deCentavos(m.dizimo)) : "—"}</td>
                <td className="num">{m.oferta ? formatarMoeda(deCentavos(m.oferta)) : "—"}</td>
                <td className="num">{m.campanha ? formatarMoeda(deCentavos(m.campanha)) : "—"}</td>
                <td className="num">{t ? formatarMoeda(deCentavos(t)) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr>
          <td>Total</td><td className="num">{formatarMoeda(deCentavos(soma("dizimo")))}</td><td className="num">{formatarMoeda(deCentavos(soma("oferta")))}</td>
          <td className="num">{formatarMoeda(deCentavos(soma("campanha")))}</td><td className="num">{formatarMoeda(total)}</td>
        </tr></tfoot>
      </table>
      <Assinatura cidade={empresa?.cidade} data={hojeISO()} quem="Tesouraria" />
    </article>
  );
}
