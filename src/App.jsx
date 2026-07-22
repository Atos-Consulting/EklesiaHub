import React, { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  fetchTudo,
  dbCriarCrianca, dbAtualizarCrianca, dbExcluirCrianca, dbAtualizarStatusCrianca,
  dbCriarResponsavel, dbAtualizarResponsavel, dbExcluirResponsavel,
  dbCriarProfessor, dbAtualizarProfessor, dbExcluirProfessor,
  dbCriarSala, dbAtualizarSala, dbExcluirSala,
  dbCriarAula, dbExcluirAula,
} from "./db";

const initialResponsaveis = [
  { id: 1, nome: "Marina Andrade", tipo: "mãe", tipoDocumento: "CPF", documento: "123.456.789-00", telefone: "(11) 98888-0001", email: "marina@email.com", dataNascimento: "1990-05-10", sexo: "Mulher", observacoes: "", foto: "" },
  { id: 2, nome: "Carlos Ribeiro", tipo: "pai", tipoDocumento: "CNH", documento: "98765432100", telefone: "(11) 98888-0002", email: "", dataNascimento: "1985-11-22", sexo: "Homem", observacoes: "", foto: "" },
  { id: 3, nome: "Patrícia Costa", tipo: "mãe", tipoDocumento: "CPF", documento: "111.222.333-44", telefone: "(11) 98888-0003", email: "", dataNascimento: "1988-03-17", sexo: "Mulher", observacoes: "", foto: "" },
];

const initialCriancas = [
  { id: 1, codigo: "KID-0001", nome: "Lucas Andrade", nascimento: "2021-03-12", turma: "Maternal", responsaveisIds: [1], alergia: "Nenhuma", sala: null, status: "fora", foto: "" },
  { id: 2, codigo: "KID-0002", nome: "Sofia Ribeiro", nascimento: "2019-07-02", turma: "Jardim", responsaveisIds: [2], alergia: "Amendoim", sala: null, status: "fora", foto: "" },
  { id: 3, codigo: "KID-0003", nome: "Davi Souza", nascimento: "2017-11-20", turma: "Juniores", responsaveisIds: [1], alergia: "Nenhuma", sala: null, status: "fora", foto: "" },
  { id: 4, codigo: "KID-0004", nome: "Helena Costa", nascimento: "2022-01-15", turma: "Berçário", responsaveisIds: [3], alergia: "Lactose", sala: null, status: "fora", foto: "" },
];

const initialSalas = [
  { id: 1, nome: "Berçário", idadeInicial: 0, idadeFinal: 1, capacidade: 8, observacoes: "" },
  { id: 2, nome: "Maternal", idadeInicial: 2, idadeFinal: 3, capacidade: 12, observacoes: "" },
  { id: 3, nome: "Jardim", idadeInicial: 4, idadeFinal: 6, capacidade: 15, observacoes: "" },
  { id: 4, nome: "Juniores", idadeInicial: 7, idadeFinal: 10, capacidade: 20, observacoes: "" },
];

const initialProfessores = [
  { id: 1, nome: "Ana Paula Lima", telefone: "(11) 99999-0001", email: "ana@igreja.com", observacoes: "", foto: "" },
  { id: 2, nome: "Roberto Ferreira", telefone: "(11) 99999-0002", email: "roberto@igreja.com", observacoes: "", foto: "" },
];

// ---------- FOTO CAPTURA ----------

function FotoAvatar({ foto, size = 56 }) {
  if (foto) {
    return <img src={foto} alt="foto" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: "2px solid #e3dcc8", flexShrink: 0 }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: "#eee7d8", border: "2px solid #e3dcc8", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.4, color: "#a39c80", flexShrink: 0 }}>
      👤
    </div>
  );
}

