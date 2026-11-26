import { useMemo, useState } from "react";
import { lbl, inp, msgErro } from "../estilos";
import Icone from "./Icone";
import Modal from "./Modal";
import PessoaModal from "./PessoaModal";
import { criarContasReceber, cancelarTituloReceber, mensagemErro } from "./db";
import { formatarMoeda, formatarData, hojeISO, lerNumero, paraCentavos, somarValores, mascararDocumento } from "./format";
import { parcelasReceber } from "./financeiro";
import FormaSelect from "./FormaSelect";

const inteiro = (v) => (/^\d+$/.test(String(v).trim()) ? Number(v) : NaN);

// Lança uma conta a receber em uma ou mais parcelas. A prévia repete a conta do banco (criar_contas_receber).
export function NovaContaReceber({ cadastros, onFechar, onConcluido, onCadastrosMudaram }) {
  const caixasAtivas = cadastros.caixas.filter((c) => c.ativo);
  const [f, setF] = useState({
    pessoaId: "", descricao: "", valor: "", valorPor: "total", parcelas: "1", primeiroVencimento: hojeISO(), periodicidade: "mensal",
    intervaloDias: "30", forma: String((cadastros.formas || []).find((x) => x.ativo && x.tipo === "pix")?.id ?? ""), contaCaixaId: caixasAtivas.length === 1 ? String(caixasAtivas[0].id) : "", centroCustoId: "", observacao: "",
  });
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [novaPessoa, setNovaPessoa] = useState(false);
  const [pessoasExtras, setPessoasExtras] = useState([]);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const pessoas = useMemo(() => [...cadastros.pessoas, ...pessoasExtras.filter((x) => !cadastros.pessoas.some((p) => p.id === x.id))]
    .filter((p) => p.ativo).sort((a, b) => a.nome.localeCompare(b.nome)), [cadastros.pessoas, pessoasExtras]);

  const valor = lerNumero(f.valor);
  const parcelas = inteiro(f.parcelas);
  const intervalo = inteiro(f.intervaloDias);
  const lista = parcelasReceber({
    centavos: valor > 0 ? paraCentavos(valor) : 0, valorPor: f.valorPor, parcelas, primeiroVencimento: f.primeiroVencimento,
    periodicidade: f.periodicidade, intervaloDias: intervalo,
  });
  const erros = {};
  if (!f.pessoaId) erros.pessoaId = "Escolha de quem a igreja vai receber";
  if (!f.descricao.trim()) erros.descricao = "Descreva a conta";
  if (!(valor > 0)) erros.valor = "Informe um valor maior que zero";
  if (!(parcelas >= 1 && parcelas <= 120)) erros.parcelas = "De 1 a 120";
  if (!f.primeiroVencimento) erros.primeiroVencimento = "Informe o vencimento";
  if (f.periodicidade === "dias" && parcelas > 1 && !(intervalo >= 1 && intervalo <= 365)) erros.intervaloDias = "De 1 a 365 dias";
  if (!Object.keys(erros).length && lista.length === 0) erros.valor = "Valor pequeno demais para dividir nessas parcelas";
  const borda = (k) => (tentou && erros[k] ? { borderColor: "var(--danger)" } : {});
  const msg = (k) => tentou && erros[k] && <div style={msgErro}>{erros[k]}</div>;
  const total = somarValores(lista.map((p) => p.valor));

  async function salvar() {
    setTentou(true);
    setErro("");
    if (Object.keys(erros).length) return;
    setSalvando(true);
    try {
      await criarContasReceber({
        pessoa_id: Number(f.pessoaId), descricao: f.descricao.trim(), emissao: hojeISO(), valor, valor_por: f.valorPor, parcelas,
        primeiro_vencimento: f.primeiroVencimento, periodicidade: f.periodicidade, intervalo_dias: f.periodicidade === "dias" ? intervalo : null,
        forma_pagamento_id: f.forma ? Number(f.forma) : null, conta_caixa_id: f.contaCaixaId ? Number(f.contaCaixaId) : null,
        centro_custo_id: f.centroCustoId ? Number(f.centroCustoId) : null, observacao: f.observacao.trim(),
      });
      await onConcluido();
    } catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }

  const grade = (min) => ({ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: "0 12px" });
  return (
    <Modal titulo="Nova conta a receber" largura={680} fecharFora={false} onFechar={onFechar}
      rodape={<>
        <button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Cancelar</button>
        <button className="btn btn-primary" onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : lista.length > 1 ? `Lançar ${lista.length} parcelas` : "Lançar"}</button>
      </>}>
      <form onSubmit={(e) => { e.preventDefault(); salvar(); }} noValidate>
        <label style={{ ...lbl, marginTop: 4 }} htmlFor="cr-pessoa">Pagador (de quem a igreja vai receber) *</label>
        <div style={{ display: "flex", gap: 8 }}>
          <select id="cr-pessoa" autoFocus style={{ ...inp, flex: 1, minWidth: 0, ...borda("pessoaId") }} value={f.pessoaId} onChange={set("pessoaId")}>
            <option value="">— Selecione —</option>
            {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.documento ? ` · ${mascararDocumento(p.tipo_pessoa, p.documento)}` : ""}</option>)}
          </select>
          <button type="button" className="btn btn-ghost" style={{ flex: "none" }} onClick={() => setNovaPessoa(true)}>+ Nova pessoa</button>
        </div>
        {msg("pessoaId")}

        <label style={lbl} htmlFor="cr-desc">Descrição *</label>
        <input id="cr-desc" maxLength={200} style={{ ...inp, ...borda("descricao") }} value={f.descricao} onChange={set("descricao")} placeholder="Ex.: aluguel do salão social, inscrições do retiro" />
        {msg("descricao")}

        <div style={grade(150)}>
          <div>
            <label style={lbl} htmlFor="cr-valor">Valor *</label>
            <input id="cr-valor" inputMode="decimal" placeholder="0,00" style={{ ...inp, textAlign: "right", ...borda("valor") }} value={f.valor} onChange={set("valor")} />
            {msg("valor")}
          </div>
          <div>
            <label style={lbl} htmlFor="cr-por">O valor é</label>
            <select id="cr-por" style={inp} value={f.valorPor} onChange={set("valorPor")}>
              <option value="total">o total (dividido nas parcelas)</option>
              <option value="parcela">o de cada parcela</option>
            </select>
          </div>
          <div>
            <label style={lbl} htmlFor="cr-parc">Parcelas *</label>
            <input id="cr-parc" inputMode="numeric" style={{ ...inp, textAlign: "right", ...borda("parcelas") }} value={f.parcelas} onChange={set("parcelas")} />
            {msg("parcelas")}
          </div>
        </div>

        <div style={grade(170)}>
          <div>
            <label style={lbl} htmlFor="cr-venc">Vencimento da 1ª parcela *</label>
            <input id="cr-venc" type="date" style={{ ...inp, ...borda("primeiroVencimento") }} value={f.primeiroVencimento} onChange={set("primeiroVencimento")} />
            {msg("primeiroVencimento")}
          </div>
          <div>
            <label style={lbl} htmlFor="cr-per">Próximas parcelas</label>
            <select id="cr-per" style={inp} value={f.periodicidade} onChange={set("periodicidade")} disabled={parcelas === 1}>
              <option value="mensal">todo mês, no mesmo dia</option>
              <option value="dias">a cada N dias</option>
            </select>
          </div>
          {f.periodicidade === "dias" && parcelas > 1 && (
            <div>
              <label style={lbl} htmlFor="cr-int">Intervalo (dias)</label>
              <input id="cr-int" inputMode="numeric" style={{ ...inp, textAlign: "right", ...borda("intervaloDias") }} value={f.intervaloDias} onChange={set("intervaloDias")} />
              {msg("intervaloDias")}
            </div>
          )}
        </div>

        <div style={grade(170)}>
          <div>
            <label style={lbl} htmlFor="cr-forma">Forma prevista</label>
            <FormaSelect id="cr-forma" style={inp} formas={cadastros.formas} value={f.forma} onChange={(v) => setF((p) => ({ ...p, forma: v }))} vazio="— Não informada —" />
          </div>
          <div>
            <label style={lbl} htmlFor="cr-caixa">Conta caixa prevista</label>
            <select id="cr-caixa" style={inp} value={f.contaCaixaId} onChange={set("contaCaixaId")}>
              <option value="">— Escolher ao receber —</option>
              {caixasAtivas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl} htmlFor="cr-centro">Centro de custo</label>
            <select id="cr-centro" style={inp} value={f.centroCustoId} onChange={set("centroCustoId")}>
              <option value="">— Nenhum —</option>
              {cadastros.centros.filter((c) => c.ativo).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
        </div>

        <label style={lbl} htmlFor="cr-obs">Observação</label>
        <input id="cr-obs" maxLength={500} style={inp} value={f.observacao} onChange={set("observacao")} placeholder="Ex.: contrato assinado, cobrar por WhatsApp" />

        {lista.length > 0 && (
          <div className="painel" style={{ paddingTop: 10, marginTop: 14 }}>
            <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>{lista.length} parcela(s), somando <strong>{formatarMoeda(total)}</strong></div>
            <table className="parcelas">
              <thead><tr><th>Parcela</th><th>Vencimento</th><th className="num">Valor</th></tr></thead>
              <tbody>
                {lista.slice(0, 12).map((p) => <tr key={p.parcela}><td>{p.parcela}/{lista.length}</td><td>{formatarData(p.vencimento)}</td><td className="num">{formatarMoeda(p.valor)}</td></tr>)}
                {lista.length > 12 && <tr><td colSpan={3} className="muted">… mais {lista.length - 12} parcela(s), até {formatarData(lista.at(-1).vencimento)}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <button type="submit" hidden />
      </form>
      {erro && <div className="alert alert-danger" role="alert" style={{ marginTop: 16 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
      {novaPessoa && (
        <PessoaModal papelPadrao="cliente" onFechar={() => setNovaPessoa(false)}
          onSalvo={(p) => { setNovaPessoa(false); setPessoasExtras((l) => [...l, p]); setF((x) => ({ ...x, pessoaId: String(p.id) })); onCadastrosMudaram(); }} />
      )}
    </Modal>
  );
}

// Cancela uma parcela a receber em aberto (ex.: o evento não aconteceu). Parcela recebida precisa de estorno antes.
export function CancelarContaReceber({ titulo: t, natureza = "receber", onFechar, onConcluido }) {
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const valido = motivo.trim().length >= 5;
  async function confirmar() {
    if (!valido) return;
    setSalvando(true);
    setErro("");
    try { await cancelarTituloReceber(t.id, motivo); await onConcluido(); }
    catch (e) { setErro(mensagemErro(e)); setSalvando(false); }
  }
  return (
    <Modal titulo={natureza === "pagar" ? "Cancelar parcela a pagar" : "Cancelar parcela a receber"} largura={480} nivel={400} fecharFora={false} onFechar={onFechar}
      rodape={<>
        <button className="btn btn-ghost" onClick={onFechar} disabled={salvando}>Voltar</button>
        <button className="btn btn-danger" style={{ opacity: valido ? 1 : 0.5 }} disabled={!valido || salvando} onClick={confirmar}>{salvando ? "Cancelando..." : "Cancelar parcela"}</button>
      </>}>
      <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "4px 0 0" }}>
        <strong>{t.descricao} — parcela {t.parcela}/{t.total_parcelas} · {formatarMoeda(t.valor)}</strong> ({t.fornecedor_nome}), vencimento {formatarData(t.vencimento)}.
        A parcela deixa de ser cobrada; as outras parcelas continuam. O cancelamento fica registrado e não pode ser desfeito. Informe o motivo:
      </p>
      <textarea autoFocus maxLength={300} style={{ ...inp, minHeight: 70, marginTop: 8, marginBottom: 8, fontFamily: "inherit" }} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: evento cancelado (mín. 5 caracteres)" />
      {erro && <div className="alert alert-danger" role="alert" style={{ marginBottom: 8 }}><Icone nome="alerta" tamanho={16} /><span>{erro}</span></div>}
    </Modal>
  );
}
