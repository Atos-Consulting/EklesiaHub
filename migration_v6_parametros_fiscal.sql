-- Migration v6 — EklesiaHub ERP: parâmetros contábeis, conta caixa, tributos e total calculado da nota
--
-- Pré-requisito: migration_v5_multiempresa.sql.  Rode UMA vez, no SQL Editor.
--
-- O que muda:
--  1. TIPOS CONTÁBEIS (novo): cada item da nota passa a ter um "tipo contábil" que define a conta de DÉBITO
--     e a conta de CRÉDITO da contabilização. Substitui a escolha direta da conta contábil no item.
--  2. CONTAS CAIXA (novo): substituem o "Fundo" na nota. Têm banco, agência, conta, saldo inicial e o saldo
--     atual é acompanhado (saldo inicial − notas aprovadas pagas por aquela conta caixa).
--  3. TOTAL DA NOTA CALCULADO: itens + frete + seguro + outras despesas − desconto + IPI + ICMS ST.
--     O total digitado pelo cliente deixa de valer; o banco recalcula e confere na aprovação.
--  4. TRIBUTOS: campo `fiscal` (JSON validado) na nota e em cada item (ICMS, IPI, PIS, COFINS, ISS, retenções...).
--  5. PLANO DE CONTAS com regras de estrutura (conta filha herda código e natureza do pai, só sintética tem filhas...).
--  6. Aprovar exige: conta caixa, tipo contábil em todos os itens e total conferido.
--
-- Os dados que já existem são preservados: notas antigas continuam valendo; itens antigos ganham o tipo contábil
-- correspondente quando a conta de débito bate com um dos tipos padrão.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Validação do campo `fiscal` (tributos)
--    Nova chave de tributo? Acrescente aqui e em src/erp/tributos.js.
-- ─────────────────────────────────────────────────────────────────────

