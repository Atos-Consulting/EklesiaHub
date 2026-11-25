# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
npm run dev -- --port 5175 --host 127.0.0.1   # sem --host o Vite escuta só em ::1 e 127.0.0.1 recusa
npx eslint src/                               # preferir a `npm run lint`: worktrees em .claude/ quebram o lint
npm run build
```

Não há suíte de testes no projeto.

## Arquitetura

O EklesiaHub hoje é **só um ERP multiempresa de igreja** (o `README.md` ainda fala do check-in Kids, que está desatualizado). Stack: React 19 + Vite + Supabase (Postgres, Auth, Storage). **Não há backend próprio:** toda regra de acesso e integridade fica no Postgres (RLS, gatilhos, RPCs). Roadmap e modelo de dados pretendido: `docs/erp-blueprint.md`.

- Fluxo de entrada (`src/App.jsx`): sessão → `Login` → `getPerfil()` (RPC `meu_perfil`) → `ErpApp`, ou uma tela de bloqueio (sem acesso, empresa ou usuário desativado).
- Código do ERP em `src/erp/`. As rotas usam hash (`#/modulo/tela`, ex.: `#/parametros/<aba>`, com a lista em `src/erp/parametros/grupos.js`). O acesso ao banco passa por `src/erp/db.js`.
- O módulo Kids está arquivado em `src/kids/` e não é importado. `src/db.js` só é usado por ele.
- Visual: tokens e classes em `src/index.css`, ícones SVG em `src/erp/Icone.jsx`, componentes compartilhados em `src/ui.jsx` e `src/estilos.js`. Tabelas ordenam pelo cabeçalho com `useOrdenacao` e `ThOrdenavel`, e as colunas ficam definidas fora do componente.

### Multiempresa e permissões

- Toda tabela do ERP tem `empresa_id`, RLS por `minha_empresa_id()` e FKs compostas `(id, empresa_id)`, para nenhum registro apontar para outra empresa. Unicidades são por empresa.
- Níveis: Usuário < Supervisor < Administrador (da empresa). À parte existe o `profiles.plataforma_admin`, que cria e gerencia empresas e pode **trocar de empresa** (clicando no nome da empresa no menu): a escolha fica em `profiles.empresa_atual_id`, `minha_empresa_id()`/`meu_nivel()` passam a devolver essa empresa e o nível Administrador, e o `profiles.empresa_id` (empresa de origem) não muda. Desde a v10 o administrador da plataforma não tem igreja de origem (`empresa_id`/`nivel` nulos): sem igreja escolhida, o `App` mostra a tela de escolha. Na interface, "empresa" aparece como **Igreja**.
- A matriz de permissões fica duplicada de propósito: o banco (RLS e gatilhos) é a fonte da verdade, e `src/erp/permissoes.js` só decide o que mostrar. Mudou uma, mude a outra.
- Usuários são criados e alterados por RPCs (`criar_usuario`, `atualizar_usuario`, `redefinir_senha_usuario`, `criar_empresa`...) que escrevem direto em `auth.users`/`auth.identities`. Conta nova nasce sem empresa e sem nível, ou seja, sem acesso.

### Dinheiro e notas

