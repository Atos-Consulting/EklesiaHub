import { useState } from "react";
import { lbl, inp } from "../estilos";
import FormaSelect from "./FormaSelect";
import { mascararDocumentoLivre, limparDocumentoLivre, mascararDocumento } from "./format";
import { formaPorId, nomeForma, formatarLinha, erroLinhaDigitavel, TIPOS_CHAVE_PIX, TIPOS_CONTA, BANDEIRAS_CARTAO } from "./financeiro";

// Dados de pagamento de um lançamento conforme a forma escolhida (v21): o comportamento da forma decide
// o que aparece — boleto: linha digitável; PIX: tipo e chave; transferência: banco, agência, conta, tipo,
// titular e CPF/CNPJ; cheque: número; cartão (v29): bandeira, 4 últimos dígitos, parcelas e autorização.
// Campo já preenchido continua aparecendo mesmo trocando a forma.
// Usado no detalhe do lançamento e na hora de pagar/receber (ContasPagar.jsx).

const grade = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0 12px" };

export function Copiar({ texto }) {
  const [ok, setOk] = useState(false);
  if (!texto) return null;
  return (
    <button type="button" className="btn btn-ghost btn-sm" style={{ flex: "none" }}
      onClick={() => navigator.clipboard?.writeText(texto).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }).catch(() => {})}>
      {ok ? "Copiado" : "Copiar"}
    </button>
  );
}

