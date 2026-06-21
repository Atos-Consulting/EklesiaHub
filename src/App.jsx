import React, { useState, useMemo } from "react";

const initialCriancas = [
  { id: 1, nome: "Lucas Andrade", nascimento: "2021-03-12", turma: "Maternal", responsavel: "Marina Andrade", alergia: "Nenhuma", sala: null, status: "fora" },
  { id: 2, nome: "Sofia Ribeiro", nascimento: "2019-07-02", turma: "Jardim", responsavel: "Carlos Ribeiro", alergia: "Amendoim", sala: null, status: "fora" },
  { id: 3, nome: "Davi Souza", nascimento: "2017-11-20", turma: "Juniores", responsavel: "Marina Andrade", alergia: "Nenhuma", sala: null, status: "fora" },
  { id: 4, nome: "Helena Costa", nascimento: "2022-01-15", turma: "Berçário", responsavel: "Patrícia Costa", alergia: "Lactose", sala: null, status: "fora" },
];

const salasConfig = [
  { nome: "Berçário", faixa: "0-1 ano", capacidade: 8 },
  { nome: "Maternal", faixa: "2-3 anos", capacidade: 12 },
  { nome: "Jardim", faixa: "4-6 anos", capacidade: 15 },
  { nome: "Juniores", faixa: "7-10 anos", capacidade: 20 },
];

