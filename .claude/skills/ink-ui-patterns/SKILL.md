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
App ({ supervisors, startedAt })
├── StatusBar ({ supervisors, startedAt })  — barra de status no topo
├── AgentGrid ({ supervisors })             — grid responsivo
│   └── AgentPanel × N ({ supervisor, width }) — painel por agente (memo)
└── Footer ()                               — caminho do log file
```

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

## Gotchas

- **Nunca usar `<Static>` para painéis.** `<Static>` é para conteúdo append-only que não muda. Painéis de agente atualizam constantemente — usar `<Box>` normal.
- **Nunca usar `<Spinner>` em grid.** Ink 6.x teve bugs com múltiplos Spinners simultâneos em grids. Usar ícones unicode estáticos por fase.
- **Nunca `console.log` em componentes.** stdout é do Ink. Qualquer print corrompe o layout. Para debug, usar `process.stderr.write()` ou `logger`.
- **`exitOnCtrlC: false` no render.** O shutdown coordenado precisa unmount do Ink ANTES de cleanup. Se exitOnCtrlC for true, Ink sai antes do cleanup.
- **Unmount ANTES de qualquer cleanup.** No handler de SIGINT: `inkInstance.unmount()` é a primeira coisa. Senão o terminal fica com raw mode ligado.
- **Nenhum key warning.** Sempre usar `key={s.id}` no map de AgentPanel.
- **patchConsole: true** no render redireciona console.log/error para não quebrar layout.
