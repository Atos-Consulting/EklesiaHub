-- ═════════════════════════════════════════════════════════════════════
-- EklesiaHub — migration v17: centro de custo por item da nota
-- ═════════════════════════════════════════════════════════════════════
-- O centro de custo sai do cabeçalho da nota (na tela) e passa a ser de cada item:
--  • aprovar exige centro de custo ativo em TODOS os itens (substitui a regra da v15, do cabeçalho);
--  • na aprovação, o cabeçalho (documentos_entrada.centro_custo_id) é preenchido pelo banco com o
--    centro dos itens quando todos têm o mesmo, e fica nulo quando são diferentes. Os títulos
--    continuam herdando do cabeçalho; o Relatório do mês divide os pagamentos pelos itens.
-- Notas já aprovadas não mudam. Rascunhos antigos com centro só no cabeçalho: a tela copia esse
-- centro para os itens sem centro ao abrir. Só redefine documentos_entrada_regras(). Rodar depois da v16.

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
    -- v17: o centro de custo é de cada item (obrigatório para aprovar; o rascunho pode ficar sem).
    IF EXISTS (SELECT 1 FROM documento_entrada_itens WHERE documento_id = NEW.id AND centro_custo_id IS NULL) THEN
      RAISE EXCEPTION 'Informe o centro de custo de todos os itens para aprovar a nota.';
    END IF;
    SELECT cc.nome INTO inativo
      FROM documento_entrada_itens i JOIN centros_custo cc ON cc.id = i.centro_custo_id
     WHERE i.documento_id = NEW.id AND NOT cc.ativo LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'O centro de custo "%" está inativo. Troque o centro dos itens que o usam.', inativo;
    END IF;
    -- O cabeçalho guarda o centro quando todos os itens têm o mesmo (os títulos herdam dele);
    -- com centros diferentes fica nulo, e os relatórios dividem os pagamentos pelos itens.
    SELECT CASE WHEN count(DISTINCT centro_custo_id) = 1 THEN min(centro_custo_id) END INTO NEW.centro_custo_id
      FROM documento_entrada_itens WHERE documento_id = NEW.id;
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