function FotoCaptura({ foto, onFoto }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const fileRef = useRef(null);
  const [camerAberta, setCameraAberta] = useState(false);
  const [erro, setErro] = useState("");

  const abrirCamera = useCallback(async () => {
    setErro("");
    setCameraAberta(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      setErro("Câmera não disponível. Use o botão de arquivo.");
      setCameraAberta(false);
    }
  }, []);

  const fecharCamera = useCallback(() => {
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    setCameraAberta(false);
  }, []);

  const capturar = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    onFoto(canvas.toDataURL("image/jpeg", 0.85));
    fecharCamera();
  }, [onFoto, fecharCamera]);

  function handleArquivo(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onFoto(ev.target.result);
    reader.readAsDataURL(file);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 18 }}>
      <FotoAvatar foto={foto} size={88} />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={abrirCamera} style={{ ...btnGhost, fontSize: 12, padding: "5px 12px" }}>📷 Tirar foto</button>
        <button type="button" onClick={() => fileRef.current.click()} style={{ ...btnGhost, fontSize: 12, padding: "5px 12px" }}>🖼 Galeria</button>
        {foto && <button type="button" onClick={() => onFoto("")} style={{ ...btnDanger, fontSize: 12, padding: "5px 12px" }}>Remover</button>}
      </div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleArquivo} />
      {erro && <div style={{ fontSize: 12, color: "#c25b2f" }}>{erro}</div>}
      <canvas ref={canvasRef} style={{ display: "none" }} />

      {camerAberta && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 300, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
          <video ref={videoRef} autoPlay playsInline style={{ width: "min(360px, 90vw)", borderRadius: 12, background: "#000" }} />
          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={capturar} style={{ ...btnPrimary, fontSize: 15, padding: "10px 28px" }}>📸 Capturar</button>
            <button onClick={fecharCamera} style={{ ...btnGhost, fontSize: 15, padding: "10px 20px", color: "#fff", borderColor: "#fff" }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function calcularTurma(nascimento) {
  const idade = Math.floor((Date.now() - new Date(nascimento)) / (365.25 * 24 * 3600 * 1000));
  if (idade <= 1) return "Berçário";
  if (idade <= 3) return "Maternal";
  if (idade <= 6) return "Jardim";
  return "Juniores";
}

// Retorna array de nomes de turmas sugeridas com base nas salas cadastradas
function calcularTurmasSugeridas(nascimento, salas) {
  if (!nascimento) return [];
  const idade = Math.floor((Date.now() - new Date(nascimento)) / (365.25 * 24 * 3600 * 1000));
  const porSalas = salas.filter((s) => idade >= s.idadeInicial && idade <= s.idadeFinal).map((s) => s.nome);
  if (porSalas.length > 0) return porSalas;
  // fallback para as turmas fixas se não houver salas cadastradas
  return [calcularTurma(nascimento)];
}

function QRBlock({ value }) {
  return (
    <div style={{
      width: 96, height: 96, background: "#fff", border: "2px solid #2f3b2f",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "monospace", fontSize: 9, color: "#2f3b2f", textAlign: "center",
      padding: 6, borderRadius: 6, lineHeight: 1.2,
    }}>
      QR · {value}
    </div>
  );
}

function Pill({ children, tone = "neutral" }) {
  const tones = {
    neutral: { bg: "#eee7d8", color: "#5b5436" },
    ok: { bg: "#d9ead0", color: "#3a5a26" },
    warn: { bg: "#f6dccb", color: "#8a4520" },
    danger: { bg: "#f3d2d2", color: "#8a2424" },
  };
  const t = tones[tone];
  return (
    <span style={{ background: t.bg, color: t.color, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999 }}>
      {children}
    </span>
  );
}

function Card({ children, style }) {
  return (
    <div style={{ background: "#fffdf8", border: "1px solid #e3dcc8", borderRadius: 12, padding: 16, ...style }}>
      {children}
    </div>
  );
}

function Header({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h2 style={{ margin: 0, fontSize: 20, color: "#2f3b2f", fontWeight: 700 }}>{title}</h2>
      {subtitle && <p style={{ margin: "4px 0 0", fontSize: 13, color: "#7a7355" }}>{subtitle}</p>}
    </div>
  );
}

// ---------- APP DA EQUIPE ----------

const diasSemanaOpcoes = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const formSalaVazio = { identificador: "", nome: "", idadeInicial: "", idadeFinal: "", capacidade: "", observacoes: "" };

function ModalSala({ inicial, onSalvar, onFechar }) {
  const [form, setForm] = useState({ ...formSalaVazio, ...(inicial || {}) });
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const f = (campo) => (e) => setForm((prev) => ({ ...prev, [campo]: e.target.value }));

  const erros = {
    identificador: !form.identificador,
    nome: !form.nome,
    idadeInicial: form.idadeInicial === "",
    idadeFinal: form.idadeFinal === "",
    capacidade: !form.capacidade,
  };
  const temErro = Object.values(erros).some(Boolean);

  async function handleSalvar() {
    setTentou(true);
    if (temErro) return;
    setSalvando(true);
    try {
      await onSalvar({
        ...form,
        idadeInicial: Number(form.idadeInicial),
        idadeFinal: Number(form.idadeFinal),
        capacidade: Number(form.capacidade),
      });
    } finally {
      setSalvando(false);
    }
  }

  const borda = (campo) => tentou && erros[campo] ? "#c25b2f" : undefined;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div style={{ background: "#fffdf8", borderRadius: 14, padding: 28, width: 440, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <strong style={{ fontSize: 16, color: "#2f3b2f" }}>{inicial ? "Editar sala" : "Criar sala"}</strong>
          <button onClick={onFechar} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#7a7355", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={lbl}>ID da sala *</label>
            <input style={{ ...inp, borderColor: borda("identificador") }} placeholder="Ex: 101" value={form.identificador} onChange={f("identificador")} />
            {tentou && erros.identificador && <div style={msgErro}>Obrigatório</div>}
          </div>
          <div style={{ flex: 2 }}>
            <label style={lbl}>Nome da sala *</label>
            <input style={{ ...inp, borderColor: borda("nome") }} placeholder="Ex: Berçário" value={form.nome} onChange={f("nome")} />
            {tentou && erros.nome && <div style={msgErro}>Obrigatório</div>}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Idade inicial (anos) *</label>
            <input style={{ ...inp, borderColor: borda("idadeInicial") }} type="number" min="0" placeholder="Ex: 0" value={form.idadeInicial} onChange={f("idadeInicial")} />
            {tentou && erros.idadeInicial && <div style={msgErro}>Obrigatório</div>}
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Idade final (anos) *</label>
            <input style={{ ...inp, borderColor: borda("idadeFinal") }} type="number" min="0" placeholder="Ex: 3" value={form.idadeFinal} onChange={f("idadeFinal")} />
            {tentou && erros.idadeFinal && <div style={msgErro}>Obrigatório</div>}
          </div>
        </div>

        <label style={lbl}>Quantidade máxima de crianças *</label>
        <input style={{ ...inp, borderColor: borda("capacidade") }} type="number" min="1" placeholder="Ex: 12" value={form.capacidade} onChange={f("capacidade")} />
        {tentou && erros.capacidade && <div style={msgErro}>Obrigatório</div>}

        <label style={lbl}>Observações</label>
        <textarea
          style={{ ...inp, resize: "vertical", minHeight: 64, fontFamily: "inherit" }}
          placeholder="Ex: Sala climatizada, precisa de monitor extra..."
          value={form.observacoes}
          onChange={f("observacoes")}
        />

        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
          <button onClick={onFechar} style={btnGhost} disabled={salvando}>Cancelar</button>
          <button onClick={handleSalvar} disabled={salvando} style={{ ...btnPrimary, opacity: salvando ? 0.6 : 1, cursor: salvando ? "not-allowed" : "pointer" }}>
            {salvando ? "Salvando..." : (inicial ? "Salvar alterações" : "Criar sala")}
          </button>
        </div>
      </div>
    </div>
  );
}

function TelaSalas({ criancas, salas, setSalas, professores, aulas, setAulas, eventoAtivo }) {
  const [busca, setBusca] = useState("");
  const [modalAberto, setModalAberto] = useState(false);
  const [editandoSala, setEditandoSala] = useState(null);
  const [iniciandoAula, setIniciandoAula] = useState(null);

  const salasFiltradas = salas.filter((s) => s.nome.toLowerCase().includes(busca.toLowerCase()));

  async function criarSala(dados) {
    const nova = await dbCriarSala(dados);
    setSalas((prev) => [...prev, nova]);
    setModalAberto(false);
  }

  async function salvarEdicao(dados) {
    await dbAtualizarSala(editandoSala.id, dados);
    setSalas((prev) => prev.map((s) => s.id === editandoSala.id ? { ...s, ...dados } : s));
    setEditandoSala(null);
  }

  async function excluirSala(id) {
    await dbExcluirSala(id);
    setSalas((prev) => prev.filter((s) => s.id !== id));
    setAulas((prev) => prev.filter((a) => a.salaId !== id));
  }

  async function criarAula(dados) {
    const nova = await dbCriarAula(dados);
    setAulas((prev) => [...prev, nova]);
    setIniciandoAula(null);
  }

  async function excluirAula(id) {
    await dbExcluirAula(id);
    setAulas((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
        <Header title="Salas e turmas" subtitle={`Ocupação em tempo real — ${eventoAtivo}`} />
        <button onClick={() => setModalAberto(true)} style={{ ...btnPrimary, whiteSpace: "nowrap" }}>+ Criar sala</button>
      </div>

      {/* Filtro */}
      <input
        placeholder="Buscar sala por nome..."
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        style={{ ...inp, marginBottom: 16, maxWidth: 320 }}
      />

      {/* Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
        {salasFiltradas.length === 0 && (
          <div style={{ gridColumn: "span 2", color: "#a39c80", fontSize: 13, padding: 12 }}>Nenhuma sala encontrada.</div>
        )}
        {salasFiltradas.map((sala) => {
          const presentes = criancas.filter((c) => c.sala === sala.nome && c.status === "presente");
          const ocupacao = presentes.length / sala.capacidade;
          const faixa = `${sala.idadeInicial}-${sala.idadeFinal} ${sala.idadeFinal <= 1 ? "ano" : "anos"}`;
          const aulasDesalaSala = aulas.filter((a) => a.salaId === sala.id).sort((a, b) => a.data.localeCompare(b.data));

          return (
            <Card key={sala.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {sala.identificador && (
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: "#fff", background: "#6a8f4a", padding: "2px 8px", borderRadius: 5, letterSpacing: 0.5 }}>{sala.identificador}</span>
                  )}
                  <strong style={{ color: "#2f3b2f" }}>{sala.nome}</strong>
                </div>
                <span style={{ fontSize: 12, color: "#7a7355" }}>{faixa}</span>
              </div>
              <div style={{ margin: "10px 0 6px", fontSize: 13, color: "#5b5436" }}>
                {presentes.length} / {sala.capacidade} crianças
              </div>
              <div style={{ height: 6, background: "#eee7d8", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min(ocupacao * 100, 100)}%`, background: ocupacao > 0.85 ? "#c25b2f" : "#6a8f4a" }} />
              </div>
              {sala.observacoes && (
                <div style={{ marginTop: 8, fontSize: 12, color: "#7a7355", fontStyle: "italic" }}>{sala.observacoes}</div>
              )}
              {/* Aulas agendadas */}
              {aulasDesalaSala.length > 0 && (
                <div style={{ marginTop: 10, borderTop: "1px solid #e3dcc8", paddingTop: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#9aab84", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>Aulas</div>
                  {aulasDesalaSala.map((aula) => (
                    <div key={aula.id} style={{ background: "#f0ece0", borderRadius: 8, padding: "8px 10px", marginBottom: 6, fontSize: 12.5 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          {aula.codigo && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#6a8f4a", background: "#d9ead0", padding: "2px 8px", borderRadius: 5, letterSpacing: 0.7 }}>{aula.codigo}</span>
                          )}
                          {aula.recorrente ? (
                            <span style={{ fontSize: 11, fontWeight: 700, color: "#3a6020", background: "#c8e6b0", padding: "2px 8px", borderRadius: 5 }}>Recorrente</span>
                          ) : aula.data ? (
                            <Pill tone="ok">📅 {new Date(aula.data + "T00:00:00").toLocaleDateString("pt-BR")}</Pill>
                          ) : null}
                          {aula.periodo && (
                            <span style={{ fontSize: 11, fontWeight: 600, color: "#5b4a1a", background: "#f0e0a0", padding: "2px 8px", borderRadius: 5 }}>{aula.periodo}</span>
                          )}
                        </div>
                        {aula.recorrente && aula.diasSemana?.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                            {aula.diasSemana.map((d) => (
                              <span key={d} style={{ fontSize: 10.5, background: "#d9ead0", color: "#3a6020", padding: "1px 7px", borderRadius: 10, fontWeight: 600 }}>{d}</span>
                            ))}
                          </div>
                        )}
                        <button onClick={() => excluirAula(aula.id)} style={{ background: "none", border: "none", color: "#c25b2f", cursor: "pointer", fontSize: 13, padding: 0 }}>✕</button>
                      </div>
                      {aula.professoresIds.length > 0 && (
                        <div style={{ marginTop: 5, color: "#5b5436" }}>
                          <strong>Prof.:</strong> {aula.professoresIds.map((pid) => professores.find((p) => p.id === pid)?.nome).filter(Boolean).join(", ")}
                        </div>
                      )}
                      {aula.professoresIds.length === 0 && (
                        <div style={{ marginTop: 4, color: "#a39c80", fontStyle: "italic" }}>Sem professores vinculados</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                <button onClick={() => setIniciandoAula(sala)} style={{ background: "#2f3b2f", color: "#fff", border: "none", borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Aula</button>
                <button onClick={() => setEditandoSala(sala)} style={{ ...btnGhost, fontSize: 12, padding: "5px 10px" }}>Editar</button>
                <button onClick={() => excluirSala(sala.id)} style={{ ...btnDanger, fontSize: 12, padding: "5px 10px" }}>Excluir</button>
              </div>
            </Card>
          );
        })}
      </div>

      {modalAberto && <ModalSala onSalvar={criarSala} onFechar={() => setModalAberto(false)} />}
      {editandoSala && <ModalSala inicial={editandoSala} onSalvar={salvarEdicao} onFechar={() => setEditandoSala(null)} />}
      {iniciandoAula && <ModalIniciarAula sala={iniciandoAula} professores={professores} aulas={aulas} onSalvar={criarAula} onFechar={() => setIniciandoAula(null)} />}
    </div>
  );
}

function TelaCheckinEquipe({ criancas, setCriancas, responsaveis, eventoAtivo }) {
  const [busca, setBusca] = useState("");
  const filtradas = criancas.filter((c) => c.nome.toLowerCase().includes(busca.toLowerCase()));

  async function fazerCheckin(id) {
    const crianca = criancas.find((c) => c.id === id);
    await dbAtualizarStatusCrianca(id, "presente", crianca?.turma || null);
    setCriancas((prev) => prev.map((c) => (c.id === id ? { ...c, status: "presente", sala: c.turma } : c)));
  }
  async function fazerCheckout(id) {
    await dbAtualizarStatusCrianca(id, "retirado", null);
    setCriancas((prev) => prev.map((c) => (c.id === id ? { ...c, status: "retirado" } : c)));
  }

  return (
    <div>
      <Header title="Check-in / Check-out" subtitle={`Recepção — ${eventoAtivo}`} />
      <input
        placeholder="Buscar criança por nome..."
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d9d2bc", marginBottom: 14, fontSize: 13 }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtradas.map((c) => (
          <div key={c.id} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            background: "#fffdf8", border: "1px solid #e3dcc8", borderRadius: 10, padding: "10px 14px",
          }}>
            <div>
              <div style={{ fontWeight: 600, color: "#2f3b2f", fontSize: 14 }}>{c.nome}</div>
              <div style={{ fontSize: 12, color: "#7a7355" }}>
                Turma: {c.turma} · Resp.: {(c.responsaveisIds || []).map((id) => responsaveis.find((r) => r.id === id)?.nome).filter(Boolean).join(", ")}
                {c.alergia !== "Nenhuma" && <> · <Pill tone="warn">{c.alergia}</Pill></>}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {c.status === "presente" && <Pill tone="ok">Na sala</Pill>}
              {c.status === "retirado" && <Pill tone="neutral">Retirado</Pill>}
              {c.status === "fora" ? (
                <button onClick={() => fazerCheckin(c.id)} style={btnPrimary}>Check-in</button>
              ) : c.status === "presente" ? (
                <button onClick={() => fazerCheckout(c.id)} style={btnDanger}>Check-out</button>
              ) : (
                <button onClick={() => fazerCheckin(c.id)} style={btnGhost}>Refazer check-in</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function calcularIdade(nascimento) {
  if (!nascimento) return null;
  const hoje = new Date();
  const nasc = new Date(nascimento + "T00:00:00");
  let anos = hoje.getFullYear() - nasc.getFullYear();
  const meses = hoje.getMonth() - nasc.getMonth();
  if (meses < 0 || (meses === 0 && hoje.getDate() < nasc.getDate())) anos--;
  if (anos < 1) {
    const diffMs = hoje - nasc;
    const m = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.44));
    return `${m} ${m === 1 ? "mês" : "meses"}`;
  }
  return `${anos} ${anos === 1 ? "ano" : "anos"}`;
}

function DropdownTurma({ turmas, turmasSugeridas, value, onChange }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function fechar(e) { if (ref.current && !ref.current.contains(e.target)) setAberto(false); }
    document.addEventListener("mousedown", fechar);
    return () => document.removeEventListener("mousedown", fechar);
  }, []);

  return (
    <div style={{ marginTop: 14 }} ref={ref}>
      <label style={lbl}>Turma</label>
      <div
        onClick={() => setAberto((p) => !p)}
        style={{ ...inp, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none", background: "#fff" }}
      >
        <span style={{ color: value ? "#2f3b2f" : "#a39c80" }}>{value || "— Selecione a turma —"}</span>
        <span style={{ fontSize: 11, color: "#7a7355", marginLeft: 8 }}>{aberto ? "▲" : "▼"}</span>
      </div>

      {aberto && (
        <div style={{ border: "1px solid #d9d2bc", borderRadius: 8, background: "#fff", marginTop: 2, overflow: "hidden", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", zIndex: 50, position: "relative" }}>
          <div
            onClick={() => { onChange(""); setAberto(false); }}
            style={{ padding: "9px 12px", fontSize: 13, color: "#a39c80", cursor: "pointer", borderBottom: "1px solid #f0ece0" }}
          >
            — Selecione a turma —
          </div>
          {turmas.map((s) => {
            const indicada = turmasSugeridas.includes(s.nome);
            const selecionada = value === s.nome;
            return (
              <div
                key={s.id}
                onClick={() => { onChange(s.nome); setAberto(false); }}
                style={{
                  padding: "9px 12px",
                  fontSize: 13,
                  cursor: "pointer",
                  color: "#2f3b2f",
                  background: selecionada ? "#c8e6b0" : indicada ? "#eef6e8" : "#fff",
                  borderLeft: indicada ? "3px solid #6a8f4a" : "3px solid transparent",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span>{s.nome}</span>
                {indicada && <span style={{ fontSize: 11, fontWeight: 700, color: "#6a8f4a", background: "#d9ead0", padding: "1px 7px", borderRadius: 8 }}>indicada</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ModalCrianca({ inicial, responsaveis, salas, onSalvar, onFechar }) {
  const formVazio = { nome: "", nascimento: "", turma: "", responsaveisIds: [], alergia: "Nenhuma", foto: "" };
  const [form, setForm] = useState({ ...formVazio, ...(inicial || {}) });
  const [seletorAberto, setSeletorAberto] = useState(false);
  const [buscaResp, setBuscaResp] = useState("");
  const [tentou, setTentou] = useState(false);
  const [confirmarTurma, setConfirmarTurma] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const turmasSugeridas = form.nascimento ? calcularTurmasSugeridas(form.nascimento, salas || []) : [];
  const turmaSugeridaLabel = turmasSugeridas.length > 0 ? turmasSugeridas.join(" ou ") : "—";
  const idadeExibida = calcularIdade(form.nascimento);

  const erros = {
    nome: !form.nome,
    nascimento: !form.nascimento,
    responsaveis: form.responsaveisIds.length === 0,
  };

  function toggleResp(id) {
    setForm((prev) => ({
      ...prev,
      responsaveisIds: prev.responsaveisIds.includes(id)
        ? prev.responsaveisIds.filter((x) => x !== id)
        : [...prev.responsaveisIds, id],
    }));
  }

  async function executarSalvar() {
    const turmaFinal = form.turma.trim() || turmasSugeridas[0] || calcularTurma(form.nascimento);
    setSalvando(true);
    try { await onSalvar({ ...form, turma: turmaFinal }); } finally { setSalvando(false); }
  }

  async function handleSalvar() {
    setTentou(true);
    if (erros.nome || erros.nascimento || erros.responsaveis) return;
    // Verifica se turma selecionada diverge das sugeridas
    const turmaDigitada = form.turma.trim();
    if (turmaDigitada && turmasSugeridas.length > 0 && !turmasSugeridas.includes(turmaDigitada)) {
      setConfirmarTurma(true);
      return;
    }
    await executarSalvar();
  }

  const respVinculados = responsaveis.filter((r) => form.responsaveisIds.includes(r.id));
  const respDisponiveis = responsaveis.filter((r) => r.nome.toLowerCase().includes(buscaResp.toLowerCase()));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div style={{ background: "#fffdf8", borderRadius: 14, padding: 28, width: 460, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <strong style={{ fontSize: 16, color: "#2f3b2f" }}>{inicial ? "Editar criança" : "Nova criança"}</strong>
          <button onClick={onFechar} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#7a7355" }}>×</button>
        </div>

        {inicial?.codigo && (
          <div style={{ textAlign: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#6a8f4a", background: "#d9ead0", padding: "3px 12px", borderRadius: 6, letterSpacing: 0.8 }}>{inicial.codigo}</span>
          </div>
        )}
        <FotoCaptura foto={form.foto} onFoto={(f) => setForm((p) => ({ ...p, foto: f }))} />

        <label style={{ ...lbl, color: tentou && erros.nome ? "#c25b2f" : undefined }}>Nome completo *</label>
        <input style={{ ...inp, borderColor: tentou && erros.nome ? "#c25b2f" : undefined }} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
        {tentou && erros.nome && <div style={msgErro}>Campo obrigatório</div>}

        <label style={{ ...lbl, color: tentou && erros.nascimento ? "#c25b2f" : undefined }}>Data de nascimento *</label>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input type="date" style={{ ...inp, flex: 1, borderColor: tentou && erros.nascimento ? "#c25b2f" : undefined }} value={form.nascimento} onChange={(e) => setForm({ ...form, nascimento: e.target.value })} />
          {idadeExibida && (
            <span style={{ whiteSpace: "nowrap", fontSize: 13, color: "#5b5436", fontWeight: 600, background: "#eee7d8", padding: "6px 12px", borderRadius: 8 }}>{idadeExibida}</span>
          )}
        </div>

        <label style={lbl}>Alergia / restrição</label>
        <input style={inp} value={form.alergia} onChange={(e) => setForm({ ...form, alergia: e.target.value })} />

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, marginBottom: 6 }}>
          <span style={{ ...lbl, margin: 0, color: tentou && erros.responsaveis ? "#c25b2f" : undefined }}>Responsável *</span>
          <button type="button" onClick={() => setSeletorAberto(true)}
            style={{ background: "#6a8f4a", color: "#fff", border: "none", borderRadius: 6, width: 22, height: 22, fontSize: 16, lineHeight: "20px", cursor: "pointer", fontWeight: 700, padding: 0 }}>+</button>
        </div>
        {tentou && erros.responsaveis && (
          <div style={msgErro}>Ao menos um responsável é obrigatório.</div>
        )}
        {respVinculados.map((r) => (
          <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#eee7d8", borderRadius: 8, padding: "6px 10px", marginBottom: 5, fontSize: 13 }}>
            <div><strong style={{ color: "#2f3b2f" }}>{r.nome}</strong><span style={{ color: "#7a7355", marginLeft: 8 }}>{r.filiacao}</span></div>
            <button onClick={() => toggleResp(r.id)} style={{ background: "none", border: "none", color: "#c25b2f", cursor: "pointer", fontSize: 16 }}>×</button>
          </div>
        ))}

        <DropdownTurma
          turmas={salas || []}
          turmasSugeridas={turmasSugeridas}
          value={form.turma}
          onChange={(v) => setForm((p) => ({ ...p, turma: v }))}
        />

        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
          <button onClick={onFechar} style={btnGhost} disabled={salvando}>Cancelar</button>
          <button onClick={handleSalvar} disabled={salvando} style={{ ...btnPrimary, opacity: salvando ? 0.6 : 1, cursor: salvando ? "not-allowed" : "pointer" }}>
            {salvando ? "Salvando..." : (inicial ? "Salvar alterações" : "Cadastrar")}
          </button>
        </div>
      </div>

      {/* Confirmação de turma divergente */}
      {confirmarTurma && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fffdf8", borderRadius: 14, padding: 28, width: 380, boxShadow: "0 8px 32px rgba(0,0,0,0.25)", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>⚠️</div>
            <strong style={{ fontSize: 15, color: "#2f3b2f", display: "block", marginBottom: 8 }}>Turma diferente da indicada</strong>
            <p style={{ fontSize: 13.5, color: "#5b5436", margin: "0 0 6px" }}>
              A turma informada <strong>"{form.turma}"</strong> é diferente da indicada pela idade:
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
              {turmasSugeridas.map((t) => <Pill key={t}>{t}</Pill>)}
            </div>
            <p style={{ fontSize: 13, color: "#7a7355", margin: "0 0 20px" }}>Deseja cadastrar mesmo assim?</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button onClick={() => setConfirmarTurma(false)} style={btnGhost}>Não, voltar</button>
              <button onClick={async () => { setConfirmarTurma(false); await executarSalvar(); }} style={btnPrimary}>Sim, cadastrar assim</button>
            </div>
          </div>
        </div>
      )}

      {/* Seletor de responsáveis (sobreposto ao modal) */}
      {seletorAberto && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget) setSeletorAberto(false); }}>
          <div style={{ background: "#fffdf8", borderRadius: 14, padding: 24, width: 360, boxShadow: "0 8px 32px rgba(0,0,0,0.22)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <strong style={{ fontSize: 14, color: "#2f3b2f" }}>Vincular responsável</strong>
              <button onClick={() => setSeletorAberto(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#7a7355" }}>×</button>
            </div>
            <input placeholder="Buscar..." style={{ ...inp, marginBottom: 10 }} value={buscaResp} onChange={(e) => setBuscaResp(e.target.value)} />
            {respDisponiveis.length === 0 && <div style={{ color: "#a39c80", fontSize: 13 }}>Nenhum responsável cadastrado.</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 260, overflowY: "auto" }}>
              {respDisponiveis.map((r) => {
                const sel = form.responsaveisIds.includes(r.id);
                return (
                  <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, background: sel ? "#eee7d8" : "#f6f2e7", cursor: "pointer" }}>
                    <input type="checkbox" checked={sel} onChange={() => toggleResp(r.id)} />
                    <div>
                      <div style={{ fontWeight: 600, color: "#2f3b2f", fontSize: 13.5 }}>{r.nome}</div>
                      <div style={{ fontSize: 11.5, color: "#7a7355" }}>{r.filiacao} · {r.telefone}</div>
                    </div>
                  </label>
                );
              })}
            </div>
            <div style={{ textAlign: "right", marginTop: 12 }}>
              <button onClick={() => setSeletorAberto(false)} style={btnPrimary}>Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TelaCriancas({ criancas, setCriancas, responsaveis, salas }) {
  const [busca, setBusca] = useState("");
  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState(null);

  const filtradas = criancas.filter((c) => c.nome.toLowerCase().includes(busca.toLowerCase()));

  function gerarCodigo(lista) {
    const max = lista.reduce((acc, c) => {
      const n = parseInt((c.codigo || "KID-0000").split("-")[1], 10);
      return n > acc ? n : acc;
    }, 0);
    return `KID-${String(max + 1).padStart(4, "0")}`;
  }

  async function criar(dados) {
    const codigo = gerarCodigo(criancas);
    const nova = await dbCriarCrianca({ ...dados, codigo });
    setCriancas((prev) => [...prev, nova]);
    setModalAberto(false);
  }

  async function salvarEdicao(dados) {
    await dbAtualizarCrianca(editando.id, dados);
    setCriancas((prev) => prev.map((c) => c.id === editando.id ? { ...c, ...dados } : c));
    setEditando(null);
  }

  async function excluir(id) {
    await dbExcluirCrianca(id);
    setCriancas((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
        <Header title="Crianças" subtitle="Turma sugerida automaticamente pela idade" />
        <button onClick={() => setModalAberto(true)} style={{ ...btnPrimary, whiteSpace: "nowrap" }}>+ Nova criança</button>
      </div>

      <input placeholder="Buscar por nome..." value={busca} onChange={(e) => setBusca(e.target.value)} style={{ ...inp, marginBottom: 16, maxWidth: 320 }} />

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtradas.length === 0 && <div style={{ color: "#a39c80", fontSize: 13 }}>Nenhuma criança encontrada.</div>}
        {filtradas.map((c) => {
          const resps = (c.responsaveisIds || []).map((id) => responsaveis.find((r) => r.id === id)).filter(Boolean);
          return (
            <Card key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <FotoAvatar foto={c.foto} size={48} />
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, color: "#2f3b2f", fontSize: 14 }}>{c.nome}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#6a8f4a", background: "#d9ead0", padding: "2px 8px", borderRadius: 6, letterSpacing: 0.5 }}>{c.codigo}</span>
                    <Pill tone="neutral">{c.turma}</Pill>
                    {c.alergia !== "Nenhuma" && <Pill tone="warn">{c.alergia}</Pill>}
                  </div>
                  <div style={{ fontSize: 12.5, color: "#7a7355", marginTop: 3 }}>
                    {c.nascimento && `${new Date(c.nascimento + "T00:00:00").toLocaleDateString("pt-BR")} · ${calcularIdade(c.nascimento)}`}
                  </div>
                  {resps.length > 0 && (
                    <div style={{ fontSize: 12, color: "#5b5436", marginTop: 2 }}>
                      Resp.: {resps.map((r) => `${r.nome} (${r.filiacao})`).join(", ")}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: 12 }}>
                <button onClick={() => setEditando(c)} style={{ ...btnGhost, fontSize: 12, padding: "5px 10px" }}>Editar</button>
                <button onClick={() => excluir(c.id)} style={{ ...btnDanger, fontSize: 12, padding: "5px 10px" }}>Excluir</button>
              </div>
            </Card>
          );
        })}
      </div>

      {modalAberto && <ModalCrianca responsaveis={responsaveis} salas={salas} onSalvar={criar} onFechar={() => setModalAberto(false)} />}
      {editando && <ModalCrianca inicial={editando} responsaveis={responsaveis} salas={salas} onSalvar={salvarEdicao} onFechar={() => setEditando(null)} />}
    </div>
  );
}

// ---------- TELA RESPONSÁVEIS ----------

const initialFiliacoes = ["Pai", "Mãe", "Avô", "Avó", "Responsável", "Tutor(a)"];

const formRespVazio = { nome: "", filiacao: "Pai", tipoDocumento: "CPF", documento: "", telefone: "", email: "", dataNascimento: "", sexo: "Homem", observacoes: "", foto: "" };
// Opções de documento: CPF ou CNH

function GerenciadorFiliacoes({ filiacoes, setFiliacoes, onFechar }) {
  const [nova, setNova] = useState("");
  const [editandoIdx, setEditandoIdx] = useState(null);
  const [editandoValor, setEditandoValor] = useState("");

  function adicionar() {
    const v = nova.trim();
    if (!v || filiacoes.includes(v)) return;
    setFiliacoes((prev) => [...prev, v]);
    setNova("");
  }

  function salvarEdicao(idx) {
    const v = editandoValor.trim();
    if (!v) return;
    setFiliacoes((prev) => prev.map((f, i) => i === idx ? v : f));
    setEditandoIdx(null);
  }

  function remover(idx) {
    setFiliacoes((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div style={{ background: "#fffdf8", borderRadius: 14, padding: 24, width: 360, boxShadow: "0 8px 32px rgba(0,0,0,0.22)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <strong style={{ fontSize: 15, color: "#2f3b2f" }}>Gerenciar filiações</strong>
          <button onClick={onFechar} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#7a7355" }}>×</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14, maxHeight: 240, overflowY: "auto" }}>
          {filiacoes.map((fil, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, background: "#f6f2e7", borderRadius: 8, padding: "6px 10px" }}>
              {editandoIdx === idx ? (
                <>
                  <input
                    style={{ ...inp, flex: 1, padding: "4px 8px" }}
                    value={editandoValor}
                    onChange={(e) => setEditandoValor(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && salvarEdicao(idx)}
                    autoFocus
                  />
                  <button onClick={() => salvarEdicao(idx)} style={{ ...btnPrimary, fontSize: 11, padding: "3px 8px" }}>✓</button>
                  <button onClick={() => setEditandoIdx(null)} style={{ ...btnGhost, fontSize: 11, padding: "3px 8px" }}>✕</button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontSize: 13.5, color: "#2f3b2f" }}>{fil}</span>
                  <button onClick={() => { setEditandoIdx(idx); setEditandoValor(fil); }} style={{ background: "none", border: "none", fontSize: 13, cursor: "pointer", color: "#6a8f4a" }}>✏️</button>
                  <button onClick={() => remover(idx)} style={{ background: "none", border: "none", fontSize: 13, cursor: "pointer", color: "#c25b2f" }}>🗑</button>
                </>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ ...inp, flex: 1 }}
            placeholder="Nova filiação..."
            value={nova}
            onChange={(e) => setNova(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && adicionar()}
          />
          <button onClick={adicionar} style={btnPrimary}>+ Adicionar</button>
        </div>
      </div>
    </div>
  );
}

function ModalResponsavel({ inicial, filiacoes, setFiliacoes, onSalvar, onFechar }) {
  const [form, setForm] = useState({ ...formRespVazio, filiacao: filiacoes[0] || "", ...(inicial || {}) });
  const [tentou, setTentou] = useState(false);
  const [gerenciando, setGerenciando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const f = (campo) => (e) => setForm((prev) => ({ ...prev, [campo]: e.target.value }));
  const erros = { nome: !form.nome, telefone: !form.telefone };

  async function handleSalvar() {
    setTentou(true);
    if (erros.nome || erros.telefone) return;
    setSalvando(true);
    try { await onSalvar(form); } finally { setSalvando(false); }
  }

  const idadeResp = calcularIdade(form.dataNascimento);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div style={{ background: "#fffdf8", borderRadius: 14, padding: 28, width: 460, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <strong style={{ fontSize: 16, color: "#2f3b2f" }}>{inicial ? "Editar responsável" : "Novo responsável"}</strong>
          <button onClick={onFechar} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#7a7355" }}>×</button>
        </div>

        <FotoCaptura foto={form.foto} onFoto={(f2) => setForm((p) => ({ ...p, foto: f2 }))} />

        <label style={{ ...lbl, color: tentou && erros.nome ? "#c25b2f" : undefined }}>Nome completo *</label>
        <input style={{ ...inp, borderColor: tentou && erros.nome ? "#c25b2f" : undefined }} placeholder="Ex: Marina Andrade" value={form.nome} onChange={f("nome")} />
        {tentou && erros.nome && <div style={msgErro}>Campo obrigatório</div>}

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
          <label style={{ ...lbl, margin: 0, flex: 1 }}>Filiação</label>
          <button type="button" onClick={() => setGerenciando(true)} style={{ background: "none", border: "none", fontSize: 12, color: "#6a8f4a", cursor: "pointer", fontWeight: 600, padding: 0 }}>⚙ Gerenciar</button>
        </div>
        <select style={{ ...inp, marginTop: 4 }} value={form.filiacao} onChange={f("filiacao")}>
          {filiacoes.map((f2) => <option key={f2} value={f2}>{f2}</option>)}
        </select>
        {gerenciando && <GerenciadorFiliacoes filiacoes={filiacoes} setFiliacoes={setFiliacoes} onFechar={() => setGerenciando(false)} />}

        <label style={lbl}>Documento</label>
        <div style={{ display: "flex", gap: 8 }}>
          <select style={{ ...inp, width: 90, flexShrink: 0 }} value={form.tipoDocumento}
            onChange={(e) => setForm((p) => ({ ...p, tipoDocumento: e.target.value, documento: "" }))}>
            <option value="CPF">CPF</option>
            <option value="CNH">CNH</option>
          </select>
          <input
            style={{ ...inp, flex: 1 }}
            placeholder={form.tipoDocumento === "CPF" ? "000.000.000-00" : "00000000000"}
            value={form.documento}
            onChange={(e) => setForm((p) => ({ ...p, documento: aplicarMascara(p.tipoDocumento, e.target.value) }))}
          />
        </div>

        <label style={{ ...lbl, color: tentou && erros.telefone ? "#c25b2f" : undefined }}>Telefone *</label>
        <input
          style={{ ...inp, borderColor: tentou && erros.telefone ? "#c25b2f" : undefined }}
          placeholder="(00) 00000-0000"
          value={form.telefone}
          onChange={(e) => setForm((p) => ({ ...p, telefone: maskTelefone(e.target.value) }))}
        />
        {tentou && erros.telefone && <div style={msgErro}>Campo obrigatório</div>}

        <label style={lbl}>E-mail (opcional)</label>
        <input style={inp} type="email" placeholder="Ex: nome@email.com" value={form.email} onChange={f("email")} />

        <label style={lbl}>Data de nascimento</label>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input type="date" style={{ ...inp, flex: 1 }} value={form.dataNascimento} onChange={f("dataNascimento")} />
          {idadeResp && (
            <span style={{ whiteSpace: "nowrap", fontSize: 13, color: "#5b5436", fontWeight: 600, background: "#eee7d8", padding: "6px 10px", borderRadius: 8 }}>{idadeResp}</span>
          )}
        </div>

        <label style={lbl}>Sexo</label>
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          {["Homem", "Mulher"].map((s) => (
            <label key={s} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, cursor: "pointer", padding: "7px 14px", borderRadius: 8, background: form.sexo === s ? "#eee7d8" : "#f6f2e7", border: form.sexo === s ? "1px solid #c8bc94" : "1px solid transparent" }}>
              <input type="radio" name="sexo" value={s} checked={form.sexo === s} onChange={f("sexo")} />
              {s}
            </label>
          ))}
        </div>

        <label style={lbl}>Observações</label>
        <textarea style={{ ...inp, resize: "vertical", minHeight: 68, fontFamily: "inherit" }} placeholder="Informações adicionais..." value={form.observacoes} onChange={f("observacoes")} />

        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
          <button onClick={onFechar} style={btnGhost} disabled={salvando}>Cancelar</button>
          <button onClick={handleSalvar} disabled={salvando} style={{ ...btnPrimary, opacity: salvando ? 0.6 : 1, cursor: salvando ? "not-allowed" : "pointer" }}>
            {salvando ? "Salvando..." : (inicial ? "Salvar alterações" : "Cadastrar")}
          </button>
        </div>
      </div>
    </div>
  );
}

function TelaResponsaveis({ responsaveis, setResponsaveis, filiacoes, setFiliacoes }) {
  const [busca, setBusca] = useState("");
  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState(null);

  const filtrados = responsaveis.filter((r) => r.nome.toLowerCase().includes(busca.toLowerCase()));

  async function criar(dados) {
    const novo = await dbCriarResponsavel(dados);
    setResponsaveis((prev) => [...prev, novo]);
    setModalAberto(false);
  }

  async function salvarEdicao(dados) {
    await dbAtualizarResponsavel(editando.id, dados);
    setResponsaveis((prev) => prev.map((r) => r.id === editando.id ? { ...r, ...dados } : r));
    setEditando(null);
  }

  async function excluir(id) {
    await dbExcluirResponsavel(id);
    setResponsaveis((prev) => prev.filter((r) => r.id !== id));
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
        <Header title="Responsáveis" subtitle="Pais e guardiões cadastrados" />
        <button onClick={() => setModalAberto(true)} style={{ ...btnPrimary, whiteSpace: "nowrap" }}>+ Novo responsável</button>
      </div>

      <input placeholder="Buscar por nome..." value={busca} onChange={(e) => setBusca(e.target.value)} style={{ ...inp, marginBottom: 16, maxWidth: 320 }} />

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtrados.length === 0 && <div style={{ color: "#a39c80", fontSize: 13 }}>Nenhum responsável encontrado.</div>}
        {filtrados.map((r) => (
          <Card key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <FotoAvatar foto={r.foto} size={48} />
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600, color: "#2f3b2f", fontSize: 14 }}>{r.nome}</span>
                  <Pill tone="neutral">{r.filiacao}</Pill>
                  <Pill tone="neutral">{r.sexo}</Pill>
                </div>
                <div style={{ fontSize: 12.5, color: "#7a7355", marginTop: 3 }}>
                  {r.filiacaoDocumento}: {r.documento} · {r.telefone}
                  {r.email && ` · ${r.email}`}
                </div>
                {r.dataNascimento && (
                  <div style={{ fontSize: 12, color: "#a39c80", marginTop: 2 }}>
                    Nascimento: {new Date(r.dataNascimento + "T00:00:00").toLocaleDateString("pt-BR")} · {calcularIdade(r.dataNascimento)}
                  </div>
                )}
                {r.observacoes && <div style={{ fontSize: 12, color: "#a39c80", fontStyle: "italic", marginTop: 2 }}>{r.observacoes}</div>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0, marginLeft: 12 }}>
              <button onClick={() => setEditando(r)} style={{ ...btnGhost, fontSize: 12, padding: "5px 10px" }}>Editar</button>
              <button onClick={() => excluir(r.id)} style={{ ...btnDanger, fontSize: 12, padding: "5px 10px" }}>Excluir</button>
            </div>
          </Card>
        ))}
      </div>

      {modalAberto && <ModalResponsavel filiacoes={filiacoes} setFiliacoes={setFiliacoes} onSalvar={criar} onFechar={() => setModalAberto(false)} />}
      {editando && <ModalResponsavel inicial={editando} filiacoes={filiacoes} setFiliacoes={setFiliacoes} onSalvar={salvarEdicao} onFechar={() => setEditando(null)} />}
    </div>
  );
}

function TelaRelatorios({ criancas }) {
  const porTurma = useMemo(() => {
    const map = {};
    criancas.forEach((c) => { map[c.turma] = (map[c.turma] || 0) + 1; });
    return map;
  }, [criancas]);
  const presentes = criancas.filter((c) => c.status === "presente").length;

  return (
    <div>
      <Header title="Relatórios" subtitle="Visão consolidada do ministério infantil" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 18 }}>
        <Card><div style={statLabel}>Cadastradas</div><div style={statValue}>{criancas.length}</div></Card>
        <Card><div style={statLabel}>Presentes agora</div><div style={statValue}>{presentes}</div></Card>
        <Card><div style={statLabel}>Turmas ativas</div><div style={statValue}>{Object.keys(porTurma).length}</div></Card>
      </div>
      <Card>
        <strong style={{ fontSize: 13, color: "#2f3b2f" }}>Distribuição por turma</strong>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {Object.entries(porTurma).map(([turma, qtd]) => (
            <div key={turma} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 80, fontSize: 12.5, color: "#5b5436" }}>{turma}</span>
              <div style={{ flex: 1, background: "#eee7d8", height: 10, borderRadius: 5, overflow: "hidden" }}>
                <div style={{ width: `${(qtd / criancas.length) * 100}%`, background: "#6a8f4a", height: "100%" }} />
              </div>
              <span style={{ fontSize: 12, color: "#7a7355" }}>{qtd}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---------- APP DOS PAIS ----------

function AppPais({ criancas, setCriancas, eventoAtivo }) {
  const meusFilhos = criancas.filter((c) => c.responsavel === "Marina Andrade");
  const [qrAtivo, setQrAtivo] = useState(null);

  function gerarCheckin(id) {
    setCriancas((prev) => prev.map((c) => (c.id === id ? { ...c, status: "presente", sala: c.turma } : c)));
    setQrAtivo(id);
  }

  return (
    <div style={{ maxWidth: 360, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <div style={{ fontSize: 13, color: "#7a7355" }}>Olá, Marina</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#2f3b2f" }}>{eventoAtivo}</div>
      </div>
      {meusFilhos.map((c) => (
        <Card key={c.id} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 600, color: "#2f3b2f" }}>{c.nome}</div>
              <div style={{ fontSize: 12, color: "#7a7355" }}>Turma: {c.turma}</div>
            </div>
            {c.status === "presente" && <Pill tone="ok">Na sala</Pill>}
            {c.status === "retirado" && <Pill tone="neutral">Retirado(a)</Pill>}
            {c.status === "fora" && <Pill tone="neutral">Fora</Pill>}
          </div>
          {c.status === "fora" ? (
            <button onClick={() => gerarCheckin(c.id)} style={{ ...btnPrimary, width: "100%", marginTop: 12 }}>
              Fazer check-in
            </button>
          ) : (
            qrAtivo === c.id && (
              <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
                <QRBlock value={c.id} />
              </div>
            )
          )}
        </Card>
      ))}
      <Card style={{ background: "#f3efe3" }}>
        <div style={{ fontSize: 12.5, color: "#5b5436" }}>
          Mostre o QR Code ao professor na entrega e na retirada. Apenas responsáveis autorizados podem retirar a criança.
        </div>
      </Card>
    </div>
  );
}

// ---------- estilos compartilhados ----------

const btnPrimary = { background: "#6a8f4a", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const btnDanger = { background: "#c25b2f", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const btnGhost = { background: "transparent", color: "#5b5436", border: "1px solid #d9d2bc", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const lbl = { display: "block", fontSize: 12, color: "#7a7355", margin: "10px 0 4px" };
const inp = { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d9d2bc", fontSize: 13, boxSizing: "border-box" };
const statLabel = { fontSize: 12, color: "#7a7355" };

// ── Máscaras ────────────────────────────────────────────────────
function maskTelefone(v) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0,2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
}
function maskCPF(v) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
}
function maskCNH(v) {
  return v.replace(/\D/g, "").slice(0, 11);
}
function aplicarMascara(tipoDoc, valor) {
  if (tipoDoc === "CPF") return maskCPF(valor);
  if (tipoDoc === "CNH") return maskCNH(valor);
  return valor;
}
const statValue = { fontSize: 26, fontWeight: 700, color: "#2f3b2f", marginTop: 4 };
const msgErro = { fontSize: 11.5, color: "#c25b2f", marginTop: 3, marginBottom: 4 };

// ---------- MODAL ATIVAR SALA ----------

function gerarCodigoAula(aulas) {
  const max = aulas.reduce((acc, a) => {
    const n = parseInt((a.codigo || "AUL-0000").split("-")[1], 10);
    return n > acc ? n : acc;
  }, 0);
  return `AUL-${String(max + 1).padStart(4, "0")}`;
}

const periodos = ["Manhã", "Tarde", "Noite"];

function ModalIniciarAula({ sala, professores, aulas, onSalvar, onFechar }) {
  const [data, setData] = useState("");
  const [periodo, setPeriodo] = useState("Manhã");
  const [recorrente, setRecorrente] = useState(false);
  const [diasSemana, setDiasSemana] = useState([]);
  const [selecionados, setSelecionados] = useState([]);
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [confirmarSemProf, setConfirmarSemProf] = useState(false);
  const codigo = gerarCodigoAula(aulas);

  function toggleDia(dia) {
    setDiasSemana((prev) => prev.includes(dia) ? prev.filter((d) => d !== dia) : [...prev, dia]);
  }

  function toggleRecorrente() {
    setRecorrente((prev) => {
      if (prev) setDiasSemana([]);
      return !prev;
    });
  }

  // Professores já alocados no mesmo dia + período em OUTRA sala
  const conflitos = useMemo(() => {
    if (!data || recorrente) return new Set();
    return new Set(
      aulas
        .filter((a) => a.salaId !== sala.id && a.data === data && a.periodo === periodo)
        .flatMap((a) => a.professoresIds)
    );
  }, [data, periodo, recorrente, aulas, sala.id]);

  function toggleProf(id) {
    if (conflitos.has(id)) return;
    setSelecionados((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  const erros = {
    data: !recorrente && !data,
    diasSemana: recorrente && diasSemana.length === 0,
  };
  const temErro = erros.data || erros.diasSemana;

  async function executarSalvar() {
    setSalvando(true);
    try {
      await onSalvar({ codigo, salaId: sala.id, salaNome: sala.nome, data: recorrente ? null : data, periodo, recorrente, diasSemana: recorrente ? diasSemana : [], professoresIds: selecionados });
    } finally {
      setSalvando(false);
    }
  }

  async function handleSalvar() {
    setTentou(true);
    if (temErro) return;
    if (selecionados.length === 0) {
      setConfirmarSemProf(true);
      return;
    }
    await executarSalvar();
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div style={{ background: "#fffdf8", borderRadius: 14, padding: 28, width: 440, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <strong style={{ fontSize: 16, color: "#2f3b2f" }}>Iniciar aula — {sala.nome}</strong>
          <button onClick={onFechar} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#7a7355", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#6a8f4a", background: "#d9ead0", padding: "3px 12px", borderRadius: 6, letterSpacing: 0.8 }}>{codigo}</span>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 2 }}>
            <label style={{ ...lbl, color: tentou && erros.data ? "#c25b2f" : recorrente ? "#b0a88a" : undefined }}>
              Data da aula {!recorrente && "*"}
            </label>
            <input
              type="date"
              disabled={recorrente}
              style={{ ...inp, borderColor: tentou && erros.data ? "#c25b2f" : undefined, opacity: recorrente ? 0.4 : 1, background: recorrente ? "#f0ece0" : undefined, cursor: recorrente ? "not-allowed" : undefined }}
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
            {tentou && erros.data && <div style={msgErro}>Informe a data ou marque Recorrente</div>}
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>Período *</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 2 }}>
              {periodos.map((p) => (
                <label key={p} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, cursor: "pointer", padding: "5px 8px", borderRadius: 7, background: periodo === p ? "#d9ead0" : "#f0ece0", fontWeight: periodo === p ? 700 : 400, color: periodo === p ? "#3a6020" : "#5b5436" }}>
                  <input type="radio" name="periodo" value={p} checked={periodo === p} onChange={() => setPeriodo(p)} style={{ accentColor: "#6a8f4a" }} />
                  {p}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Toggle Recorrente */}
        <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 10, background: recorrente ? "#eef6e8" : "#f6f2e7", border: `1px solid ${recorrente ? "#b0d09a" : "#e3dcc8"}` }}>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}>
            <div onClick={toggleRecorrente} style={{ width: 40, height: 22, borderRadius: 11, background: recorrente ? "#6a8f4a" : "#c8c0a8", position: "relative", transition: "background 0.2s", cursor: "pointer", flexShrink: 0 }}>
              <div style={{ width: 18, height: 18, borderRadius: 9, background: "#fff", position: "absolute", top: 2, left: recorrente ? 20 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }} />
            </div>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: recorrente ? "#3a6020" : "#7a7355" }}>Recorrente</span>
            {recorrente && <span style={{ fontSize: 12, color: "#6a7a5a" }}>— escolha os dias</span>}
          </label>
          {recorrente && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 12 }}>
                {diasSemanaOpcoes.map((dia) => {
                  const ativo = diasSemana.includes(dia);
                  const destaqueBorda = tentou && erros.diasSemana;
                  return (
                    <button key={dia} type="button" onClick={() => toggleDia(dia)} style={{ padding: "5px 11px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", border: `2px solid ${ativo ? "#6a8f4a" : destaqueBorda ? "#c25b2f" : "#c8c0a8"}`, background: ativo ? "#d9ead0" : "#fff", color: ativo ? "#3a6020" : "#7a7355", transition: "all 0.15s" }}>
                      {dia}
                    </button>
                  );
                })}
              </div>
              {tentou && erros.diasSemana && <div style={{ ...msgErro, marginTop: 6 }}>Selecione pelo menos um dia da semana</div>}
            </>
          )}
        </div>

        <label style={{ ...lbl, marginTop: 16 }}>Vincular professores</label>
        {professores.length === 0 && (
          <div style={{ fontSize: 12.5, color: "#a39c80", marginTop: 6 }}>Nenhum professor cadastrado ainda.</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          {professores.map((p) => {
            const emConflito = conflitos.has(p.id);
            const selecionado = selecionados.includes(p.id);
            const aulaConflito = emConflito ? aulas.find((a) => a.salaId !== sala.id && a.data === data && a.periodo === periodo && a.professoresIds.includes(p.id)) : null;
            return (
              <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, cursor: emConflito ? "not-allowed" : "pointer", padding: "8px 10px", borderRadius: 8, background: emConflito ? "#f9ece8" : selecionado ? "#eee7d8" : "#f6f2e7", opacity: emConflito ? 0.8 : 1, border: emConflito ? "1px solid #e8b4a0" : "1px solid transparent" }}>
                <input type="checkbox" checked={selecionado} disabled={emConflito} onChange={() => toggleProf(p.id)} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: emConflito ? "#a04030" : "#2f3b2f" }}>{p.nome}</div>
                  <div style={{ fontSize: 11.5, color: "#7a7355" }}>{p.telefone}</div>
                </div>
                {emConflito && (
                  <span style={{ fontSize: 11, color: "#c25b2f", fontStyle: "italic" }}>
                    Em {aulaConflito?.salaNome || "outra sala"} ({periodo})
                  </span>
                )}
              </label>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
          <button onClick={onFechar} style={btnGhost} disabled={salvando}>Cancelar</button>
          <button onClick={handleSalvar} disabled={salvando} style={{ ...btnPrimary, opacity: salvando ? 0.6 : 1, cursor: salvando ? "not-allowed" : "pointer" }}>
            {salvando ? "Salvando..." : "Iniciar aula"}
          </button>
        </div>
      </div>

      {/* Confirmação sem professor */}
      {confirmarSemProf && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fffdf8", borderRadius: 14, padding: 28, width: 360, boxShadow: "0 8px 32px rgba(0,0,0,0.25)", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>⚠️</div>
            <strong style={{ fontSize: 15, color: "#2f3b2f", display: "block", marginBottom: 8 }}>Nenhum professor vinculado</strong>
            <p style={{ fontSize: 13.5, color: "#5b5436", margin: "0 0 20px" }}>
              Tem certeza que deseja iniciar a aula sem professor?
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button
                onClick={() => setConfirmarSemProf(false)}
                style={btnGhost}
              >
                Não, voltar
              </button>
              <button
                onClick={async () => { setConfirmarSemProf(false); await executarSalvar(); }}
                style={btnPrimary}
              >
                Sim, iniciar assim
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- TELA PROFESSORES ----------

const formProfVazio = { nome: "", telefone: "", email: "", observacoes: "", foto: "" };

function ModalProfessor({ inicial, onSalvar, onFechar }) {
  const [form, setForm] = useState(inicial || formProfVazio);
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const f = (campo) => (e) => setForm((prev) => ({ ...prev, [campo]: e.target.value }));
  const erros = { nome: !form.nome, telefone: !form.telefone };

  async function handleSalvar() {
    setTentou(true);
    if (erros.nome || erros.telefone) return;
    setSalvando(true);
    try { await onSalvar(form); } finally { setSalvando(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div style={{ background: "#fffdf8", borderRadius: 14, padding: 28, width: 420, boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <strong style={{ fontSize: 16, color: "#2f3b2f" }}>{inicial ? "Editar professor" : "Novo professor"}</strong>
          <button onClick={onFechar} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#7a7355", lineHeight: 1 }}>×</button>
        </div>

        <FotoCaptura foto={form.foto} onFoto={(f2) => setForm((p) => ({ ...p, foto: f2 }))} />

        <label style={{ ...lbl, color: tentou && erros.nome ? "#c25b2f" : undefined }}>Nome completo *</label>
        <input style={{ ...inp, borderColor: tentou && erros.nome ? "#c25b2f" : undefined }} placeholder="Ex: Ana Paula Lima" value={form.nome} onChange={f("nome")} />
        {tentou && erros.nome && <div style={msgErro}>Campo obrigatório</div>}

        <label style={{ ...lbl, color: tentou && erros.telefone ? "#c25b2f" : undefined }}>Telefone *</label>
        <input
          style={{ ...inp, borderColor: tentou && erros.telefone ? "#c25b2f" : undefined }}
          placeholder="(00) 00000-0000"
          value={form.telefone}
          onChange={(e) => setForm((p) => ({ ...p, telefone: maskTelefone(e.target.value) }))}
        />
        {tentou && erros.telefone && <div style={msgErro}>Campo obrigatório</div>}

        <label style={lbl}>E-mail</label>
        <input style={inp} type="email" placeholder="Ex: ana@igreja.com" value={form.email} onChange={f("email")} />

        <label style={lbl}>Observações</label>
        <textarea
          style={{ ...inp, resize: "vertical", minHeight: 72, fontFamily: "inherit" }}
          placeholder="Ex: Disponível apenas nos domingos..."
          value={form.observacoes}
          onChange={f("observacoes")}
        />

        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
          <button onClick={onFechar} style={btnGhost} disabled={salvando}>Cancelar</button>
          <button onClick={handleSalvar} disabled={salvando} style={{ ...btnPrimary, opacity: salvando ? 0.6 : 1, cursor: salvando ? "not-allowed" : "pointer" }}>
            {salvando ? "Salvando..." : (inicial ? "Salvar alterações" : "Cadastrar")}
          </button>
        </div>
      </div>
    </div>
  );
}

function TelaProfessores({ professores, setProfessores }) {
  const [busca, setBusca] = useState("");
  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState(null);

  const filtrados = professores.filter((p) => p.nome.toLowerCase().includes(busca.toLowerCase()));

  async function criarProf(dados) {
    const novo = await dbCriarProfessor(dados);
    setProfessores((prev) => [...prev, novo]);
    setModalAberto(false);
  }

  async function salvarEdicao(dados) {
    await dbAtualizarProfessor(editando.id, dados);
    setProfessores((prev) => prev.map((p) => p.id === editando.id ? { ...p, ...dados } : p));
    setEditando(null);
  }

  async function excluir(id) {
    await dbExcluirProfessor(id);
    setProfessores((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
        <Header title="Professores" subtitle="Equipe do ministério Kids" />
        <button onClick={() => setModalAberto(true)} style={{ ...btnPrimary, whiteSpace: "nowrap" }}>+ Novo professor</button>
      </div>

      <input
        placeholder="Buscar professor por nome..."
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        style={{ ...inp, marginBottom: 16, maxWidth: 320 }}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtrados.length === 0 && <div style={{ color: "#a39c80", fontSize: 13 }}>Nenhum professor encontrado.</div>}
        {filtrados.map((p) => (
          <Card key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <FotoAvatar foto={p.foto} size={48} />
              <div>
                <div style={{ fontWeight: 600, color: "#2f3b2f", fontSize: 14 }}>{p.nome}</div>
                <div style={{ fontSize: 12.5, color: "#7a7355", marginTop: 2 }}>
                  {p.telefone}{p.email && ` · ${p.email}`}
                </div>
                {p.observacoes && <div style={{ fontSize: 12, color: "#a39c80", marginTop: 3, fontStyle: "italic" }}>{p.observacoes}</div>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <button onClick={() => setEditando(p)} style={{ ...btnGhost, fontSize: 12, padding: "5px 10px" }}>Editar</button>
              <button onClick={() => excluir(p.id)} style={{ ...btnDanger, fontSize: 12, padding: "5px 10px" }}>Excluir</button>
            </div>
          </Card>
        ))}
      </div>

      {modalAberto && <ModalProfessor onSalvar={criarProf} onFechar={() => setModalAberto(false)} />}
      {editando && <ModalProfessor inicial={editando} onSalvar={salvarEdicao} onFechar={() => setEditando(null)} />}
    </div>
  );
}

const navItens = [
  { id: "inicio",   label: "Início",    icone: "⛪" },
  { id: "checkin",  label: "Check-in",  icone: "✅" },
  { id: "kids",     label: "Kids",      icone: "🧒" },
  { id: "agenda",   label: "Agenda",    icone: "📅" },
  { id: "mais",     label: "Mais",      icone: "☰"  },
];

const abasKids = [
  { id: "salas",        label: "Salas" },
  { id: "professores",  label: "Professores" },
  { id: "criancas",     label: "Crianças" },
  { id: "responsaveis", label: "Responsáveis" },
  { id: "relatorios",   label: "Relatórios" },
];

// ── TELA INÍCIO ──────────────────────────────────────────────────

const cultos = [
  { dia: "Domingo", hora: "10h00", nome: "Culto da Família", local: "Templo Principal" },
  { dia: "Quarta",  hora: "19h30", nome: "Culto de Oração",  local: "Templo Principal" },
  { dia: "Sexta",   hora: "20h00", nome: "Culto de Jovens",  local: "Sala Youth" },
];

function TelaInicio({ membro, criancas, setModulo, setTela }) {
  const [humor, setHumor] = useState(null);
  const humores = [
    { id: "bem",      label: "Bem",       icone: "😊" },
    { id: "animado",  label: "Animado",   icone: "🔥" },
    { id: "cansado",  label: "Cansado",   icone: "😴" },
    { id: "triste",   label: "Triste",    icone: "😔" },
  ];

  const hoje = new Date();
  const diasSemana = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
  const diaHoje = diasSemana[hoje.getDay()];
  const cultoHoje = cultos.find((c) => c.dia === diaHoje);

  return (
    <div style={{ background: "#1a2212", minHeight: "100%", color: "#f6f2e7", paddingBottom: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 20px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 46, height: 46, borderRadius: "50%", background: "#4a6630", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700, color: "#d9ead0", flexShrink: 0 }}>
            {membro.charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#9aab84" }}>Bom te ver de novo,</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#f6f2e7" }}>{membro} 🔥</div>
          </div>
        </div>
        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#2f3b2f", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, cursor: "pointer" }}>🔔</div>
      </div>

      {/* Humor */}
      {!humor ? (
        <div style={{ margin: "10px 20px", background: "#2f3b2f", borderRadius: 12, padding: "14px 16px" }}>
          <div style={{ fontSize: 13, color: "#9aab84", marginBottom: 12 }}>Como está se sentindo hoje?</div>
          <div style={{ display: "flex", gap: 10 }}>
            {humores.map((h) => (
              <button key={h.id} onClick={() => setHumor(h.id)} style={{ flex: 1, background: "#3a4d28", border: "none", borderRadius: 10, padding: "10px 4px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <span style={{ fontSize: 22 }}>{h.icone}</span>
                <span style={{ fontSize: 11, color: "#c8d8b0", fontWeight: 600 }}>{h.label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ margin: "10px 20px", background: "#2f3b2f", borderRadius: 12, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "#9aab84" }}>Hoje você está {humores.find((h) => h.id === humor)?.icone} {humores.find((h) => h.id === humor)?.label}</span>
          <button onClick={() => setHumor(null)} style={{ background: "none", border: "none", color: "#6a8f4a", fontSize: 12, cursor: "pointer" }}>Alterar</button>
        </div>
      )}

      {/* Banner destaque */}
      <div style={{ margin: "14px 20px", background: "linear-gradient(135deg, #2a4a18 0%, #4a7a28 100%)", borderRadius: 16, padding: "24px 20px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: 16, top: 10, fontSize: 60, opacity: 0.12 }}>✝</div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#9aab84", letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>Série atual</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: "#f6f2e7", lineHeight: 1.2, marginBottom: 8 }}>Enraizados{"\n"}na Palavra</div>
        <div style={{ fontSize: 12, color: "#9aab84", marginBottom: 16 }}>
          "Aquele que é capaz de fazer infinitamente mais do que tudo o que pedimos ou pensamos." — Ef 3:20a
        </div>
        <button style={{ background: "#6a8f4a", border: "none", borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 700, padding: "8px 18px", cursor: "pointer" }}>Ver pregações</button>
      </div>

      {/* Culto de hoje ou próximo */}
      <div style={{ margin: "0 20px 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#f6f2e7" }}>{cultoHoje ? "Culto hoje" : "Próximos cultos"}</span>
          <span style={{ fontSize: 12, color: "#6a8f4a", cursor: "pointer" }} onClick={() => setModulo("agenda")}>Ver todos ›</span>
        </div>
        {(cultoHoje ? [cultoHoje] : cultos.slice(0, 2)).map((c, i) => (
          <div key={i} style={{ background: "#2f3b2f", borderRadius: 12, padding: "12px 16px", marginBottom: 8, display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ background: "#4a6630", borderRadius: 10, padding: "8px 12px", textAlign: "center", minWidth: 52 }}>
              <div style={{ fontSize: 11, color: "#9aab84", fontWeight: 600 }}>{c.dia.slice(0, 3).toUpperCase()}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#d9ead0" }}>{c.hora}</div>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#f6f2e7" }}>{c.nome}</div>
              <div style={{ fontSize: 12, color: "#9aab84" }}>📍 {c.local}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Kids resumo */}
      {criancas.length > 0 && (
        <div style={{ margin: "0 20px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#f6f2e7" }}>🧒 Kids — hoje</span>
            <span style={{ fontSize: 12, color: "#6a8f4a", cursor: "pointer" }} onClick={() => { setModulo("kids"); setTela("criancas"); }}>Gerenciar ›</span>
          </div>
          <div style={{ background: "#2f3b2f", borderRadius: 12, padding: "14px 16px", display: "flex", gap: 20 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: "#d9ead0" }}>{criancas.filter((c) => c.status === "presente").length}</div>
              <div style={{ fontSize: 11, color: "#9aab84" }}>Presentes</div>
            </div>
            <div style={{ width: 1, background: "#4a6630" }} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: "#f6f2e7" }}>{criancas.length}</div>
              <div style={{ fontSize: 11, color: "#9aab84" }}>Cadastradas</div>
            </div>
            <div style={{ width: 1, background: "#4a6630" }} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: "#c25b2f" }}>{criancas.filter((c) => c.status === "fora").length}</div>
              <div style={{ fontSize: 11, color: "#9aab84" }}>Aguardando</div>
            </div>
          </div>
        </div>
      )}

      {/* Edificação */}
      <div style={{ margin: "0 20px" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#f6f2e7", marginBottom: 10 }}>Para sua edificação</div>
        <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 4 }}>
          {[
            { titulo: "Quebrando Ciclos", subtitulo: "Restaurando vidas", icone: "🔗" },
            { titulo: "A Fé que Move", subtitulo: "Série Hebreus 11",   icone: "⛰️" },
            { titulo: "Família no Altar", subtitulo: "Série especial",    icone: "🏠" },
          ].map((item, i) => (
            <div key={i} style={{ minWidth: 150, background: "#2f3b2f", borderRadius: 12, padding: "16px 14px", cursor: "pointer", flexShrink: 0 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>{item.icone}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#f6f2e7" }}>{item.titulo}</div>
              <div style={{ fontSize: 11, color: "#9aab84", marginTop: 3 }}>{item.subtitulo}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [criancas, setCriancas] = useState([]);
  const [salas, setSalas] = useState([]);
  const [professores, setProfessores] = useState([]);
  const [responsaveis, setResponsaveis] = useState([]);
  const [aulas, setAulas] = useState([]);
  const [filiacoes, setFiliacoes] = useState(initialFiliacoes);
  const [carregando, setCarregando] = useState(true);
  const [erroDb, setErroDb] = useState("");
  const [perfil, setPerfil] = useState("equipe");

  useEffect(() => {
    fetchTudo()
      .then((dados) => {
        setCriancas(dados.criancas);
        setSalas(dados.salas);
        setProfessores(dados.professores);
        setResponsaveis(dados.responsaveis);
        setAulas(dados.aulas);
      })
      .catch((err) => setErroDb(err.message || "Erro ao conectar ao banco."))
      .finally(() => setCarregando(false));
  }, []);
  const [modulo, setModulo] = useState("inicio");
  const [tela, setTela] = useState("salas");
  const eventoAtivo = "Culto de domingo · 10h";
  const membroNome = "Marbson Tomaz";

  if (carregando) return (
    <div style={{ minHeight: "100vh", background: "#f6f2e7", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Helvetica, Arial, sans-serif" }}>
      <div style={{ textAlign: "center", color: "#7a7355" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>Carregando EklesiaHub...</div>
      </div>
    </div>
  );

  if (erroDb) return (
    <div style={{ minHeight: "100vh", background: "#f6f2e7", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Helvetica, Arial, sans-serif" }}>
      <div style={{ textAlign: "center", color: "#c25b2f", maxWidth: 400, padding: 24 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Erro ao conectar ao banco</div>
        <div style={{ fontSize: 13, color: "#7a7355" }}>{erroDb}</div>
        <div style={{ fontSize: 12, color: "#a39c80", marginTop: 12 }}>Verifique as credenciais no arquivo .env e se o schema foi criado no Supabase.</div>
      </div>
    </div>
  );

  function navegar(id) {
    setModulo(id);
    if (id === "kids") setTela("salas");
  }

  // Conteúdo principal baseado no módulo ativo
  function renderConteudo() {
    if (modulo === "inicio") return <TelaInicio membro={membroNome} criancas={criancas} setModulo={navegar} setTela={setTela} />;
    if (modulo === "checkin") return <div style={{ padding: 28 }}><TelaCheckinEquipe criancas={criancas} setCriancas={setCriancas} responsaveis={responsaveis} eventoAtivo={eventoAtivo} /></div>;
    if (modulo === "agenda") return (
      <div style={{ padding: 28 }}>
        <Header title="Agenda" subtitle="Próximos eventos" />
        {cultos.map((c, i) => (
          <div key={i} style={{ background: "#fff", borderRadius: 12, padding: "14px 18px", marginBottom: 10, display: "flex", gap: 16, alignItems: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
            <div style={{ background: "#d9ead0", borderRadius: 10, padding: "8px 12px", textAlign: "center", minWidth: 52 }}>
              <div style={{ fontSize: 11, color: "#6a8f4a", fontWeight: 700 }}>{c.dia.slice(0, 3).toUpperCase()}</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#2f3b2f" }}>{c.hora}</div>
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#2f3b2f" }}>{c.nome}</div>
              <div style={{ fontSize: 12, color: "#7a7355" }}>📍 {c.local}</div>
            </div>
          </div>
        ))}
      </div>
    );
    if (modulo === "mais") return (
      <div style={{ padding: 28 }}>
        <Header title="Mais" subtitle="Configurações e perfil" />
        <div style={{ background: "#fff", borderRadius: 12, padding: "14px 18px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
          <div style={{ fontSize: 13.5, color: "#2f3b2f", fontWeight: 600, marginBottom: 4 }}>{membroNome}</div>
          <div style={{ fontSize: 12, color: "#7a7355" }}>Membro · Igreja Vila Verde</div>
        </div>
      </div>
    );
    // Kids com sub-abas
    return (
      <div style={{ display: "flex", minHeight: "calc(100vh - 116px)" }}>
        <div style={{ width: 160, background: "#fffdf8", padding: "16px 12px", borderRight: "1px solid #e3dcc8" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#9aab84", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10, paddingLeft: 4 }}>Kids</div>
          {abasKids.map((a) => (
            <div key={a.id} onClick={() => setTela(a.id)}
              style={{ padding: "9px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13.5, marginBottom: 4, background: tela === a.id ? "#eee7d8" : "transparent", fontWeight: tela === a.id ? 700 : 500, color: "#2f3b2f" }}>
              {a.label}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, padding: 28 }}>
          {tela === "salas"        && <TelaSalas criancas={criancas} salas={salas} setSalas={setSalas} professores={professores} aulas={aulas} setAulas={setAulas} eventoAtivo={eventoAtivo} />}
          {tela === "professores"  && <TelaProfessores professores={professores} setProfessores={setProfessores} />}
          {tela === "criancas"     && <TelaCriancas criancas={criancas} setCriancas={setCriancas} responsaveis={responsaveis} salas={salas} />}
          {tela === "responsaveis" && <TelaResponsaveis responsaveis={responsaveis} setResponsaveis={setResponsaveis} filiacoes={filiacoes} setFiliacoes={setFiliacoes} />}
          {tela === "relatorios"   && <TelaRelatorios criancas={criancas} />}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: modulo === "inicio" ? "#1a2212" : "#f6f2e7", fontFamily: "Helvetica, Arial, sans-serif", color: "#2f3b2f", display: "flex", flexDirection: "column" }}>

      {/* Conteúdo principal */}
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 66 }}>
        {perfil === "equipe" ? renderConteudo() : (
          <div style={{ padding: 28 }}>
            <AppPais criancas={criancas} setCriancas={setCriancas} eventoAtivo={eventoAtivo} />
          </div>
        )}
      </div>

      {/* Bottom navigation */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: 64, background: "#1a2212", borderTop: "1px solid #2f3b2f", display: "flex", zIndex: 100 }}>
        {navItens.map((n) => {
          const ativo = modulo === n.id;
          return (
            <div key={n.id} onClick={() => navegar(n.id)}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", gap: 3, transition: "opacity 0.15s" }}>
              <div style={{ fontSize: 22, lineHeight: 1 }}>{n.icone}</div>
              <div style={{ fontSize: 10, fontWeight: ativo ? 700 : 500, color: ativo ? "#d9ead0" : "#6a7a5a" }}>{n.label}</div>
              {ativo && <div style={{ position: "absolute", bottom: 0, width: 32, height: 3, background: "#6a8f4a", borderRadius: "3px 3px 0 0" }} />}
            </div>
          );
        })}
        {/* Toggle perfil discreto no canto */}
        <div style={{ position: "absolute", top: -38, right: 12, display: "flex", gap: 4 }}>
          <button onClick={() => setPerfil("equipe")} style={{ ...toggleBtn, fontSize: 11, padding: "4px 8px", ...(perfil === "equipe" ? toggleBtnActive : {}) }}>Equipe</button>
          <button onClick={() => setPerfil("pais")}   style={{ ...toggleBtn, fontSize: 11, padding: "4px 8px", ...(perfil === "pais"   ? toggleBtnActive : {}) }}>Pais</button>
        </div>
      </div>
    </div>
  );
}

const toggleBtn = { background: "transparent", color: "#cfc8ad", border: "1px solid #4a554a", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, cursor: "pointer" };
const toggleBtnActive = { background: "#6a8f4a", color: "#fff", border: "1px solid #6a8f4a" };
