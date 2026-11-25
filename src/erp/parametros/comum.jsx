import { Pill } from "../../ui";
import Icone from "../Icone";
import Modal from "../Modal";

export const Situacao = ({ ativo }) => <Pill tone={ativo ? "ok" : "neutral"}>{ativo ? "Ativo" : "Inativo"}</Pill>;

// Cabeçalho de cada aba: título, explicação e botão de novo cadastro.
export function CabecalhoAba({ titulo, descricao, acaoRotulo, onAcao }) {
  return (
    <div style={{ padding: "20px 24px 12px", display: "flex", gap: 16, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
      <div style={{ flex: "1 1 360px", minWidth: 0 }}>
        <h2 style={{ fontSize: 16, fontWeight: 650 }}>{titulo}</h2>
        <p className="muted" style={{ marginTop: 4 }}>{descricao}</p>
      </div>
      {onAcao && <button className="btn btn-primary" onClick={onAcao}><Icone nome="mais" tamanho={16} traco={2.2} /> {acaoRotulo}</button>}
    </div>
  );
}

// Janela de cadastro com rodapé Cancelar / Salvar e mensagem de erro do servidor.
export function FormModal({ titulo, largura = 520, onFechar, onSalvar, salvando, erro, children }) {
  return (
    <Modal titulo={titulo} largura={largura} fecharFora={false} onFechar={onFechar}
      rodape={<>
        <button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Cancelar</button>
        <button className="btn btn-primary" onClick={onSalvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</button>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); onSalvar(); }} noValidate>
        {children}
        <button type="submit" hidden />
      </form>
      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}

export const CampoAtivo = ({ ativo, onChange, dica }) => (
  <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18, fontSize: 13.5, color: "var(--text-2)" }}>
    <input type="checkbox" checked={ativo} onChange={(e) => onChange(e.target.checked)} />
    <span>Ativo{dica && <span className="muted"> — {dica}</span>}</span>
  </label>
);

export const BotaoEditar = ({ onClick, rotulo }) => (
  <button type="button" className="icon-btn" onClick={onClick} aria-label={`Editar ${rotulo}`} title="Editar"><Icone nome="editar" tamanho={16} /></button>
);
