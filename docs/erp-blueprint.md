# EklesiaHub ERP — Blueprint (ponto de partida)

> Status (2026-11-24): referência e escopo aprovados. **Implementado:** fundação mínima (papéis + RLS por papel, navegação por módulo) e **Administrativo → Notas de entrada e Fornecedores**. Demais módulos ainda não existem.
>
> **2026-11-24 (2):** o produto passou a ser **somente o ERP**, com layout de site (menu lateral, URL por módulo `#/modulo/tela`, responsivo) e visual empresarial (Inter, tokens em `src/index.css`). O módulo Kids (check-in, salas, crianças, agenda, app dos pais) foi **arquivado** em `src/kids/KidsApp.jsx` — não é importado por nada; tabelas e views no banco foram mantidas.
>
> **2026-11-24 (3):** o sistema virou **multiempresa** (empresas isoladas pelo banco), com **3 níveis** (Administrador, Supervisor, Usuário), aba **Usuários** (cadastro, nível, desativar, redefinir senha), aba **Parâmetros** (1º: tamanho do número da nota por tipo) e aba **Empresas** (só administrador da plataforma). Detalhes na seção 6.
>
> Decisões: o ERP é construído **dentro do EklesiaHub** (mesmo repo e Supabase; Kids vira um módulo). Começamos pela **entrada de notas** (lançamento manual + anexo; importação de XML da NF-e fica para depois), com o modelo já pronto para a contabilização futura (cada item aponta para uma conta do plano de contas; o status `lancada` está reservado).
>
> Aviso: este sistema organiza a gestão e a escrituração da igreja, mas não substitui o contador responsável nem certifica obrigações fiscais/legais. Plano de contas, regras de contabilização e fechamento devem ser validados por um contador.

## 1. Sistema de referência

**Odoo** como espinha conceitual, com vocabulário fiscal/contábil brasileiro (o mesmo que o TOTVS Protheus usa).

Por que o Odoo:
- É modular: cada "app" (Contabilidade, Compras, Vendas, Estoque, PDV) compartilha o mesmo núcleo — contatos, produtos e **um único razão contábil**.
- Todo documento operacional (nota de entrada, venda no PDV, doação) vira **título financeiro + lançamento contábil**. É exatamente o que queremos em "entrada de notas vinculadas à contabilidade".
- Modelo de dados simples e muito bem documentado, fácil de reproduzir em Postgres/Supabase.

Complementos:
- **ERPNext (domínio Non-profit)**: ideia de membros, doações e campanhas como entidades de primeira classe.
- **TOTVS Protheus**: nomenclatura que o time já conhece — Documento de Entrada (SF1/SD1) → Contas a Pagar (SE2) → Lançamento contábil (CT2); Contas a Receber (SE1); Plano de Contas (CT1).

## 2. Princípio central

```
Documento operacional  →  Título financeiro  →  Lançamento contábil
(nota de entrada,         (a pagar / a receber,    (partidas dobradas,
 venda, oferta)            baixa, caixa/banco)      razão, balancete)
```

Um só razão. Nenhum módulo grava saldo "por fora": tudo que afeta dinheiro passa por lançamento contábil.

## 3. Núcleo compartilhado (todos os módulos usam)

| Entidade | Observação |
|---|---|
| Pessoas/Parceiros | membros, fornecedores, clientes, doadores — um cadastro só, com papéis. Hoje existem `responsaveis`/`professores`; devem apontar para esse cadastro. |
| Plano de contas | hierárquico, com natureza (ativo, passivo, patrimônio social, receita, despesa). |
| Centros de custo | ministérios (Kids, Louvor, Missões, Manutenção…). |
| Fundos | restritos (campanha de construção, missões) e não restritos — comum em entidades sem fins lucrativos. |
| Períodos contábeis | abertos/fechados; período fechado não aceita lançamento. |
| Produtos | itens de livraria/bazar e também serviços/despesas recorrentes. |
| Usuários e papéis | admin, financeiro, contador, comercial, kids (equipe). |

## 4. Módulos pedidos

### Dashboard
KPIs consolidados: saldo de caixa/bancos, a pagar/receber da semana, entradas x saídas do mês, resultado (superávit/déficit), vendas da livraria/bazar, notas pendentes de lançamento, kids presentes hoje.

### Administrativo
- **Entrada de notas** (NF-e, NFS-e, recibos, faturas): fornecedor, itens, impostos retidos, anexo do arquivo (Supabase Storage), centro de custo/fundo.
- Fluxo de status: rascunho → aprovada → lançada (gera título a pagar + lançamento contábil) → cancelada (por estorno).
- Cadastro de fornecedores, contratos e (fase posterior) patrimônio.

### Financeiro
- Contas a pagar e a receber, baixas parciais/totais.
- Caixa e contas bancárias, movimentos, conciliação.
- **Contribuições**: dízimos, ofertas e campanhas (por pessoa opcional, por fundo).
- Orçamento por centro de custo e fluxo de caixa projetado.

