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
- Níveis: Usuário < Supervisor < Administrador (da empresa). À parte existe o `profiles.plataforma_admin`, que cria e gerencia empresas mas **não vê dados de negócio**.
- A matriz de permissões fica duplicada de propósito: o banco (RLS e gatilhos) é a fonte da verdade, e `src/erp/permissoes.js` só decide o que mostrar. Mudou uma, mude a outra.
- Usuários são criados e alterados por RPCs (`criar_usuario`, `atualizar_usuario`, `redefinir_senha_usuario`, `criar_empresa`...) que escrevem direto em `auth.users`/`auth.identities`. Conta nova nasce sem empresa e sem nível, ou seja, sem acesso.

### Dinheiro e notas

- Notas de entrada: rascunho → aprovada → cancelada. Nota aprovada é imutável. O total é calculado no banco e o cliente não digita.
- Use `numeric`, imutabilidade e estorno em vez de edição. O sistema não substitui o contador: o plano de contas semeado é só exemplo.
- Importar XML: `src/erp/ImportarXml.jsx` mais o leitor puro `src/erp/nfe.js` (NF-e 55 / NFC-e 65). Cada XML vira sempre um **rascunho**.

### Parâmetros

O catálogo fica em `src/erp/catalogoParametros.js`. **Não** chame o arquivo de `parametros.js`, que colide com `Parametros.jsx` no Windows. Parâmetro novo precisa de três coisas: regra em `parametros_valida()` no SQL, entrada no catálogo e bloco na tela.

## Migrations

Arquivos SQL soltos na raiz, rodados **à mão no SQL Editor** em ordem: `schema.sql` → `migration_v2` → `v3` (Kids) → `v4_erp` → `v5_multiempresa` → `v6_parametros_fiscal` → `v7_niveis_usuarios`. Não presuma que a última já foi aplicada no banco real. A UI que depende dela quebra até ser aplicada. Teste migrations novas com dados legados já aprovados, porque os gatilhos de imutabilidade podem barrar o backfill.

## Gotchas

- **PostgREST com FK composta:** o embed pelo nome da coluna (`pessoas!fornecedor_id(...)`) dá `PGRST200`. Use o **nome da FK** (`pessoas!documentos_entrada_fornecedor_fk(...)`). Para conferir um embed ou uma RPC sem login, chame com a chave anon: `PGRST200` = relação ou RPC não existe; `42501` = existe, só falta autenticar.
- `desktop.ini` (Google Drive) aparece sempre como modificado. Nunca commite.