// valor = dadosPagamentoDe(t); onChange(novoValor). sugestao = dados do cadastro da pessoa ou de outro lançamento
// dela (ultimosDadosDaPessoa). guardar = { nome, onGuardar } mostra "Guardar no cadastro de <nome>" (v29).
export function CamposPagamento({ formas, valor: f, onChange, prefixo = "dp", sugestao, guardar, rotuloForma = "Forma de pagamento" }) {
  const set = (k) => (e) => onChange({ ...f, [k]: e.target.value });
  const tipo = formaPorId(formas, f.forma_pagamento_id)?.tipo;
  const mostra = (forma, ...campos) => tipo === forma || campos.some((c) => f[c]);
  const erroLinha = erroLinhaDigitavel(f.linha_digitavel);
  const id = (k) => `${prefixo}-${k}`;
  const usarSugestao = () => onChange({
    ...f, pix_chave: sugestao.pix_chave ?? "", pix_tipo: sugestao.pix_tipo ?? "", banco: sugestao.banco ?? "", agencia: sugestao.agencia ?? "",
    conta: sugestao.conta ?? "", tipo_conta: sugestao.tipo_conta ?? "", titular: sugestao.titular ?? "", titular_documento: sugestao.titular_documento ?? "",
  });
  const precisaDeConta = tipo === "pix" || tipo === "transferencia";
  const vazio = !f.pix_chave && !f.banco && !f.conta;

  return (
    <>
      <label style={lbl} htmlFor={id("forma")}>{rotuloForma}</label>
      <FormaSelect id={id("forma")} style={inp} formas={formas} value={f.forma_pagamento_id} vazio="— Não informada —"
        onChange={(v) => onChange({ ...f, forma_pagamento_id: v })} />
      {sugestao && precisaDeConta && vazio && (
        <div className="dica-dados">
          Há dados de {sugestao.pix_chave ? `PIX (${sugestao.pix_chave})` : `conta (${[sugestao.banco, sugestao.agencia, sugestao.conta].filter(Boolean).join(" · ")})`} {sugestao.doCadastro ? "no cadastro desta pessoa" : "em outro lançamento desta pessoa"}.
          <button type="button" className="btn btn-ghost btn-sm" onClick={usarSugestao}>Usar estes dados</button>
        </div>
      )}

      {mostra("boleto", "linha_digitavel") && (
        <>
          <label style={lbl} htmlFor={id("linha")}>Linha digitável ou código de barras do boleto</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input id={id("linha")} style={{ ...inp, fontFamily: "monospace", ...(erroLinha ? { borderColor: "var(--danger)" } : {}) }} inputMode="numeric" maxLength={60}
              value={f.linha_digitavel} onChange={set("linha_digitavel")} onBlur={() => onChange({ ...f, linha_digitavel: formatarLinha(f.linha_digitavel.replace(/\D/g, "")) })}
              placeholder="00000.00000 00000.000000 00000.000000 0 00000000000000" />
            <Copiar texto={f.linha_digitavel.replace(/\D/g, "")} />
          </div>
          {erroLinha && <div style={{ fontSize: 12.5, color: "var(--danger)", marginTop: 5 }}>{erroLinha}</div>}
        </>
      )}

      {mostra("pix", "pix_chave") && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(140px, 180px) 1fr", gap: "0 12px" }}>
          <div>
            <label style={lbl} htmlFor={id("pixtipo")}>Tipo de chave</label>
            <select id={id("pixtipo")} style={inp} value={f.pix_tipo} onChange={set("pix_tipo")}>
              <option value="">—</option>
              {Object.entries(TIPOS_CHAVE_PIX).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl} htmlFor={id("pix")}>Chave PIX</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input id={id("pix")} style={inp} maxLength={77} value={f.pix_chave} onChange={set("pix_chave")} placeholder="CPF/CNPJ, e-mail, telefone ou chave aleatória" />
              <Copiar texto={f.pix_chave.trim()} />
            </div>
          </div>
        </div>
      )}

      {mostra("transferencia", "banco", "agencia", "conta", "titular") && (
        <>
          <div style={grade}>
            <div><label style={lbl} htmlFor={id("banco")}>Banco</label><input id={id("banco")} style={inp} maxLength={60} value={f.banco} onChange={set("banco")} placeholder="Ex.: Banco do Brasil (001)" /></div>
            <div><label style={lbl} htmlFor={id("ag")}>Agência</label><input id={id("ag")} style={inp} maxLength={20} value={f.agencia} onChange={set("agencia")} /></div>
            <div><label style={lbl} htmlFor={id("conta")}>Conta</label><input id={id("conta")} style={inp} maxLength={30} value={f.conta} onChange={set("conta")} placeholder="Com o dígito" /></div>
            <div>
              <label style={lbl} htmlFor={id("tipoconta")}>Tipo de conta</label>
              <select id={id("tipoconta")} style={inp} value={f.tipo_conta} onChange={set("tipo_conta")}>
                <option value="">—</option>
                {Object.entries(TIPOS_CONTA).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr minmax(170px, 1fr)", gap: "0 12px" }}>
            <div><label style={lbl} htmlFor={id("titular")}>Titular da conta</label><input id={id("titular")} style={inp} maxLength={120} value={f.titular} onChange={set("titular")} /></div>
            <div>
              <label style={lbl} htmlFor={id("titdoc")}>CPF/CNPJ do titular</label>
              <input id={id("titdoc")} style={inp} maxLength={18} value={mascararDocumentoLivre(f.titular_documento)}
                onChange={(e) => onChange({ ...f, titular_documento: limparDocumentoLivre(e.target.value) })} />
            </div>
          </div>
        </>
      )}

      {guardar && (
        <div className="dica-dados">
          Estes dados de {f.pix_chave ? "PIX" : "conta"} não estão no cadastro de {guardar.nome}. Guardando, os próximos lançamentos já vêm com eles.
          <button type="button" className="btn btn-ghost btn-sm" onClick={guardar.onGuardar} disabled={guardar.salvando}>{guardar.salvando ? "Guardando..." : "Guardar no cadastro"}</button>
          {guardar.erro && <span style={{ color: "var(--danger)", width: "100%" }}>{guardar.erro}</span>}
        </div>
      )}

      {(tipo === "cartao_credito" || tipo === "cartao_debito" || f.cartao_bandeira || f.cartao_final || f.cartao_parcelas || f.cartao_autorizacao) && (
        <>
          <div style={grade}>
            <div>
              <label style={lbl} htmlFor={id("bandeira")}>Bandeira</label>
              <select id={id("bandeira")} style={inp} value={f.cartao_bandeira} onChange={set("cartao_bandeira")}>
                <option value="">—</option>
                {Object.entries(BANDEIRAS_CARTAO).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl} htmlFor={id("final")}>Final do cartão</label>
              <input id={id("final")} style={inp} inputMode="numeric" maxLength={4} placeholder="4 últimos dígitos" value={f.cartao_final}
                onChange={(e) => onChange({ ...f, cartao_final: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
            </div>
            {(tipo === "cartao_credito" || f.cartao_parcelas) && (
              <div>
                <label style={lbl} htmlFor={id("cparc")}>Parcelas no cartão</label>
                <input id={id("cparc")} style={{ ...inp, textAlign: "right" }} inputMode="numeric" maxLength={2} placeholder="1" value={f.cartao_parcelas}
                  onChange={(e) => onChange({ ...f, cartao_parcelas: e.target.value.replace(/\D/g, "").slice(0, 2) })} />
              </div>
            )}
            <div>
              <label style={lbl} htmlFor={id("aut")}>Autorização / NSU</label>
              <input id={id("aut")} style={inp} maxLength={40} value={f.cartao_autorizacao} onChange={set("cartao_autorizacao")} placeholder="Do comprovante da maquininha" />
            </div>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Por segurança, só os 4 últimos dígitos do cartão são guardados.</div>
        </>
      )}

      {mostra("cheque", "cheque_numero") && (
        <div style={{ maxWidth: 220 }}>
          <label style={lbl} htmlFor={id("cheque")}>Número do cheque</label>
          <input id={id("cheque")} style={inp} maxLength={20} value={f.cheque_numero} onChange={set("cheque_numero")} />
        </div>
      )}
    </>
  );
}

const leitura = (rotulo, conteudo) => (
  <div><label style={lbl}>{rotulo}</label><div style={{ ...inp, background: "var(--surface-2)", minHeight: 38 }}>{conteudo || "—"}</div></div>
);

// Os mesmos dados, só para ler (lançamento pago, cancelado ou sem permissão de editar).
export function LeituraPagamento({ t, formas }) {
  const doc = t.titular_documento ? mascararDocumento(t.titular_documento.length === 11 ? "PF" : "PJ", t.titular_documento) : "";
  return (
    <>
      {leitura("Forma de pagamento", t.forma_pagamento_nome ?? nomeForma(formas, t.forma_pagamento_id, t.forma_pagamento))}
      {t.linha_digitavel && <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}><div style={{ flex: 1 }}>{leitura("Linha digitável", <span style={{ fontFamily: "monospace" }}>{formatarLinha(t.linha_digitavel)}</span>)}</div><Copiar texto={t.linha_digitavel} /></div>}
      {t.pix_chave && <div style={grade}>{leitura("Chave PIX", t.pix_chave)}{t.pix_tipo && leitura("Tipo de chave", TIPOS_CHAVE_PIX[t.pix_tipo])}</div>}
      {(t.banco || t.agencia || t.conta) && <div style={grade}>{leitura("Banco", t.banco)}{leitura("Agência", t.agencia)}{leitura("Conta", t.conta)}{t.tipo_conta && leitura("Tipo de conta", TIPOS_CONTA[t.tipo_conta])}</div>}
      {(t.titular || doc) && <div style={grade}>{leitura("Titular", t.titular)}{leitura("CPF/CNPJ do titular", doc)}</div>}
      {t.cheque_numero && leitura("Número do cheque", t.cheque_numero)}
      {(t.cartao_bandeira || t.cartao_final || t.cartao_autorizacao) && (
        <div style={grade}>
          {leitura("Cartão", [BANDEIRAS_CARTAO[t.cartao_bandeira], t.cartao_final && `final ${t.cartao_final}`].filter(Boolean).join(" · "))}
          {t.cartao_parcelas && leitura("Parcelas no cartão", `${t.cartao_parcelas}x`)}
          {t.cartao_autorizacao && leitura("Autorização / NSU", t.cartao_autorizacao)}
        </div>
      )}
    </>
  );
}