### Contábil
- Plano de contas, lançamentos manuais, regras de contabilização automática dos módulos.
- Razão, balancete, DRE (superávit/déficit do exercício), balanço patrimonial.
- Fechamento de período. Lançamento posted é imutável — correção só por estorno.
- Referência normativa de escrituração: ITG 2002 (entidades sem finalidade de lucro) — a validar com o contador.

### Comercial (livraria, bazar, etc.)
- Produtos, preços, estoque com movimentações (entrada por compra/nota, saída por venda, ajuste).
- Vendas/PDV simples com forma de pagamento; venda gera caixa + baixa de estoque + CMV + lançamento contábil.
- Fora do MVP: emissão fiscal (NFC-e/NF-e). Inicialmente venda interna com recibo; integração com emissor externo depois.

### Kids (já existe)
Passa a ser um módulo ("Ministérios") do mesmo ERP, reaproveitando login, papéis e cadastro de pessoas.

## 5. Modelo de dados (esboço)

```
pessoas, pessoa_papeis
plano_contas, centros_custo, fundos, periodos_contabeis
lancamentos (cabeçalho: data, histórico, origem_tipo, origem_id, status)
lancamento_itens (conta, centro_custo, fundo, débito, crédito)   -- numeric(15,2)
documentos_entrada, documento_entrada_itens, documento_anexos
titulos (tipo pagar|receber, vencimento, valor, status), titulo_baixas
contas_bancarias, movimentos_bancarios
produtos, estoque_movimentos
vendas, venda_itens, venda_pagamentos
contribuicoes (pessoa?, fundo, valor, forma, data)
profiles (user_id, papel)
```

Regras no banco (não só no front): soma de débitos = soma de créditos por lançamento; lançamento posted imutável; período fechado bloqueia escrita; valores monetários sempre `numeric`, nunca `float`; trilha de auditoria (quem/quando) em tudo que mexe com dinheiro.

## 6. Multiempresa, níveis de acesso e segurança (`migration_v5_multiempresa.sql`)

**Multiempresa.** O sistema atende várias empresas. Toda tabela do ERP tem `empresa_id`, a RLS compara com `minha_empresa_id()` e chaves estrangeiras compostas `(id, empresa_id)` impedem qualquer referência entre empresas, mesmo por erro de código. Storage de anexos também respeita a empresa. Unicidades (CNPJ de fornecedor, código de conta, chave de NF-e) valem por empresa.

**Administrador da plataforma** (`profiles.plataforma_admin`, concedido só por SQL): cria e gerencia empresas e o primeiro administrador de cada uma; **não enxerga dados de negócio** das empresas. É o único que acessa a aba Empresas.

**Níveis** (por usuário, dentro da empresa):

| | Usuário | Supervisor | Administrador |
|---|---|---|---|
| Lançar/editar rascunhos de notas, cadastrar fornecedores | ✅ | ✅ | ✅ |
| Aprovar e cancelar notas | — | ✅ | ✅ |
| Plano de contas, centros de custo, fundos | só leitura | só leitura | ✅ |
| Usuários e Parâmetros | — | — | ✅ |

A matriz está duplicada de propósito: a regra vale no banco (RLS e gatilhos) e a tela só decide o que mostrar (`src/erp/permissoes.js`). Para mudar o que um nível pode, ajuste os dois lados.

**Contas novas nascem sem acesso** (sem empresa e sem nível) — inclusive auto-cadastro. Só `criar_usuario`/`criar_empresa` liberam. Administrador cria usuários da própria empresa; há proteção contra rebaixar/desativar a si mesmo e contra deixar a empresa sem Administrador ativo.

**Parâmetros por empresa** (`parametros`, catálogo em `src/erp/catalogoParametros.js`): hoje o tamanho máximo do número da nota por tipo, validado também no banco.

**Módulo Kids arquivado:** a v5 fechou o acesso às tabelas, views públicas e à função de check-in. Reativar exige devolver policies com isolamento por empresa.

## 7. Roadmap sugerido

| Fase | Entrega |
|---|---|
| 0 — Fundação | ✅ `profiles` com papéis + RLS por papel, cadastro único de pessoas, navegação por módulo com URL (`src/erp/`), sistema de design (`src/index.css`), Kids arquivado. |
| 2a — Administrativo (adiantado) | ✅ Notas de entrada (rascunho → aprovada → cancelada, imutável após aprovar, anexos privados, itens com conta contábil) e Fornecedores. Migration: `migration_v4_erp.sql`. |
| 1 — Contábil (núcleo) | Plano de contas (hoje só semente de exemplo, sem tela de edição), centros de custo, fundos, lançamentos com partidas dobradas validadas no banco, razão e balancete. |
| 2b — Administrativo → Contábil | Aprovar a nota gera título a pagar + lançamento contábil (usa o status `lancada`). Importação de XML da NF-e. |
| 3 — Financeiro | Caixa/bancos, baixas, contribuições (dízimos/ofertas), fluxo de caixa, conciliação simples. |
| 4 — Comercial | Produtos, estoque, PDV/vendas, compras via entrada de notas, CMV. |
| 5 — Dashboard | KPIs consolidados e DRE/balanço. |
