---
name: orchestrator-coordination
description: >-
  Orchestrator multi-agent coordination: 3-phase launch, model state
  management, prompt tracking, stagger logic, and graceful shutdown.
  Use when modifying launch flow, model selection, or shutdown behavior.
---
# Orchestrator Coordination — multi-agent management

## Visão geral

`Orchestrator` (em `src/orchestrator/Orchestrator.ts`) coordena N `AgentSupervisor` instances. Gerencia worktrees, stagger de spawn, model state global, e shutdown ordenado.

## 3-Phase Launch

`launch(tasks: AgentTask[])` executa em 3 fases distintas:

### Phase 1: Create worktrees + instantiate supervisors (sequencial)

```typescript
for (const task of tasks) {
  const wt = await this.wm.create({ id, baseBranch });  // git worktree add
  const supervisor = new AgentSupervisor({ id, cwd: wt.path, model, mock });
  this.supervisors.push(supervisor);
  supervisor.on('stateChange', () => this.refreshModelState());
  this.emit('agentAdded', supervisor);  // UI recebe imediatamente
}
```

Sequencial porque `git worktree add` modifica `.git/worktrees/` — operação não thread-safe. Se criar worktree falha, a task é skipped com `status: 'error'`.

### Phase 2: Start with stagger (paralelo com delay)

```typescript
for (let i = 0; i < prepared.length; i++) {
  const startPromise = (async () => {
    if (i > 0) await sleep(this.spawnStaggerMs);  // default 500ms
    await entry.supervisor.start();  // ACP handshake
    return entry;
  })();
  startPromises.push(startPromise);
}
await Promise.all(startPromises);
```

O stagger evita burst de rate limit. Se `start()` falha (handshake ACP), a task é skipped.

### Phase 3: Fire prompts simultaneously (sem stagger)

```typescript
for (const entry of started) {
  const tracker = this.createTracker(entry.id);
  entry.supervisor.prompt(entry.task.prompt)
    .then(stopReason => tracker.resolve({ id, status: 'done', stopReason }))
    .catch(err => tracker.resolve({ id, status: 'error', error: err.message }));
}
```

Todos os prompts disparam ao mesmo tempo. Cada um tracked por um `PromptResult` promise.

## Prompt Tracking

```typescript
private promptTrackers: Map<string, {
  resolve: (result: PromptResult) => void;
  promise: Promise<PromptResult>;
}>;

createTracker(id) → { resolve, promise }
waitForAll() → Promise.all(trackers.values().map(t => t.promise))
```

`waitForAll()` retorna `PromptResult[]`:
```typescript
interface PromptResult {
  id: string;
  status: 'done' | 'error';
  stopReason?: string;
  error?: string;
}
```

## Model State Management

### OrchestratorModelState

```typescript
interface OrchestratorModelState {
  availableModels: SessionConfigValue[];  // união de modelos de todos supervisors
  selectedModel: string | null;           // modelo global selecionado
  selectedModelLabel: string | null;      // display name do modelo
  switching: boolean;                     // true enquanto setModelForAll() está em andamento
  error: string | null;                   // erro do último switch
}
```

### mergeAvailableModels(supervisors)

Combina modelos de todos supervisors, dedup por `value`:
```typescript
function mergeAvailableModels(supervisors: AgentSupervisor[]): SessionConfigValue[] {
  const seen = new Set<string>();
  const merged: SessionConfigValue[] = [];
  for (const supervisor of supervisors) {
    for (const model of supervisor.getAvailableModels()) {
      if (!seen.has(model.value)) { seen.add(model.value); merged.push(model); }
    }
  }
  return merged;
}
```

### refreshModelState()

Chamada a cada `stateChange` de qualquer supervisor. Recalcula:
1. `availableModels` via `mergeAvailableModels()`
2. `selectedModel` — se todos supervisors reportam o mesmo modelo, esse é o selecionado
3. `selectedModelLabel` — resolve name via modelos disponíveis ou supervisor state
4. `switching` — true se algum supervisor ainda tem modelo diferente do selecionado

Emite `'modelStateChange'` se houve mudança (comparação via `JSON.stringify`).

### setModelForAll(model)

```typescript
async setModelForAll(model: string): Promise<void> {
  // 1. Validar que modelo existe na lista
  // 2. Set switching = true
  // 3. Promise.allSettled(supervisors.map(s => s.setModel(model)))
  // 4. refreshModelState()
  // 5. Set switching = false (ou error se algum falhou)
}
```

Usa `Promise.allSettled` para não falhar se um supervisor não consegue trocar. Primeiro failure é propagado como erro.

## Stagger Configuration

```typescript
this.spawnStaggerMs = opts.spawnStaggerMs
  ?? parseInt(process.env['COPILOT_ORCH_STAGGER_MS'] ?? '', 10)
  ?? 500;  // default 500ms
```

Warning se N>3 e stagger<3000ms:
```
logger.warn('N alto com stagger baixo; considere stagger >= 3000ms')
```

## Limites e guards

- **Max 6 agentes.** `if (tasks.length > 6) throw new Error('N > 6 não suportado')`.
- **Stagger warning.** N>3 com stagger<3000ms gera log warning.
- **Worktree failure.** Falha em criar worktree skip task e resolve tracker com error.
- **Start failure.** Falha no handshake ACP skip task e resolve tracker com error.
- **Agent error event.** Orchestrator registra handler `supervisor.on('error', ...)` para evitar crash por unhandled error event.

## Shutdown coordenado

```typescript
async shutdown(opts?: { preserveWorktrees?: boolean }): Promise<void> {
  // 1. Cancel all — envia session/cancel para cada supervisor
  await Promise.allSettled(this.supervisors.map(s => s.cancel()));

  // 2. Wait — aguarda até 3s por exit voluntário
  await Promise.race([
    Promise.allSettled(this.supervisors.map(s => s.waitForExit())),
    sleep(3000),
  ]);

  // 3. Force shutdown — SIGTERM → SIGKILL para cada supervisor
  await Promise.allSettled(this.supervisors.map(s => s.shutdown()));

  // 4. Destroy worktrees (a menos que preserveWorktrees: true)
  if (!opts?.preserveWorktrees) {
    await this.wm.destroyAll();
  }
}
```

`preserveWorktrees: true` é usado no exit normal para que o usuário possa inspecionar os resultados.

## Init e cleanup

```typescript
async init(): Promise<void> {
  const pruned = await this.wm.pruneOrphans();
  // Log se encontrou worktrees órfãs
}
```

Chamado antes de `launch()`. Remove worktrees de sessões anteriores que crasharam.

## Gotchas

- **agentAdded emitido antes do start().** O UI recebe o supervisor no estado `'spawning'` — antes do handshake ACP. Isso permite ver painéis aparecendo em tempo real.
- **error handler é obrigatório.** Sem `supervisor.on('error', ...)`, Node.js crasha com unhandled 'error' event no EventEmitter.
- **refreshModelState() é chamada frequentemente.** A cada `stateChange` de qualquer supervisor. A comparação via `JSON.stringify` evita emissões desnecessárias.
- **setModelForAll não é atômico.** Cada supervisor troca modelo independentemente. Se um falha, os outros já trocaram.
- **Prompt tracking é fire-and-forget.** Os prompts são disparados e o resultado é capturado via tracker. O Orchestrator não re-tenta prompts que falharam — o retry vive no AgentSupervisor (rate limit).
- **generateId() é Math.random().** IDs de agentes são 6 chars aleatórios (base36). Colisão é possível mas desprezível para N≤6.
