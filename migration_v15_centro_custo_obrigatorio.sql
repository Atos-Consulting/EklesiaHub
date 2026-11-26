-- ═════════════════════════════════════════════════════════════════════
-- EklesiaHub — migration v15: centro de custo obrigatório na aprovação da nota
-- ═════════════════════════════════════════════════════════════════════
-- A partir desta versão, uma nota de entrada só é aprovada com centro de custo (ativo) no cabeçalho.
-- O rascunho continua podendo ficar sem centro (o XML importado chega sem ele), e as notas já
-- aprovadas não mudam: elas aparecem como "Sem centro de custo" nos relatórios.
-- Os títulos do Financeiro herdam o centro da nota (gerar_titulos_nota). Rodar depois da v14.
-- Só redefine documentos_entrada_regras() (cópia da v11 com a regra nova); o gatilho já aponta para ela.

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
    -- v15: centro de custo obrigatório para aprovar (o rascunho continua podendo ficar sem).
    IF NEW.centro_custo_id IS NULL THEN
      RAISE EXCEPTION 'Informe o centro de custo para aprovar a nota.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM centros_custo WHERE id = NEW.centro_custo_id AND ativo) THEN
      RAISE EXCEPTION 'O centro de custo da nota está inativo.';
    END IF;
    IF usa_contabilidade(NEW.empresa_id)
       AND EXISTS (SELECT 1 FROM documento_entrada_itens WHERE documento_id = NEW.id AND tipo_contabil_id IS NULL) THEN
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
