import { useEffect, useMemo, useRef, useState } from "react";
import { Header, Pill } from "../ui";
import { lbl, inp, maskTelefone } from "../estilos";
import Icone from "./Icone";
import NotaModal from "./NotaModal";
import PessoaModal from "./PessoaModal";
import { lerNfeXml, decodificarChave, TAMANHO_MAX_XML } from "./nfe";
import { buscarNotasExistentes, buscarCnpjEmpresa, salvarPessoa, salvarNota, enviarAnexo, mensagemErro } from "./db";
import { formatarMoeda, formatarData, hojeISO, mascararDocumento, limparCnpj, soDigitos } from "./format";
import { tamanhoNumero } from "./catalogoParametros";
import ThOrdenavel from "./ThOrdenavel";
import { useOrdenacao } from "./useOrdenacao";

// Valor de ordenação de cada coluna da lista de arquivos (as de dados só existem quando o XML foi lido).
const COLUNAS = {
  arquivo: (a) => a.nome,
  nota: (a) => (a.ok ? `${a.dados.numero}` : null),
  fornecedor: (a) => (a.ok ? a.dados.fornecedor.nome : null),
  emissao: (a) => (a.ok ? a.dados.dataEmissao : null),
  valor: (a) => (a.ok ? a.dados.valorTotal : null),
  itens: (a) => (a.ok ? a.dados.itens.length : null),
  situacao: (a) => (a.resultado?.status === "ok" ? "Importada" : a.resultado?.status === "erro" ? "Falhou" : a.situacao === "pronta" ? "Pronta" : a.situacao === "duplicada" ? "Já lançada" : "Com erro"),
};

const MAX_ARQUIVOS = 30;
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

// ── Importação de arquivos .xml ──────────────────────────────────────────────

