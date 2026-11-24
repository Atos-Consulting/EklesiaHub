-- Migration v4 — EklesiaHub ERP (Fase 0 mínima + Administrativo / Entrada de notas)
--
-- Pré-requisito: migration_v3.sql (RLS do app Kids).
--
-- O que entra aqui:
--  1. Papéis por usuário (profiles) e funções de checagem usadas pelas policies.
--  2. Cadastros-base compartilhados: pessoas, plano de contas, centros de custo, fundos.
--  3. Entrada de notas (documentos_entrada + itens + anexos) com regras de integridade no banco.
--  4. Bucket privado de anexos no Storage.
--
-- AVISO: o plano de contas semeado abaixo é só um ponto de partida de exemplo.
-- Deve ser revisado/ajustado pelo contador responsável antes do uso real.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Papéis
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE profiles (
  user_id   uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  papel     text NOT NULL DEFAULT 'kids'
            CHECK (papel IN ('admin', 'financeiro', 'contador', 'comercial', 'kids')),
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION meu_papel() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT papel FROM profiles WHERE user_id = auth.uid()
$$;

CREATE FUNCTION tem_papel(VARIADIC papeis text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(meu_papel() = ANY (papeis), false)
$$;

REVOKE EXECUTE ON FUNCTION meu_papel() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION tem_papel(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION meu_papel() TO authenticated;
GRANT EXECUTE ON FUNCTION tem_papel(text[]) TO authenticated;

-- Cada usuário lê o próprio papel; só admin lê todos e altera papéis.
-- Ninguém insere/deleta direto: o perfil nasce pelo trigger abaixo.
CREATE POLICY profiles_select ON profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR tem_papel('admin'));
CREATE POLICY profiles_update ON profiles FOR UPDATE TO authenticated
  USING (tem_papel('admin')) WITH CHECK (tem_papel('admin'));

-- Toda conta nova nasce com o papel de menor privilégio.
CREATE FUNCTION handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO profiles (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Contas que já existem entram como 'kids' (menor privilégio).
INSERT INTO profiles (user_id) SELECT id FROM auth.users ON CONFLICT DO NOTHING;

-- >>> PASSO MANUAL: promova a sua conta a admin (troque o e-mail) e rode:
-- UPDATE profiles SET papel = 'admin'
--  WHERE user_id = (SELECT id FROM auth.users WHERE email = 'seu-email@igreja.com');

-- Mantém atualizado_em em qualquer tabela que tenha essa coluna.
CREATE FUNCTION set_atualizado_em() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Cadastros-base
-- ─────────────────────────────────────────────────────────────────────

-- Cadastro único de pessoas (fornecedor, cliente, doador, membro...).
CREATE TABLE pessoas (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo_pessoa   text NOT NULL CHECK (tipo_pessoa IN ('PF', 'PJ')),
  nome          text NOT NULL CHECK (length(btrim(nome)) > 0),
  documento     text,  -- sem máscara: CPF (11 dígitos) ou CNPJ (14; numérico ou alfanumérico)
  email         text,
  telefone      text,
  observacoes   text,
  papeis        text[] NOT NULL DEFAULT '{}'
                CHECK (papeis <@ ARRAY['fornecedor', 'cliente', 'doador', 'membro']),
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (
    documento IS NULL
    OR (tipo_pessoa = 'PF' AND documento ~ '^[0-9]{11}$')
    -- CNPJ alfanumérico (a partir de 2026): 12 posições [0-9A-Z] + 2 dígitos verificadores
    OR (tipo_pessoa = 'PJ' AND documento ~ '^[0-9A-Z]{12}[0-9]{2}$')
  )
);
CREATE UNIQUE INDEX pessoas_documento_uq ON pessoas (documento) WHERE documento IS NOT NULL;
CREATE TRIGGER pessoas_atualizado BEFORE UPDATE ON pessoas
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

CREATE TABLE plano_contas (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo    text NOT NULL UNIQUE,
  nome      text NOT NULL,
  natureza  text NOT NULL
            CHECK (natureza IN ('ativo', 'passivo', 'patrimonio_social', 'receita', 'despesa')),
  analitica boolean NOT NULL DEFAULT true,  -- só contas analíticas recebem lançamento
  pai_id    bigint REFERENCES plano_contas(id),
  ativo     boolean NOT NULL DEFAULT true
);

CREATE TABLE centros_custo (
  id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome  text NOT NULL UNIQUE,
  ativo boolean NOT NULL DEFAULT true
);

-- Fundos: recursos restritos (ex.: campanha de construção) x livres.
CREATE TABLE fundos (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome     text NOT NULL UNIQUE,
  restrito boolean NOT NULL DEFAULT false,
  ativo    boolean NOT NULL DEFAULT true
);

-- Sementes de exemplo (revisar com o contador)
INSERT INTO centros_custo (nome) VALUES
  ('Administração'), ('Kids'), ('Louvor'), ('Missões'), ('Manutenção'), ('Livraria e Bazar');

INSERT INTO fundos (nome, restrito) VALUES ('Geral', false);

INSERT INTO plano_contas (codigo, nome, natureza, analitica) VALUES
  ('1',     'ATIVO',                         'ativo',             false),
  ('1.1',   'Ativo Circulante',              'ativo',             false),
  ('1.1.01','Caixa',                         'ativo',             true),
  ('1.1.02','Bancos conta movimento',        'ativo',             true),
  ('1.1.03','Estoques (livraria e bazar)',   'ativo',             true),
  ('1.2',   'Ativo Não Circulante',          'ativo',             false),
  ('1.2.01','Imobilizado',                   'ativo',             true),
  ('2',     'PASSIVO',                       'passivo',           false),
  ('2.1',   'Passivo Circulante',            'passivo',           false),
  ('2.1.01','Fornecedores a pagar',          'passivo',           true),
  ('2.1.02','Obrigações trabalhistas e tributárias', 'passivo',   true),
  ('3',     'PATRIMÔNIO SOCIAL',             'patrimonio_social', false),
  ('3.1',   'Patrimônio Social',             'patrimonio_social', true),
  ('3.2',   'Superávit/Déficit do exercício','patrimonio_social', true),
  ('4',     'RECEITAS',                      'receita',           false),
  ('4.1',   'Contribuições',                 'receita',           false),
  ('4.1.01','Dízimos',                       'receita',           true),
  ('4.1.02','Ofertas',                       'receita',           true),
  ('4.1.03','Campanhas e doações',           'receita',           true),
  ('4.2',   'Receitas comerciais',           'receita',           false),
  ('4.2.01','Vendas livraria e bazar',       'receita',           true),
  ('5',     'DESPESAS',                      'despesa',           false),
  ('5.1',   'Despesas administrativas',      'despesa',           false),
  ('5.1.01','Água, luz e telefone',          'despesa',           true),
  ('5.1.02','Material de escritório e limpeza','despesa',         true),
  ('5.1.03','Serviços de terceiros',         'despesa',           true),
  ('5.1.04','Manutenção e reparos',          'despesa',           true),
  ('5.2',   'Despesas com pessoal',          'despesa',           false),
  ('5.2.01','Prebendas e salários',          'despesa',           true),
  ('5.3',   'Despesas ministeriais',         'despesa',           false),
  ('5.3.01','Eventos e ministérios',         'despesa',           true),
  ('5.3.02','Missões e ação social',         'despesa',           true),
  ('5.4',   'Custo das mercadorias vendidas','despesa',           true);

UPDATE plano_contas c SET pai_id = p.id
  FROM plano_contas p
 WHERE c.codigo LIKE '%.%'
   AND p.codigo = regexp_replace(c.codigo, '\.[^.]+$', '');
UPDATE plano_contas c SET pai_id = NULL WHERE codigo NOT LIKE '%.%';

-- ─────────────────────────────────────────────────────────────────────
-- 3. Entrada de notas
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE documentos_entrada (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo                text NOT NULL CHECK (tipo IN ('nfe', 'nfse', 'recibo', 'fatura', 'outro')),
  numero              text NOT NULL CHECK (length(btrim(numero)) > 0),
  serie               text NOT NULL DEFAULT '',
  -- 44 posições; com CNPJ alfanumérico do emitente a chave também pode conter letras
  chave_acesso        text CHECK (chave_acesso IS NULL OR chave_acesso ~ '^[0-9A-Z]{44}$'),
  fornecedor_id       bigint NOT NULL REFERENCES pessoas(id),
  data_emissao        date NOT NULL,
  data_entrada        date NOT NULL DEFAULT current_date,
  valor_total         numeric(15,2) NOT NULL CHECK (valor_total > 0),
  centro_custo_id     bigint REFERENCES centros_custo(id),
  fundo_id            bigint REFERENCES fundos(id),
  observacoes         text,
  -- 'lancada' fica reservado: será usado quando o módulo Contábil existir
  status              text NOT NULL DEFAULT 'rascunho'
                      CHECK (status IN ('rascunho', 'aprovada', 'lancada', 'cancelada')),
  motivo_cancelamento text,
  criado_por          uuid DEFAULT auth.uid(),
  aprovado_por        uuid,
  aprovado_em         timestamptz,
  cancelado_por       uuid,
  cancelado_em        timestamptz,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  CHECK (data_entrada >= data_emissao),
  CHECK (status <> 'cancelada' OR length(btrim(coalesce(motivo_cancelamento, ''))) > 0)
);

-- Impede lançar a mesma nota duas vezes (notas canceladas não contam).
CREATE UNIQUE INDEX documentos_entrada_nota_uq
  ON documentos_entrada (fornecedor_id, tipo, serie, numero) WHERE status <> 'cancelada';
CREATE UNIQUE INDEX documentos_entrada_chave_uq
  ON documentos_entrada (chave_acesso) WHERE chave_acesso IS NOT NULL AND status <> 'cancelada';
CREATE INDEX documentos_entrada_status_idx ON documentos_entrada (status, data_entrada DESC);

CREATE TABLE documento_entrada_itens (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  documento_id    bigint NOT NULL REFERENCES documentos_entrada(id) ON DELETE CASCADE,
  descricao       text NOT NULL CHECK (length(btrim(descricao)) > 0),
  quantidade      numeric(15,4) NOT NULL CHECK (quantidade > 0),
  valor_unitario  numeric(15,4) NOT NULL CHECK (valor_unitario >= 0),
  valor_total     numeric(15,2) NOT NULL CHECK (valor_total >= 0),
  conta_id        bigint NOT NULL REFERENCES plano_contas(id),
  centro_custo_id bigint REFERENCES centros_custo(id)
);
CREATE INDEX documento_entrada_itens_doc_idx ON documento_entrada_itens (documento_id);

CREATE TABLE documento_anexos (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  documento_id  bigint NOT NULL REFERENCES documentos_entrada(id) ON DELETE CASCADE,
  caminho       text NOT NULL UNIQUE,  -- caminho do objeto no bucket notas-anexos
  nome_arquivo  text NOT NULL,
  tipo_mime     text,
  tamanho       bigint,
  enviado_por   uuid DEFAULT auth.uid(),
  criado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documento_anexos_doc_idx ON documento_anexos (documento_id);

-- Regras de ciclo de vida da nota:
--  rascunho  -> editável livremente; pode ir para aprovada ou cancelada
--  aprovada  -> imutável (nenhum campo muda), só pode ser cancelada com motivo
--  cancelada -> final
--  lancada   -> reservado ao módulo Contábil (bloqueado por enquanto)
CREATE FUNCTION documentos_entrada_regras() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  soma numeric(15,2);
  qtd  integer;
  ignorar text[] := ARRAY['status', 'motivo_cancelamento', 'cancelado_por', 'cancelado_em',
                          'aprovado_por', 'aprovado_em', 'atualizado_em'];
BEGIN
  IF NEW.status = 'lancada' THEN
    RAISE EXCEPTION 'Status "lancada" ainda não está disponível (depende do módulo Contábil).';
  END IF;

  IF OLD.status IN ('cancelada', 'lancada') THEN
    RAISE EXCEPTION 'Nota % não pode mais ser alterada.', OLD.status;
  END IF;

  IF OLD.status = 'aprovada' THEN
    IF NEW.status <> 'cancelada' THEN
      RAISE EXCEPTION 'Nota aprovada é imutável; só pode ser cancelada (com motivo).';
    END IF;
    IF (to_jsonb(NEW) - ignorar) IS DISTINCT FROM (to_jsonb(OLD) - ignorar) THEN
      RAISE EXCEPTION 'Ao cancelar uma nota aprovada, nenhum outro campo pode ser alterado.';
    END IF;
  END IF;

  IF OLD.status = 'rascunho' AND NEW.status = 'aprovada' THEN
    SELECT coalesce(sum(valor_total), 0), count(*) INTO soma, qtd
      FROM documento_entrada_itens WHERE documento_id = NEW.id;
    IF qtd = 0 THEN
      RAISE EXCEPTION 'A nota precisa ter ao menos um item para ser aprovada.';
    END IF;
    IF soma <> NEW.valor_total THEN
      RAISE EXCEPTION 'A soma dos itens (%) é diferente do valor total da nota (%).', soma, NEW.valor_total;
    END IF;
    NEW.aprovado_por := auth.uid();
    NEW.aprovado_em  := now();
  END IF;

  IF NEW.status = 'cancelada' AND OLD.status <> 'cancelada' THEN
    NEW.cancelado_por := auth.uid();
    NEW.cancelado_em  := now();
  END IF;

  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER documentos_entrada_regras_trg
  BEFORE UPDATE ON documentos_entrada
  FOR EACH ROW EXECUTE FUNCTION documentos_entrada_regras();

-- Nova nota sempre nasce como rascunho e com o autor registrado pelo banco.
CREATE FUNCTION documentos_entrada_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.status        := 'rascunho';
  NEW.criado_por    := auth.uid();
  NEW.aprovado_por  := NULL;  NEW.aprovado_em  := NULL;
  NEW.cancelado_por := NULL;  NEW.cancelado_em := NULL;
  NEW.motivo_cancelamento := NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER documentos_entrada_insert_trg
  BEFORE INSERT ON documentos_entrada
  FOR EACH ROW EXECUTE FUNCTION documentos_entrada_insert();

-- Itens: só mudam enquanto a nota é rascunho, e só usam contas analíticas ativas
-- de natureza despesa ou ativo (ex.: compra de estoque/imobilizado).
CREATE FUNCTION documento_entrada_itens_regras() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  doc_id  bigint := CASE WHEN TG_OP = 'DELETE' THEN OLD.documento_id ELSE NEW.documento_id END;
  doc_st  text;
  conta   plano_contas%ROWTYPE;
BEGIN
  SELECT status INTO doc_st FROM documentos_entrada WHERE id = doc_id;
  IF NOT FOUND THEN
    -- exclusão em cascata da própria nota (só permitida em rascunho pela RLS)
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF doc_st <> 'rascunho' THEN
    RAISE EXCEPTION 'Itens só podem ser alterados enquanto a nota é rascunho (status atual: %).', doc_st;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    SELECT * INTO conta FROM plano_contas WHERE id = NEW.conta_id;
    IF NOT conta.analitica OR NOT conta.ativo OR conta.natureza NOT IN ('despesa', 'ativo') THEN
      RAISE EXCEPTION 'A conta % - % não aceita itens de nota (precisa ser analítica, ativa e de despesa/ativo).',
        conta.codigo, conta.nome;
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER documento_entrada_itens_regras_trg
  BEFORE INSERT OR UPDATE OR DELETE ON documento_entrada_itens
  FOR EACH ROW EXECUTE FUNCTION documento_entrada_itens_regras();

-- Salva cabeçalho + itens de forma atômica (uma transação). SECURITY INVOKER:
-- a RLS e os triggers valem normalmente para quem chamou.
-- p_doc: {tipo, numero, serie, chave_acesso, fornecedor_id, data_emissao, data_entrada,
--         valor_total, centro_custo_id, fundo_id, observacoes}
-- p_itens: [{descricao, quantidade, valor_unitario, valor_total, conta_id, centro_custo_id}]
CREATE FUNCTION salvar_nota_entrada(p_id bigint, p_doc jsonb, p_itens jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_id bigint := p_id;
BEGIN
  IF v_id IS NULL THEN
    INSERT INTO documentos_entrada (tipo, numero, serie, chave_acesso, fornecedor_id, data_emissao,
                                    data_entrada, valor_total, centro_custo_id, fundo_id, observacoes)
    VALUES (p_doc->>'tipo', p_doc->>'numero', coalesce(p_doc->>'serie', ''),
            nullif(p_doc->>'chave_acesso', ''), (p_doc->>'fornecedor_id')::bigint,
            (p_doc->>'data_emissao')::date, coalesce((p_doc->>'data_entrada')::date, current_date),
            (p_doc->>'valor_total')::numeric, nullif(p_doc->>'centro_custo_id', '')::bigint,
            nullif(p_doc->>'fundo_id', '')::bigint, nullif(p_doc->>'observacoes', ''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE documentos_entrada SET
      tipo = p_doc->>'tipo',
      numero = p_doc->>'numero',
      serie = coalesce(p_doc->>'serie', ''),
      chave_acesso = nullif(p_doc->>'chave_acesso', ''),
      fornecedor_id = (p_doc->>'fornecedor_id')::bigint,
      data_emissao = (p_doc->>'data_emissao')::date,
      data_entrada = coalesce((p_doc->>'data_entrada')::date, data_entrada),
      valor_total = (p_doc->>'valor_total')::numeric,
      centro_custo_id = nullif(p_doc->>'centro_custo_id', '')::bigint,
      fundo_id = nullif(p_doc->>'fundo_id', '')::bigint,
      observacoes = nullif(p_doc->>'observacoes', '')
    WHERE id = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Nota % não encontrada ou sem permissão.', v_id;
    END IF;
    DELETE FROM documento_entrada_itens WHERE documento_id = v_id;
  END IF;

  INSERT INTO documento_entrada_itens (documento_id, descricao, quantidade, valor_unitario,
                                       valor_total, conta_id, centro_custo_id)
  SELECT v_id, i.descricao, i.quantidade, i.valor_unitario, i.valor_total, i.conta_id, i.centro_custo_id
    FROM jsonb_to_recordset(coalesce(p_itens, '[]'::jsonb)) AS i(
      descricao text, quantidade numeric, valor_unitario numeric,
      valor_total numeric, conta_id bigint, centro_custo_id bigint);

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION salvar_nota_entrada(bigint, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION salvar_nota_entrada(bigint, jsonb, jsonb) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 4. RLS das tabelas do ERP
--    Leitura:  admin, financeiro, contador (+ comercial nos cadastros-base)
--    Escrita:  admin, financeiro (notas e pessoas); admin, contador (plano/centros/fundos)
-- ─────────────────────────────────────────────────────────────────────

REVOKE ALL ON pessoas, plano_contas, centros_custo, fundos,
              documentos_entrada, documento_entrada_itens, documento_anexos, profiles FROM anon;

ALTER TABLE pessoas                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE plano_contas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE centros_custo           ENABLE ROW LEVEL SECURITY;
ALTER TABLE fundos                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos_entrada      ENABLE ROW LEVEL SECURITY;
ALTER TABLE documento_entrada_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE documento_anexos        ENABLE ROW LEVEL SECURITY;

CREATE POLICY pessoas_select ON pessoas FOR SELECT TO authenticated
  USING (tem_papel('admin', 'financeiro', 'contador', 'comercial'));
CREATE POLICY pessoas_insert ON pessoas FOR INSERT TO authenticated
  WITH CHECK (tem_papel('admin', 'financeiro'));
CREATE POLICY pessoas_update ON pessoas FOR UPDATE TO authenticated
  USING (tem_papel('admin', 'financeiro')) WITH CHECK (tem_papel('admin', 'financeiro'));

CREATE POLICY plano_contas_select ON plano_contas FOR SELECT TO authenticated
  USING (tem_papel('admin', 'financeiro', 'contador', 'comercial'));
CREATE POLICY plano_contas_write ON plano_contas FOR ALL TO authenticated
  USING (tem_papel('admin', 'contador')) WITH CHECK (tem_papel('admin', 'contador'));

CREATE POLICY centros_custo_select ON centros_custo FOR SELECT TO authenticated
  USING (tem_papel('admin', 'financeiro', 'contador', 'comercial'));
CREATE POLICY centros_custo_write ON centros_custo FOR ALL TO authenticated
  USING (tem_papel('admin', 'contador')) WITH CHECK (tem_papel('admin', 'contador'));

CREATE POLICY fundos_select ON fundos FOR SELECT TO authenticated
  USING (tem_papel('admin', 'financeiro', 'contador', 'comercial'));
CREATE POLICY fundos_write ON fundos FOR ALL TO authenticated
  USING (tem_papel('admin', 'contador')) WITH CHECK (tem_papel('admin', 'contador'));

CREATE POLICY documentos_select ON documentos_entrada FOR SELECT TO authenticated
  USING (tem_papel('admin', 'financeiro', 'contador'));
CREATE POLICY documentos_insert ON documentos_entrada FOR INSERT TO authenticated
  WITH CHECK (tem_papel('admin', 'financeiro'));
CREATE POLICY documentos_update ON documentos_entrada FOR UPDATE TO authenticated
  USING (tem_papel('admin', 'financeiro')) WITH CHECK (tem_papel('admin', 'financeiro'));
CREATE POLICY documentos_delete ON documentos_entrada FOR DELETE TO authenticated
  USING (status = 'rascunho' AND tem_papel('admin', 'financeiro'));

CREATE POLICY itens_select ON documento_entrada_itens FOR SELECT TO authenticated
  USING (tem_papel('admin', 'financeiro', 'contador'));
CREATE POLICY itens_write ON documento_entrada_itens FOR ALL TO authenticated
  USING (tem_papel('admin', 'financeiro')) WITH CHECK (tem_papel('admin', 'financeiro'));

CREATE POLICY anexos_select ON documento_anexos FOR SELECT TO authenticated
  USING (tem_papel('admin', 'financeiro', 'contador'));
CREATE POLICY anexos_insert ON documento_anexos FOR INSERT TO authenticated
  WITH CHECK (
    tem_papel('admin', 'financeiro')
    AND EXISTS (SELECT 1 FROM documentos_entrada d
                 WHERE d.id = documento_id AND d.status IN ('rascunho', 'aprovada'))
  );
CREATE POLICY anexos_delete ON documento_anexos FOR DELETE TO authenticated
  USING (
    tem_papel('admin', 'financeiro')
    AND EXISTS (SELECT 1 FROM documentos_entrada d
                 WHERE d.id = documento_id AND d.status = 'rascunho')
  );

-- ─────────────────────────────────────────────────────────────────────
-- 5. Storage: bucket privado de anexos (PDF, XML, imagens; até 10 MB)
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('notas-anexos', 'notas-anexos', false, 10485760,
        ARRAY['application/pdf', 'text/xml', 'application/xml', 'image/png', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;

-- Caminho do objeto: <id da nota>/<arquivo>
CREATE POLICY notas_anexos_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'notas-anexos' AND tem_papel('admin', 'financeiro', 'contador'));

CREATE POLICY notas_anexos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'notas-anexos'
    AND tem_papel('admin', 'financeiro')
    AND EXISTS (SELECT 1 FROM documentos_entrada d
                 WHERE d.id::text = (storage.foldername(name))[1]
                   AND d.status IN ('rascunho', 'aprovada'))
  );

-- Arquivo de nota aprovada não pode ser apagado pelo Storage (trilha de auditoria).
CREATE POLICY notas_anexos_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'notas-anexos'
    AND tem_papel('admin', 'financeiro')
    AND NOT EXISTS (
      SELECT 1 FROM documento_anexos a
        JOIN documentos_entrada d ON d.id = a.documento_id
       WHERE a.caminho = objects.name AND d.status <> 'rascunho')
  );
