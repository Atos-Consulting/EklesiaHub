import { useMemo, useState } from "react";
import { Header } from "../ui";
import { inp } from "../estilos";
import Icone from "./Icone";
import ThOrdenavel from "./ThOrdenavel";
import { useOrdenacao } from "./useOrdenacao";
import { useCarga } from "./useCarga";
import Impressao from "./Impressao";
import { InformeContribuicoes } from "./DocumentosEntrada";
import { listarContribuicoesAno, buscarEmpresa } from "./db";
import { formatarMoeda, hojeISO, mascararDocumento, paraCentavos, deCentavos } from "./format";

// Financeiro → Dízimos e ofertas → Informe anual: total contribuído por pessoa no ano, com a
// declaração para imprimir (uma pessoa ou todas). Entradas sem pessoa e estornadas não entram.

const COLUNAS = {
  nome: (l) => l.nome,
  dizimo: (l) => l.dizimo,
  oferta: (l) => l.oferta,
  campanha: (l) => l.campanha,
  total: (l) => l.total,
};

export default function InformeAnual({ cadastros, perfil }) {
  const anoAtual = Number(hojeISO().slice(0, 4));
  const [ano, setAno] = useState(anoAtual);
  const [busca, setBusca] = useState("");
  const [imprimir, setImprimir] = useState(null); // lista de pessoa_id
  const dados = useCarga(`ano|${ano}`, () => listarContribuicoesAno(ano));
  const empresa = useCarga(perfil?.empresa_id ? `emp|${perfil.empresa_id}` : null, () => buscarEmpresa(perfil.empresa_id));

  const { linhas, resumos, semPessoa } = useMemo(() => {
    const mapa = new Map();
    let sem = 0;
    for (const e of dados.dados || []) {
      const c = paraCentavos(e.valor);
      if (!e.pessoa_id) { sem += c; continue; }
      if (!mapa.has(e.pessoa_id)) mapa.set(e.pessoa_id, { meses: Array.from({ length: 12 }, () => ({ dizimo: 0, oferta: 0, campanha: 0 })), total: 0 });
      const r = mapa.get(e.pessoa_id);
      const tipo = e.tipo === "dizimo" || e.tipo === "campanha" ? e.tipo : "oferta"; // "outra" (antiga) conta como oferta
      r.meses[Number(e.data.slice(5, 7)) - 1][tipo] += c;
      r.total += c;
    }
    const lista = [...mapa.entries()].map(([id, r]) => {
      const p = cadastros.pessoas.find((x) => x.id === id);
      const soma = (k) => r.meses.reduce((a, m) => a + m[k], 0);
      return { id, nome: p?.nome ?? `Pessoa ${id}`, pessoa: p, dizimo: soma("dizimo"), oferta: soma("oferta"), campanha: soma("campanha"), total: r.total };
    });
    return { linhas: lista, resumos: mapa, semPessoa: sem };
  }, [dados.dados, cadastros.pessoas]);

  const termo = busca.trim().toLowerCase();
  const filtradas = useMemo(() => linhas.filter((l) => !termo || l.nome.toLowerCase().includes(termo) || (l.pessoa?.documento || "").includes(termo.replace(/\D/g, "") || "§")), [linhas, termo]);
  const ordenacao = useOrdenacao(filtradas, COLUNAS, { chave: "nome", dir: "asc" });
  const totalGeral = filtradas.reduce((a, l) => a + l.total, 0);
  const pronto = dados.dados && !dados.carregando;
  const anos = Array.from({ length: 6 }, (_, i) => anoAtual - i);

  return (
    <div>
      <div className="page-header">
        <Header title="Informe anual" subtitle="Total que cada pessoa contribuiu no ano (dízimos, ofertas e campanhas), com a declaração para imprimir ou salvar em PDF. Só entram entradas válidas com a pessoa identificada." />
        <button className="btn btn-primary" disabled={!pronto || filtradas.length === 0} onClick={() => setImprimir(ordenacao.ordenadas.map((l) => l.id))}>
          <Icone nome="impressora" tamanho={16} /> Imprimir {filtradas.length > 1 ? `todos (${filtradas.length})` : "informe"}
        </button>
      </div>

      {dados.erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 16 }}><Icone nome="alerta" tamanho={16} /><span>{dados.erro}</span></div>}

      <div className="card">
        <div className="toolbar">
          <label>Ano
            <select value={ano} onChange={(e) => setAno(Number(e.target.value))} style={{ ...inp, width: 110 }}>
              {anos.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label style={{ flex: "1 1 220px", maxWidth: 320 }}>Buscar
            <input placeholder="Nome ou CPF" value={busca} onChange={(e) => setBusca(e.target.value)} style={inp} />
          </label>
        </div>
        {pronto && semPessoa > 0 && (
          <div className="muted" style={{ fontSize: 12.5, padding: "0 16px 10px" }}>
            {formatarMoeda(deCentavos(semPessoa))} em {ano} foram lançados sem identificar a pessoa e não aparecem nos informes.
          </div>
        )}
        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <ThOrdenavel chave="nome" ordenacao={ordenacao}>Pessoa</ThOrdenavel>
              <ThOrdenavel chave="dizimo" ordenacao={ordenacao} className="num">Dízimos</ThOrdenavel>
              <ThOrdenavel chave="oferta" ordenacao={ordenacao} className="num">Ofertas</ThOrdenavel>
              <ThOrdenavel chave="campanha" ordenacao={ordenacao} className="num">Campanhas</ThOrdenavel>
              <ThOrdenavel chave="total" ordenacao={ordenacao} className="num">Total</ThOrdenavel>
              <th className="acoes"><span className="sr-only">Ações</span></th>
            </tr></thead>
            <tbody>
              {!pronto && !dados.erro && <tr><td className="vazio" colSpan={6}>Carregando...</td></tr>}
              {pronto && filtradas.length === 0 && <tr><td className="vazio" colSpan={6}>{linhas.length ? "Ninguém encontrado com essa busca." : `Nenhuma contribuição identificada em ${ano}.`}</td></tr>}
              {pronto && ordenacao.ordenadas.map((l) => (
                <tr key={l.id}>
                  <td style={{ fontWeight: 550 }}>{l.nome}{l.pessoa?.documento && <div className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{mascararDocumento(l.pessoa.tipo_pessoa, l.pessoa.documento)}</div>}</td>
                  <td className="num">{l.dizimo ? formatarMoeda(deCentavos(l.dizimo)) : "—"}</td>
                  <td className="num">{l.oferta ? formatarMoeda(deCentavos(l.oferta)) : "—"}</td>
                  <td className="num">{l.campanha ? formatarMoeda(deCentavos(l.campanha)) : "—"}</td>
                  <td className="num" style={{ fontWeight: 650 }}>{formatarMoeda(deCentavos(l.total))}</td>
                  <td className="acoes"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setImprimir([l.id])}><Icone nome="impressora" tamanho={14} /> Informe</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pronto && filtradas.length > 0 && (
          <div className="table-footer"><span>{filtradas.length} pessoa(s)</span><span>Total: <strong>{formatarMoeda(deCentavos(totalGeral))}</strong></span></div>
        )}
      </div>

      {imprimir && (
        <Impressao onFim={() => setImprimir(null)}>
          {imprimir.map((id) => (
            <InformeContribuicoes key={id} ano={ano} pessoa={cadastros.pessoas.find((p) => p.id === id)} resumo={resumos.get(id)}
              empresa={empresa.dados} nomeIgreja={perfil?.empresa_nome} />
          ))}
        </Impressao>
      )}
    </div>
  );
}
