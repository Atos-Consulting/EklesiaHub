-- ═════════════════════════════════════════════════════════════════════
-- EklesiaHub — migration v16: Usuário registra dízimos e ofertas; sai "Outra entrada"
-- ═════════════════════════════════════════════════════════════════════
-- Decisão da revisão do Financeiro (fatia 4):
--  • Qualquer nível da igreja (Usuário, Supervisor, Administrador) registra entradas. Quem conta o
--    dinheiro do culto lança na hora; estornar continua só para Supervisor ou Administrador
--    (estornar_entrada não muda).
--  • O tipo "outra" não é mais aceito em entradas novas: o que não é contribuição (rendimento,
--    venda, reembolso) vai para Caixa como entrada avulsa (registrar_movimento, Supervisor+).
--    Entradas "outra" já gravadas continuam válidas (o CHECK da tabela não muda).
-- Só redefine registrar_entrada() (cópia da v12 com as duas regras). Rodar depois da v15.

CREATE OR REPLACE FUNCTION registrar_entrada(p_dados jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa  bigint := minha_empresa_id();
  v_tipo     text := p_dados->>'tipo';
  v_data     date;
  v_valor    numeric;
  v_caixa    bigint := nullif(p_dados->>'conta_caixa_id', '')::bigint;
  v_forma    text := nullif(p_dados->>'forma_pagamento', '');
  v_pessoa   bigint := nullif(p_dados->>'pessoa_id', '')::bigint;
  v_campanha bigint := nullif(p_dados->>'campanha_id', '')::bigint;
  v_centro   bigint := nullif(p_dados->>'centro_custo_id', '')::bigint;
  v_desc     text := nullif(btrim(coalesce(p_dados->>'descricao', '')), '');
  cx         contas_caixa%ROWTYPE;
  v_id       bigint;
BEGIN
  -- v16: qualquer nível da igreja registra (quem conta o dinheiro no culto); estornar continua Supervisor+.
  IF NOT tem_nivel('administrador', 'supervisor', 'usuario') THEN
    RAISE EXCEPTION 'Sem acesso para registrar entradas nesta igreja.';
  END IF;
  -- v16: "outra" saiu; o que não é contribuição vira entrada avulsa em Caixa (registrar_movimento).
  IF v_tipo = 'outra' THEN
    RAISE EXCEPTION 'Entradas que não são dízimo, oferta ou campanha (ex.: rendimento, venda, reembolso) são lançadas em Financeiro → Caixa → Extrato e movimentos, como entrada avulsa.';
  END IF;
  IF v_tipo IS NULL OR v_tipo NOT IN ('dizimo', 'oferta', 'campanha') THEN
    RAISE EXCEPTION 'Tipo de entrada inválido.';
  END IF;
  BEGIN
    v_data := (p_dados->>'data')::date;
    v_valor := round((p_dados->>'valor')::numeric, 2);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Data ou valor inválido.';
  END;
  IF v_data IS NULL THEN RAISE EXCEPTION 'Informe a data da entrada.'; END IF;
  IF v_data > current_date THEN RAISE EXCEPTION 'A data da entrada não pode ser futura.'; END IF;
  IF v_valor IS NULL OR v_valor <= 0 THEN RAISE EXCEPTION 'O valor precisa ser maior que zero.'; END IF;
  IF v_valor > 9999999999999 THEN RAISE EXCEPTION 'Valor alto demais.'; END IF;
  IF v_forma IS NULL THEN RAISE EXCEPTION 'Informe a forma de recebimento.'; END IF;
  IF length(v_desc) > 200 THEN RAISE EXCEPTION 'A descrição pode ter no máximo 200 caracteres.'; END IF;

  SELECT * INTO cx FROM contas_caixa WHERE id = v_caixa AND empresa_id = v_empresa;
  IF NOT FOUND THEN RAISE EXCEPTION 'Informe a conta caixa que recebeu o valor.'; END IF;
  IF NOT cx.ativo THEN RAISE EXCEPTION 'A conta caixa "%" está inativa.', cx.nome; END IF;
  IF v_data < cx.data_saldo_inicial THEN
    RAISE EXCEPTION 'A data é anterior ao saldo inicial da conta caixa "%" (%).', cx.nome, to_char(cx.data_saldo_inicial, 'DD/MM/YYYY');
  END IF;

  IF v_pessoa IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pessoas WHERE id = v_pessoa AND empresa_id = v_empresa AND ativo) THEN
    RAISE EXCEPTION 'Pessoa não encontrada ou inativa.';
  END IF;
  IF v_tipo = 'campanha' THEN
    IF v_campanha IS NULL THEN RAISE EXCEPTION 'Escolha a campanha.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM campanhas WHERE id = v_campanha AND empresa_id = v_empresa AND ativo) THEN
      RAISE EXCEPTION 'Campanha não encontrada ou inativa.';
    END IF;
  ELSE
    v_campanha := NULL;
  END IF;
  IF v_centro IS NOT NULL AND NOT EXISTS (SELECT 1 FROM centros_custo WHERE id = v_centro AND empresa_id = v_empresa AND ativo) THEN
    RAISE EXCEPTION 'Centro de custo não encontrado ou inativo.';
  END IF;

  INSERT INTO entradas (empresa_id, tipo, data, valor, conta_caixa_id, forma_pagamento, pessoa_id, campanha_id,
                        centro_custo_id, descricao, registrado_por, registrado_por_nome)
  VALUES (v_empresa, v_tipo, v_data, v_valor, v_caixa, v_forma, v_pessoa, v_campanha, v_centro, v_desc, auth.uid(),
          (SELECT coalesce(nullif(btrim(nome), ''), email) FROM profiles WHERE user_id = auth.uid()))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