function calcularTurma(nascimento) {
  const idade = Math.floor((Date.now() - new Date(nascimento)) / (365.25 * 24 * 3600 * 1000));
  if (idade <= 1) return "Berçário";
  if (idade <= 3) return "Maternal";
  if (idade <= 6) return "Jardim";
  return "Juniores";
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

function TelaSalas({ criancas, eventoAtivo }) {
  return (
    <div>
      <Header title="Salas e turmas" subtitle={`Ocupação em tempo real — ${eventoAtivo}`} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
        {salasConfig.map((sala) => {
          const presentes = criancas.filter((c) => c.sala === sala.nome && c.status === "presente");
          const ocupacao = presentes.length / sala.capacidade;
          return (
            <Card key={sala.nome}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <strong style={{ color: "#2f3b2f" }}>{sala.nome}</strong>
                <span style={{ fontSize: 12, color: "#7a7355" }}>{sala.faixa}</span>
              </div>
              <div style={{ margin: "10px 0 6px", fontSize: 13, color: "#5b5436" }}>
                {presentes.length} / {sala.capacidade} crianças
              </div>
              <div style={{ height: 6, background: "#eee7d8", borderRadius: 4, overflow: "hidden" }}>
                <div style={{
                  height: "100%", width: `${Math.min(ocupacao * 100, 100)}%`,
                  background: ocupacao > 0.85 ? "#c25b2f" : "#6a8f4a",
                }} />
              </div>
              <ul style={{ margin: "10px 0 0", paddingLeft: 16, fontSize: 12.5, color: "#444" }}>
                {presentes.length === 0 && <li style={{ color: "#a39c80" }}>Nenhuma criança ainda</li>}
                {presentes.map((c) => (
                  <li key={c.id} style={{ marginBottom: 3 }}>
                    {c.nome} {c.alergia !== "Nenhuma" && <Pill tone="warn">{c.alergia}</Pill>}
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function TelaCheckinEquipe({ criancas, setCriancas, eventoAtivo }) {
  const [busca, setBusca] = useState("");
  const filtradas = criancas.filter((c) => c.nome.toLowerCase().includes(busca.toLowerCase()));

  function fazerCheckin(id) {
    setCriancas((prev) => prev.map((c) => (c.id === id ? { ...c, status: "presente", sala: c.turma } : c)));
  }
  function fazerCheckout(id) {
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
                Turma: {c.turma} · Responsável: {c.responsavel}
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

function TelaCadastro({ criancas, setCriancas }) {
  const [form, setForm] = useState({ nome: "", nascimento: "", responsavel: "", alergia: "Nenhuma" });
  const turmaSugerida = form.nascimento ? calcularTurma(form.nascimento) : "—";

  function salvar() {
    if (!form.nome || !form.nascimento || !form.responsavel) return;
    setCriancas((prev) => [
      ...prev,
      { id: Date.now(), ...form, turma: turmaSugerida, sala: null, status: "fora" },
    ]);
    setForm({ nome: "", nascimento: "", responsavel: "", alergia: "Nenhuma" });
  }

  return (
    <div>
      <Header title="Cadastro de criança" subtitle="A turma é sugerida automaticamente pela idade" />
      <Card style={{ maxWidth: 420 }}>
        <label style={lbl}>Nome completo</label>
        <input style={inp} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
        <label style={lbl}>Data de nascimento</label>
        <input type="date" style={inp} value={form.nascimento} onChange={(e) => setForm({ ...form, nascimento: e.target.value })} />
        <label style={lbl}>Responsável</label>
        <input style={inp} value={form.responsavel} onChange={(e) => setForm({ ...form, responsavel: e.target.value })} />
        <label style={lbl}>Alergia / restrição</label>
        <input style={inp} value={form.alergia} onChange={(e) => setForm({ ...form, alergia: e.target.value })} />
        <div style={{ margin: "10px 0 16px", fontSize: 12.5, color: "#7a7355" }}>
          Turma sugerida: <Pill>{turmaSugerida}</Pill>
        </div>
        <button onClick={salvar} style={btnPrimary}>Salvar cadastro</button>
      </Card>
      <div style={{ marginTop: 20, fontSize: 13, color: "#7a7355" }}>{criancas.length} crianças cadastradas no total</div>
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
const statValue = { fontSize: 26, fontWeight: 700, color: "#2f3b2f", marginTop: 4 };

export default function App() {
  const [criancas, setCriancas] = useState(initialCriancas);
  const [perfil, setPerfil] = useState("equipe");
  const [tela, setTela] = useState("checkin");
  const eventoAtivo = "Culto de domingo · 10h";

  const abas = [
    { id: "checkin", label: "Check-in" },
    { id: "salas", label: "Salas" },
    { id: "cadastro", label: "Cadastro" },
    { id: "relatorios", label: "Relatórios" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#f6f2e7", fontFamily: "Helvetica, Arial, sans-serif", color: "#2f3b2f" }}>
      <div style={{ background: "#2f3b2f", padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ color: "#f6f2e7", fontSize: 15 }}>EklesiaHub</strong>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setPerfil("equipe")}
            style={{ ...toggleBtn, ...(perfil === "equipe" ? toggleBtnActive : {}) }}
          >App da equipe</button>
          <button
            onClick={() => setPerfil("pais")}
            style={{ ...toggleBtn, ...(perfil === "pais" ? toggleBtnActive : {}) }}
          >App dos pais</button>
        </div>
      </div>

      {perfil === "equipe" ? (
        <div style={{ display: "flex" }}>
          <div style={{ width: 170, background: "#fffdf8", minHeight: "calc(100vh - 50px)", padding: 16, borderRight: "1px solid #e3dcc8" }}>
            {abas.map((a) => (
              <div
                key={a.id}
                onClick={() => setTela(a.id)}
                style={{
                  padding: "9px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13.5, marginBottom: 4,
                  background: tela === a.id ? "#eee7d8" : "transparent",
                  fontWeight: tela === a.id ? 700 : 500,
                  color: "#2f3b2f",
                }}
              >
                {a.label}
              </div>
            ))}
          </div>
          <div style={{ flex: 1, padding: 28 }}>
            {tela === "checkin" && <TelaCheckinEquipe criancas={criancas} setCriancas={setCriancas} eventoAtivo={eventoAtivo} />}
            {tela === "salas" && <TelaSalas criancas={criancas} eventoAtivo={eventoAtivo} />}
            {tela === "cadastro" && <TelaCadastro criancas={criancas} setCriancas={setCriancas} />}
            {tela === "relatorios" && <TelaRelatorios criancas={criancas} />}
          </div>
        </div>
      ) : (
        <div style={{ padding: 28 }}>
          <AppPais criancas={criancas} setCriancas={setCriancas} eventoAtivo={eventoAtivo} />
        </div>
      )}
    </div>
  );
}

const toggleBtn = { background: "transparent", color: "#cfc8ad", border: "1px solid #4a554a", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, cursor: "pointer" };
const toggleBtnActive = { background: "#6a8f4a", color: "#fff", border: "1px solid #6a8f4a" };
