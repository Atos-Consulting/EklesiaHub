import { useEffect, useState } from "react";
import { lbl, inp } from "../../estilos";
import Icone from "../Icone";
import { buscarEmpresa, atualizarDadosEmpresa, mensagemErro } from "../db";
import { mascararCnpj, soDigitos } from "../format";
import { enderecoDe, errosEndereco } from "../endereco";
import CamposEndereco from "../CamposEndereco";
import { CabecalhoAba } from "./comum";

// Sistema → Dados da igreja: nome, endereço e contatos. Logo e cores ficam na aba Layout.
// Razão social e CNPJ são do cadastro da plataforma (tela Igrejas).
export default function DadosIgreja({ perfil, onIdentidadeMudou }) {
  const [empresa, setEmpresa] = useState(null);
  const [nome, setNome] = useState("");
  const [endereco, setEndereco] = useState(() => enderecoDe(null));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);
  const [tentou, setTentou] = useState(false);

  useEffect(() => {
    let ativo = true;
    buscarEmpresa(perfil.empresa_id)
      .then((e) => { if (!ativo) return; setEmpresa(e); setNome(e.nome_fantasia ?? ""); setEndereco(enderecoDe(e)); })
      .catch((e) => { if (ativo) setErro(mensagemErro(e)); });
    return () => { ativo = false; };
  }, [perfil.empresa_id]);

  const erros = errosEndereco(endereco);

  async function salvar() {
    setTentou(true);
    setErro("");
    setOk(false);
    if (Object.keys(erros).length) return;
    setSalvando(true);
    try {
      await atualizarDadosEmpresa({ ...endereco, nome_fantasia: nome, cep: soDigitos(endereco.cep) });
      setOk(true);
      onIdentidadeMudou?.({ empresa_nome: nome.trim() || empresa.razao_social });
    } catch (e) { setErro(mensagemErro(e)); }
    finally { setSalvando(false); }
  }

  return (
    <>
      <CabecalhoAba titulo="Dados da igreja" descricao="Nome, endereço e contatos da igreja, que aparecem nos documentos e relatórios. A logo e as cores ficam em Parâmetros → Layout. A razão social e o CNPJ são definidos pelo administrador da plataforma." />
      <div style={{ padding: "0 24px 24px" }}>
        {!empresa && !erro && <div className="carregando-linha"><div className="spinner" /> Carregando...</div>}
        {empresa && (
          <form onSubmit={(e) => { e.preventDefault(); salvar(); }} noValidate>
            <div className="resumo-pagar" style={{ marginTop: 0 }}>
              <span>Razão social: <strong>{empresa.razao_social}</strong></span>
              <span>CNPJ: <strong>{empresa.cnpj ? mascararCnpj(empresa.cnpj) : "não informado"}</strong></span>
            </div>
            <div style={{ maxWidth: 480 }}>
              <label style={lbl} htmlFor="ig-nome">Nome da igreja (como aparece no sistema)</label>
              <input id="ig-nome" style={inp} maxLength={120} value={nome} placeholder={empresa.razao_social} onChange={(e) => { setOk(false); setNome(e.target.value); }} />
            </div>

            <h3 className="section-title">Endereço e contato</h3>
            <CamposEndereco valor={endereco} onChange={(v) => { setOk(false); setEndereco(v); }} erros={erros} tentou={tentou} prefixo="ig" />

            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 20 }}>
              {ok && <span className="pill pill-ok">Dados salvos</span>}
              <button type="submit" className="btn btn-primary" disabled={salvando}>{salvando ? "Salvando..." : "Salvar dados"}</button>
            </div>
          </form>
        )}
        {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
      </div>
    </>
  );
}
