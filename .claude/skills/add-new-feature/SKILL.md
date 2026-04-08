---
name: add-new-feature
description: >-
  Step-by-step workflow for adding new features to the orchestrator. Covers
  the full path from ACP types through phase machine, supervisor, orchestrator,
  UI, tests, and mock updates. Use when planning or implementing new features.
---
# Add New Feature — workflow step-by-step

## Checklist de implementação

Seguir esta ordem evita dependências quebradas entre módulos:

### 1. Tipo ACP (se a feature envolve novo tipo de mensagem)

Arquivo: `src/acp/types.ts`

- Criar nova interface na discriminated union `SessionUpdate`
- Adicionar type guard: `export const isNovoTipo = (u: SessionUpdate): u is NovoTipo => u.sessionUpdate === 'novo_tipo';`
- Adicionar na union: `export type SessionUpdate = ... | NovoTipo;`

### 2. Phase machine (se a feature afeta estado do agente)

Arquivo: `src/acp/phase-machine.ts`

- Se nova fase: adicionar em `AgentPhase` type
- Se novo campo em AgentState: adicionar com valor default em `initialState`
- Adicionar handling em `reduceAgentState()` usando o type guard
- Lembrar: função PURA — sem I/O, sem async, sem Date.now
- Sempre retornar novo objeto (spread), nunca mutar

Testes: `src/acp/__tests__/phase-machine.test.ts`

- Testar transição: estado anterior → update → estado esperado
- Testar estados absorventes (done, error) bloqueiam a transição
- Testar acumulação se novo campo acumula

### 3. AgentSupervisor (se a feature afeta ciclo de vida do agente)

Arquivo: `src/agent/AgentSupervisor.ts`

- Novo campo em `AgentSupervisorOptions` se configurável
- Handler para novo tipo de notification se vem via ACP
- Método público se expõe nova operação

### 4. Orchestrator (se a feature afeta coordenação)

Arquivo: `src/orchestrator/Orchestrator.ts`

- Propagar nova opção de `OrchestratorOptions` para `AgentSupervisorOptions`
- Registrar error handler no supervisor: `supervisor.on('error', ...)`
- Se novo resultado: adicionar campo em `PromptResult`
- Se novo modelo/config: atualizar `refreshModelState()` ou `mergeAvailableModels()`

### 4.5. Model integration (se a feature envolve seleção de modelo)

Arquivos: `src/orchestrator/Orchestrator.ts`, `src/agent/AgentSupervisor.ts`

- Se novo configOption: atualizar helpers em `src/acp/types.ts` (`getModelConfigOption`, etc.)
- Propagar model option via `OrchestratorOptions.model` → `AgentSupervisorOptions.model` → `buildCommandArgs()`
- Se modelo selecionável pela UI: integrar com `setModelForAll()` no Orchestrator
- Atualizar `OrchestratorModelState` se necessário

### 5. CLI (se a feature tem flag nova)

Arquivo: `src/cli.ts`

- Adicionar em `parseArgs.options`
- Adicionar em `ParsedArgs` interface
- Validar valor em `parseCli()`
- Adicionar na help text
- Propagar para Orchestrator/AgentSupervisor no `src/index.ts`

### 5.5. Wizard updates (se a feature adiciona nova opção de configuração interativa)

Arquivos: `src/ui/wizard/WizardScreen.tsx`, `src/ui/wizard/types.ts`

- Se novo step no wizard: adicionar à union `WizardStep` em `types.ts`
- Adicionar estado (`useState`) no `WizardScreen` para o novo campo
- Implementar JSX condicional para o novo step (seguindo padrão dos steps existentes)
- Propagar novo campo no `WizardConfig` → `AgentConfig` → `onComplete` callback
- Componentes disponíveis: `TextInput`, `ConfirmInput` (@inkjs/ui), `ArrowSelect` (custom)

### 6. UI (se a feature é visível)

Arquivos: `src/ui/AgentPanel.tsx`, `src/ui/StatusBar.tsx`, `src/ui/App.tsx`

- Nova fase → adicionar em `PHASE_ICON`, `PHASE_LABEL`, `phaseBorderColor()` no AgentPanel
- Novo campo visual no painel → adicionar JSX conditionals em AgentPanel
- Novo agregado na StatusBar → atualizar subscribe/getSnapshot
- Novo model/config UI → integrar com model selector overlay na App (useInput keybindings)
- Se afeta wizard → ver step 5.5

### 7. Mock (se a feature usa ACP)

Arquivo: `src/mock/MockCopilotProcess.ts`

- Adicionar emissão do novo tipo de notification no cenário relevante
- Se novo cenário: adicionar ao `MockScenario` type e implementar branch
- Atualizar `src/cli.ts` VALID_SCENARIOS se novo cenário

### 8. Testes

- Phase machine: `src/acp/__tests__/phase-machine.test.ts` — nova transição
- WorktreeManager: `src/worktree/__tests__/WorktreeManager.test.ts` — se tocou worktrees
- CLI: `src/__tests__/cli.test.ts` — se adicionou nova flag
- Validação manual: `npm run dev:mock -- "test"` para verificar visualmente

### 9. Checklist final

```bash
npm run typecheck          # tsc --noEmit sem erros
npm run test:run           # todos os testes passam
npm run dev:mock -- "x"    # UI funciona com 1 agente
npm run dev:mock -- -n 3 "a" "b" "c"  # UI funciona com 3 agentes
```

Se a feature tem modo interativo, testar também:
```bash
npm run dev:mock           # Abre wizard, preencher config, verificar launch
```

## Gotchas de integração

- **Imports ESM.** Todo import local usa `.js`: `import { X } from './types.js'`. Não `.ts`.
- **Error event handler.** Se AgentSupervisor emite `'error'`, o Orchestrator DEVE ter listener registrado. Sem listener, Node crasha com unhandled error event.
- **Ordem de campos em AgentState.** `initialState` deve ter o novo campo com valor default. Se esquecer, `reduceAgentState` vai retornar `undefined` para o campo.
- **Mock deve emitir mesmo formato.** MockCopilotProcess precisa emitir notifications no mesmo formato NDJSON que o Copilot real. O discriminador é `params.update.sessionUpdate`.
- **UI memo.** Se os props de AgentPanel mudam (ex: nova prop), o memo comparison precisa detectar. Props de referência (objects) que mudam shallow identity causam re-render desnecessário.
- **Log, nunca print.** Qualquer output de debug vai para `logger.info()` ou `logger.debug()`, nunca console.log. Verificar com grep antes de commitar.
- **Interactive mode flow.** `WizardScreen.onComplete(config)` → `App` muda para running mode → `onLaunch(config)` → `index.ts` constrói tasks → `orch.launch(tasks)`. A UI já está renderizada quando o launch ocorre.
- **Model propagation.** `WizardConfig.model` → `AgentTask.model` → `AgentSupervisorOptions.model` → `buildCommandArgs()` → `--model X` no CLI do Copilot. Se vazio/auto, não passa `--model`.
