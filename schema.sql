-- EklesiaHub - Schema inicial

CREATE TABLE responsaveis (
  id          SERIAL PRIMARY KEY,
  nome        TEXT NOT NULL,
  tipo        TEXT,
  tipo_doc    TEXT DEFAULT 'CPF',
  documento   TEXT,
  telefone    TEXT,
  email       TEXT,
  nascimento  DATE,
  sexo        TEXT,
  observacoes TEXT,
  foto_url    TEXT,
  criado_em   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE criancas (
  id          SERIAL PRIMARY KEY,
  codigo      TEXT UNIQUE,
  nome        TEXT NOT NULL,
  nascimento  DATE,
  turma       TEXT,
  alergia     TEXT DEFAULT 'Nenhuma',
  foto_url    TEXT,
  status      TEXT DEFAULT 'fora',
  sala_atual  TEXT,
  criado_em   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE crianca_responsavel (
  crianca_id     INT REFERENCES criancas(id) ON DELETE CASCADE,
  responsavel_id INT REFERENCES responsaveis(id) ON DELETE CASCADE,
  PRIMARY KEY (crianca_id, responsavel_id)
);

CREATE TABLE professores (
  id          SERIAL PRIMARY KEY,
  nome        TEXT NOT NULL,
  telefone    TEXT,
  email       TEXT,
  observacoes TEXT,
  foto_url    TEXT,
  criado_em   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE salas (
  id            SERIAL PRIMARY KEY,
  identificador TEXT,
  nome          TEXT NOT NULL,
  idade_inicial INT,
  idade_final   INT,
  capacidade    INT,
  observacoes   TEXT,
);

CREATE TABLE aulas (
  id        SERIAL PRIMARY KEY,
  codigo    TEXT UNIQUE,
  sala_id   INT REFERENCES salas(id) ON DELETE CASCADE,
  data      DATE,
  periodo     TEXT NOT NULL DEFAULT 'Manhã',
  recorrente  BOOLEAN DEFAULT FALSE,
  dias_semana TEXT[] DEFAULT '{}',
  criado_em TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE aula_professor (
  aula_id      INT REFERENCES aulas(id) ON DELETE CASCADE,
  professor_id INT REFERENCES professores(id) ON DELETE CASCADE,
  PRIMARY KEY (aula_id, professor_id)
);
