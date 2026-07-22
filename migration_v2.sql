-- Migration v2 — EklesiaHub
-- Adiciona campo identificador na tabela salas
ALTER TABLE salas ADD COLUMN IF NOT EXISTS identificador TEXT DEFAULT '';

-- Adiciona campo codigo na tabela aulas
ALTER TABLE aulas ADD COLUMN IF NOT EXISTS codigo TEXT UNIQUE;

-- Adiciona campo periodo na tabela aulas
ALTER TABLE aulas ADD COLUMN IF NOT EXISTS periodo TEXT NOT NULL DEFAULT 'Manhã';

-- Adiciona campos de recorrência na tabela aulas
ALTER TABLE aulas ADD COLUMN IF NOT EXISTS recorrente BOOLEAN DEFAULT FALSE;
ALTER TABLE aulas ADD COLUMN IF NOT EXISTS dias_semana TEXT[] DEFAULT '{}';

-- Permite data nula (aulas recorrentes não têm data fixa)
ALTER TABLE aulas ALTER COLUMN data DROP NOT NULL;
