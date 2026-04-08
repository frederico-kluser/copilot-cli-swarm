---
name: mock-development
description: >-
  Mock mode for developing without Copilot CLI. Covers --mock flag, mock
  scenarios (happy/slow/error/rate_limit), MockCopilotProcess internals,
  and how to add new scenarios. Use when working with mock mode or testing.
---
# Mock Development — desenvolvimento sem Copilot real

## Uso básico

```bash
npm run dev:mock -- "prompt"                     # 1 agente, cenário happy
npm run dev:mock -- -n 3 "a" "b" "c"            # 3 agentes mock
npm run dev:mock:slow -- "test"                  # cenário slow (delays 3x)
npm run dev:mock:error -- "test"                 # cenário error (tool_call falha)
npm run dev -- --mock --mock-scenario=rate_limit "test"  # cenário rate_limit
```

Mock mode não precisa de Copilot instalado, não gasta rate limit, e completa em segundos.

## Cenários disponíveis

| Cenário | Comportamento | Duração aprox. |
|---|---|---|
| `happy` | Fluxo completo: thought → plan → tool_call → message_chunks → done | ~4s |
| `slow` | Igual a happy mas com delays 3x maiores | ~12s |
| `error` | tool_call_update com status `failed`, exit 1 | ~3s |
| `rate_limit` | Response JSON-RPC com code 429, exit 1 (dispara retry no AgentSupervisor) | ~3s + backoff |

## Anatomia do MockCopilotProcess (`src/mock/MockCopilotProcess.ts`)

```typescript
class MockCopilotProcess extends EventEmitter {
  readonly stdin: PassThrough;    // Writable — recebe requests
  readonly stdout: PassThrough;   // Readable — emite responses/notifications
  readonly stderr: PassThrough;   // Readable — vazio no happy path
  readonly pid: number;           // Fake PID (900000+)
  killed: boolean;

  constructor(opts: { scenario?: MockScenario; seed?: number })
  kill(signal?: NodeJS.Signals): boolean
}
```

**Interface duck-typed.** O AgentSupervisor recebe `MockCopilotProcess` ou `execa child` sem nenhum `if (mock)` — ambos expõem `stdin`, `stdout`, `stderr`, `pid`, `killed`, `kill()`, e evento `'exit'`.

## Fluxo interno do cenário happy

```
t=0ms    → initialize response (protocolVersion: 1)
t=100ms  → session/new response (sessionId: mock_sess_{pid})
t=500ms  → notification: agent_thought_chunk "Analyzing..."
t=1000ms → notification: plan (3 entries)
t=1500ms → notification: tool_call (execute "ls -la")
t=2500ms → notification: tool_call_update (completed)
t=2800ms → notifications: 12x agent_message_chunk (100ms entre cada)
t=4000ms → response: session/prompt {stopReason: "end_turn"}
t=4000ms → stdout.push(null) + emit('exit', 0, null)
```

## Como adicionar um novo cenário

1. Adicionar o nome ao type `MockScenario` em `src/mock/MockCopilotProcess.ts`:
   ```typescript
   export type MockScenario = 'happy' | 'slow' | 'error' | 'rate_limit' | 'novo';
   ```

2. Adicionar o branch em `startScenario()`:
   ```typescript
   if (scenario === 'novo') {
     // Emitir NDJSON via emit(out, {...})
     // Usar await sleep(ms, this.abort) entre mensagens
     // Sempre verificar if (this.abort.aborted) return; após cada sleep
     // Terminar com exit event
     return;
   }
   ```

3. Adicionar flag CLI em `src/cli.ts` (adicionar ao array `VALID_SCENARIOS`):
   ```typescript
   const VALID_SCENARIOS = ['happy', 'slow', 'error', 'rate_limit', 'novo'] as const;
   ```

4. Adicionar script em `package.json`:
   ```json
   "dev:mock:novo": "tsx src/index.ts --mock --mock-scenario=novo"
   ```

5. Testar: `npm run dev:mock:novo -- "test prompt"`

## fake-acp-stream.ts vs MockCopilotProcess

| | fake-acp-stream.ts | MockCopilotProcess |
|---|---|---|
| Localização | `src/mock/fake-acp-stream.ts` | `src/mock/MockCopilotProcess.ts` |
| Execução | Script standalone (`npx tsx`) | In-process (instanciado pelo AgentSupervisor) |
| I/O | `process.stdout.write` | `PassThrough` streams em memória |
| Uso | Debug manual, validação de formato | Runtime em `--mock` mode |
| Cenários | happy + error (via `--scenario=error`) | happy, slow, error, rate_limit |

`fake-acp-stream.ts` é útil para validação manual do formato NDJSON. `MockCopilotProcess` é o que roda em produção mock.

## Gotchas

- **Abort signal.** Cada sleep no MockCopilotProcess checa `this.abort.aborted` para parar emissão após `kill()`. Sem isso, o mock continua emitindo após shutdown.
- **Stream end.** No cenário happy, `stdout.push(null)` é chamado após o último response para sinalizar EOF. Cenários de erro emitem exit mas podem não fechar o stream explicitamente.
- **Fake PIDs.** Range 900000+ para nunca colidir com PIDs reais. O pids-file.ts registra esses PIDs mas `isProcessAlive(fakePid)` retorna false, então o reaper os ignora.
- **Seed.** O campo `seed` existe para reprodutibilidade futura mas não é implementado nos cenários atuais. Cenários são determinísticos sem seed.