- Notas de entrada: rascunho → aprovada → cancelada. Nota aprovada é imutável. O total é calculado no banco e o cliente não digita.
- Cada item tem um tipo contábil (define débito e crédito), obrigatório enquanto o parâmetro `contabilidade.ativa` não for `false`. Com a contabilidade desligada (v11), o item pode ficar sem tipo e sem contas; a regra está em `usa_contabilidade()` no banco e em `usaContabilidade()` na tela.
- Use `numeric`, imutabilidade e estorno em vez de edição. O sistema não substitui o contador: o plano de contas semeado é só exemplo.
- Aprovar a nota gera os títulos do Financeiro (`titulos_financeiros`, contas a pagar) conforme a condição de pagamento, no valor **líquido** (total − retenções). À vista já nasce pago pela conta caixa da nota; parcelado fica em aberto até a baixa (`pagar_titulo`). O saldo da conta caixa desconta os **pagamentos** não estornados (`contas_caixa_saldo`). Títulos e pagamentos só são gravados por funções do banco; cancelar nota com parcela paga manualmente exige estornar antes. A prévia das parcelas na tela (`src/erp/financeiro.js`) repete a conta de `gerar_titulos_nota`: mudou uma, mude a outra.
- Entradas (v12, Financeiro → Dízimos e ofertas): dízimo, oferta, campanha ou outra, sempre numa conta caixa, com pessoa opcional. Só `registrar_entrada`/`estornar_entrada` gravam (Supervisor+); a entrada é imutável, e erro se corrige com estorno. O saldo da conta caixa é saldo inicial + entradas − pagamentos, ambos não estornados e a partir da data do saldo inicial. Campanhas (meta e período opcionais) são cadastro do Administrador em Parâmetros → Financeiro.
- Movimentos de caixa (v13, Financeiro → Movimentos de caixa): transferência entre contas, saída avulsa e entrada avulsa, só por `registrar_movimento`/`estornar_movimento` (Supervisor+), imutáveis. A view `extrato_caixa` junta entradas, pagamentos e movimentos (valor + entra, − sai; estornados e datas antes do saldo inicial ficam fora) e é a base de `contas_caixa_saldo` e de `saldo_caixa_ate()`. **Tudo o que mexe em saldo de conta caixa precisa entrar no `extrato_caixa`.**
- Contas a receber (v14): os mesmos `titulos_financeiros` (natureza `receber`, sem nota) e `pagamentos` (a baixa é o recebimento). Lançadas por `criar_contas_receber` (parcelas mensais ou a cada N dias; a prévia em `parcelasReceber()` de `financeiro.js` repete a conta), baixadas por `receber_titulo`, canceladas por `cancelar_titulo_receber`; `pagar_titulo`/`receber_titulo` recusam a natureza errada. A tela é a mesma de contas a pagar (`ContasPagar.jsx` com `natureza`, textos em `TEXTOS`).
- Fluxo de caixa (`src/erp/FluxoCaixa.jsx`, sem migration): realizado do `extrato_caixa` + previsto dos títulos em aberto (pagar e receber), agrupado por dia, semana ou mês, com saldo acumulado a partir de `saldo_caixa_ate()`. Vendo todas as contas, transferências entre elas não contam; vencidos em aberto entram em hoje.
- Importar XML: `src/erp/ImportarXml.jsx` mais o leitor puro `src/erp/nfe.js` (NF-e 55 / NFC-e 65). Cada XML vira sempre um **rascunho**.

### Logs

O gatilho `registrar_log()` (v10) grava em `logs` toda criação, alteração (só os campos que mudaram, com de/para) e exclusão nas tabelas do ERP. Tabela nova do ERP precisa do gatilho `<tabela>_log_trg`. O log é só leitura (Administrador da igreja, em Sistema → Logs). Os itens da nota não são registrados, porque `salvar_nota_entrada` apaga e recria os itens a cada gravação.

### Parâmetros

O catálogo fica em `src/erp/catalogoParametros.js`. **Não** chame o arquivo de `parametros.js`, que colide com `Parametros.jsx` no Windows. Parâmetro novo precisa de três coisas: regra em `parametros_valida()` no SQL, entrada no catálogo e bloco na tela.

## Migrations

Arquivos SQL soltos na raiz, rodados **à mão no SQL Editor** em ordem: `schema.sql` → `migration_v2` → `v3` (Kids) → `v4_erp` → `v5_multiempresa` → `v6_parametros_fiscal` → `v7_niveis_usuarios` → `v8_financeiro` → `v9_trocar_empresa` → `v10_cadastro_logs` → `v11_contabilidade_opcional` → `v12_entradas` → `v13_movimentos_caixa` → `v14_contas_receber`. Não presuma que a última já foi aplicada no banco real. A UI que depende dela quebra até ser aplicada. Teste migrations novas com dados legados já aprovados, porque os gatilhos de imutabilidade podem barrar o backfill.

## BMAD

O projeto tem o próprio `_bmad/` (`config.toml`: `output_folder = "{project-root}/docs"`). Os documentos dos agentes BMAD (PRD, arquitetura, épicos, histórias) vão para `docs/`, junto com o `docs/erp-blueprint.md`.

## Gotchas

- **PostgREST com FK composta:** o embed pelo nome da coluna (`pessoas!fornecedor_id(...)`) dá `PGRST200`. Use o **nome da FK** (`pessoas!documentos_entrada_fornecedor_fk(...)`). Para conferir um embed ou uma RPC sem login, chame com a chave anon: `PGRST200` = relação ou RPC não existe; `42501` = existe, só falta autenticar.
- `desktop.ini` (Google Drive) aparece sempre como modificado. Nunca commite.
