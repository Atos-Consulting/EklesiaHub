import { supabase } from "./supabase";

// ── Mapeadores: DB → formato do app ──────────────────────────────

const mapCrianca = (row, relacoes = []) => ({
  id: row.id,
  codigo: row.codigo,
  nome: row.nome,
  nascimento: row.nascimento,
  turma: row.turma,
  alergia: row.alergia,
  foto: row.foto_url || "",
  status: row.status,
  sala: row.sala_atual,
  responsaveisIds: relacoes.filter((r) => r.crianca_id === row.id).map((r) => r.responsavel_id),
});

const mapResponsavel = (row) => ({
  id: row.id,
  nome: row.nome,
  filiacao: row.tipo,
  tipoDocumento: row.tipo_doc,
  documento: row.documento,
  telefone: row.telefone || "",
  email: row.email || "",
  dataNascimento: row.nascimento || "",
  sexo: row.sexo,
  observacoes: row.observacoes || "",
  foto: row.foto_url || "",
});

const mapProfessor = (row) => ({
  id: row.id,
  nome: row.nome,
  telefone: row.telefone || "",
  email: row.email || "",
  observacoes: row.observacoes || "",
  foto: row.foto_url || "",
});

const mapSala = (row) => ({
  id: row.id,
  identificador: row.identificador || "",
  nome: row.nome,
  idadeInicial: row.idade_inicial,
  idadeFinal: row.idade_final,
  capacidade: row.capacidade,
  observacoes: row.observacoes || "",
});

// ── FETCH (carregamento inicial) ──────────────────────────────────

export async function fetchTudo() {
  const [
    { data: responsaveis, error: e1 },
    { data: criancas, error: e2 },
    { data: relacoes, error: e3 },
    { data: professores, error: e4 },
    { data: salas, error: e5 },
    { data: aulas, error: e6 },
    { data: aulaProf, error: e7 },
  ] = await Promise.all([
    supabase.from("responsaveis").select("*").order("nome"),
    supabase.from("criancas").select("*").order("codigo"),
    supabase.from("crianca_responsavel").select("*"),
    supabase.from("professores").select("*").order("nome"),
    supabase.from("salas").select("*").order("id"),
    supabase.from("aulas").select("*").order("data"),
    supabase.from("aula_professor").select("*"),
  ]);

  const erros = [e1, e2, e3, e4, e5, e6, e7].filter(Boolean);
  if (erros.length) throw erros[0];

  return {
    responsaveis: responsaveis.map(mapResponsavel),
    criancas: criancas.map((c) => mapCrianca(c, relacoes)),
    professores: professores.map(mapProfessor),
    salas: salas.map(mapSala),
    aulas: aulas.map((a) => ({
      id: a.id,
      codigo: a.codigo || "",
      salaId: a.sala_id,
      salaNome: salas.find((s) => s.id === a.sala_id)?.nome || "",
      data: a.data,
      periodo: a.periodo || "Manhã",
      recorrente: a.recorrente || false,
      diasSemana: a.dias_semana || [],
      professoresIds: aulaProf.filter((r) => r.aula_id === a.id).map((r) => r.professor_id),
    })),
  };
}

// ── CRIANÇAS ────────────────────────────────────────────────────

export async function dbCriarCrianca(dados) {
  const { data, error } = await supabase.from("criancas").insert({
    codigo: dados.codigo,
    nome: dados.nome,
    nascimento: dados.nascimento || null,
    turma: dados.turma,
    alergia: dados.alergia,
    foto_url: dados.foto || "",
    status: "fora",
    sala_atual: null,
  }).select().single();
  if (error) throw error;

  if (dados.responsaveisIds?.length) {
    await supabase.from("crianca_responsavel").insert(
      dados.responsaveisIds.map((rid) => ({ crianca_id: data.id, responsavel_id: rid }))
    );
  }
  return mapCrianca(data, (dados.responsaveisIds || []).map((rid) => ({ crianca_id: data.id, responsavel_id: rid })));
}

export async function dbAtualizarCrianca(id, dados) {
  const { error } = await supabase.from("criancas").update({
    nome: dados.nome,
    nascimento: dados.nascimento || null,
    turma: dados.turma,
    alergia: dados.alergia,
    foto_url: dados.foto || "",
  }).eq("id", id);
  if (error) throw error;

  await supabase.from("crianca_responsavel").delete().eq("crianca_id", id);
  if (dados.responsaveisIds?.length) {
    await supabase.from("crianca_responsavel").insert(
      dados.responsaveisIds.map((rid) => ({ crianca_id: id, responsavel_id: rid }))
    );
  }
}

export async function dbExcluirCrianca(id) {
  const { error } = await supabase.from("criancas").delete().eq("id", id);
  if (error) throw error;
}

export async function dbAtualizarStatusCrianca(id, status, salaAtual) {
  // Usa a função checkin_crianca (SECURITY DEFINER) em vez de UPDATE direto porque
  // o check-in dos pais roda sem login — a função só altera status/sala_atual.
  const { error } = await supabase.rpc("checkin_crianca", { p_id: id, p_status: status, p_sala: salaAtual });
  if (error) throw error;
}

// ── APP DOS PAIS (sem login) ──────────────────────────────────────
// Usa as views públicas em vez das tabelas reais: elas não expõem CPF,
// telefone, e-mail, alergia, data de nascimento ou foto de todo mundo
// para quem só tem a chave anon.