function PorArquivos({ perfil, cadastros, podeEditar, podeAprovar, onCadastrosMudaram }) {
  const tiposAtivos = cadastros.tipos.filter((t) => t.ativo);
  const caixasAtivas = cadastros.caixas.filter((c) => c.ativo);
  const [tipoId, setTipoId] = useState("");
  const [centroId, setCentroId] = useState("");
  const [caixaId, setCaixaId] = useState(() => (caixasAtivas.length === 1 ? String(caixasAtivas[0].id) : ""));
  const [analises, setAnalises] = useState([]);
  const [lendo, setLendo] = useState(false);
  const [importando, setImportando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [cnpjEmpresa, setCnpjEmpresa] = useState(null);
  const [notaAberta, setNotaAberta] = useState(null);
  const inputArquivo = useRef(null);

  useEffect(() => {
    let ativo = true;
    buscarCnpjEmpresa(perfil.empresa_id).then((c) => { if (ativo) setCnpjEmpresa(c); }).catch(() => {});
    return () => { ativo = false; };
  }, [perfil.empresa_id]);

  // Situação de cada arquivo: erro | duplicada | pronta (e se o fornecedor será cadastrado).
  function classificar(lista, existentes) {
    const vistas = new Set();
    const tamMax = tamanhoNumero(cadastros.parametros, "nfe");
    return lista.map((a) => {
      if (!a.ok) return { ...a, situacao: "erro" };
      const d = a.dados;
      const avisos = [...a.avisos];
      const fornecedor = cadastros.pessoas.find((p) => p.documento === d.fornecedor.documento);
      const jaExiste = existentes.some((n) => n.chave_acesso === d.chave
        || (fornecedor && n.fornecedor_id === fornecedor.id && n.tipo === "nfe" && (n.serie || "") === (d.serie || "") && n.numero === d.numero));
      const repetida = vistas.has(d.chave);
      vistas.add(d.chave);
      if (cnpjEmpresa && d.destinatario.documento && d.destinatario.documento !== limparCnpj(cnpjEmpresa) && d.destinatario.documento !== soDigitos(cnpjEmpresa)) {
        avisos.push(`A nota foi emitida para outro CNPJ (${mascararDocumento(d.destinatario.documento.length === 11 ? "PF" : "PJ", d.destinatario.documento)} — ${d.destinatario.nome || "destinatário"}), não para esta empresa.`);
      }
      if (repetida) return { ...a, avisos, situacao: "duplicada", repetida: true, motivo: "Este XML aparece mais de uma vez na lista." };
      if (jaExiste) return { ...a, avisos, situacao: "duplicada", motivo: "Esta nota já foi lançada." };
      if (fornecedor && !fornecedor.ativo) return { ...a, avisos, situacao: "erro", erro: `O fornecedor "${fornecedor.nome}" está inativo. Reative-o em Fornecedores.` };
      if (d.numero.length > tamMax) return { ...a, avisos, situacao: "erro", erro: `O número ${d.numero} passa do tamanho definido em Parâmetros para NF-e (${tamMax}).` };
      return { ...a, avisos, situacao: "pronta", fornecedorNovo: !fornecedor };
    });
  }

  async function adicionar(arquivos) {
    setAviso("");
    const lista = Array.from(arquivos);
    if (lista.length === 0) return;
    if (analises.length + lista.length > MAX_ARQUIVOS) { setAviso(`Importe até ${MAX_ARQUIVOS} arquivos por vez.`); return; }
    setLendo(true);
    const novas = [];
    for (const f of lista) {
      const base = { id: crypto.randomUUID(), arquivo: f, nome: f.name, selecionada: true };
      if (!/\.xml$/i.test(f.name)) { novas.push({ ...base, ok: false, erro: "Não é um arquivo .xml.", avisos: [] }); continue; }
      if (f.size > TAMANHO_MAX_XML) { novas.push({ ...base, ok: false, erro: "O arquivo é grande demais para uma nota (máximo de 2 MB).", avisos: [] }); continue; }
      try { novas.push({ ...base, ...lerNfeXml(await f.text()) }); }
      catch { novas.push({ ...base, ok: false, erro: "Não foi possível ler o arquivo.", avisos: [] }); }
    }
    const todas = [...analises, ...novas];
    const validas = todas.filter((a) => a.ok);
    let existentes = [];
    try {
      existentes = await buscarNotasExistentes({
        chaves: [...new Set(validas.map((a) => a.dados.chave))],
        numeros: [...new Set(validas.map((a) => a.dados.numero))],
      });
    } catch (e) {
      setAviso(`Não consegui conferir duplicidades agora (${mensagemErro(e)}). O banco ainda vai barrar notas repetidas.`);
    }
    setAnalises(classificar(todas, existentes));
    setLendo(false);
  }

  const ordenacao = useOrdenacao(analises, COLUNAS, null);
  const alterar = (id, mudanca) => setAnalises((p) => p.map((a) => (a.id === id ? { ...a, ...mudanca } : a)));
  const selecionadas = analises.filter((a) => a.selecionada && a.situacao === "pronta" && !a.resultado);
  const totalSelecionado = selecionadas.reduce((acc, a) => acc + Math.round(a.dados.valorTotal * 100), 0) / 100;
  const importadas = analises.filter((a) => a.resultado?.status === "ok");
  const falhas = analises.filter((a) => a.resultado?.status === "erro");

  async function importar() {
    setImportando(true);
    setAviso("");
    const pessoas = [...cadastros.pessoas]; // cópia: um fornecedor criado numa nota vale para as seguintes
    const hoje = hojeISO();
    for (const a of selecionadas) {
      alterar(a.id, { resultado: { status: "importando" } });
      try {
        const d = a.dados;
        let forn = pessoas.find((p) => p.documento === d.fornecedor.documento);
        const fone = soDigitos(d.fornecedor.telefone);
        if (!forn) {
          forn = await salvarPessoa(null, {
            tipoPessoa: d.fornecedor.tipoPessoa, nome: d.fornecedor.nome, documento: d.fornecedor.documento,
            email: "", telefone: fone.length === 10 || fone.length === 11 ? maskTelefone(fone) : "", observacoes: "",
            papeis: ["fornecedor"], ativo: true,
          });
          pessoas.push(forn);
        } else if (!forn.papeis.includes("fornecedor")) {
          const atualizado = await salvarPessoa(forn.id, {
            tipoPessoa: forn.tipo_pessoa, nome: forn.nome, documento: forn.documento, email: forn.email || "",
            telefone: forn.telefone || "", observacoes: forn.observacoes || "", papeis: [...forn.papeis, "fornecedor"], ativo: forn.ativo,
          });
          pessoas.splice(pessoas.indexOf(forn), 1, atualizado);
          forn = atualizado;
        }

        const id = await salvarNota(null, {
          tipo: "nfe", numero: d.numero, serie: d.serie || "", chave_acesso: d.chave, fornecedor_id: forn.id,
          data_emissao: d.dataEmissao, data_entrada: d.dataEmissao > hoje ? d.dataEmissao : hoje,
          centro_custo_id: centroId || null, conta_caixa_id: caixaId || null, natureza_operacao: d.natOp || "",
          valor_frete: d.ajustes.frete, valor_seguro: d.ajustes.seguro, valor_outras: d.ajustes.outras, valor_desconto: d.ajustes.desconto,
          fiscal: d.fiscal, // o total da nota é calculado pelo banco a partir dos itens e destes campos
          observacoes: `Importada do XML ${a.nome} (${d.modeloNome}).`,
        }, d.itens.map((i) => ({
          descricao: i.descricao, quantidade: i.quantidade, valor_unitario: i.valorUnitario, valor_total: i.valorTotal,
          tipo_contabil_id: Number(tipoId), centro_custo_id: null, fiscal: i.fiscal,
        })));

        let avisoAnexo = "";
        try { await enviarAnexo(id, a.arquivo); } // o XML original fica anexado como comprovante
        catch (e) { avisoAnexo = `Nota criada, mas o XML não foi anexado (${mensagemErro(e)}).`; }
        alterar(a.id, { resultado: { status: "ok", id, aviso: avisoAnexo } });
      } catch (e) {
        alterar(a.id, { resultado: { status: "erro", mensagem: mensagemErro(e) } });
      }
    }
    await onCadastrosMudaram();
    setImportando(false);
  }

  function soltar(e) {
    e.preventDefault();
    setArrastando(false);
    if (podeEditar) adicionar(e.dataTransfer.files);
  }

  const pilula = (a) => {
    if (a.resultado?.status === "ok") return <Pill tone="ok">Importada</Pill>;
    if (a.resultado?.status === "erro") return <Pill tone="danger">Falhou</Pill>;
    if (a.resultado?.status === "importando") return <Pill tone="warn">Importando…</Pill>;
    if (a.situacao === "pronta") return <Pill tone="ok">Pronta</Pill>;
    if (a.situacao === "duplicada") return <Pill>{a.repetida ? "Repetido" : "Já lançada"}</Pill>;
    return <Pill tone="danger">Com erro</Pill>;
  };

  return (
    <>
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 650 }}>Como as notas serão criadas</h2>
        <p className="muted" style={{ marginTop: 4 }}>
          Cada XML vira uma nota em <strong>rascunho</strong> (nunca aprovada automaticamente), com o fornecedor, os itens e o XML original anexado.
          Escolha abaixo o tipo contábil dos itens (ele define débito e crédito) — você pode ajustar item a item antes de aprovar. Frete, desconto e tributos do XML já vão preenchidos.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "0 14px" }}>
          <div>
            <label style={lbl} htmlFor="imp-tipo">Tipo contábil dos itens *</label>
            <select id="imp-tipo" style={inp} value={tipoId} onChange={(e) => setTipoId(e.target.value)}>
              <option value="">— Selecione —</option>
              {tiposAtivos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl} htmlFor="imp-centro">Centro de custo</label>
            <select id="imp-centro" style={inp} value={centroId} onChange={(e) => setCentroId(e.target.value)}>
              <option value="">— Nenhum —</option>
              {cadastros.centros.filter((c) => c.ativo).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl} htmlFor="imp-caixa">Conta caixa</label>
            <select id="imp-caixa" style={inp} value={caixaId} onChange={(e) => setCaixaId(e.target.value)}>
              <option value="">— Definir na aprovação —</option>
              {caixasAtivas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
        </div>
      </div>

      {podeEditar ? (
        <div className={`dropzone${arrastando ? " ativo" : ""}`} role="button" tabIndex={0}
          onClick={() => inputArquivo.current?.click()} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputArquivo.current?.click(); }}
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }} onDragLeave={() => setArrastando(false)} onDrop={soltar}>
          <Icone nome="arquivo" tamanho={26} />
          <strong>{lendo ? "Lendo arquivos…" : "Arraste os XMLs aqui ou clique para escolher"}</strong>
          <span className="muted">NF-e (modelo 55) e NFC-e (modelo 65) · até {MAX_ARQUIVOS} arquivos por vez · 2 MB cada</span>
          <input ref={inputArquivo} type="file" multiple accept=".xml,text/xml,application/xml" style={{ display: "none" }}
            onChange={(e) => { adicionar(e.target.files); e.target.value = ""; }} />
        </div>
      ) : (
        <div className="alert alert-warn"><Icone nome="cadeado" tamanho={16} /><span>Seu nível não permite importar notas.</span></div>
      )}

      {aviso && <div className="alert alert-warn" role="status" style={{ marginTop: 14 }}><Icone nome="alerta" tamanho={16} /><span>{aviso}</span></div>}

      {(importadas.length > 0 || falhas.length > 0) && !importando && (
        <div className={`alert ${falhas.length ? "alert-warn" : "alert-ok"}`} role="status" style={{ marginTop: 14 }}>
          <Icone nome={falhas.length ? "alerta" : "check"} tamanho={16} />
          <span>
            {importadas.length} nota(s) importada(s) como rascunho{falhas.length ? `, ${falhas.length} falharam` : ""}.
            {importadas.length > 0 && <> Revise os tipos contábeis dos itens e peça a aprovação a um Supervisor ou Administrador em <a href="#/administrativo/notas" style={{ textDecoration: "underline", fontWeight: 600 }}>Notas de entrada</a>.</>}
          </span>
        </div>
      )}

      {analises.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <ThOrdenavel chave="arquivo" ordenacao={ordenacao}>Arquivo</ThOrdenavel>
                  <ThOrdenavel chave="nota" ordenacao={ordenacao}>Nota</ThOrdenavel>
                  <ThOrdenavel chave="fornecedor" ordenacao={ordenacao}>Fornecedor</ThOrdenavel>
                  <ThOrdenavel chave="emissao" ordenacao={ordenacao}>Emissão</ThOrdenavel>
                  <ThOrdenavel chave="valor" ordenacao={ordenacao} className="num">Valor</ThOrdenavel>
                  <ThOrdenavel chave="itens" ordenacao={ordenacao} className="num">Itens</ThOrdenavel>
                  <ThOrdenavel chave="situacao" ordenacao={ordenacao}>Situação</ThOrdenavel>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ordenacao.ordenadas.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <input type="checkbox" aria-label={`Importar ${a.nome}`} disabled={a.situacao !== "pronta" || Boolean(a.resultado)}
                        checked={a.situacao === "pronta" && a.selecionada && !a.resultado ? true : Boolean(a.resultado?.status === "ok")}
                        onChange={(e) => alterar(a.id, { selecionada: e.target.checked })} />
                    </td>
                    <td className="truncate" style={{ maxWidth: 240 }}>
                      <div style={{ fontWeight: 550 }}>{a.nome}</div>
                      {(a.erro || a.motivo || a.resultado?.mensagem) && <div style={{ color: "var(--danger-text)", fontSize: 12.5, whiteSpace: "normal" }}>{a.resultado?.mensagem || a.erro || a.motivo}</div>}
                      {a.resultado?.aviso && <div style={{ color: "var(--warn-text)", fontSize: 12.5, whiteSpace: "normal" }}>{a.resultado.aviso}</div>}
                      {a.avisos?.map((v) => <div key={v} style={{ color: "var(--warn-text)", fontSize: 12.5, whiteSpace: "normal" }}>{v}</div>)}
                    </td>
                    {a.ok ? (
                      <>
                        <td>{a.dados.modeloNome} {a.dados.numero}{a.dados.serie ? ` / ${a.dados.serie}` : ""}</td>
                        <td className="truncate">
                          {a.dados.fornecedor.nome}
                          {a.fornecedorNovo && <div><span className="pill pill-warn" style={{ marginTop: 3 }}>será cadastrado</span></div>}
                        </td>
                        <td>{formatarData(a.dados.dataEmissao)}</td>
                        <td className="num" style={{ fontWeight: 550 }}>{formatarMoeda(a.dados.valorTotal)}</td>
                        <td className="num">{a.dados.itens.length}</td>
                      </>
                    ) : <td colSpan={5} />}
                    <td>{pilula(a)}</td>
                    <td style={{ textAlign: "right" }}>
                      {a.resultado?.status === "ok" && <button className="btn btn-ghost btn-sm" onClick={() => setNotaAberta(a.resultado.id)}>Abrir nota</button>}
                      {!a.resultado && !importando && <button className="icon-btn perigo" aria-label={`Remover ${a.nome} da lista`} onClick={() => setAnalises((p) => p.filter((x) => x.id !== a.id))}><Icone nome="fechar" tamanho={16} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-footer" style={{ alignItems: "center" }}>
            <span>{selecionadas.length} selecionada(s) · total <strong>{formatarMoeda(totalSelecionado)}</strong></span>
            <span style={{ display: "inline-flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              {!tipoId && selecionadas.length > 0 && <span style={{ color: "var(--warn-text)" }}>Escolha o tipo contábil dos itens.</span>}
              <button className="btn btn-ghost" onClick={() => setAnalises([])} disabled={importando}>Limpar lista</button>
              <button className="btn btn-primary" onClick={importar} disabled={importando || !podeEditar || !tipoId || selecionadas.length === 0}>
                {importando ? "Importando…" : `Importar ${selecionadas.length} nota(s) como rascunho`}
              </button>
            </span>
          </div>
        </div>
      )}

      {notaAberta && (
        <NotaModal notaId={notaAberta} cadastros={cadastros} podeEditar={podeEditar} podeAprovar={podeAprovar}
          onCadastrosMudaram={onCadastrosMudaram} onMudou={() => {}} onFechar={() => setNotaAberta(null)} />
      )}
    </>
  );
}

