import { useEffect, useRef, useState } from "react";
import Icone from "./Icone";
import { listarComprovantes, enviarComprovante, removerComprovante, urlComprovante, validarComprovante, mensagemErro } from "./db";
import { formatarTamanho } from "./format";

// Comprovantes (PDF, PNG, JPG até 10 MB) de um pagamento/recebimento ou de um movimento de caixa (v21).
// alvo = { pagamentoId } ou { movimentoId }. Supervisor+ anexa e remove; todos da igreja abrem.
// Anexar não mexe em saldo: vale mesmo com o período conciliado.
export default function Comprovantes({ alvo, podeEditar, onMudou }) {
  const chave = alvo.pagamentoId ? `p${alvo.pagamentoId}` : `m${alvo.movimentoId}`;
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [remover, setRemover] = useState(null);
  const entrada = useRef(null);
  const alvoRef = useRef(alvo);
  useEffect(() => { alvoRef.current = alvo; });

  useEffect(() => {
    let ativo = true;
    listarComprovantes(alvoRef.current).then((d) => { if (ativo) setLista(d); }).catch((e) => { if (ativo) { setLista([]); setErro(mensagemErro(e)); } });
    return () => { ativo = false; };
  }, [chave]);

  async function enviar(arquivos) {
    setErro("");
    const invalidos = arquivos.map(validarComprovante).filter(Boolean);
    if (invalidos.length) { setErro(invalidos.join(" ")); return; }
    setEnviando(true);
    try {
      for (const a of arquivos) {
        const c = await enviarComprovante(alvo, a);
        setLista((l) => [...(l || []), c]);
      }
      onMudou?.();
    } catch (e) { setErro(mensagemErro(e)); }
    finally { setEnviando(false); if (entrada.current) entrada.current.value = ""; }
  }

  async function abrir(c) {
    setErro("");
    const janela = window.open("", "_blank"); // abre já no clique (o navegador bloqueia janela aberta depois de um await)
    try { const url = await urlComprovante(c.caminho); if (janela) janela.location.replace(url); else window.open(url, "_blank"); }
    catch (e) { janela?.close(); setErro(mensagemErro(e)); }
  }

  async function confirmarRemocao() {
    setErro("");
    try { await removerComprovante(remover); setLista((l) => l.filter((x) => x.id !== remover.id)); setRemover(null); onMudou?.(); }
    catch (e) { setErro(mensagemErro(e)); setRemover(null); }
  }

  return (
    <div className="comprovantes">
      {lista === null && <div className="muted" style={{ fontSize: 13 }}>Carregando...</div>}
      {lista && lista.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Nenhum comprovante anexado.</div>}
      {lista && lista.length > 0 && (
        <ul className="comprovantes-lista">
          {lista.map((c) => (
            <li key={c.id}>
              <Icone nome="clipe" tamanho={15} />
              <button type="button" className="link-botao" onClick={() => abrir(c)} title="Abrir em outra aba">{c.nome_arquivo}</button>
              <span className="muted">{formatarTamanho(c.tamanho)}{c.enviado_por_nome ? ` · ${c.enviado_por_nome}` : ""} · {new Date(c.criado_em).toLocaleDateString("pt-BR")}</span>
              {podeEditar && (remover?.id === c.id
                ? <span className="comprovantes-confirma">Remover? <button type="button" className="btn btn-ghost btn-sm" style={{ color: "var(--danger)" }} onClick={confirmarRemocao}>Sim</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemover(null)}>Não</button></span>
                : <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remover ${c.nome_arquivo}`} onClick={() => setRemover(c)}><Icone nome="lixeira" tamanho={14} /></button>)}
            </li>
          ))}
        </ul>
      )}
      {podeEditar && (
        <label className={`btn btn-ghost btn-sm${enviando ? " desabilitado" : ""}`} style={{ marginTop: 8 }}>
          <Icone nome="mais" tamanho={14} /> {enviando ? "Enviando..." : "Anexar comprovante"}
          <input ref={entrada} type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" multiple hidden disabled={enviando}
            onChange={(e) => e.target.files?.length && enviar([...e.target.files])} />
        </label>
      )}
      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 8 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </div>
  );
}

// Escolha de arquivos antes de existir o pagamento (na tela de pagar): só guarda a lista; o envio é depois.
export function EscolherComprovantes({ arquivos, onChange }) {
  const [erro, setErro] = useState("");
  return (
    <div className="comprovantes">
      {arquivos.length > 0 && (
        <ul className="comprovantes-lista">
          {arquivos.map((a, i) => (
            <li key={`${a.name}-${i}`}>
              <Icone nome="clipe" tamanho={15} /><span>{a.name}</span><span className="muted">{formatarTamanho(a.size)}</span>
              <button type="button" className="btn btn-ghost btn-sm" aria-label={`Tirar ${a.name}`} onClick={() => onChange(arquivos.filter((_, j) => j !== i))}><Icone nome="fechar" tamanho={14} /></button>
            </li>
          ))}
        </ul>
      )}
      <label className="btn btn-ghost btn-sm" style={{ marginTop: 4 }}>
        <Icone nome="clipe" tamanho={14} /> Anexar comprovante
        <input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" multiple hidden
          onChange={(e) => {
            const novos = [...(e.target.files || [])];
            const inv = novos.map(validarComprovante).filter(Boolean);
            setErro(inv.join(" "));
            onChange([...arquivos, ...novos.filter((a) => !validarComprovante(a))]);
            e.target.value = "";
          }} />
      </label>
      {erro && <div style={{ fontSize: 12.5, color: "var(--danger)", marginTop: 5 }}>{erro}</div>}
    </div>
  );
}