export async function fetchPais() {
  const [
    { data: responsaveis, error: e1 },
    { data: criancas, error: e2 },
    { data: relacoes, error: e3 },
  ] = await Promise.all([
    supabase.from("responsaveis_publico").select("*").order("nome"),
    supabase.from("criancas_publico").select("*").order("codigo"),
    supabase.from("crianca_responsavel").select("*"),
  ]);

  const erros = [e1, e2, e3].filter(Boolean);
  if (erros.length) throw erros[0];

  return {
    responsaveis: responsaveis.map((r) => ({ id: r.id, nome: r.nome, filiacao: r.filiacao, foto: r.foto_url || "" })),
    criancas: criancas.map((c) => ({
      id: c.id,
      codigo: c.codigo,
      nome: c.nome,
      turma: c.turma,
      status: c.status,
      responsaveisIds: relacoes.filter((r) => r.crianca_id === c.id).map((r) => r.responsavel_id),
    })),
  };
}

// ── RESPONSÁVEIS ─────────────────────────────────────────────────

export async function dbCriarResponsavel(dados) {
  const { data, error } = await supabase.from("responsaveis").insert({
    nome: dados.nome,
    tipo: dados.filiacao,
    tipo_doc: dados.tipoDocumento,
    documento: dados.documento,
    telefone: dados.telefone || "",
    email: dados.email || "",
    nascimento: dados.dataNascimento || null,
    sexo: dados.sexo,
    observacoes: dados.observacoes || "",
    foto_url: dados.foto || "",
  }).select().single();
  if (error) throw error;
  return mapResponsavel(data);
}

export async function dbAtualizarResponsavel(id, dados) {
  const { error } = await supabase.from("responsaveis").update({
    nome: dados.nome,
    tipo: dados.filiacao,
    tipo_doc: dados.tipoDocumento,
    documento: dados.documento,
    telefone: dados.telefone || "",
    email: dados.email || "",
    nascimento: dados.dataNascimento || null,
    sexo: dados.sexo,
    observacoes: dados.observacoes || "",
    foto_url: dados.foto || "",
  }).eq("id", id);
  if (error) throw error;
}

export async function dbExcluirResponsavel(id) {
  const { error } = await supabase.from("responsaveis").delete().eq("id", id);
  if (error) throw error;
}

// ── PROFESSORES ──────────────────────────────────────────────────

export async function dbCriarProfessor(dados) {
  const { data, error } = await supabase.from("professores").insert({
    nome: dados.nome,
    telefone: dados.telefone || "",
    email: dados.email || "",
    observacoes: dados.observacoes || "",
    foto_url: dados.foto || "",
  }).select().single();
  if (error) throw error;
  return mapProfessor(data);
}

export async function dbAtualizarProfessor(id, dados) {
  const { error } = await supabase.from("professores").update({
    nome: dados.nome,
    telefone: dados.telefone || "",
    email: dados.email || "",
    observacoes: dados.observacoes || "",
    foto_url: dados.foto || "",
  }).eq("id", id);
  if (error) throw error;
}

export async function dbExcluirProfessor(id) {
  const { error } = await supabase.from("professores").delete().eq("id", id);
  if (error) throw error;
}

// ── SALAS ────────────────────────────────────────────────────────

export async function dbCriarSala(dados) {
  const { data, error } = await supabase.from("salas").insert({
    identificador: dados.identificador || "",
    nome: dados.nome,
    idade_inicial: dados.idadeInicial,
    idade_final: dados.idadeFinal,
    capacidade: dados.capacidade,
    observacoes: dados.observacoes || "",
  }).select().single();
  if (error) throw error;
  return mapSala(data);
}

export async function dbAtualizarSala(id, dados) {
  const { error } = await supabase.from("salas").update({
    identificador: dados.identificador || "",
    nome: dados.nome,
    idade_inicial: dados.idadeInicial,
    idade_final: dados.idadeFinal,
    capacidade: dados.capacidade,
    observacoes: dados.observacoes || "",
  }).eq("id", id);
  if (error) throw error;
}

export async function dbExcluirSala(id) {
  const { error } = await supabase.from("salas").delete().eq("id", id);
  if (error) throw error;
}

// ── AULAS ────────────────────────────────────────────────────────

export async function dbCriarAula(dados) {
  const { data, error } = await supabase.from("aulas").insert({
    codigo: dados.codigo,
    sala_id: dados.salaId,
    data: dados.data || null,
    periodo: dados.periodo,
    recorrente: dados.recorrente || false,
    dias_semana: dados.diasSemana || [],
  }).select().single();
  if (error) throw error;

  if (dados.professoresIds?.length) {
    await supabase.from("aula_professor").insert(
      dados.professoresIds.map((pid) => ({ aula_id: data.id, professor_id: pid }))
    );
  }
  return { id: data.id, codigo: data.codigo, salaId: data.sala_id, salaNome: dados.salaNome, data: data.data, periodo: data.periodo, recorrente: data.recorrente, diasSemana: data.dias_semana || [], professoresIds: dados.professoresIds || [] };
}

export async function dbExcluirAula(id) {
  const { error } = await supabase.from("aulas").delete().eq("id", id);
  if (error) throw error;
}