// ── Pela chave de acesso ─────────────────────────────────────────────────────

function PorChave({ cadastros, podeEditar, podeAprovar, onCadastrosMudaram }) {
  const [entrada, setEntrada] = useState("");
  const [existente, setExistente] = useState(null); // { chave, nota }
  const [prefill, setPrefill] = useState(null);
  const [novoFornecedor, setNovoFornecedor] = useState(false);

  const caracteres = entrada.replace(/[^0-9A-Za-z]/g, "").length;
  const decod = useMemo(() => (caracteres === 44 ? decodificarChave(entrada) : null), [entrada, caracteres]);

  useEffect(() => {
    if (!decod?.valida) return;
    let ativo = true;
    buscarNotasExistentes({ chaves: [decod.chave] })
      .then((r) => { if (ativo) setExistente({ chave: decod.chave, nota: r[0] ?? null }); })
      .catch(() => { if (ativo) setExistente({ chave: decod.chave, nota: null, falhou: true }); });
    return () => { ativo = false; };
  }, [decod?.chave, decod?.valida]);

  const duplicada = decod && existente?.chave === decod.chave ? existente.nota : null;
  const fornecedor = decod ? cadastros.pessoas.find((p) => p.documento === decod.documento) : null;
  const podeAbrir = decod?.valida && decod.suportado && !duplicada && podeEditar;

  const linha = (rotulo, valor) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
      <span className="muted">{rotulo}</span><span style={{ fontWeight: 550, textAlign: "right" }}>{valor}</span>
    </div>
  );

  return (
    <>
      <div className="alert alert-warn" style={{ marginBottom: 16 }}>
        <Icone nome="alerta" tamanho={16} />
        <span>
          <strong>A chave de acesso sozinha não baixa o XML.</strong> O Portal Nacional só entrega o XML completo com o <em>certificado digital</em> da empresa, e a consulta pública exige CAPTCHA.
          Aqui lemos o que a própria chave contém (emitente, número, série e mês) e abrimos a nota já preenchida — o valor, os itens e o dia exato você completa, ou importa o XML na aba <strong>Arquivos XML</strong>.
        </span>
      </div>

      <div className="card" style={{ padding: 20, maxWidth: 760 }}>
        <label style={{ ...lbl, marginTop: 0 }} htmlFor="chave-entrada">Chave de acesso (44 caracteres)</label>
        <input id="chave-entrada" style={{ ...inp, fontFamily: "monospace", letterSpacing: 0.5 }} value={entrada}
          placeholder="Cole aqui a chave de 44 dígitos" autoComplete="off" spellCheck={false}
          onChange={(e) => setEntrada(e.target.value.toUpperCase().slice(0, 70))} />
        <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>{caracteres}/44 caracteres{caracteres > 0 && caracteres < 44 ? " — continue colando/digitando" : ""}</div>

        {caracteres > 44 && <div className="alert alert-danger" style={{ marginTop: 14 }}><Icone nome="alerta" tamanho={16} /><span>A chave tem 44 caracteres; há {caracteres - 44} a mais.</span></div>}
        {decod && !decod.valida && <div className="alert alert-danger" role="alert" style={{ marginTop: 14 }}><Icone nome="alerta" tamanho={16} /><span>{decod.erro}</span></div>}

        {decod?.valida && (
          <div style={{ marginTop: 16 }}>
            {linha("Documento", <Pill tone={decod.suportado ? "ok" : "danger"}>{decod.modeloNome}</Pill>)}
            {linha("Emitente", <>{decod.tipoPessoa === "PF" ? "CPF" : "CNPJ"} {mascararDocumento(decod.tipoPessoa, decod.documento)}</>)}
            {linha("Fornecedor no sistema", fornecedor ? fornecedor.nome : <Pill tone="warn">não cadastrado</Pill>)}
            {linha("Número / série", `${decod.numero} / ${decod.serie}`)}
            {linha("Emissão", `${MESES[decod.mes - 1]} de ${decod.ano} (${decod.uf})`)}
            {linha("Dígito verificador", decod.dvConfere === null ? <Pill>não verificado (chave com letras)</Pill> : <Pill tone="ok">confere</Pill>)}

            {!decod.suportado && <div className="alert alert-danger" style={{ marginTop: 14 }}><Icone nome="alerta" tamanho={16} /><span>Só NF-e (55) e NFC-e (65) são suportadas.</span></div>}
            {duplicada && <div className="alert alert-warn" style={{ marginTop: 14 }}><Icone nome="alerta" tamanho={16} /><span>Esta nota já foi lançada ({duplicada.status}). Abra-a em <a href="#/administrativo/notas" style={{ textDecoration: "underline", fontWeight: 600 }}>Notas de entrada</a>.</span></div>}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
              <button className="btn btn-primary" disabled={!podeAbrir}
                onClick={() => setPrefill({ tipo: "nfe", numero: decod.numero, serie: decod.serie, chaveAcesso: decod.chave, fornecedorId: fornecedor ? String(fornecedor.id) : "", dataEmissao: "" })}>
                Abrir nova nota com estes dados
              </button>
              {!fornecedor && podeEditar && <button className="btn btn-ghost" onClick={() => setNovoFornecedor(true)}>Cadastrar este fornecedor</button>}
            </div>
          </div>
        )}
      </div>

      {prefill && (
        <NotaModal cadastros={cadastros} podeEditar={podeEditar} podeAprovar={podeAprovar} prefill={prefill}
          onCadastrosMudaram={onCadastrosMudaram} onMudou={() => {}} onFechar={() => setPrefill(null)} />
      )}
      {novoFornecedor && (
        <PessoaModal sugestao={{ tipoPessoa: decod.tipoPessoa, documento: decod.documento }}
          onSalvo={async () => { setNovoFornecedor(false); await onCadastrosMudaram(); }} onFechar={() => setNovoFornecedor(false)} />
      )}
    </>
  );
}

// ── Tela ─────────────────────────────────────────────────────────────────────

export default function ImportarXml(props) {
  const [modo, setModo] = useState("arquivos");
  return (
    <div>
      <div className="page-header">
        <Header title="Importar XML" subtitle="Traga notas fiscais eletrônicas direto do arquivo XML, sem digitar." />
        <div className="segmented" role="tablist" aria-label="Forma de importação">
          <button role="tab" aria-selected={modo === "arquivos"} aria-pressed={modo === "arquivos"} onClick={() => setModo("arquivos")}>Arquivos XML</button>
          <button role="tab" aria-selected={modo === "chave"} aria-pressed={modo === "chave"} onClick={() => setModo("chave")}>Chave de acesso</button>
        </div>
      </div>
      {modo === "arquivos" ? <PorArquivos {...props} /> : <PorChave {...props} />}
    </div>
  );
}