CREATE FUNCTION fiscal_valido(f jsonb, nivel text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  k text; v jsonb;
  nums text[]; strs text[]; bools text[];
BEGIN
  IF f IS NULL OR jsonb_typeof(f) <> 'object' THEN RETURN false; END IF;
  IF nivel = 'item' THEN
    nums  := ARRAY['icms_base', 'icms_aliquota', 'icms', 'icms_st', 'ipi_aliquota', 'ipi', 'pis', 'cofins',
                   'iss_aliquota', 'iss', 'inss', 'irrf', 'csll'];
    strs  := ARRAY['ncm', 'cfop', 'unidade', 'cst'];
    bools := ARRAY[]::text[];
  ELSE
    nums  := ARRAY['icms_base', 'icms', 'icms_st_base', 'icms_st', 'ipi', 'pis', 'cofins', 'iss', 'inss', 'irrf',
                   'csll', 'outras_retencoes', 'total_tributos'];
    strs  := ARRAY['protocolo'];
    bools := ARRAY['iss_retido'];
  END IF;
  FOR k, v IN SELECT * FROM jsonb_each(f) LOOP
    IF k = ANY (nums) THEN
      IF jsonb_typeof(v) <> 'number' OR (v #>> '{}')::numeric < 0 OR (v #>> '{}')::numeric >= 1e13 THEN RETURN false; END IF;
    ELSIF k = ANY (strs) THEN
      IF jsonb_typeof(v) <> 'string' OR length(v #>> '{}') > 60 THEN RETURN false; END IF;
    ELSIF k = ANY (bools) THEN
      IF jsonb_typeof(v) <> 'boolean' THEN RETURN false; END IF;
    ELSE
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Plano de contas: regras de estrutura
-- ─────────────────────────────────────────────────────────────────────

CREATE FUNCTION plano_contas_regras() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  pai plano_contas%ROWTYPE;
BEGIN
  IF NEW.codigo !~ '^[0-9]+(\.[0-9]+)*$' THEN
    RAISE EXCEPTION 'O código da conta deve ter só números separados por ponto (ex.: 5.1.01).';
  END IF;
  IF length(btrim(NEW.nome)) = 0 THEN
    RAISE EXCEPTION 'Informe o nome da conta.';
  END IF;

  IF NEW.pai_id IS NULL THEN
    IF position('.' IN NEW.codigo) > 0 THEN
      RAISE EXCEPTION 'Uma conta com código "%" precisa ter uma conta pai (só as contas de 1º nível não têm pai).', NEW.codigo;
    END IF;
  ELSE
    SELECT * INTO pai FROM plano_contas WHERE id = NEW.pai_id AND empresa_id = NEW.empresa_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Conta pai não encontrada.'; END IF;
    IF pai.analitica THEN
      RAISE EXCEPTION 'A conta pai (% - %) é analítica; só contas sintéticas podem ter contas filhas.', pai.codigo, pai.nome;
    END IF;
    IF NEW.codigo !~ ('^' || replace(pai.codigo, '.', '\.') || '\.[0-9]+$') THEN
      RAISE EXCEPTION 'O código da conta filha deve começar com o código do pai (% ) seguido de um novo nível (ex.: %.01).', pai.codigo, pai.codigo;
    END IF;
    IF NEW.natureza <> pai.natureza THEN
      RAISE EXCEPTION 'A natureza da conta (%) precisa ser a mesma da conta pai (%).', NEW.natureza, pai.natureza;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.codigo <> OLD.codigo AND EXISTS (SELECT 1 FROM plano_contas WHERE pai_id = OLD.id) THEN
      RAISE EXCEPTION 'Não é possível mudar o código de uma conta que já tem contas filhas.';
    END IF;
    IF NEW.analitica AND NOT OLD.analitica AND EXISTS (SELECT 1 FROM plano_contas WHERE pai_id = OLD.id) THEN
      RAISE EXCEPTION 'Uma conta com contas filhas não pode ser analítica.';
    END IF;
    IF NOT NEW.analitica AND OLD.analitica AND (
         EXISTS (SELECT 1 FROM documento_entrada_itens WHERE conta_id = OLD.id OR conta_credito_id = OLD.id)
      OR EXISTS (SELECT 1 FROM tipos_contabeis WHERE conta_debito_id = OLD.id OR conta_credito_id = OLD.id)
      OR EXISTS (SELECT 1 FROM contas_caixa WHERE conta_contabil_id = OLD.id)) THEN
      RAISE EXCEPTION 'Esta conta já está em uso (notas, tipos contábeis ou contas caixa) e não pode virar sintética.';
    END IF;
    IF NEW.natureza <> OLD.natureza AND (
         EXISTS (SELECT 1 FROM plano_contas WHERE pai_id = OLD.id)
      OR EXISTS (SELECT 1 FROM documento_entrada_itens WHERE conta_id = OLD.id OR conta_credito_id = OLD.id)
      OR EXISTS (SELECT 1 FROM tipos_contabeis WHERE conta_debito_id = OLD.id OR conta_credito_id = OLD.id)) THEN
      RAISE EXCEPTION 'Não é possível mudar a natureza de uma conta que tem filhas ou já está em uso.';
    END IF;
    IF OLD.ativo AND NOT NEW.ativo AND (
         EXISTS (SELECT 1 FROM tipos_contabeis WHERE ativo AND (conta_debito_id = OLD.id OR conta_credito_id = OLD.id))
      OR EXISTS (SELECT 1 FROM contas_caixa WHERE ativo AND conta_contabil_id = OLD.id)
      OR EXISTS (SELECT 1 FROM plano_contas WHERE ativo AND pai_id = OLD.id)) THEN
      RAISE EXCEPTION 'Esta conta é usada por tipos contábeis, contas caixa ou contas filhas ativas. Desative-os antes.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Contas caixa e tipos contábeis
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE contas_caixa (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id         bigint NOT NULL DEFAULT minha_empresa_id() REFERENCES empresas(id),
  nome               text NOT NULL CHECK (length(btrim(nome)) > 0),
  banco              text,
  agencia            text,
  numero_conta       text,
  saldo_inicial      numeric(15,2) NOT NULL DEFAULT 0,
  data_saldo_inicial date NOT NULL DEFAULT current_date,
  conta_contabil_id  bigint,  -- conta do plano que representa este caixa/banco (ativo)
  ativo              boolean NOT NULL DEFAULT true,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contas_caixa_empresa_nome_uq UNIQUE (empresa_id, nome),
  CONSTRAINT contas_caixa_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT contas_caixa_conta_fk FOREIGN KEY (conta_contabil_id, empresa_id) REFERENCES plano_contas (id, empresa_id)
);
CREATE TRIGGER contas_caixa_atualizado BEFORE UPDATE ON contas_caixa FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

CREATE FUNCTION contas_caixa_regras() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE c plano_contas%ROWTYPE;
BEGIN
  IF NEW.conta_contabil_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.conta_contabil_id IS DISTINCT FROM OLD.conta_contabil_id) THEN
    SELECT * INTO c FROM plano_contas WHERE id = NEW.conta_contabil_id;
    IF NOT c.analitica OR NOT c.ativo OR c.natureza <> 'ativo' THEN
      RAISE EXCEPTION 'A conta contábil do caixa precisa ser analítica, ativa e de natureza ativo (ex.: Caixa, Bancos).';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER contas_caixa_regras_trg BEFORE INSERT OR UPDATE ON contas_caixa FOR EACH ROW EXECUTE FUNCTION contas_caixa_regras();

CREATE TABLE tipos_contabeis (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id       bigint NOT NULL DEFAULT minha_empresa_id() REFERENCES empresas(id),
  nome             text NOT NULL CHECK (length(btrim(nome)) > 0),
  descricao        text,
  conta_debito_id  bigint NOT NULL,
  conta_credito_id bigint NOT NULL,
  ativo            boolean NOT NULL DEFAULT true,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tipos_contabeis_empresa_nome_uq UNIQUE (empresa_id, nome),
  CONSTRAINT tipos_contabeis_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT tipos_contabeis_debito_fk FOREIGN KEY (conta_debito_id, empresa_id) REFERENCES plano_contas (id, empresa_id),
  CONSTRAINT tipos_contabeis_credito_fk FOREIGN KEY (conta_credito_id, empresa_id) REFERENCES plano_contas (id, empresa_id),
  CHECK (conta_debito_id <> conta_credito_id)
);
CREATE TRIGGER tipos_contabeis_atualizado BEFORE UPDATE ON tipos_contabeis FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

-- Débito de uma compra: despesa ou ativo (estoque, imobilizado). Crédito: ativo (caixa/banco) ou passivo (fornecedores).
CREATE FUNCTION tipos_contabeis_regras() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE d plano_contas%ROWTYPE; c plano_contas%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.conta_debito_id <> OLD.conta_debito_id OR NEW.conta_credito_id <> OLD.conta_credito_id THEN
    SELECT * INTO d FROM plano_contas WHERE id = NEW.conta_debito_id;
    SELECT * INTO c FROM plano_contas WHERE id = NEW.conta_credito_id;
    IF NOT d.analitica OR NOT d.ativo OR d.natureza NOT IN ('despesa', 'ativo') THEN
      RAISE EXCEPTION 'A conta de débito (% - %) precisa ser analítica, ativa e de despesa ou ativo.', d.codigo, d.nome;
    END IF;
    IF NOT c.analitica OR NOT c.ativo OR c.natureza NOT IN ('ativo', 'passivo') THEN
      RAISE EXCEPTION 'A conta de crédito (% - %) precisa ser analítica, ativa e de ativo (caixa/banco) ou passivo (fornecedores a pagar).', c.codigo, c.nome;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tipos_contabeis_regras_trg BEFORE INSERT OR UPDATE ON tipos_contabeis FOR EACH ROW EXECUTE FUNCTION tipos_contabeis_regras();

CREATE TRIGGER plano_contas_regras_trg BEFORE INSERT OR UPDATE ON plano_contas FOR EACH ROW EXECUTE FUNCTION plano_contas_regras();

-- ─────────────────────────────────────────────────────────────────────
-- 4. Colunas novas nas notas e nos itens
-- ─────────────────────────────────────────────────────────────────────

-- As regras de imutabilidade ficam desligadas só durante o preenchimento dos dados antigos.
ALTER TABLE documentos_entrada      DISABLE TRIGGER USER;
ALTER TABLE documento_entrada_itens DISABLE TRIGGER USER;

ALTER TABLE documentos_entrada
  ADD COLUMN conta_caixa_id    bigint,
  ADD COLUMN natureza_operacao text,
  ADD COLUMN valor_frete       numeric(15,2) NOT NULL DEFAULT 0 CHECK (valor_frete >= 0),
  ADD COLUMN valor_seguro      numeric(15,2) NOT NULL DEFAULT 0 CHECK (valor_seguro >= 0),
  ADD COLUMN valor_outras      numeric(15,2) NOT NULL DEFAULT 0 CHECK (valor_outras >= 0),
  ADD COLUMN valor_desconto    numeric(15,2) NOT NULL DEFAULT 0 CHECK (valor_desconto >= 0),
  ADD COLUMN fiscal            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (fiscal_valido(fiscal, 'nota'));
ALTER TABLE documentos_entrada ADD CONSTRAINT documentos_entrada_caixa_fk
  FOREIGN KEY (conta_caixa_id, empresa_id) REFERENCES contas_caixa (id, empresa_id);

ALTER TABLE documento_entrada_itens
  ADD COLUMN tipo_contabil_id bigint,
  ADD COLUMN conta_credito_id bigint,
  ADD COLUMN fiscal           jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (fiscal_valido(fiscal, 'item'));
ALTER TABLE documento_entrada_itens ADD CONSTRAINT documento_entrada_itens_tipo_fk
  FOREIGN KEY (tipo_contabil_id, empresa_id) REFERENCES tipos_contabeis (id, empresa_id);
ALTER TABLE documento_entrada_itens ADD CONSTRAINT documento_entrada_itens_credito_fk
  FOREIGN KEY (conta_credito_id, empresa_id) REFERENCES plano_contas (id, empresa_id);

-- ─────────────────────────────────────────────────────────────────────
-- 5. Dados padrão (tipos contábeis e conta caixa) — também para as empresas que já existem
-- ─────────────────────────────────────────────────────────────────────

CREATE FUNCTION semear_parametros_contabeis(p_empresa bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO contas_caixa (empresa_id, nome, conta_contabil_id)
  SELECT p_empresa, 'Caixa geral', (SELECT id FROM plano_contas WHERE empresa_id = p_empresa AND codigo = '1.1.01')
  ON CONFLICT (empresa_id, nome) DO NOTHING;

  INSERT INTO tipos_contabeis (empresa_id, nome, descricao, conta_debito_id, conta_credito_id)
  SELECT p_empresa, v.nome, v.descricao, d.id, c.id
    FROM (VALUES
      ('Água, luz e telefone',                '5.1.01', 'Contas de consumo da igreja'),
      ('Material de escritório e limpeza',    '5.1.02', 'Papelaria, produtos de limpeza e copa'),
      ('Serviços de terceiros',               '5.1.03', 'Prestadores de serviço, honorários, assessorias'),
      ('Manutenção e reparos',                '5.1.04', 'Conserto e conservação do templo e equipamentos'),
      ('Prebendas e salários',                '5.2.01', 'Remuneração de pastores e funcionários'),
      ('Eventos e ministérios',               '5.3.01', 'Despesas de eventos, cultos especiais e ministérios'),
      ('Missões e ação social',               '5.3.02', 'Missões, doações e assistência social'),
      ('Compra de mercadorias para revenda',  '1.1.03', 'Livros e produtos da livraria e do bazar (vão para o estoque)'),
      ('Aquisição de bens (imobilizado)',     '1.2.01', 'Equipamentos, móveis e instrumentos de uso duradouro')
    ) AS v(nome, debito, descricao)
    JOIN plano_contas d ON d.empresa_id = p_empresa AND d.codigo = v.debito
    JOIN plano_contas c ON c.empresa_id = p_empresa AND c.codigo = '1.1.01'
  ON CONFLICT (empresa_id, nome) DO NOTHING;
END;
$$;
REVOKE EXECUTE ON FUNCTION semear_parametros_contabeis(bigint) FROM PUBLIC, anon, authenticated;

-- Empresas novas: plano de contas já com a hierarquia montada (as regras da seção 2 exigem pai na criação).
CREATE OR REPLACE FUNCTION semear_empresa(p_empresa bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  INSERT INTO centros_custo (empresa_id, nome)
  SELECT p_empresa, n FROM unnest(ARRAY['Administração', 'Kids', 'Louvor', 'Missões', 'Manutenção', 'Livraria e Bazar']) AS n;

  INSERT INTO fundos (empresa_id, nome, restrito) VALUES (p_empresa, 'Geral', false);

  FOR r IN
    SELECT * FROM (VALUES
      ('1', 'ATIVO', 'ativo', false), ('1.1', 'Ativo Circulante', 'ativo', false),
      ('1.1.01', 'Caixa', 'ativo', true), ('1.1.02', 'Bancos conta movimento', 'ativo', true),
      ('1.1.03', 'Estoques (livraria e bazar)', 'ativo', true), ('1.2', 'Ativo Não Circulante', 'ativo', false),
      ('1.2.01', 'Imobilizado', 'ativo', true), ('2', 'PASSIVO', 'passivo', false),
      ('2.1', 'Passivo Circulante', 'passivo', false), ('2.1.01', 'Fornecedores a pagar', 'passivo', true),
      ('2.1.02', 'Obrigações trabalhistas e tributárias', 'passivo', true),
      ('3', 'PATRIMÔNIO SOCIAL', 'patrimonio_social', false), ('3.1', 'Patrimônio Social', 'patrimonio_social', true),
      ('3.2', 'Superávit/Déficit do exercício', 'patrimonio_social', true),
      ('4', 'RECEITAS', 'receita', false), ('4.1', 'Contribuições', 'receita', false),
      ('4.1.01', 'Dízimos', 'receita', true), ('4.1.02', 'Ofertas', 'receita', true),
      ('4.1.03', 'Campanhas e doações', 'receita', true), ('4.2', 'Receitas comerciais', 'receita', false),
      ('4.2.01', 'Vendas livraria e bazar', 'receita', true), ('5', 'DESPESAS', 'despesa', false),
      ('5.1', 'Despesas administrativas', 'despesa', false), ('5.1.01', 'Água, luz e telefone', 'despesa', true),
      ('5.1.02', 'Material de escritório e limpeza', 'despesa', true), ('5.1.03', 'Serviços de terceiros', 'despesa', true),
      ('5.1.04', 'Manutenção e reparos', 'despesa', true), ('5.2', 'Despesas com pessoal', 'despesa', false),
      ('5.2.01', 'Prebendas e salários', 'despesa', true), ('5.3', 'Despesas ministeriais', 'despesa', false),
      ('5.3.01', 'Eventos e ministérios', 'despesa', true), ('5.3.02', 'Missões e ação social', 'despesa', true),
      ('5.4', 'Custo das mercadorias vendidas', 'despesa', true)
    ) AS v(codigo, nome, natureza, analitica)
    ORDER BY array_length(string_to_array(v.codigo, '.'), 1), v.codigo
  LOOP
    INSERT INTO plano_contas (empresa_id, codigo, nome, natureza, analitica, pai_id)
    VALUES (p_empresa, r.codigo, r.nome, r.natureza, r.analitica,
            (SELECT id FROM plano_contas
              WHERE empresa_id = p_empresa AND r.codigo LIKE '%.%'
                AND codigo = regexp_replace(r.codigo, '\.[^.]+$', '')));
  END LOOP;

  PERFORM semear_parametros_contabeis(p_empresa);
END;
$$;

-- Preenche as empresas existentes e liga os itens antigos ao tipo cujo débito coincide.
SELECT semear_parametros_contabeis(id) FROM empresas;

UPDATE documento_entrada_itens i
   SET tipo_contabil_id = t.id, conta_credito_id = t.conta_credito_id
  FROM tipos_contabeis t
 WHERE t.empresa_id = i.empresa_id AND t.conta_debito_id = i.conta_id AND i.tipo_contabil_id IS NULL;

ALTER TABLE documentos_entrada      ENABLE TRIGGER USER;
ALTER TABLE documento_entrada_itens ENABLE TRIGGER USER;

-- ─────────────────────────────────────────────────────────────────────
-- 6. Saldo da conta caixa
--    Saldo atual = saldo inicial − notas APROVADAS pagas por esta conta caixa, de data de entrada igual ou
--    posterior à data do saldo inicial. Cancelar a nota devolve o valor. (Retenções e pagamento a prazo
--    entram com o módulo Financeiro.)
-- ─────────────────────────────────────────────────────────────────────

CREATE VIEW contas_caixa_saldo WITH (security_invoker = true) AS
SELECT c.id, c.empresa_id, c.nome, c.banco, c.agencia, c.numero_conta, c.saldo_inicial, c.data_saldo_inicial,
       c.conta_contabil_id, c.ativo,
       coalesce(s.saidas, 0)::numeric(15,2)                    AS total_saidas,
       (c.saldo_inicial - coalesce(s.saidas, 0))::numeric(15,2) AS saldo_atual,
       coalesce(s.qtd, 0)::int                                  AS qtd_notas
  FROM contas_caixa c
  LEFT JOIN LATERAL (
    SELECT sum(d.valor_total) AS saidas, count(*) AS qtd
      FROM documentos_entrada d
     WHERE d.conta_caixa_id = c.id AND d.status IN ('aprovada', 'lancada') AND d.data_entrada >= c.data_saldo_inicial
  ) s ON true;

-- ─────────────────────────────────────────────────────────────────────
-- 7. Regras dos itens e da nota (substituem as da v4/v5)
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION documento_entrada_itens_regras() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  doc_id bigint := CASE WHEN TG_OP = 'DELETE' THEN OLD.documento_id ELSE NEW.documento_id END;
  doc_st text;
  conta  plano_contas%ROWTYPE;
  tipo   tipos_contabeis%ROWTYPE;
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
    -- As contas de débito e crédito do item vêm SEMPRE do tipo contábil (o que o cliente mandar é ignorado).
    IF NEW.tipo_contabil_id IS NOT NULL THEN
      SELECT * INTO tipo FROM tipos_contabeis WHERE id = NEW.tipo_contabil_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Tipo contábil não encontrado.'; END IF;
      IF TG_OP = 'INSERT' AND NOT tipo.ativo THEN
        RAISE EXCEPTION 'O tipo contábil "%" está inativo.', tipo.nome;
      END IF;
      NEW.conta_id := tipo.conta_debito_id;
      NEW.conta_credito_id := tipo.conta_credito_id;
    ELSIF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Selecione o tipo contábil de todos os itens.';
    END IF;

    SELECT * INTO conta FROM plano_contas WHERE id = NEW.conta_id;
    IF NOT conta.analitica OR NOT conta.ativo OR conta.natureza NOT IN ('despesa', 'ativo') THEN
      RAISE EXCEPTION 'A conta % - % não aceita itens de nota (precisa ser analítica, ativa e de despesa/ativo).',
        conta.codigo, conta.nome;
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION documentos_entrada_regras() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  soma numeric(15,2);
  esperado numeric(15,2);
  qtd  integer;
  inativo text;
  ignorar text[] := ARRAY['status', 'motivo_cancelamento', 'cancelado_por', 'cancelado_em',
                          'aprovado_por', 'aprovado_em', 'atualizado_em'];
BEGIN
  IF NEW.status = 'lancada' THEN
    RAISE EXCEPTION 'Status "lancada" ainda não está disponível (depende do módulo Contábil).';
  END IF;

  IF OLD.status IN ('cancelada', 'lancada') THEN
    RAISE EXCEPTION 'Nota % não pode mais ser alterada.', OLD.status;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('aprovada', 'cancelada')
     AND NOT tem_nivel('administrador', 'supervisor') THEN
    RAISE EXCEPTION 'Somente Supervisor ou Administrador pode aprovar ou cancelar notas.';
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
    IF NEW.conta_caixa_id IS NULL THEN
      RAISE EXCEPTION 'Informe a conta caixa para aprovar a nota.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM contas_caixa WHERE id = NEW.conta_caixa_id AND ativo) THEN
      RAISE EXCEPTION 'A conta caixa da nota está inativa.';
    END IF;
    IF EXISTS (SELECT 1 FROM documento_entrada_itens WHERE documento_id = NEW.id AND tipo_contabil_id IS NULL) THEN
      RAISE EXCEPTION 'Todos os itens precisam de um tipo contábil. Edite a nota e selecione o tipo de cada item.';
    END IF;
    SELECT t.nome INTO inativo
      FROM documento_entrada_itens i JOIN tipos_contabeis t ON t.id = i.tipo_contabil_id
     WHERE i.documento_id = NEW.id AND NOT t.ativo LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'O tipo contábil "%" está inativo. Troque o tipo dos itens que o usam.', inativo;
    END IF;
    -- Fixa a contabilização na data da aprovação, com as regras VIGENTES de cada tipo contábil.
    UPDATE documento_entrada_itens SET tipo_contabil_id = tipo_contabil_id WHERE documento_id = NEW.id;

    esperado := soma + NEW.valor_frete + NEW.valor_seguro + NEW.valor_outras - NEW.valor_desconto
                + coalesce((NEW.fiscal->>'ipi')::numeric, 0) + coalesce((NEW.fiscal->>'icms_st')::numeric, 0);
    IF esperado <> NEW.valor_total THEN
      RAISE EXCEPTION 'O total da nota (%) não confere com os itens e ajustes (%).', NEW.valor_total, esperado;
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

-- Salva cabeçalho + itens numa transação. O TOTAL É CALCULADO AQUI (o cliente não define):
--   itens + frete + seguro + outras despesas − desconto + IPI + ICMS ST.
-- p_doc: {tipo, numero, serie, chave_acesso, fornecedor_id, data_emissao, data_entrada, centro_custo_id,
--         conta_caixa_id, natureza_operacao, observacoes, valor_frete, valor_seguro, valor_outras,
--         valor_desconto, fiscal:{...}}
-- p_itens: [{descricao, quantidade, valor_unitario, valor_total, tipo_contabil_id, centro_custo_id, fiscal:{...}}]
CREATE OR REPLACE FUNCTION salvar_nota_entrada(p_id bigint, p_doc jsonb, p_itens jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_id bigint := p_id;
  v_itens jsonb := coalesce(p_itens, '[]'::jsonb);
  v_fiscal jsonb := coalesce(p_doc->'fiscal', '{}'::jsonb);
  v_soma numeric;
  v_total numeric(15,2);
  v_frete numeric := coalesce(nullif(p_doc->>'valor_frete', '')::numeric, 0);
  v_seguro numeric := coalesce(nullif(p_doc->>'valor_seguro', '')::numeric, 0);
  v_outras numeric := coalesce(nullif(p_doc->>'valor_outras', '')::numeric, 0);
  v_desconto numeric := coalesce(nullif(p_doc->>'valor_desconto', '')::numeric, 0);
BEGIN
  IF jsonb_array_length(v_itens) = 0 THEN
    RAISE EXCEPTION 'Inclua ao menos um item na nota.';
  END IF;
  IF NOT fiscal_valido(v_fiscal, 'nota')
     OR EXISTS (SELECT 1 FROM jsonb_to_recordset(v_itens) AS i(fiscal jsonb)
                 WHERE i.fiscal IS NOT NULL AND NOT fiscal_valido(i.fiscal, 'item')) THEN
    RAISE EXCEPTION 'Os tributos informados são inválidos: use apenas os campos previstos, com valores numéricos não negativos.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(v_itens) AS i(tipo_contabil_id bigint) WHERE i.tipo_contabil_id IS NULL) THEN
    RAISE EXCEPTION 'Selecione o tipo contábil de todos os itens.';
  END IF;

  SELECT coalesce(sum(i.valor_total), 0) INTO v_soma FROM jsonb_to_recordset(v_itens) AS i(valor_total numeric);
  v_total := round(v_soma + v_frete + v_seguro + v_outras - v_desconto
                   + coalesce((v_fiscal->>'ipi')::numeric, 0) + coalesce((v_fiscal->>'icms_st')::numeric, 0), 2);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'O total da nota precisa ser maior que zero.';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO documentos_entrada (tipo, numero, serie, chave_acesso, fornecedor_id, data_emissao, data_entrada,
                                    valor_total, centro_custo_id, conta_caixa_id, natureza_operacao, observacoes,
                                    valor_frete, valor_seguro, valor_outras, valor_desconto, fiscal)
    VALUES (p_doc->>'tipo', p_doc->>'numero', coalesce(p_doc->>'serie', ''), nullif(p_doc->>'chave_acesso', ''),
            (p_doc->>'fornecedor_id')::bigint, (p_doc->>'data_emissao')::date,
            coalesce((p_doc->>'data_entrada')::date, current_date), v_total,
            nullif(p_doc->>'centro_custo_id', '')::bigint, nullif(p_doc->>'conta_caixa_id', '')::bigint,
            nullif(p_doc->>'natureza_operacao', ''), nullif(p_doc->>'observacoes', ''),
            v_frete, v_seguro, v_outras, v_desconto, v_fiscal)
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
      valor_total = v_total,
      centro_custo_id = nullif(p_doc->>'centro_custo_id', '')::bigint,
      conta_caixa_id = nullif(p_doc->>'conta_caixa_id', '')::bigint,
      natureza_operacao = nullif(p_doc->>'natureza_operacao', ''),
      observacoes = nullif(p_doc->>'observacoes', ''),
      valor_frete = v_frete, valor_seguro = v_seguro, valor_outras = v_outras, valor_desconto = v_desconto,
      fiscal = v_fiscal
    WHERE id = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Nota % não encontrada ou sem permissão.', v_id;
    END IF;
    DELETE FROM documento_entrada_itens WHERE documento_id = v_id;
  END IF;

  -- conta_id e conta_credito_id são definidos pelo gatilho a partir do tipo contábil
  INSERT INTO documento_entrada_itens (documento_id, descricao, quantidade, valor_unitario, valor_total,
                                       tipo_contabil_id, centro_custo_id, fiscal)
  SELECT v_id, i.descricao, i.quantidade, i.valor_unitario, i.valor_total, i.tipo_contabil_id, i.centro_custo_id,
         coalesce(i.fiscal, '{}'::jsonb)
    FROM jsonb_to_recordset(v_itens) AS i(
      descricao text, quantidade numeric, valor_unitario numeric, valor_total numeric,
      tipo_contabil_id bigint, centro_custo_id bigint, fiscal jsonb);

  RETURN v_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 8. RLS das tabelas novas (todos leem; só o Administrador altera) + permissões
-- ─────────────────────────────────────────────────────────────────────

REVOKE ALL ON contas_caixa, tipos_contabeis, contas_caixa_saldo FROM anon;
GRANT SELECT ON contas_caixa_saldo TO authenticated;
ALTER TABLE contas_caixa    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tipos_contabeis ENABLE ROW LEVEL SECURITY;

CREATE POLICY contas_caixa_select ON contas_caixa FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY contas_caixa_write ON contas_caixa FOR ALL TO authenticated
  USING (empresa_id = minha_empresa_id() AND tem_nivel('administrador'))
  WITH CHECK (empresa_id = minha_empresa_id() AND tem_nivel('administrador'));

CREATE POLICY tipos_contabeis_select ON tipos_contabeis FOR SELECT TO authenticated USING (empresa_id = minha_empresa_id());
CREATE POLICY tipos_contabeis_write ON tipos_contabeis FOR ALL TO authenticated
  USING (empresa_id = minha_empresa_id() AND tem_nivel('administrador'))
  WITH CHECK (empresa_id = minha_empresa_id() AND tem_nivel('administrador'));
