---
name: ink-ui-patterns
description: >-
  Ink 6.8 terminal UI patterns with React 19. Grid layout for N agent panels,
  useSyncExternalStore for real-time state, memo for performance. Use when
  creating or modifying UI components, layouts, or agent state subscriptions.
---
# Ink UI Patterns — React 19 + Ink 6.8

## Arquitetura de componentes

```
App ({ orchestrator, startedAt, interactive?, onLaunch? })
├── [wizard mode] WizardScreen ({ onComplete }) — config interativa
│   └── ArrowSelect, TextInput, ConfirmInput
│
├── [running mode]
│   ├── StatusBar ({ supervisors, startedAt, modelState, selectorOpen })
│   ├── [selectorOpen] Model Selector overlay
│   ├── AgentGrid ({ supervisors })
│   │   └── AgentPanel × N ({ supervisor, width }) — painel por agente (memo)
│   └── Footer ()
```

## Modos da App

```typescript
interface AppProps {
  orchestrator: Orchestrator;
  startedAt: number;
  interactive?: boolean;        // true → começa no wizard
  onLaunch?: (config: WizardConfig) => void;
}
```

App usa `useState<'wizard' | 'running'>`. Em modo `wizard`, renderiza `WizardScreen`. Quando wizard completa, muda para `running` e chama `onLaunch(config)`.

## Grid responsivo

O `AgentGrid` calcula colunas baseado em `supervisors.length`:

| N agentes | Colunas | Width por painel |
|---|---|---|
| 1 | 1 | 100% |
| 2 | 2 | 50% |
| 3-4 | 2 | 50% |
| 5-6 | 3 | 33% |

```tsx
const cols = n <= 2 ? n || 1 : n <= 4 ? 2 : 3;
const width = `${Math.floor(100 / cols)}%`;
```

Layout usa `<Box flexDirection="row" flexWrap="wrap">` com cada AgentPanel recebendo `width` como prop.

## Hook useAgentState

```typescript
// src/ui/useAgentState.ts
export function useAgentState(supervisor: AgentSupervisor): AgentState {
  const subscribe = useCallback((cb) => {
    supervisor.on('stateChange', cb);
    return () => supervisor.off('stateChange', cb);
  }, [supervisor]);
  const getSnapshot = useCallback(() => supervisor.state, [supervisor]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
```

**Sempre usar `useSyncExternalStore`**, nunca `useState + useEffect`. O motivo: `useSyncExternalStore` evita tearing em updates rápidos (múltiplos stateChange em sequência antes do React re-renderizar).

## AgentPanel — memoização

```tsx
export const AgentPanel = memo(function AgentPanel({ supervisor, width }) {
  const state = useAgentState(supervisor);
  // ...render baseado em state.phase
});
```

`memo` é obrigatório: quando um supervisor muda estado, apenas seu AgentPanel re-renderiza. Sem memo, todos os painéis re-renderizam a cada update de qualquer agente.

## StatusBar — multi-subscriber

```typescript
function usePhaseCounts(supervisors: AgentSupervisor[]) {
  const subscribe = useCallback((cb) => {
    supervisors.forEach(s => s.on('stateChange', cb));
    return () => supervisors.forEach(s => s.off('stateChange', cb));
  }, [supervisors]);
  const getSnapshot = useCallback(() => {
    const counts = { spawning: 0, idle: 0, thinking: 0, /* ... */ };
    supervisors.forEach(s => counts[s.state.phase]++);
    return JSON.stringify(counts);  // nova ref a cada mudança
  }, [supervisors]);
  return JSON.parse(useSyncExternalStore(subscribe, getSnapshot));
}
```

O `getSnapshot` retorna string JSON para garantir referência consistente. O parse acontece fora do store.

## Cores e ícones por fase

| Phase | Borda | Ícone |
|---|---|---|
| `spawning` | gray | `...` |
| `idle` | gray | `ZZZ` |
| `thinking` | green | `[T]` |
| `planning` | green | `[P]` |
| `tool_call` | green | `[>]` |
| `responding` | green | `[R]` |
| `done` | gray | `[OK]` |
| `error` | red | `[!!]` |
| `rate_limited` | yellow | `[~~]` |

## Timer elapsed no StatusBar

```tsx
const [elapsed, setElapsed] = useState(Date.now() - startedAt);
useEffect(() => {
  const t = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
  return () => clearInterval(t);
}, [startedAt]);
```

Formatar como `MM:SS`. Nunca usar `Date.now()` direto no JSX — sempre via state/effect.

## Model Selector overlay

App gerencia `selectorOpen` e `highlightedIndex` state. Keybindings via `useInput`:

```typescript
useInput((input, key) => {
  if ((input === 'm' || input === 'M') && modelState.availableModels.length > 0) {
    setSelectorOpen(open => !open);    // Toggle com M
  }
  if (selectorOpen) {
    if (key.escape) setSelectorOpen(false);
    if (key.upArrow || input === 'k') setHighlightedIndex(i => i <= 0 ? last : i - 1);
    if (key.downArrow || input === 'j') setHighlightedIndex(i => (i + 1) % total);
    if (key.return) {
      const model = modelState.availableModels[highlightedIndex];
      setSelectorOpen(false);
      orchestrator.setModelForAll(model.value);
    }
  }
});
```

Renderiza dropdown com borda `round`, cor `cyan` (ou `yellow` durante switching).

## useOrchestratorModelState hook

```typescript
function useOrchestratorModelState(orch: Orchestrator): OrchestratorModelState {
  const subscribe = useCallback((cb) => {
    orch.on('modelStateChange', cb);
    return () => orch.off('modelStateChange', cb);
  }, [orch]);
  const getSnapshot = useCallback(() => orch.getModelState(), [orch]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
```

Retorna `{ availableModels, selectedModel, selectedModelLabel, switching, error }`.

## useOrchestratorSupervisors hook

```typescript
function useOrchestratorSupervisors(orch: Orchestrator): AgentSupervisor[] {
  const [supervisors, setSupervisors] = useState(() => [...orch.supervisors]);
  useEffect(() => {
    setSupervisors([...orch.supervisors]);  // sync on mount
    const onAdded = () => setSupervisors([...orch.supervisors]);
    orch.on('agentAdded', onAdded);
    return () => orch.off('agentAdded', onAdded);
  }, [orch]);
  return supervisors;
}
```

Usa `useState` + `useEffect` (não `useSyncExternalStore`) porque a lista cresce mas não tem snapshot estável — novos supervisors são adicionados via evento.

## WizardScreen

Steps: `agents_count` → `model_select` → `prompt_mode` → `prompts` → `model_overrides` → `review`.

```typescript
interface WizardConfig {
  agents: number;
  model: string;
  agentConfigs: AgentConfig[];  // { id, prompt, model? }
}
```

Componentes usados:
- `TextInput` (@inkjs/ui) — para número de agentes e prompts
- `ConfirmInput` (@inkjs/ui) — para sim/não (prompt compartilhado, overrides de modelo)
- `ArrowSelect` (custom) — seletor com setas, substitui `Select` do @inkjs/ui que tem bugs com valores vazios

### ArrowSelect (custom component)

```tsx
function ArrowSelect({ options, onSelect }: {
  options: { label: string; value: string; description?: string }[];
  onSelect: (value: string) => void;
}) {
  const [focused, setFocused] = useState(0);
  useInput((_input, key) => {
    if (key.upArrow) setFocused(i => i <= 0 ? options.length - 1 : i - 1);
    if (key.downArrow) setFocused(i => i >= options.length - 1 ? 0 : i + 1);
    if (key.return) onSelect(options[focused].value);
  });
  // render com '> ' para focused, '  ' para outros
}
```

## AgentPanel — model e rate_limited display

```tsx
{(state.currentModelLabel || state.currentModel) && (
  <Text dimColor>model: {state.currentModelLabel ?? state.currentModel}</Text>
)}

{state.phase === 'rate_limited' && (
  <Text color="yellow">
    rate limited, retry {state.retryCount}/3
    {state.retryResumeAt
      ? ` in ${Math.max(0, Math.ceil((state.retryResumeAt - Date.now()) / 1000))}s`
      : ''}
  </Text>
)}
```

## Gotchas

- **Nunca usar `<Static>` para painéis.** `<Static>` é para conteúdo append-only que não muda. Painéis de agente atualizam constantemente — usar `<Box>` normal.
- **Nunca usar `<Spinner>` em grid.** Ink 6.x teve bugs com múltiplos Spinners simultâneos em grids. Usar ícones unicode estáticos por fase.
- **Nunca `console.log` em componentes.** stdout é do Ink. Qualquer print corrompe o layout. Para debug, usar `process.stderr.write()` ou `logger`.
- **`exitOnCtrlC: false` no render.** O shutdown coordenado precisa unmount do Ink ANTES de cleanup. Se exitOnCtrlC for true, Ink sai antes do cleanup.
- **Unmount ANTES de qualquer cleanup.** No handler de SIGINT: `inkInstance.unmount()` é a primeira coisa. Senão o terminal fica com raw mode ligado.
- **Nenhum key warning.** Sempre usar `key={s.id}` no map de AgentPanel.
- **patchConsole: true** no render redireciona console.log/error para não quebrar layout.
