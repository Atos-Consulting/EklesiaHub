import { useEffect, useState } from "react";
import Icone from "../Icone";
import { buscarEmpresa, mensagemErro } from "../db";
import { CabecalhoAba } from "./comum";
import IdentidadeIgreja from "./IdentidadeIgreja";

// Parâmetros → Sistema → Layout (v22): logo da igreja (menu e documentos impressos) e cores do sistema.
export default function Layout({ perfil, onIdentidadeMudou }) {
  const [empresa, setEmpresa] = useState(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let ativo = true;
    buscarEmpresa(perfil.empresa_id)
      .then((e) => { if (ativo) setEmpresa(e); })
      .catch((e) => { if (ativo) setErro(mensagemErro(e)); });
    return () => { ativo = false; };
  }, [perfil.empresa_id]);

  return (
    <>
      <CabecalhoAba titulo="Layout" descricao="Logo e cores do sistema da igreja. A logo aparece no menu e nos documentos impressos (relatórios, comprovantes); as cores valem para todos os usuários da igreja depois de salvar." />
      <div style={{ padding: "0 24px 24px" }}>
        {!empresa && !erro && <div className="carregando-linha"><div className="spinner" /> Carregando...</div>}
        {empresa && <IdentidadeIgreja empresa={empresa} onSalvo={(x) => onIdentidadeMudou?.(x)} />}
        {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
      </div>
    </>
  );
}
