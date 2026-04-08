# Roadmap com prompts por tarefa: orquestrador multi-agente Copilot CLI

Este documento estende o roadmap de 4 semanas adicionando, para cada uma das 22 tarefas, um prompt autocontido pronto para ser passado a um coding agent (Copilot CLI, Claude Code, Cursor). Os prompts seguem o padrão CO-STAR em XML tags — preferido por Claude e Copilot — com contexto em camadas (projeto → stack → tarefa → critérios), referências técnicas concretas, e critérios de aceitação verificáveis por comando shell. Anti-padrões de prompt foram evitados sistematicamente: nada de "escreva código limpo", nada de instruções genéricas, nada de assumir contexto compartilhado falso.

**Regra para usar os prompts:** cada prompt assume que as tarefas anteriores estão concluídas no repositório. O agente pode ler qualquer arquivo já existente no working tree, mas não deve inventar APIs — quando um detalhe de SDK for marcado como "verificar nos tipos", o agente deve literalmente abrir o `.d.ts` do pacote antes de escrever código que dependa dele.

---

## Camada 0: contexto compartilhado entre todos os prompts

Este bloco é o **prefixo estável** que pode ser anexado ao topo de qualquer prompt se o agente perder contexto entre sessões. Você não precisa repeti-lo — está aqui como referência única.

```xml
<project_overview>
Nome: multi-copilot-orchestrator (projeto pessoal, solo, Linux/macOS/WSL)
Objetivo: um único processo Node.js que spawna N instâncias de `copilot --acp --stdio`, 
cada uma rodando em sua própria git worktree, com UI em grid Ink mostrando streaming em 
tempo real do estado de cada agente (thinking, planning, tool_call, responding, done, error).
Arquitetura: Arquitetura A — tudo em um Ink (um processo Node, N child processes Copilot 
via ACP stdio, tmux apenas como wrapper externo para detach/reattach).
</project_overview>

<stack>
- Runtime: Node 22+, TypeScript 6.0, tsx 4.21 (ESM puro, "type":"module")
- Copilot ACP: @agentclientprotocol/sdk (pinar versão exata, 0.17.x)
- Copilot CLI: @github/copilot instalado globalmente, invocado como `copilot --acp --stdio`
- UI: ink 6.8 + @inkjs/ui 2.0 + react 19
- Git: simple-git 3.35 (worktrees via .raw() — não há API dedicada)
- Processos: execa 9.6 (preferir sobre child_process puro)
- Logging: pino 10.3 (destino: arquivo, NUNCA stdout — conflita com Ink)
- Testes: vitest 4.1 (com @vitest/coverage-v8)
</stack>

<critical_constraints>
- Ink renderiza no stdout do processo; qualquer log, console.log, ou print que vaze para 
  stdout vai corromper a UI. pino SEMPRE para arquivo, stderr só para erros fatais.
- ACP = JSON-RPC 2.0 sobre NDJSON em stdio. O child process Copilot usa seu próprio stdin 
  (do ponto de vista dele) para receber requests e stdout para enviar. No orchestrator, 
  escrevemos no stdin do child e lemos do stdout do child.
- Copilot CLI em modo ACP auto-aprova tool calls (Issue github/copilot-cli#845, confirmado 
  em abril 2026). O handler de requestPermission precisa existir no protocolo mas na 
  prática nunca é chamado. Não dependa dele para gating de segurança.
- Rate limit burst do Copilot é ~10-20 req/min com hard-fail (não throttle). Staggering 
  de spawn e retry com backoff são obrigatórios quando N >= 3.
- simple-git worktrees usam .raw('worktree', 'add', ...) — não existe .worktree() method.
- Branch name inválido em git worktree add pode corromper .git/worktrees; sempre validar.
</critical_constraints>

<layout>
src/
  acp/
    types.ts              # tipos ACP derivados do SDK + spec
    phase-machine.ts      # session/update → AgentPhase
    __tests__/
  agent/
    AgentSupervisor.ts    # 1 classe = 1 child process Copilot
  worktree/
    WorktreeManager.ts
    __tests__/
  orchestrator/
    Orchestrator.ts       # gerencia N supervisors
  ui/
    App.tsx
    AgentGrid.tsx
    AgentPanel.tsx
    StatusBar.tsx
  logging/
    logger.ts             # pino configurado
  mock/
    fake-acp-stream.ts    # script standalone para desenvolvimento
    MockCopilotProcess.ts # fachada usada no modo --mock
  cli.ts                  # parseArgs
  index.ts                # entry point
scripts/
  setup.sh
  cleanup-worktrees.sh
</layout>
```

---

## Seção 1: estrutura temporal

| Semana | Objetivo | Horas | DoD curto |
|---|---|---|---|
| S1 | Um agente end-to-end | ~25h | `npm run dev -- "prompt"` mostra 1 painel streamando |
| S2 | N agentes em paralelo | ~17h | `npm run dev -- -n 3 ...` grid de 3 painéis |
| S3 | Hardening | ~15h | `kill -9` em agente → painel vermelho, sem zumbis |
| S4 | Polish + mock completo | ~18h | `npm run dev:mock` funciona clean + README |

---

## Seção 2: as 22 tarefas com prompts

Cada tarefa tem: linha de tabela resumo + prompt completo logo abaixo.

Convenção para nome de sessão DAG: `dag-l{camada}-t{nn}-deps-{deps}`.
Mesma `camada` = tarefas potencialmente paralelizáveis assim que todas as dependências diretas estiverem concluídas.

---

### Tarefa 1 — Setup projeto

| Campo | Valor |
|---|---|
| Arquivos | `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/index.ts` |
| Depende de | — |
| Nome da sessão DAG | `dag-l0-t01-root` |
| Validação | `npx tsc --noEmit` e `npm test` passam; `npx tsx src/index.ts` imprime "hello" |
| Horas | 2h |

#### Prompt da tarefa 1

```xml
<role>
Você é um engenheiro Node.js/TypeScript sênior iniciando um projeto pessoal em ESM puro 
com suporte a JSX (Ink). O projeto rodará em Linux/macOS/WSL. Autor é o único consumidor.
</role>

<task>
Criar o scaffold inicial do projeto: package.json com scripts, tsconfig.json configurado 
para ESM + React JSX + Node 22, vitest.config.ts, .gitignore, e um src/index.ts mínimo 
que apenas imprime "hello" via stderr (NUNCA stdout — o stdout será do Ink mais tarde).
Não adicionar nenhum código de ACP, Ink, ou worktree ainda — apenas o esqueleto que 
compila e roda.
</task>

<files_to_create>
- package.json com "type":"module", scripts: dev, test, test:watch, typecheck, build.
  dev executa `tsx src/index.ts`, typecheck executa `tsc --noEmit`, test executa vitest.
- tsconfig.json: target ES2022, module NodeNext, moduleResolution NodeNext, jsx "react-jsx", 
  strict true, noUncheckedIndexedAccess true, outDir dist, rootDir src, 
  resolveJsonModule true, skipLibCheck true.
- vitest.config.ts: environment node, coverage provider v8, include src/**/*.test.ts.
- .gitignore: node_modules, dist, *.log, .env, .tsbuildinfo, coverage.
- src/index.ts: process.stderr.write("hello\n"); process.exit(0);
</files_to_create>

<dependencies_to_install>
devDependencies (versões exatas, pinadas):
  typescript@~6.0.0, tsx@~4.21.0, vitest@~4.1.0, @vitest/coverage-v8@~4.1.0,
  @types/node@~22.0.0, @types/react@~19.0.0
dependencies:
  NENHUMA ainda. Serão adicionadas tarefa a tarefa.
</dependencies_to_install>

<acceptance_criteria>
1. `npm install` completa sem peer warnings.
2. `npm run typecheck` retorna exit 0.
3. `npm run dev` imprime "hello" no stderr e sai com código 0.
4. `npm test` passa (sem testes ainda = 0 passed, 0 failed, exit 0).
5. `ls src/` mostra apenas index.ts.
</acceptance_criteria>

<constraints>
- NÃO crie src/ui, src/agent, src/worktree — serão criados nas tarefas seguintes.
- NÃO use ts-node, babel, swc, webpack — apenas tsx para rodar, tsc para typecheck.
- NÃO adicione ESLint ou Prettier agora; polish de Semana 4.
- NÃO use CommonJS; "type":"module" é obrigatório.
- tsconfig moduleResolution deve ser "NodeNext", não "Node" nem "Bundler".
</constraints>
```

---

### Tarefa 2 — Mock ACP stream

| Campo | Valor |
|---|---|
| Arquivos | `src/mock/fake-acp-stream.ts` |
| Depende de | 1 |
| Nome da sessão DAG | `dag-l1-t02-deps-t01` |
| Validação | `npx tsx src/mock/fake-acp-stream.ts` emite ≥10 linhas NDJSON válidas em ~8s |
| Horas | 3h |

#### Prompt da tarefa 2

```xml
<role>
Você está criando uma ferramenta de desenvolvimento que substitui o Copilot CLI real 
durante a iteração — para não gastar rate limit enquanto testa UI e orquestração.
</role>

<task>
Criar um script standalone em src/mock/fake-acp-stream.ts que, quando executado diretamente 
via tsx, lê requests JSON-RPC de seu stdin e emite notifications session/update no stdout 
em formato NDJSON (uma linha JSON por mensagem). Ele simula o ciclo completo de uma sessão 
ACP realística: initialize response → newSession response → sequência de session/update 
notifications → final response para session/prompt.
</task>

<acp_message_shapes>
Formato JSON-RPC 2.0. Todos os objetos ficam em uma linha (NDJSON), terminados por \n.

Request (client → agent), tem id:
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}

Response (agent → client), mesmo id:
{"jsonrpc":"2.0","id":1,"result":{...}}

Notification (agent → client, fire-and-forget), SEM id:
{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"sess_1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"..."}}}}

O discriminador é o campo "sessionUpdate" dentro de params.update. Valores a simular:
- "agent_thought_chunk" com content: {text: "..."}
- "plan" com entries: [{content: "step 1", priority: "high", status: "pending"}]
- "tool_call" com toolCallId, title, kind (ex: "execute"), rawInput
- "tool_call_update" com toolCallId, status ("pending"|"in_progress"|"completed"|"failed")
- "agent_message_chunk" com content: {type: "text", text: "..."}

Nota: a estrutura exata pode variar entre versões do @agentclientprotocol/sdk. Nesta tarefa 
fingimos — a tarefa 4 (spike) captura o formato real e a tarefa 5 cria os tipos definitivos.
</acp_message_shapes>

<scenario_to_simulate>
Sequência com delays realistas usando setTimeout:
t=0:   envia response de initialize (protocolVersion: 1, agentCapabilities: {})
t=100: envia response de session/new (sessionId: "mock_sess_1")
t=500: notification agent_thought_chunk "Analisando a estrutura do repositório..."
t=1500: notification plan com 3 entries
t=2500: notification tool_call (kind: "execute", rawInput: {command: "ls -la"})
t=4000: notification tool_call_update status: "completed"
t=4500: 20 notifications agent_message_chunk emitidas a cada 150ms (cada chunk com 5-10 palavras)
t=7500: response final para session/prompt com {stopReason: "end_turn"}
</scenario_to_simulate>

<acceptance_criteria>
1. `npx tsx src/mock/fake-acp-stream.ts` imprime ≥25 linhas NDJSON em ~8s.
2. Cada linha do stdout parseia como JSON válido (`... | while read l; do echo "$l" | jq -e . > /dev/null || exit 1; done`).
3. Pelo menos 5 tipos diferentes de sessionUpdate aparecem.
4. Script termina com exit 0 após emitir o último chunk.
5. Suporta flag --scenario=error: emite tool_call_update com status "failed" no meio e encerra com exit 1.
</acceptance_criteria>

<constraints>
- NÃO importe @agentclientprotocol/sdk nesta tarefa — é um mock puro, zero dependências 
  além do Node stdlib.
- NÃO leia stdin se não houver dados; o script pode ignorar stdin na versão inicial e 
  apenas emitir o stream no stdout (tarefa 21 formaliza modo interativo).
- Usar apenas process.stdout.write + JSON.stringify + setTimeout. Sem libs.
</constraints>
```

---

### Tarefa 3 — WorktreeManager com testes

| Campo | Valor |
|---|---|
| Arquivos | `src/worktree/WorktreeManager.ts`, `src/worktree/__tests__/WorktreeManager.test.ts` |
| Depende de | 1 |
| Nome da sessão DAG | `dag-l1-t03-deps-t01` |
| Validação | `npx vitest run src/worktree` ≥8 testes verdes |
| Horas | 4h |

#### Prompt da tarefa 3

```xml
<role>
Você é engenheiro TypeScript e está criando a camada de isolamento Git do orquestrador.
</role>

<task>
Criar uma classe WorktreeManager que cria, lista, remove e limpa git worktrees efêmeras, 
usando simple-git 3.35. Não existe API dedicada .worktree() — tudo é via .raw('worktree', ...).
Escrever testes vitest que criam um repo git temporário em /tmp, testam o ciclo completo, 
e limpam depois de cada teste.
</task>

<api_surface>
<![CDATA[
class WorktreeManager {
  constructor(repoDir: string)  // repoDir = raiz do repo principal
  
  async create(opts: { id: string; baseBranch: string }): Promise<WorktreeInfo>
    // cria worktree em {os.tmpdir()}/copilot-orch/agent-{id}
    // cria branch descartável "agent/{id}" a partir de baseBranch
    // retorna { id, path, branch }
    // erro se id contém caracteres inválidos (só [a-z0-9-])
    
  async list(): Promise<WorktreeInfo[]>
    // parse de `git worktree list --porcelain` via .raw()
    
  async destroy(info: WorktreeInfo, opts?: { force?: boolean }): Promise<void>
    // 1. se dirty e !force → throw DirtyWorktreeError
    // 2. se dirty e force → checkout + clean -fd
    // 3. worktree remove --force {path}
    // 4. branch -D {branch} (ignora erro se já removida)
    // 5. nunca deixa a worktree listada em git worktree list
    
  async destroyAll(): Promise<void>
    // destroy cada worktree gerenciada + worktree prune no final
    
  async isLocked(path: string): Promise<boolean>
    // checa existência de .git/worktrees/{name}/locked
}

interface WorktreeInfo { id: string; path: string; branch: string }
class DirtyWorktreeError extends Error {}
]]></api_surface>

<simple_git_reference>
import { simpleGit } from 'simple-git';
const git = simpleGit(repoDir);

// worktrees:
await git.raw(['worktree', 'add', worktreePath, '-b', branchName, baseBranch]);
const raw = await git.raw(['worktree', 'list', '--porcelain']);
await git.raw(['worktree', 'remove', '--force', worktreePath]);
await git.raw(['worktree', 'prune']);

// status em um worktree específico:
const wtGit = simpleGit(worktreePath);
const status = await wtGit.status();  // status.isClean() retorna boolean
await wtGit.raw(['checkout', '--', '.']);
await wtGit.clean('f', ['-d']);
</simple_git_reference>

<porcelain_format>
Saída de `git worktree list --porcelain`:
  worktree /caminho/do/repo
  HEAD abc123...
  branch refs/heads/main
  [linha em branco]
  worktree /tmp/copilot-orch/agent-x
  HEAD def456...
  branch refs/heads/agent/x
  [linha em branco]

Parse por blocos separados por linha vazia; cada bloco tem chaves "worktree", "HEAD", "branch".
</porcelain_format>

<tests_to_write>
Setup: beforeEach cria um repo git real em `${os.tmpdir()}/wt-test-${randomUUID()}`, 
faz commit inicial, instancia WorktreeManager. afterEach destrói tudo.

Casos:
1. create() produz worktree listável em list()
2. create() com id inválido "agent 1" (com espaço) lança erro
3. create() duplicado lança erro e não corrompe estado
4. destroy() em worktree limpa funciona
5. destroy() em worktree dirty sem force lança DirtyWorktreeError
6. destroy() em worktree dirty com force funciona
7. destroyAll() limpa todas e chama prune
8. isLocked() retorna true após criar arquivo locked manualmente
9. list() retorna array vazio após destroyAll
</tests_to_write>

<acceptance_criteria>
1. `npx vitest run src/worktree` mostra ≥9 testes passando.
2. `npx tsc --noEmit` sem erros.
3. Após `vitest run`, `ls /tmp/copilot-orch/` está vazio ou inexistente (cleanup correto).
4. Nenhum teste deixa processo pendurado (vitest encerra em &lt;10s).
</acceptance_criteria>

<constraints>
- NÃO usar isomorphic-git — não suporta worktrees.
- NÃO invocar git via child_process direto — use simple-git para ganhar AbortController.
- NÃO assumir que a branch existe; create() deve falhar limpo se baseBranch não existe.
- Caminho das worktrees SEMPRE em os.tmpdir() + "copilot-orch" + "agent-{id}".
- NUNCA remover a worktree principal (path === repoDir) — proteger com guard.
</constraints>
```

---

### Tarefa 4 — Spike ACP (descartável)

| Campo | Valor |
|---|---|
| Arquivos | `src/spike-acp.ts` (temporário, NÃO vai para src/ final) |
| Depende de | 1 |
| Nome da sessão DAG | `dag-l1-t04-deps-t01` |
| Validação | Script conecta, envia prompt, loga ≥5 tipos de notification em arquivo |
| Horas | 4h |

#### Prompt da tarefa 4

```xml
<role>
Você é engenheiro realizando spike de descoberta: o objetivo é descobrir o formato REAL 
das mensagens ACP emitidas pelo Copilot CLI, capturando tudo em um arquivo para análise 
posterior. Este script é descartável — será deletado após a tarefa 5 extrair os tipos.
</role>

<task>
Criar src/spike-acp.ts que:
1. Spawna `copilot --acp --stdio` via execa em um diretório de teste já inicializado.
2. Envia uma sequência mínima: initialize → session/new → session/prompt ("list files in current directory").
3. Captura TODAS as linhas NDJSON recebidas em tmp/spike-capture.ndjson (append).
4. Imprime uma tabela resumo no stderr com contagem de cada tipo de sessionUpdate visto.
5. Encerra limpo após receber o response de session/prompt ou após 60s de timeout.

Use @agentclientprotocol/sdk para conectar, MAS também escreva as linhas raw antes do SDK 
parsear — queremos ver o wire format cru. Para isso, faça um tee no stdout do child process.
</task>

<sdk_usage_hints>
// Instalação: `npm i @agentclientprotocol/sdk@0.17` (pinar exato).
// A API exata pode variar entre versões. ANTES de codar, leia os tipos:
//   cat node_modules/@agentclientprotocol/sdk/dist/index.d.ts | head -200
//
// API esperada (confirmar nos .d.ts):
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
// O helper ndJsonStream(readable, writable) retorna um objeto que serializa/deserializa.
// ClientSideConnection recebe esse stream e expõe .initialize(), .newSession(), .prompt(), 
// .cancel(), e .onNotification('session/update', handler).
//
// SE os nomes exatos não baterem, inspecione o .d.ts e ajuste. NÃO invente nomes.
</sdk_usage_hints>

<execa_usage>
import { execa } from 'execa';
const child = execa('copilot', ['--acp', '--stdio'], {
  cwd: testRepoDir,
  stdin: 'pipe',
  stdout: 'pipe',
  stderr: 'pipe',
  reject: false,
});
// child.stdin, child.stdout são streams; child.kill('SIGTERM') para encerrar.
// Para tee: use stream.pipeline ou pipe manual duplicando chunks para o arquivo.
</execa_usage>

<test_repo_setup>
Antes de spawnar o Copilot, garanta que existe um repo git mínimo em /tmp/spike-repo com 
alguns arquivos (README.md, src/app.ts). Se já existir, reuse. Isto dá contexto ao agente 
sem gastar muitos tokens.
</test_repo_setup>

<acceptance_criteria>
1. `npx tsx src/spike-acp.ts` completa em &lt;90s.
2. tmp/spike-capture.ndjson existe e cada linha parseia como JSON válido.
3. stderr mostra tabela tipo:
     sessionUpdate             | count
     agent_thought_chunk       | 3
     agent_message_chunk       | 27
     tool_call                 | 2
     tool_call_update          | 4
4. Discriminador real identificado (sessionUpdate / kind / outro) — anotar em 
   docs/acp-findings.md (criar este arquivo).
5. Processo copilot terminou (`pgrep -f "copilot.*acp"` vazio após spike encerrar).
</acceptance_criteria>

<constraints>
- Este script vive em src/ temporariamente. Será movido para scripts/spike-acp.ts ou 
  deletado após tarefa 5.
- NÃO consumir rate limit em loop — uma única execução por teste.
- Se o Copilot pedir auth, falhe com mensagem clara "rode `copilot auth` primeiro".
- NÃO logar nada no stdout — tudo vai para arquivo ou stderr.
</constraints>
```

---

### Tarefa 5 — Tipos ACP

| Campo | Valor |
|---|---|
| Arquivos | `src/acp/types.ts` |
| Depende de | 4 |
| Nome da sessão DAG | `dag-l2-t05-deps-t04` |
| Validação | `npx tsc --noEmit` compila; tipos cobrem todos os sessionUpdate vistos no spike |
| Horas | 2h |

#### Prompt da tarefa 5

```xml
<role>
Você está formalizando os tipos TypeScript do protocolo ACP a partir dos dados reais 
capturados no spike (tarefa 4). Prefira re-exportar tipos do SDK quando existirem e 
apenas complementar quando estiverem ausentes ou frouxos.
</role>

<task>
Criar src/acp/types.ts que exporta:
1. AgentPhase: union literal type das fases que a UI vai renderizar.
2. SessionUpdate: discriminated union de todos os tipos de notification session/update 
   realmente observados em tmp/spike-capture.ndjson + docs/acp-findings.md.
3. Type guards: isAgentMessageChunk, isToolCall, isToolCallUpdate, isPlan, isAgentThoughtChunk.
4. Re-exports dos tipos do SDK quando disponíveis (ClientCapabilities, InitializeResponse, etc.).
</task>

<phase_union>
export type AgentPhase =
  | 'spawning'    // antes de initialize completar
  | 'idle'        // sessão criada, aguardando prompt
  | 'thinking'    // agent_thought_chunk recebido recentemente
  | 'planning'    // plan recebido recentemente
  | 'tool_call'   // tool_call em progresso
  | 'responding'  // agent_message_chunk streamando
  | 'done'        // stopReason recebido
  | 'error';      // processo crashou ou session retornou erro
</phase_union>

<workflow>
1. Abra tmp/spike-capture.ndjson e docs/acp-findings.md.
2. Abra node_modules/@agentclientprotocol/sdk/dist/*.d.ts e liste os tipos exportados.
3. Para cada tipo de sessionUpdate visto no capture, decida:
   - se o SDK já exporta o tipo: re-exporte com `export type { X } from '@agentclientprotocol/sdk'`
   - se não: defina interface local espelhando a estrutura real do JSON
4. Escreva a união SessionUpdate com discriminador no campo 'sessionUpdate' (camelCase 
   confirmado no spike — ajuste se o capture mostrar outro nome).
5. Escreva type guards simples: 
     export const isAgentMessageChunk = (u: SessionUpdate): u is AgentMessageChunk =>
       u.sessionUpdate === 'agent_message_chunk';
</workflow>

<acceptance_criteria>
1. `npx tsc --noEmit` retorna 0 erros.
2. Pelo menos 6 variantes na união SessionUpdate.
3. Pelo menos 5 type guards exportados.
4. Nenhum `any` explícito — use `unknown` + narrowing quando o SDK não tiver o tipo.
5. Comentário no topo do arquivo cita: "SDK version: X.Y.Z, capture date: YYYY-MM-DD".
6. Tarefa 6 consegue importar os tipos sem erro (será validado ao rodar a tarefa 6).
</acceptance_criteria>

<constraints>
- NÃO duplique tipos que o SDK já exporta — re-exporte.
- NÃO use `any`. Prefira `unknown` com type guards.
- NÃO assuma estrutura — SEMPRE confirme no capture real.
- Se um campo puder ser undefined, marque com `?`, não com `| undefined`.
- Marque comentário "// inferido do spike — não documentado no SDK" onde aplicável.
</constraints>
```

---

### Tarefa 6 — Phase machine

| Campo | Valor |
|---|---|
| Arquivos | `src/acp/phase-machine.ts`, `src/acp/__tests__/phase-machine.test.ts` |
| Depende de | 5 |
| Nome da sessão DAG | `dag-l3-t06-deps-t05` |
| Validação | `npx vitest run src/acp` ≥12 testes verdes |
| Horas | 3h |

#### Prompt da tarefa 6

```xml
<role>
Você está codificando a lógica pura que mapeia notifications ACP para fases renderizáveis 
na UI. Este é o módulo mais testável do projeto — zero I/O, zero dependências além dos 
tipos da tarefa 5.
</role>

<task>
Criar src/acp/phase-machine.ts com uma função pura `reducePhase(current, update)` que, 
dada a fase atual de um agente e uma nova SessionUpdate, retorna a próxima fase. Além 
disso, exporta um acumulador `reduceAgentState(state, update)` que atualiza um objeto 
AgentState completo (fase + lastMessage + currentTool + error).
</task>

<state_shape>
export interface AgentState {
  phase: AgentPhase;
  lastMessage: string;       // texto acumulado de agent_message_chunk
  lastThought: string;       // texto acumulado de agent_thought_chunk
  currentTool: { id: string; title: string; status: string } | null;
  plan: PlanEntry[] | null;
  error: string | null;
}

export const initialState: AgentState = {
  phase: 'spawning',
  lastMessage: '',
  lastThought: '',
  currentTool: null,
  plan: null,
  error: null,
};
</state_shape>

<transitions>
Regras (pura, sem side effects):
- agent_thought_chunk → phase: 'thinking', lastThought += chunk.text
- plan → phase: 'planning', plan = update.entries
- tool_call → phase: 'tool_call', currentTool = { id, title, status: 'pending' }
- tool_call_update → mantém phase 'tool_call', atualiza currentTool.status
  - se status === 'completed' e não há mais tool_call em flight → phase permanece 
    'tool_call' até próximo update (não voltar para idle aqui)
  - se status === 'failed' → phase: 'error', error = update.error ?? 'tool failed'
- agent_message_chunk → phase: 'responding', lastMessage += chunk.content.text
- stopReason recebido (via resposta de session/prompt, não via update) → phase: 'done'
- child process exit → phase: 'error', error: `exit ${code}`

Transições explicitamente proibidas (retornar estado inalterado + log warn):
- done → qualquer coisa exceto initial (resetar manualmente antes do próximo prompt)
- error → qualquer coisa exceto initial
</transitions>

<tests_to_write>
1. initialState.phase === 'spawning'
2. reducePhase após primeiro agent_thought_chunk → 'thinking'
3. thinking → planning ao receber plan
4. planning → tool_call ao receber tool_call
5. tool_call_update com status 'completed' mantém phase 'tool_call'
6. tool_call_update com status 'failed' → 'error'
7. agent_message_chunk acumula texto corretamente (3 chunks consecutivos)
8. reset via função resetState() volta ao initialState
9. transição proibida done → thinking mantém done
10. plan entries são copiados, não referenciados (teste mutação no input)
11. lastThought acumula em múltiplos agent_thought_chunk
12. currentTool.status reflete último tool_call_update para o mesmo toolCallId
</tests_to_write>

<acceptance_criteria>
1. `npx vitest run src/acp` mostra ≥12 testes passando.
2. `npx tsc --noEmit` sem erros.
3. phase-machine.ts não importa nada além de ./types.
4. Coverage de phase-machine.ts ≥90% (vitest --coverage).
5. Nenhuma função no arquivo faz I/O, chama Date.now(), ou tem aleatoriedade.
</acceptance_criteria>

<constraints>
- PURO. Zero imports além de ./types.
- Imutável: sempre retornar novo objeto, nunca mutar input.
- NÃO usar setTimeout, Promise, async. É síncrono.
- NÃO ler process.env nem fs. Puro.
- Use `satisfies AgentState` em vez de `as AgentState` para validar.
</constraints>
```

---

### Tarefa 7 — AgentSupervisor v1

| Campo | Valor |
|---|---|
| Arquivos | `src/agent/AgentSupervisor.ts` |
| Depende de | 3, 5, 6 |
| Nome da sessão DAG | `dag-l4-t07-deps-t03-t05-t06` |
| Validação | Script de teste manual spawna 1 agente, recebe updates, shutdown limpo |
| Horas | 4h |

#### Prompt da tarefa 7

```xml
<role>
Você está criando a peça central: a classe que encapsula um child process Copilot e 
traduz mensagens ACP em eventos tipados consumíveis pela UI.
</role>

<task>
Criar src/agent/AgentSupervisor.ts com a classe AgentSupervisor que estende EventEmitter, 
spawna `copilot --acp --stdio` via execa em um cwd (worktree path), conecta ao child via 
@agentclientprotocol/sdk, e emite eventos 'stateChange', 'done', 'error'. Foco no happy 
path — hardening de crash e timeout vem nas tarefas 16-18.
</task>

<class_signature>
<![CDATA[
import { EventEmitter } from 'node:events';
import type { AgentState } from '../acp/phase-machine.js';

export interface AgentSupervisorOptions {
  id: string;
  cwd: string;          // path da worktree
  command?: string;     // default: 'copilot'
  args?: string[];      // default: ['--acp', '--stdio']
}

export type AgentSupervisorEvents = {
  stateChange: [state: AgentState];
  done: [stopReason: string];
  error: [err: Error];
};

export class AgentSupervisor extends EventEmitter<AgentSupervisorEvents> {
  readonly id: string;
  state: AgentState;
  
  constructor(opts: AgentSupervisorOptions)
  
  async start(): Promise<void>
    // 1. spawn via execa
    // 2. conecta ClientSideConnection sobre child.stdout/child.stdin
    // 3. registra handler onNotification('session/update')
    // 4. chama initialize
    // 5. chama newSession(cwd)
    // 6. atualiza state.phase = 'idle'
    
  async prompt(text: string): Promise<string>
    // envia session/prompt com [{type: "text", text}]
    // aguarda response (stopReason)
    // emite 'done' com stopReason
    // retorna stopReason
    
  async cancel(): Promise<void>
    // envia session/cancel notification (fire-and-forget)
    
  async shutdown(): Promise<void>
    // 1. stdin.end()
    // 2. aguarda exit com timeout 3s
    // 3. SIGTERM se ainda vivo
    // 4. SIGKILL se ainda vivo após +2s
}
]]></class_signature>

<acp_sdk_integration>
// Confirme os nomes exatos lendo node_modules/@agentclientprotocol/sdk/dist/index.d.ts.
// Esperado (ajustar se divergir):

import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';

const child = execa('copilot', ['--acp', '--stdio'], {
  cwd: opts.cwd,
  stdin: 'pipe',
  stdout: 'pipe',
  stderr: 'pipe',
  reject: false,
});

const stream = ndJsonStream(child.stdout!, child.stdin!);
const conn = new ClientSideConnection(stream);

conn.onNotification('session/update', (params) => {
  this.state = reduceAgentState(this.state, params.update);
  this.emit('stateChange', this.state);
});

// Handler de requestPermission (nunca é chamado pelo Copilot na v1.0.20 devido ao 
// Issue #845, mas precisa existir no contrato):
conn.onRequest('requestPermission', async (params) => ({
  outcome: { outcome: 'selected', optionId: params.options[0]?.optionId ?? 'allow' },
}));

await conn.initialize({
  protocolVersion: PROTOCOL_VERSION,
  clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
});

const { sessionId } = await conn.newSession({ cwd: opts.cwd, mcpServers: [] });
</acp_sdk_integration>

<manual_test_script>
Criar scripts/test-supervisor.ts (NÃO é teste vitest, é validação manual):
  - Cria worktree temporária via WorktreeManager
  - Instancia AgentSupervisor apontando para ela
  - Anexa listener que loga cada stateChange no stderr
  - Chama start(), depois prompt("list files in current dir")
  - Aguarda 'done', loga stopReason
  - Chama shutdown()
  - Destroi a worktree
  - Sai com exit 0
Rodar com `npx tsx scripts/test-supervisor.ts`.
</manual_test_script>

<acceptance_criteria>
1. `npx tsc --noEmit` sem erros.
2. `npx tsx scripts/test-supervisor.ts` completa em &lt;120s e sai com exit 0.
3. Logs no stderr mostram pelo menos: spawning → idle → thinking → tool_call → responding → done.
4. Após o script sair, `pgrep -f "copilot.*acp"` retorna vazio.
5. Após o script sair, `git worktree list` no repo de teste mostra só a principal.
</acceptance_criteria>

<constraints>
- NÃO suportar cancelamento via AbortSignal ainda — só método .cancel(). Tarefa 14 adiciona signal.
- NÃO implementar retry de rate limit aqui — tarefa 20.
- NÃO logar via pino aqui — use console.error (será substituído na tarefa 19).
- NÃO fazer SIGKILL prematuro — SIGTERM primeiro, espere 3s.
- Garantir que erros no stderr do child sejam capturados (child.stderr.on('data', ...)) 
  e incluídos no error emitido.
</constraints>
```

---

### Tarefa 8 — UI Ink estática

| Campo | Valor |
|---|---|
| Arquivos | `src/ui/App.tsx`, `src/ui/AgentPanel.tsx`, `src/ui/dev-static.tsx` |
| Depende de | 1 |
| Nome da sessão DAG | `dag-l1-t08-deps-t01` |
| Validação | `npx tsx src/ui/dev-static.tsx` renderiza layout correto, sai com Ctrl+C |
| Horas | 3h |

#### Prompt da tarefa 8

```xml
<role>
Você é designer de UI de terminal. Conhece React e Ink 6.8. O foco desta tarefa é definir 
o LAYOUT dos painéis de agente com dados mockados — zero lógica de ACP, zero estado vivo.
</role>

<task>
Criar componentes Ink puros para renderizar um grid de painéis de agente: App.tsx (root), 
AgentPanel.tsx (um card por agente), e dev-static.tsx (arquivo executável que renderiza 
App com 3 AgentState mockados para validação visual).
</task>

<visual_spec>
Cada AgentPanel tem ~10 linhas e ~40 colunas:
┌─ Agent abc123 ─────────────────────────┐
│ 🔧 tool_call · shell                    │
│ plan: 2/5 steps done                    │
│ ─────────────────────────────────────── │
│ > ls -la                                │
│ total 48                                │
│ drwxr-xr-x  8 user user 4096 Apr 8 ...  │
└─────────────────────────────────────────┘

- Borda verde se fase ativa (thinking, planning, tool_call, responding)
- Borda cinza se idle/done
- Borda vermelha se error
- Ícone de fase: 💤 idle, 🧠 thinking, 📋 planning, 🔧 tool_call, 💬 responding, ✅ done, ❌ error
- Últimas 3 linhas de lastMessage com truncate-end
- StatusBar no topo: "N agentes | 1 thinking | 2 tool_call | 0 done"

Grid: 2 colunas quando N >= 2, 1 coluna quando N === 1.
</visual_spec>

<ink_api_reference>
<![CDATA[
import { render, Box, Text, Static, useApp, useInput } from 'ink';
import { Spinner, Badge } from '@inkjs/ui';

// Box props relevantes:
//   flexDirection: 'row' | 'column'
//   flexWrap: 'wrap' | 'nowrap'
//   borderStyle: 'round' | 'single' | 'double' | 'bold'
//   borderColor: string
//   width: number | string ('50%')
//   paddingX, paddingY: number
//   gap: number

// render() options:
const { unmount, waitUntilExit } = render(<App />, {
  exitOnCtrlC: false,    // controlamos SIGINT via signal handler
  patchConsole: true,    // redireciona console.log/error para não quebrar layout
});

// Para updates de alta frequência (tarefa 9 usa isto): envolver painéis em React.memo.
// <Static> é para logs append-only que não mudam — NÃO usar para painéis que atualizam.
]]></ink_api_reference>

<component_signatures>
<![CDATA[
// src/ui/AgentPanel.tsx
import { memo } from 'react';
interface AgentPanelProps {
  id: string;
  state: AgentState;
  width: string;  // ex: "50%"
}
export const AgentPanel = memo(function AgentPanel({ id, state, width }: AgentPanelProps) {
  // ...
});

// src/ui/App.tsx
interface AppProps {
  agents: Array<{ id: string; state: AgentState }>;
}
export function App({ agents }: AppProps) {
  // StatusBar no topo, grid de AgentPanel, footer com "Ctrl+C to quit"
}

// src/ui/dev-static.tsx (executável, não exportado)
const mockAgents = [
  { id: 'abc', state: { phase: 'thinking', lastMessage: 'Analyzing...', ... } },
  { id: 'def', state: { phase: 'tool_call', lastMessage: 'ls output...', ... } },
  { id: 'ghi', state: { phase: 'done', lastMessage: 'Task complete', ... } },
];
render(<App agents={mockAgents} />, { exitOnCtrlC: true });
]]></component_signatures>

<acceptance_criteria>
1. `npx tsx src/ui/dev-static.tsx` renderiza 3 painéis em grid 2x2 (terceiro sozinho na linha 2).
2. Cada painel mostra ícone correto para a fase mockada.
3. Ctrl+C encerra o dev-static limpo, retorna ao shell.
4. `npx tsc --noEmit` sem erros.
5. Painéis com fase 'thinking' têm borda verde; 'done' tem borda cinza.
6. StatusBar mostra contagem correta.
7. Nenhum warning do React ("key" prop) no stderr.
</acceptance_criteria>

<constraints>
- NÃO importar nada de src/agent, src/orchestrator — esta tarefa é UI pura com dados mock.
- NÃO usar useState para os agents em App — receber por props. Estado vem na tarefa 9.
- NÃO usar &lt;Static&gt; para os painéis — painéis precisam re-renderizar. &lt;Static&gt; é para logs.
- NÃO usar Spinner ainda — Ink 6.x teve bugs com múltiplos spinners simultâneos em grids.
  Usar ícone unicode estático por fase.
- Envolver AgentPanel em memo para preparar tarefa 9 (alta frequência de updates).
</constraints>
```

---

### Tarefa 9 — Wire-up 1 agente

| Campo | Valor |
|---|---|
| Arquivos | `src/index.ts`, atualiza `src/ui/App.tsx` |
| Depende de | 7, 8 |
| Nome da sessão DAG | `dag-l5-t09-deps-t07-t08` |
| Validação | `npm run dev -- "hello"` mostra 1 painel com streaming real |
| Horas | 4h |

#### Prompt da tarefa 9

```xml
<role>
Você está conectando os blocos: um AgentSupervisor real alimentando um AgentPanel real 
via um hook React. Este é o momento "funciona end-to-end" da Semana 1.
</role>

<task>
Atualizar src/index.ts para ser o entry point real: parseia um prompt simples de argv, 
cria uma worktree via WorktreeManager, spawna um AgentSupervisor, passa para o App Ink via 
um hook useAgentState, e renderiza. Atualizar App.tsx para consumir o supervisor via hook.
</task>

<hook_spec>
// src/ui/useAgentState.ts (novo arquivo)
import { useSyncExternalStore } from 'react';
import type { AgentSupervisor } from '../agent/AgentSupervisor.js';
import type { AgentState } from '../acp/phase-machine.js';

export function useAgentState(supervisor: AgentSupervisor): AgentState {
  // Usa useSyncExternalStore para assinar 'stateChange' do supervisor.
  // subscribe: registra listener, retorna cleanup.
  // getSnapshot: retorna supervisor.state (referência que muda a cada evento).
  // React re-renderiza quando supervisor.state muda identidade.
}
</hook_spec>

<index_ts_flow>
<![CDATA[
1. parseArgs simples: o primeiro arg posicional é o prompt. Se vazio, imprimir usage no stderr e exit 1.
2. repoDir = process.cwd() (assume que o usuário rodou `cd /meu/repo && npm run dev -- "..."`).
3. const wm = new WorktreeManager(repoDir);
4. const wt = await wm.create({ id: randomId(), baseBranch: 'main' });
5. const agent = new AgentSupervisor({ id: wt.id, cwd: wt.path });
6. await agent.start();
7. render(<App supervisor={agent} />, { exitOnCtrlC: false });
8. Em paralelo, chamar agent.prompt(promptText) (não await — UI precisa renderizar 
   enquanto agente trabalha).
9. Ao receber 'done' ou 'error': aguardar 2s, unmount, destruir worktree, exit 0.
10. SIGINT handler: cancelar agente, aguardar shutdown, destruir worktree, exit 130.
]]></index_ts_flow>

<app_changes>
// Antes: App recebia array de {id, state}
// Agora: recebe um ou mais AgentSupervisor.
interface AppProps {
  supervisors: AgentSupervisor[];
}

// Cada supervisor tem seu AgentPanel; hook useAgentState internamente.
// Para esta tarefa, supervisors.length === 1. Tarefa 11 generaliza para N.
</app_changes>

<acceptance_criteria>
1. `npm run dev -- "list files in the current repo"` abre Ink, renderiza 1 painel, 
   mostra fases transitando (thinking → tool_call → responding), termina com ✅ done.
2. Ao terminar, worktree foi destruída (`git worktree list` só mostra a principal).
3. Ctrl+C durante execução: cancela, limpa worktree, sai limpo.
4. `pgrep -f "copilot.*acp"` vazio após sair.
5. `npx tsc --noEmit` sem erros.
6. Nenhum log vazou no stdout (que corromperia Ink) — verificável porque o layout fica íntegro.
</acceptance_criteria>

<constraints>
- NÃO usar pino ainda — tarefa 19. Por enquanto só stderr via process.stderr.write.
- NÃO implementar retry — tarefa 20.
- NÃO suportar N agentes ainda — tarefa 10-11.
- NÃO usar o flag --mock — tarefa 21.
- Usar useSyncExternalStore, NÃO useState+useEffect — evita tearing em updates rápidos.
- SIGINT handler DEVE chamar unmount() antes de destruir worktree, senão Ink deixa 
  terminal corrompido.
</constraints>
```

---

### Tarefa 10 — Orchestrator

| Campo | Valor |
|---|---|
| Arquivos | `src/orchestrator/Orchestrator.ts` |
| Depende de | 7, 3 |
| Nome da sessão DAG | `dag-l5-t10-deps-t03-t07` |
| Validação | Script de teste instancia 3 supervisors independentes, todos atingem 'done' |
| Horas | 3h |

#### Prompt da tarefa 10

```xml
<role>
Você está criando a camada de coordenação: uma classe Orchestrator que gerencia o 
lifecycle de N AgentSupervisor, mantém a lista de worktrees, e expõe uma API uniforme 
para o index.ts consumir.
</role>

<task>
Criar src/orchestrator/Orchestrator.ts que encapsula: criação de N worktrees, spawn de N 
AgentSupervisor (com stagger de 2s entre spawns), disparo paralelo de prompts, e shutdown 
coordenado. Não precisa de UI aqui — é lógica pura de coordenação.
</task>

<api>
<![CDATA[
export interface OrchestratorOptions {
  repoDir: string;
  baseBranch?: string;   // default 'main'
  spawnStaggerMs?: number; // default 2000
}

export interface AgentTask {
  id: string;           // gerado se omitido
  prompt: string;
}

export class Orchestrator {
  readonly supervisors: AgentSupervisor[] = [];
  readonly worktrees: WorktreeInfo[] = [];
  
  constructor(opts: OrchestratorOptions)
  
  async launch(tasks: AgentTask[]): Promise<void>
    // Para cada task:
    //   1. cria worktree
    //   2. instancia AgentSupervisor
    //   3. await supervisor.start()
    //   4. dispara supervisor.prompt(task.prompt) SEM await (fire and track)
    //   5. await sleep(spawnStaggerMs) antes do próximo
    // Adiciona listeners que resolvem/rejeitam por supervisor
    
  async waitForAll(): Promise<PromptResult[]>
    // Aguarda todos os supervisors emitirem 'done' ou 'error'
    // Retorna array com { id, status: 'done' | 'error', stopReason | error }
    
  async shutdown(): Promise<void>
    // 1. cancel() em todos os supervisors
    // 2. aguarda 3s
    // 3. shutdown() em todos em paralelo
    // 4. destroyAll() no WorktreeManager
}

interface PromptResult {
  id: string;
  status: 'done' | 'error';
  stopReason?: string;
  error?: string;
}
]]></api>

<stagger_rationale>
2 segundos entre spawns evita:
- burst do rate limit do Copilot (~10-20 req/min)
- saturação de CPU no cold start (cada copilot-language-server consome ~60% de 1 core 
  durante os primeiros 2s)
- race em .git/worktrees que o Copilot pode acessar

Se N >= 5, considerar stagger maior (configurável via opção).
</stagger_rationale>

<manual_test>
Criar scripts/test-orchestrator.ts:
  const orch = new Orchestrator({ repoDir: process.cwd() });
  await orch.launch([
    { id: 'a', prompt: 'list files in src' },
    { id: 'b', prompt: 'read README.md and summarize in 1 sentence' },
    { id: 'c', prompt: 'count lines in package.json' },
  ]);
  const results = await orch.waitForAll();
  console.error(JSON.stringify(results, null, 2));
  await orch.shutdown();
Rodar com `npx tsx scripts/test-orchestrator.ts` e verificar tempos no stderr.
</manual_test>

<acceptance_criteria>
1. `npx tsx scripts/test-orchestrator.ts` completa em &lt;5min.
2. Todos os 3 agentes atingem 'done' (ou 'error' explícito, não travado).
3. Logs no stderr mostram timestamps de spawn com ~2s de diferença entre cada.
4. Após shutdown: `git worktree list` limpo, `pgrep -f "copilot.*acp"` vazio.
5. Se 1 agente crashar, os outros 2 continuam até done — Orchestrator não aborta tudo.
6. `npx tsc --noEmit` sem erros.
</acceptance_criteria>

<constraints>
- NÃO integrar com Ink aqui — pura lógica.
- NÃO implementar rate limit handling — tarefa 20.
- NÃO usar Promise.all para launch (quebra stagger). Use for...of com await.
- Promise.all é OK para shutdown (paralelo intencional).
- Se create() de worktree falhar, NÃO rollback de worktrees anteriores. Apenas pular 
  essa task e registrar erro no results.
</constraints>
```

---

### Tarefa 11 — Grid dinâmico N painéis

| Campo | Valor |
|---|---|
| Arquivos | `src/ui/AgentGrid.tsx`, atualiza `src/ui/App.tsx` |
| Depende de | 8, 10 |
| Nome da sessão DAG | `dag-l6-t11-deps-t08-t10` |
| Validação | dev-static atualizado mostra layout correto para N=1,2,3,4 |
| Horas | 4h |

#### Prompt da tarefa 11

```xml
<role>
Você está generalizando o layout de 1 painel para N painéis em grid responsivo.
</role>

<task>
Criar src/ui/AgentGrid.tsx que recebe supervisors[] e renderiza cada um como AgentPanel 
em um layout flex-wrap adaptativo. Atualizar App.tsx para usar AgentGrid. Atualizar 
dev-static.tsx para testar N=1, 2, 3, 4 via argumento --n.
</task>

<layout_rules>
<![CDATA[
- N=1: 1 coluna full-width (100%)
- N=2: 2 colunas lado a lado (50% cada)
- N=3: 2 colunas, 2 linhas (terceiro sozinho na linha 2)
- N=4: 2 colunas, 2 linhas (2x2)
- N=5-6: 3 colunas
- N≥7: 3 colunas (scrolling na prática não funciona bem em Ink; acima de 6 é descope)

Usar flexWrap='wrap' em <Box flexDirection='row'> com width por painel calculado via 
Math.floor(100/cols)+'%'.
]]></layout_rules>

<agent_grid_signature>
<![CDATA[
interface AgentGridProps {
  supervisors: AgentSupervisor[];
}

export function AgentGrid({ supervisors }: AgentGridProps) {
  const cols = supervisors.length <= 2 ? supervisors.length 
             : supervisors.length <= 4 ? 2 
             : 3;
  const width = `${Math.floor(100 / cols)}%`;
  return (
    <Box flexDirection="row" flexWrap="wrap">
      {supervisors.map(s => (
        <AgentPanel key={s.id} supervisor={s} width={width} />
      ))}
    </Box>
  );
}
]]></agent_grid_signature>

<agent_panel_update>
// AgentPanel agora recebe supervisor (não state) e usa useAgentState internamente.
interface AgentPanelProps {
  supervisor: AgentSupervisor;
  width: string;
}
export const AgentPanel = memo(function AgentPanel({ supervisor, width }: AgentPanelProps) {
  const state = useAgentState(supervisor);
  // render como antes
});
</agent_panel_update>

<dev_static_update>
// Suporta --n 3 para testar diferentes números.
// Usa MockSupervisor (classe fake com mesma interface do AgentSupervisor) porque não 
// queremos spawnar Copilot real aqui.
// Cria uma classe inline MockSupervisor que emite stateChange a cada 500ms com fases 
// variadas.
</dev_static_update>

<acceptance_criteria>
1. `npx tsx src/ui/dev-static.tsx --n 1` renderiza 1 painel full-width.
2. `npx tsx src/ui/dev-static.tsx --n 2` renderiza 2 painéis 50/50.
3. `npx tsx src/ui/dev-static.tsx --n 3` renderiza 2x2 (com 1 slot vazio).
4. `npx tsx src/ui/dev-static.tsx --n 4` renderiza 2x2 preenchido.
5. MockSupervisor varia fases visivelmente ao longo de ~20s.
6. Nenhum flicker perceptível (AgentPanel memoizado evita re-render de irmãos).
7. `npx tsc --noEmit` sem erros.
</acceptance_criteria>

<constraints>
- NÃO suportar >6 agentes; mostrar aviso "N muito alto, suporte limitado" se N > 6.
- NÃO implementar scroll interno por painel — descope.
- NÃO re-renderizar o grid inteiro quando um único supervisor muda estado. A memoização 
  de AgentPanel por props (supervisor, width) deve isolar updates.
- MockSupervisor vive em dev-static.tsx, não em arquivo separado.
</constraints>
```

---

### Tarefa 12 — CLI argument parsing

| Campo | Valor |
|---|---|
| Arquivos | `src/cli.ts`, atualiza `src/index.ts` |
| Depende de | 1 |
| Nome da sessão DAG | `dag-l1-t12-deps-t01` |
| Validação | `npm run dev -- --help` imprime flags; parsing de -n, --mock, prompts |
| Horas | 2h |

#### Prompt da tarefa 12

```xml
<role>
Você está adicionando parsing robusto de argumentos usando util.parseArgs nativo do Node 
22 — sem dependências extras.
</role>

<task>
Criar src/cli.ts que usa util.parseArgs para transformar process.argv em uma estrutura 
ParsedArgs tipada. Suportar --help, --mock, -n/--agents (número), --log-level, e prompts 
posicionais. Atualizar src/index.ts para consumir o resultado.
</task>

<parsed_args_type>
export interface ParsedArgs {
  help: boolean;
  mock: boolean;
  agents: number;        // default 1; se prompts.length > 1, usar prompts.length
  logLevel: 'debug' | 'info' | 'warn' | 'error';  // default 'info'
  prompts: string[];     // posicionais
}

export function parseCli(argv: string[]): ParsedArgs;
export function printHelp(): void;  // escreve em stderr
</parsed_args_type>

<parse_args_usage>
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  args: argv.slice(2),  // pula 'node' e o script
  options: {
    help:      { type: 'boolean', short: 'h' },
    mock:      { type: 'boolean' },
    agents:    { type: 'string',  short: 'n' },  // parse como number depois
    'log-level': { type: 'string' },
  },
  allowPositionals: true,
  strict: true,
});

// validações manuais:
// - agents deve parsear como inteiro positivo
// - logLevel deve estar na lista permitida
// - prompts.length deve ser >= 1 (exceto quando --help)
</parse_args_usage>

<help_text>
<![CDATA[
Uso: multi-copilot [opções] <prompt>...

Opções:
  -n, --agents N      Número de agentes (default: número de prompts)
      --mock          Usar mock ACP em vez de Copilot real
      --log-level L   debug | info | warn | error (default: info)
  -h, --help          Mostra esta ajuda

Exemplos:
  multi-copilot "refactor auth module"
  multi-copilot -n 3 "task 1" "task 2" "task 3"
  multi-copilot --mock "dev test"

Variáveis de ambiente:
  COPILOT_ORCH_LOG_DIR   Diretório de logs (default: ~/.local/share/copilot-orch/logs)
]]></help_text>

<acceptance_criteria>
1. `npm run dev -- --help` imprime a help acima no stderr e sai com exit 0.
2. `npm run dev -- -n 3 "a" "b" "c"` resulta em { agents: 3, prompts: ['a','b','c'], ... }.
3. `npm run dev -- --mock "x"` resulta em { mock: true, prompts: ['x'], ... }.
4. `npm run dev -- -n abc "x"` falha com mensagem clara no stderr e exit 1.
5. `npm run dev -- ""` (prompt vazio) falha com exit 1.
6. `npm run dev -- --invalid` falha com mensagem do parseArgs e exit 1.
7. `npx tsc --noEmit` sem erros.
</acceptance_criteria>

<constraints>
- NÃO instalar yargs, commander, meow — usar parseArgs nativo.
- NÃO misturar lógica de execução com parsing; cli.ts só parseia.
- Erros de parseArgs devem virar mensagens amigáveis, não stack traces.
- Help sempre em stderr, NUNCA stdout (stdout é do Ink).
</constraints>
```

---

### Tarefa 13 — Staggered spawn + rate limit awareness

| Campo | Valor |
|---|---|
| Arquivos | atualiza `src/orchestrator/Orchestrator.ts` |
| Depende de | 10 |
| Nome da sessão DAG | `dag-l6-t13-deps-t10` |
| Validação | Logs mostram stagger ≥2s entre spawns; config via env/flag |
| Horas | 2h |

#### Prompt da tarefa 13

```xml
<role>
Você está refinando o Orchestrator para ser defensivo contra o rate limit burst do 
Copilot CLI (~10-20 req/min com hard-fail, não throttle).
</role>

<task>
Adicionar ao Orchestrator: (a) variável de stagger configurável via env COPILOT_ORCH_STAGGER_MS, 
default 2000; (b) log estruturado via pino (usar o logger da tarefa 19 se já existir; senão, 
console.error por ora) de cada spawn com timestamp ISO; (c) aviso quando N > 3 recomendando 
stagger maior; (d) hard cap de N=6 com erro claro se excedido.
</task>

<changes>
<![CDATA[
1. Em OrchestratorOptions, ler spawnStaggerMs de opts OU process.env.COPILOT_ORCH_STAGGER_MS OU 2000.
2. Validar: if (tasks.length > 6) throw new Error("N > 6 não suportado; use no máximo 6 agentes").
3. if (tasks.length > 3 && spawnStaggerMs < 3000) logar warn: "N alto com stagger baixo; 
   considere stagger >= 3000ms para evitar rate limit burst".
4. Antes de cada spawn, logar: { event: 'spawn', id, index, spawnAt: new Date().toISOString() }.
5. Após o último spawn, logar total elapsed.
]]></changes>

<logging_interim>
Se logger pino ainda não existir (tarefa 19 vem depois nesta semana), usar um helper 
temporário que escreve JSON em stderr:
  const log = (obj) => process.stderr.write(JSON.stringify({...obj, ts: Date.now()}) + '\n');
Marcar com comentário "// TODO: trocar por pino na tarefa 19".
</logging_interim>

<acceptance_criteria>
1. `COPILOT_ORCH_STAGGER_MS=500 npx tsx scripts/test-orchestrator.ts` spawna com 500ms.
2. `npx tsx scripts/test-orchestrator.ts` (sem env) usa 2000ms (visível nos timestamps).
3. Teste com 4 tasks imprime warning sobre stagger baixo.
4. Teste com 7 tasks lança erro antes de spawnar qualquer coisa.
5. Logs parseaveis como JSON: `... | grep '^{' | jq -e .` passa.
6. `npx tsc --noEmit` sem erros.
</acceptance_criteria>

<constraints>
- NÃO usar setInterval para stagger; usar for...of com await sleep.
- NÃO transformar em backpressure adaptativa — isso é tarefa 20.
- NÃO remover a opção opts.spawnStaggerMs; env é fallback, opts tem prioridade.
</constraints>
```

---

### Tarefa 14 — Shutdown coordenado

| Campo | Valor |
|---|---|
| Arquivos | atualiza `src/index.ts`, `src/agent/AgentSupervisor.ts`, `src/orchestrator/Orchestrator.ts` |
| Depende de | 10, 7 |
| Nome da sessão DAG | `dag-l6-t14-deps-t07-t10` |
| Validação | Ctrl+C durante 3 agentes: zero zumbis, zero worktrees pendurados |
| Horas | 4h |

#### Prompt da tarefa 14

```xml
<role>
Você está endurecendo o shutdown: o cenário é "Ctrl+C no meio de 3 agentes trabalhando". 
Tudo precisa fechar limpo, sem processo zumbi, sem worktree locked, sem terminal quebrado.
</role>

<task>
Implementar shutdown idempotente que responde a SIGINT e SIGTERM, garante unmount do Ink 
antes de destruir recursos (senão terminal fica corrompido), cancela agentes em paralelo, 
aguarda com timeout escalonado (cancel 3s → SIGTERM 2s → SIGKILL), e limpa worktrees.
</task>

<shutdown_sequence>
// Em src/index.ts, após render:

let shuttingDown = false;
const shutdown = async (signal: 'SIGINT' | 'SIGTERM') => {
  if (shuttingDown) return;
  shuttingDown = true;
  
  // 1. Unmount Ink IMEDIATAMENTE — libera terminal antes de qualquer cleanup lento.
  //    Se cleanup demorar, usuário vê o shell voltando rapidamente.
  try { inkInstance.unmount(); } catch {}
  
  // 2. Log single-line no stderr (stdout agora é seguro novamente).
  process.stderr.write(`\n[${signal}] shutting down ${orch.supervisors.length} agents...\n`);
  
  // 3. Cancel em paralelo (fire and forget, cancel é fast).
  await Promise.allSettled(orch.supervisors.map(s => s.cancel()));
  
  // 4. Aguarda até 3s para agentes terminarem graciosamente.
  await Promise.race([
    Promise.allSettled(orch.supervisors.map(s => s.waitForExit())),
    sleep(3000),
  ]);
  
  // 5. shutdown() força SIGTERM → SIGKILL nos que ainda respiram.
  await Promise.allSettled(orch.supervisors.map(s => s.shutdown()));
  
  // 6. Destroy worktrees.
  await orch.wm.destroyAll();
  
  process.exit(signal === 'SIGINT' ? 130 : 143);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
</shutdown_sequence>

<supervisor_additions>
<![CDATA[
// Adicionar em AgentSupervisor:
async waitForExit(): Promise<void>
  // retorna quando child process emitiu 'exit'; resolve imediato se já saiu.

// Melhorar shutdown():
async shutdown(): Promise<void> {
  if (!this.child || this.child.killed) return;
  try { this.child.stdin?.end(); } catch {}
  const killed = await Promise.race([
    this.waitForExit().then(() => true),
    sleep(2000).then(() => false),
  ]);
  if (!killed) {
    try { this.child.kill('SIGTERM'); } catch {}
    await Promise.race([this.waitForExit(), sleep(2000)]);
  }
  if (!this.child.killed) {
    try { this.child.kill('SIGKILL'); } catch {}
  }
}
]]></supervisor_additions>

<acceptance_criteria>
1. Rodar `npm run dev -- -n 3 "task1" "task2" "task3"` e pressionar Ctrl+C após 5s.
2. Terminal volta ao shell em &lt;6s.
3. `pgrep -f "copilot.*acp"` retorna vazio.
4. `git worktree list` mostra só a worktree principal.
5. Nenhum diretório órfão em /tmp/copilot-orch/.
6. exit code 130 (SIGINT).
7. Apertar Ctrl+C 2x durante shutdown não causa double-cleanup (guard shuttingDown).
8. `kill -TERM &lt;pid&gt;` em outro terminal produz o mesmo shutdown limpo com exit 143.
</acceptance_criteria>

<constraints>
- SEMPRE unmount Ink ANTES de qualquer operação async de cleanup — senão terminal fica com 
  raw mode ligado.
- NÃO usar process.exit() no meio do shutdown — deixa o await hanging. Só exit no final.
- Shutdown DEVE ser idempotente — segundo Ctrl+C não deve executar de novo.
- NÃO trabalhe com AbortController na Semana 2 — SIGKILL é garantia final suficiente.
</constraints>
```

---

### Tarefa 15 — Status bar global

| Campo | Valor |
|---|---|
| Arquivos | `src/ui/StatusBar.tsx`, atualiza `src/ui/App.tsx` |
| Depende de | 11 |
| Nome da sessão DAG | `dag-l7-t15-deps-t11` |
| Validação | Status bar mostra contadores corretos em tempo real |
| Horas | 2h |

#### Prompt da tarefa 15

```xml
<role>
Você está adicionando a barra de status que sumariza o estado global do orquestrador.
</role>

<task>
Criar src/ui/StatusBar.tsx que recebe supervisors[] e mostra: contagem total, distribuição 
por fase, tempo decorrido desde o primeiro spawn, e hint "Ctrl+C to quit". Atualizar 
App.tsx para montar StatusBar no topo e um footer minimal.
</task>

<status_bar_signature>
interface StatusBarProps {
  supervisors: AgentSupervisor[];
  startedAt: number;  // Date.now() do momento em que o primeiro agente começou
}

export function StatusBar({ supervisors, startedAt }: StatusBarProps) {
  // Subscreve a stateChange de cada supervisor.
  // Calcula agregados: counts por fase, MM:SS desde startedAt.
  // Renderiza em 1 linha com inverse background.
}
</status_bar_signature>

<visual>
Linha no topo, fundo invertido:
 3 agents │ 🧠 1  📋 0  🔧 1  💬 1  ✅ 0  ❌ 0 │ 02:34 │ Ctrl+C to quit 

Footer no fim:
 logs: ~/.local/share/copilot-orch/logs/session-20260408-143022.ndjson 
</visual>

<elapsed_timer>
// Elapsed precisa atualizar a cada segundo; usar useEffect com setInterval:
const [elapsed, setElapsed] = useState(Date.now() - startedAt);
useEffect(() => {
  const t = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
  return () => clearInterval(t);
}, [startedAt]);
// Formatar MM:SS: Math.floor(elapsed/60000) + ':' + ((elapsed/1000)%60).toFixed(0).padStart(2,'0')
</elapsed_timer>

<phase_aggregation>
<![CDATA[
// Para recomputar contagens quando qualquer supervisor muda, use useSyncExternalStore 
// com um subscribe que registra listener em TODOS os supervisors e notifica no callback.

function usePhaseCounts(supervisors: AgentSupervisor[]): Record<AgentPhase, number> {
  const subscribe = useCallback((cb: () => void) => {
    supervisors.forEach(s => s.on('stateChange', cb));
    return () => supervisors.forEach(s => s.off('stateChange', cb));
  }, [supervisors]);
  const getSnap = useCallback(() => {
    const counts: Record<AgentPhase, number> = { spawning: 0, idle: 0, thinking: 0, 
      planning: 0, tool_call: 0, responding: 0, done: 0, error: 0 };
    supervisors.forEach(s => counts[s.state.phase]++);
    return counts;
  }, [supervisors]);
  return useSyncExternalStore(subscribe, getSnap);
}
]]></phase_aggregation>

<acceptance_criteria>
1. Com 3 agentes rodando, StatusBar mostra "3 agents" e distribuição correta.
2. Counts atualizam em tempo real quando agentes transitam fases.
3. Timer incrementa a cada 1s.
4. Footer mostra caminho de log (placeholder até tarefa 19; pode ser string fixa por ora).
5. StatusBar não re-renderiza painéis irmãos (verificar via React DevTools profiler ou 
   contador manual de renders em cada AgentPanel).
6. `npx tsc --noEmit` sem erros.
</acceptance_criteria>

<constraints>
- NÃO recalcular counts dentro do render de cada AgentPanel — só StatusBar consome o hook.
- NÃO usar Date.now() direto no JSX — sempre via state/effect, para re-render controlado.
- NÃO usar Spinner aqui — ícones unicode estáticos.
</constraints>
```

---

### Tarefa 16 — Error states na UI

| Campo | Valor |
|---|---|
| Arquivos | atualiza `src/ui/AgentPanel.tsx`, `src/agent/AgentSupervisor.ts` |
| Depende de | 9, 11 |
| Nome da sessão DAG | `dag-l7-t16-deps-t09-t11` |
| Validação | `kill -9` em um processo copilot → painel fica vermelho, outros continuam |
| Horas | 3h |

#### Prompt da tarefa 16

```xml
<role>
Você está endurecendo a UI para lidar com agentes que crasham no meio da execução. Um 
agente morto não deve derrubar os outros, e seu estado na UI deve comunicar o erro com 
clareza — não ficar "congelado" em thinking para sempre.
</role>

<task>
(1) Detectar exit do child process no AgentSupervisor e traduzir em AgentPhase 'error' 
com mensagem derivada do exit code e stderr. (2) Atualizar AgentPanel para renderizar o 
estado de erro com borda vermelha, ícone ❌, e a mensagem de erro com quebra de linha. 
(3) Garantir que o Orchestrator não aborte os outros agentes quando um crasha.
</task>

<supervisor_changes>
// Em AgentSupervisor.start(), adicionar captura de stderr e handler de exit:

let stderrBuf = '';
this.child.stderr?.on('data', (chunk: Buffer) => {
  stderrBuf += chunk.toString('utf8');
  if (stderrBuf.length > 4096) stderrBuf = stderrBuf.slice(-4096); // rolling buffer
});

this.child.on('exit', (code, signal) => {
  if (this.state.phase === 'done') return;  // exit normal após done, ignorar
  const reason = signal ? `signal ${signal}` 
               : code !== 0 ? `exit ${code}` 
               : 'unexpected exit';
  const lastStderr = stderrBuf.split('\n').filter(Boolean).slice(-3).join(' | ');
  this.state = {
    ...this.state,
    phase: 'error',
    error: `${reason}${lastStderr ? ' — ' + lastStderr : ''}`,
  };
  this.emit('stateChange', this.state);
  this.emit('error', new Error(this.state.error!));
});

// Também capturar rejection da initialize/newSession/prompt e marcar como error:
try {
  await this.conn.initialize(...);
} catch (err) {
  this.state = { ...this.state, phase: 'error', 
                 error: `initialize failed: ${(err as Error).message}` };
  this.emit('stateChange', this.state);
  throw err;
}
</supervisor_changes>

<agent_panel_error_rendering>
<![CDATA[
// Em AgentPanel, quando state.phase === 'error':
// - borderColor: 'red'
// - ícone: ❌
// - substituir área de lastMessage por <Text color="red" wrap="wrap">{state.error}</Text>
// - truncar error em 200 caracteres, com "…" se maior
// - NÃO mostrar currentTool/plan (eles ficaram stale)

// Exemplo de layout em erro:
// ┌─ Agent abc ─ ❌ error ──────────────┐
// │                                      │
// │ exit 1 — Error: auth required        │
// │ Run `copilot auth` to login          │
// │                                      │
// └──────────────────────────────────────┘
]]></agent_panel_error_rendering>

<orchestrator_resilience>
// Verificar que Orchestrator.waitForAll() já resolve individualmente por supervisor.
// Se não: mudar o tracking para Promise.allSettled, garantindo que 1 erro não rejeita o 
// conjunto. PromptResult { status: 'error' } já cobre o caso — só confirmar.
</orchestrator_resilience>

<manual_test_procedure>
<![CDATA[
1. `npm run dev -- -n 3 "task1" "task2" "task3"`
2. Em outro terminal, `pgrep -f "copilot.*acp"` lista 3 PIDs.
3. `kill -9 <pid_do_segundo>`.
4. No terminal do orquestrador, o segundo painel deve ficar vermelho com mensagem 
   "signal SIGKILL — ..." em <2s.
5. Os outros 2 painéis continuam normalmente até done.
6. Ctrl+C ao final limpa tudo.
]]></manual_test_procedure>

<acceptance_criteria>
1. Procedimento manual acima funciona como descrito.
2. Painel em erro tem borda vermelha e ícone ❌ visíveis.
3. Mensagem de erro inclui signal OU exit code, e últimas linhas de stderr quando disponíveis.
4. Orchestrator NÃO chama shutdown automático nos outros agentes quando um crasha.
5. `npx tsc --noEmit` sem erros.
6. Ao final, todos os agentes (inclusive o crashado) tiveram suas worktrees destruídas.
</acceptance_criteria>

<constraints>
- NÃO tentar restart automático do agente crashado — isso é retry, e é tarefa 20 
  (escopo estrito: só rate limit).
- NÃO popup/modal — Ink não tem; toda feedback é dentro do painel.
- stderr buffer é rolling 4KB — NÃO manter histórico completo (memory leak).
- NÃO acionar process.exit do Node quando um agente morre; só registra o erro.
</constraints>
```

---

### Tarefa 17 — Worktree cleanup robusto

| Campo | Valor |
|---|---|
| Arquivos | atualiza `src/worktree/WorktreeManager.ts`, `scripts/cleanup-worktrees.ts` |
| Depende de | 3 |
| Nome da sessão DAG | `dag-l2-t17-deps-t03` |
| Validação | Cenário: processo morto ao meio deixa worktree; cleanup script remove tudo |
| Horas | 4h |

#### Prompt da tarefa 17

```xml
<role>
Você está resolvendo o caso em que o Node morre ao meio (segfault, kill -9 no parent, OOM) 
e deixa worktrees órfãs e/ou locked. O próximo startup precisa detectar e limpar, e existe 
um script manual para forçar cleanup a qualquer momento.
</role>

<task>
(1) Adicionar WorktreeManager.pruneOrphans() que detecta worktrees na convenção 
/tmp/copilot-orch/agent-* cujos .git/worktrees/*/locked existem OU cujo processo dono 
já morreu. (2) Chamar pruneOrphans() no startup do Orchestrator antes de criar novas 
worktrees. (3) Criar scripts/cleanup-worktrees.ts como ferramenta standalone para forçar 
remoção de tudo.
</task>

<prune_orphans_spec>
<![CDATA[
// Em WorktreeManager:

async pruneOrphans(): Promise<number> {
  // 1. Rode `git worktree list --porcelain` e parse.
  // 2. Para cada worktree cujo path começa com "${os.tmpdir()}/copilot-orch/":
  //    a. Verifique se o path ainda existe em disco.
  //       - Se não existe: só rode `git worktree prune` para limpar a referência.
  //       - Se existe: verifique se .git/worktrees/{name}/locked existe.
  //         - Se sim: unlock com `git worktree unlock {path}` antes de tentar remove.
  //    b. Tente `git worktree remove --force {path}`.
  //    c. Se falhar, logar warn mas continuar.
  //    d. Tente deletar branch agent/{id} se ainda existir.
  // 3. Ao final, `git worktree prune`.
  // 4. Retorna número de worktrees removidas.
}

// Obter nome interno da worktree (para path .git/worktrees/{name}):
// git armazena em .git/worktrees/<name>/ onde name = basename do path da worktree.
]]></prune_orphans_spec>

<cleanup_script>
// scripts/cleanup-worktrees.ts
// Uso: `npx tsx scripts/cleanup-worktrees.ts` no repo.
// Comportamento:
//   1. new WorktreeManager(process.cwd())
//   2. await wm.pruneOrphans()
//   3. Log no stderr: "Removidas N worktrees órfãs"
//   4. Adicionalmente, varrer /tmp/copilot-orch/ e deletar diretórios cujo nome 
//      agent-* NÃO está mais em `git worktree list` (fs.rm recursive).
//   5. exit 0 em sucesso, 1 em erro.

// Adicionar em package.json: "cleanup": "tsx scripts/cleanup-worktrees.ts"
</cleanup_script>

<orchestrator_integration>
// Em Orchestrator constructor ou launch(), chamar:
const pruned = await this.wm.pruneOrphans();
if (pruned > 0) log.warn({ event: 'orphans_cleaned', count: pruned });
</orchestrator_integration>

<manual_test>
1. `npm run dev -- "task longa"` em um terminal.
2. Em outro terminal, `pkill -9 -f "tsx src/index.ts"` (mata o parent à força).
3. Verificar que worktree ficou: `git worktree list` mostra agent-* ainda listada.
4. `npm run cleanup` deve remover a worktree órfã.
5. Teste do locked: criar uma worktree manualmente, `git worktree lock /tmp/copilot-orch/agent-x`,
   rodar `npm run cleanup`, verificar que foi removida (via unlock → remove).
</manual_test>

<acceptance_criteria>
1. `npm run cleanup` em um repo limpo retorna "Removidas 0 worktrees" e exit 0.
2. Após simular crash (pkill -9 parent), `npm run cleanup` remove worktree órfã.
3. Worktree manualmente locked é removida pelo script.
4. Orchestrator em novo startup detecta e limpa órfã automaticamente com warn no log.
5. Nunca remove a worktree principal (guard contra path === repoDir).
6. `npx tsc --noEmit` sem erros.
</acceptance_criteria>

<constraints>
- NÃO delete /tmp/copilot-orch/ inteiro sem verificar conteúdo — pode ter diretórios 
  legítimos em uso por outro processo.
- NÃO use rm -rf via child_process; use fs.rm({ recursive: true, force: true }).
- pruneOrphans DEVE ser idempotente — rodar 2x não quebra nada.
- NÃO tratar dirty state no cleanup forçado — a filosofia é "crashou = descartável".
</constraints>
```

---

### Tarefa 18 — Zombie process reaper

| Campo | Valor |
|---|---|
| Arquivos | atualiza `src/agent/AgentSupervisor.ts`, `src/orchestrator/Orchestrator.ts` |
| Depende de | 7, 14 |
| Nome da sessão DAG | `dag-l7-t18-deps-t07-t14` |
| Validação | Após crash simulado, `pgrep -f "copilot.*acp"` vazio em <10s |
| Horas | 2h |

#### Prompt da tarefa 18

```xml
<role>
Você está matando zumbis. O cenário: o parent Node.js morre ou perde o controle, mas os 
child processes copilot continuam vivos consumindo 60% de CPU e 1GB de RAM cada. Precisa 
garantir que, na pior das hipóteses, o sistema operacional mata tudo.
</role>

<task>
(1) Usar PDEATHSIG no Linux (via opção do execa) para amarrar o ciclo de vida do child ao 
parent. (2) Persistir PIDs spawnados em ~/.local/state/copilot-orch/pids.json e limpar no 
shutdown. (3) Adicionar comando `npm run reap` que lê esse arquivo e envia SIGKILL em tudo. 
(4) Limpar arquivo no startup, enviando SIGKILL em PIDs stale antes.
</task>

<pdeathsig>
// Linux: prctl(PR_SET_PDEATHSIG, SIGKILL) garante que child morre se parent morrer.
// execa expõe isto via 'detached: false' + NÃO usar detached:true (default safe).
// Se node-pty fosse usado, teria 'detached' explícito; execa 9.x já não detacha.

// Comportamento por SO:
// - Linux: amarre via forkOptions { detached: false } e setpgid — child fica no mesmo 
//   process group; kill do parent propaga SIGHUP ao grupo.
// - macOS: NÃO tem PDEATHSIG; dependemos do tracking manual de PIDs + reaper.
// - WSL: comporta como Linux.

// Conclusão: implemente tracking de PIDs manualmente (funciona em todo lugar) e 
// adicionalmente use detached:false no execa.
</pdeathsig>

<pids_file_spec>
<![CDATA[
// src/agent/pids-file.ts (novo)

const pidsFile = path.join(
  process.env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local/state'),
  'copilot-orch',
  'pids.json'
);

interface PidEntry {
  pid: number;
  agentId: string;
  spawnedAt: number;  // Date.now()
  parentPid: number;  // process.pid do orchestrator
}

export async function addPid(entry: PidEntry): Promise<void>
export async function removePid(pid: number): Promise<void>
export async function readPids(): Promise<PidEntry[]>
export async function clearAll(): Promise<void>

// Arquivo: JSON array, sincronizado com lockfile simples (proper-lockfile seria dep extra 
// desnecessária; use fs.mkdir atomic + fs.writeFile + rename). 
// Para v1, aceita race conditions em uso concorrente — é projeto pessoal.
]]></pids_file_spec>

<startup_reaping>
<![CDATA[
// Em Orchestrator constructor (ou método .init() chamado antes de launch):
async init(): Promise<void> {
  const stale = await readPids();
  const myPid = process.pid;
  for (const entry of stale) {
    // Considera stale se parent PID não está mais vivo.
    const parentAlive = this.isProcessAlive(entry.parentPid);
    if (!parentAlive && this.isProcessAlive(entry.pid)) {
      try { process.kill(entry.pid, 'SIGKILL'); } catch {}
      log.warn({ event: 'zombie_reaped', pid: entry.pid, agentId: entry.agentId });
    }
  }
  await clearAll();  // limpa o arquivo inteiro; novas entradas serão adicionadas em launch.
}

private isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
]]></startup_reaping>

<supervisor_integration>
// Em AgentSupervisor.start(), após spawn:
await addPid({
  pid: this.child.pid!,
  agentId: this.id,
  spawnedAt: Date.now(),
  parentPid: process.pid,
});

// Em AgentSupervisor.shutdown(), após confirmar kill:
await removePid(this.child.pid!);
</supervisor_integration>

<reap_script>
// scripts/reap.ts: lê ~/.local/state/copilot-orch/pids.json e manda SIGKILL em todos.
// Uso de emergência quando tudo deu errado.
// package.json: "reap": "tsx scripts/reap.ts"
</reap_script>

<acceptance_criteria>
1. `pkill -9 -f "tsx src/index.ts"` durante execução com 3 agentes.
2. `pgrep -f "copilot.*acp"` pode ainda listar processos (macOS) — isso é esperado.
3. `npm run reap` mata todos os processos listados no pids.json.
4. Novo `npm run dev -- "x"` em startup detecta PIDs stale e os mata antes de spawnar novos.
5. Log mostra "zombie_reaped" no startup após crash.
6. `npx tsc --noEmit` sem erros.
</acceptance_criteria>

<constraints>
- NÃO depender de proper-lockfile ou libs de lock — o projeto é solo, race é aceitável.
- NÃO kill processos que não pertencem ao orquestrador — SEMPRE verifique parentPid no entry.
- NÃO crie loop de kill recursivo — um SIGKILL direto e um kill(pid, 0) pra confirmar.
- arquivo pids.json deve ficar em XDG_STATE_HOME, não em /tmp (precisa sobreviver reboot).
</constraints>
```

---

### Tarefa 19 — Logging pino para arquivo

| Campo | Valor |
|---|---|
| Arquivos | `src/logging/logger.ts`, atualiza módulos que usavam console.error |
| Depende de | 1 |
| Nome da sessão DAG | `dag-l1-t19-deps-t01` |
| Validação | `cat ~/.local/share/copilot-orch/logs/session-*.ndjson \| jq .` mostra logs estruturados |
| Horas | 3h |

#### Prompt da tarefa 19

```xml
<role>
Você está substituindo o logging ad-hoc por pino 10.3 estruturado, escrevendo em arquivo 
NDJSON com child loggers por agente. Stdout é sagrado — NUNCA pode receber logs.
</role>

<task>
(1) Criar src/logging/logger.ts que configura pino com destino = arquivo (sem transport 
assíncrono complicado — usar pino.destination síncrono). (2) Criar diretório de logs 
automaticamente. (3) Expor um logger raiz e uma factory createAgentLogger(id) que retorna 
child logger com bindings { agentId }. (4) Substituir TODOS os console.error temporários 
em módulos anteriores por chamadas via este logger.
</task>

<logger_ts_spec>
// src/logging/logger.ts

import pino from 'pino';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

function logDir(): string {
  return process.env.COPILOT_ORCH_LOG_DIR 
    ?? path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local/share'),
                 'copilot-orch', 'logs');
}

function createLogFile(): string {
  const dir = logDir();
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(dir, `session-${ts}.ndjson`);
}

const logFilePath = createLogFile();

// Destino síncrono — pino.destination com sync:false usa worker, mas queremos 
// synchronous writes para não perder logs em crash. Em solo project, perf é OK.
const dest = pino.destination({ dest: logFilePath, sync: true });

export const logger = pino({
  level: process.env.COPILOT_ORCH_LOG_LEVEL ?? 'info',
  base: { pid: process.pid },
  timestamp: pino.stdTimeFunctions.isoTime,
}, dest);

export function createAgentLogger(agentId: string) {
  return logger.child({ agentId });
}

export { logFilePath };
</logger_ts_spec>

<migration_checklist>
Procure por `console.error`, `process.stderr.write` com JSON, e helpers de log temporários 
("TODO: trocar por pino") e substitua:

- src/orchestrator/Orchestrator.ts: spawn events → logger.info({ event: 'spawn', ... })
- src/agent/AgentSupervisor.ts: erros → logger.error({ err, agentId }, "message")
- src/worktree/WorktreeManager.ts: pruneOrphans warns → logger.warn(...)
- src/index.ts: shutdown messages → logger.info

NÃO substituir:
- stderr writes em src/cli.ts (help, parse errors) — são UX, não logs.
- Testes vitest — usam console normalmente.

Cada AgentSupervisor instancia createAgentLogger(this.id) uma vez em start() e usa em 
tudo; o agentId fica bindeado automaticamente em todos os logs do supervisor.
</migration_checklist>

<footer_log_path_update>
// StatusBar footer (tarefa 15) tinha um placeholder. Atualizar para usar logFilePath 
// real importado de src/logging/logger.ts.
</footer_log_path_update>

<acceptance_criteria>
1. `npm run dev -- "x"` cria ~/.local/share/copilot-orch/logs/session-*.ndjson.
2. `cat` do arquivo: cada linha é JSON válido, com campos { level, time, pid, msg } no mínimo.
3. Linhas de agente incluem `agentId`.
4. `grep -c . arquivo.ndjson` > 10 após uma sessão típica.
5. Stdout permanece limpo (UI Ink íntegra).
6. `COPILOT_ORCH_LOG_LEVEL=debug npm run dev -- "x"` gera mais linhas que o default.
7. Crash (kill -9) não perde as últimas linhas porque sync: true.
8. `npx tsc --noEmit` sem erros.
</acceptance_criteria>

<constraints>
- pino.destination({ sync: true }) — síncrono é intencional, NÃO usar pino.transport() 
  (worker thread) neste projeto. Menos moving parts.
- NÃO usar pino-pretty em runtime — só para leitura manual (`pino-pretty &lt; session-*.ndjson`).
- NÃO instalar pino-roll — rotação é descope; cada sessão = arquivo novo já é suficiente.
- NUNCA logar para stdout. Se precisar debugar o logger, use fs.writeSync(2, ...) (stderr raw).
</constraints>
```

---

### Tarefa 20 — Retry e backoff para rate limit

| Campo | Valor |
|---|---|
| Arquivos | atualiza `src/agent/AgentSupervisor.ts`, `src/acp/types.ts` |
| Depende de | 7, 19 |
| Nome da sessão DAG | `dag-l5-t20-deps-t07-t19` |
| Validação | Com mock error de rate limit, agente pausa 60s e retenta; visível no log |
| Horas | 3h |

#### Prompt da tarefa 20

```xml
<role>
Você está adicionando resiliência contra o rate limit hard-fail do Copilot CLI. O modelo 
é: detectar erro de rate limit nas respostas ACP, sinalizar "rate_limited" como phase, 
aguardar backoff, e retentar o último prompt — até 3 vezes com exponential backoff e jitter.
</role>

<task>
(1) Adicionar fase 'rate_limited' em AgentPhase. (2) Detectar erro de rate limit em 
responses do ACP (inspecionar error.message via heurística de string, já que ACP não 
padroniza códigos). (3) Implementar retry com backoff 60s/120s/300s + jitter. (4) Mostrar 
contador "retry 1/3 in 45s" na UI. (5) Ao exceder retries, transitar para 'error'.
</task>

<phase_addition>
// Em src/acp/phase-machine.ts, adicionar:
export type AgentPhase = 
  | 'spawning' | 'idle' | 'thinking' | 'planning' | 'tool_call' 
  | 'responding' | 'done' | 'error' 
  | 'rate_limited';  // NOVO

// Em AgentState:
interface AgentState {
  // ...campos existentes
  retryCount: number;
  retryResumeAt: number | null;  // Date.now() + backoffMs quando em rate_limited
}
</phase_addition>

<error_detection>
// Em AgentSupervisor.prompt(), envolva a chamada em try/catch e detecte rate limit 
// via heurística (ACP não padroniza code). O Copilot CLI reporta rate limit via:
// - response com error.message contendo "rate limit" ou "429" ou "quota exceeded"
// - exit code 1 com stderr contendo essas strings
// Mantenha um array de regexes para atualizar quando descobrir formas novas:

const RATE_LIMIT_PATTERNS = [
  /rate.?limit/i,
  /\b429\b/,
  /quota.*exceeded/i,
  /too many requests/i,
];

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return RATE_LIMIT_PATTERNS.some(re => re.test(msg));
}
</error_detection>

<retry_loop>
<![CDATA[
// Sequência de backoff com jitter ±10%:
const BACKOFFS_MS = [60_000, 120_000, 300_000];
function withJitter(ms: number): number {
  return Math.round(ms * (0.9 + Math.random() * 0.2));
}

async prompt(text: string): Promise<string> {
  this.lastPromptText = text;
  for (let attempt = 0; attempt <= BACKOFFS_MS.length; attempt++) {
    try {
      const result = await this.doPrompt(text);  // versão interna sem retry
      this.state = { ...this.state, retryCount: 0, retryResumeAt: null };
      return result;
    } catch (err) {
      if (!isRateLimitError(err) || attempt === BACKOFFS_MS.length) {
        throw err;  // não é rate limit, ou esgotou retries → propaga
      }
      const waitMs = withJitter(BACKOFFS_MS[attempt]!);
      const resumeAt = Date.now() + waitMs;
      this.state = { 
        ...this.state, phase: 'rate_limited', 
        retryCount: attempt + 1, retryResumeAt: resumeAt 
      };
      this.emit('stateChange', this.state);
      this.agentLog.warn({ event: 'rate_limited', attempt: attempt + 1, waitMs }, 
                         'rate limited, backing off');
      await sleep(waitMs);
    }
  }
  throw new Error('unreachable');
}
]]></retry_loop>

<ui_update>
// Em AgentPanel, quando state.phase === 'rate_limited':
// - border color: yellow
// - ícone: ⏳
// - mensagem: "rate limited, retry {retryCount}/3 in {remainingSec}s"
// - atualizar remaining a cada 1s via useEffect setInterval
// - remainingSec = Math.max(0, Math.ceil((state.retryResumeAt - Date.now())/1000))
</ui_update>

<acceptance_criteria>
1. Simulação com fake-acp-stream (tarefa 21) pode emitir erro rate limit; agente transita 
   para rate_limited, aguarda, e retenta (visível no log).
2. Contador UI decrementa a cada segundo.
3. Após 3 retries falhando, phase vai para 'error' com mensagem "rate limit exceeded after 3 retries".
4. Prompt não-rate-limit erra imediatamente sem retry.
5. Log contém entries `{event:'rate_limited'}` para cada retry.
6. `npx tsc --noEmit` sem erros.
</acceptance_criteria>

<constraints>
- NÃO usar libs como p-retry, async-retry — 20 linhas de código custom são suficientes.
- NÃO fazer retry em outros tipos de erro (auth, crash, syntax). Só rate limit.
- Backoffs são FIXOS (60/120/300); NÃO tentar adaptive estimation por enquanto.
- Jitter é obrigatório — sem ele, N agentes acordam juntos e batem o rate limit de novo.
- sleep() durante retry DEVE ser cancelável por shutdown (receber AbortSignal). Simples: 
  envolver em Promise.race([sleep(ms), this.shutdownSignal]).
</constraints>
```

---

### Tarefa 21 — Mock mode completo

| Campo | Valor |
|---|---|
| Arquivos | `src/mock/MockCopilotProcess.ts`, atualiza `src/agent/AgentSupervisor.ts` |
| Depende de | 2, 7 |
| Nome da sessão DAG | `dag-l5-t21-deps-t02-t07` |
| Validação | `npm run dev:mock -- -n 3 "a" "b" "c"` roda 3 agentes fake sem Copilot instalado |
| Horas | 4h |

#### Prompt da tarefa 21

```xml
<role>
Você está formalizando o modo mock: o orquestrador inteiro roda sem o binário copilot 
instalado, usando fake-acp-stream (tarefa 2) como child process substituto. Isso permite 
iterar UI/orquestração sem consumir rate limit.
</role>

<task>
(1) Criar src/mock/MockCopilotProcess.ts que expõe a mesma interface que o execa child 
real (stdin, stdout, stderr, kill, exit event) mas internamente usa streams in-memory e 
emite mensagens NDJSON simuladas. (2) Atualizar AgentSupervisor para, quando 
opts.mock === true, instanciar MockCopilotProcess em vez de execa(copilot). (3) CLI 
flag --mock (já existe da tarefa 12) propaga para cada supervisor. (4) Suportar cenários: 
happy, slow, error, rate_limit via flag --mock-scenario.
</task>

<mock_process_spec>
<![CDATA[
// src/mock/MockCopilotProcess.ts

import { Readable, Writable, PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';

export type MockScenario = 'happy' | 'slow' | 'error' | 'rate_limit';

export interface MockCopilotProcessOptions {
  scenario?: MockScenario;   // default 'happy'
  seed?: number;             // default Date.now(); para reproduzir cenários
}

export class MockCopilotProcess extends EventEmitter {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly pid: number;
  killed = false;
  
  constructor(opts: MockCopilotProcessOptions = {}) {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.pid = Math.floor(Math.random() * 1e6) + 900000; // fake PID range
    this.startScenario(opts.scenario ?? 'happy');
  }
  
  private async startScenario(scenario: MockScenario): Promise<void> {
    // Aguardar initialize request no stdin (parse linha a linha).
    // Responder initialize.
    // Aguardar session/new → responder com sessionId mock.
    // Aguardar session/prompt → executar script conforme scenario.
    // happy:    seq de agent_thought → plan → tool_call → tool_call_update completed → 
    //           agent_message_chunk * 20 → response done.
    // slow:     mesmo que happy mas delays 3x maiores.
    // error:    emite um tool_call_update com status 'failed'.
    // rate_limit: responde session/prompt com error { message: "rate limit exceeded" }.
  }
  
  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    if (this.killed) return false;
    this.killed = true;
    setImmediate(() => this.emit('exit', signal === 'SIGKILL' ? null : 0, signal));
    return true;
  }
}
]]></mock_process_spec>

<supervisor_integration>
// Em AgentSupervisor, adicionar opção:
interface AgentSupervisorOptions {
  // ...
  mock?: boolean;
  mockScenario?: MockScenario;
}

// Em start():
let child: execa.ResultPromise | MockCopilotProcess;
if (opts.mock) {
  child = new MockCopilotProcess({ scenario: opts.mockScenario });
} else {
  child = execa('copilot', ['--acp', '--stdio'], { cwd: opts.cwd, ... });
}
// resto do código usa child.stdin/stdout/stderr/kill() — interface comum já é 
// compatível graças à mesma shape.
</supervisor_integration>

<cli_propagation>
// Em index.ts, após parseCli:
if (parsed.mock) {
  for (const supervisor of orch.supervisors) {
    // já propagado via Orchestrator options que recebe mock: parsed.mock
  }
}

// Em package.json, adicionar:
"dev:mock": "tsx src/index.ts --mock"
// E scripts variantes:
"dev:mock:slow": "tsx src/index.ts --mock --mock-scenario=slow",
"dev:mock:error": "tsx src/index.ts --mock --mock-scenario=error"
</cli_propagation>

<acceptance_criteria>
1. `PATH= npm run dev:mock -- "task"` funciona mesmo com PATH vazio (copilot não encontrado).
2. `npm run dev:mock -- -n 3 "a" "b" "c"` mostra grid 3 painéis, cada um completando em 
   ~8s (cenário happy).
3. `npm run dev:mock:error -- "x"` mostra painel transitando para 'error' no meio.
4. `npm run dev:mock:slow -- "x"` completa em ~24s.
5. Ctrl+C durante mock limpa sem zumbis (MockCopilotProcess.kill funciona).
6. Rate limit cenário dispara o retry loop da tarefa 20.
7. Fake PID não colide com PIDs reais (range alto).
8. `npx tsc --noEmit` sem erros.
</acceptance_criteria>

<constraints>
- MockCopilotProcess DEVE expor interface suficiente para o AgentSupervisor não precisar 
  de `if (mock)` espalhado — duck typing clean.
- NÃO usar execa com comando fake — MockCopilotProcess é in-process, zero overhead.
- NÃO usar child_process.fork — in-memory streams são mais rápidos e controláveis.
- Cenários DEVEM ser determinísticos com seed fixo (útil para capturar bugs).
- PassThrough streams DEVEM ter highWaterMark default — não tunar.
</constraints>
```

---

### Tarefa 22 — README + script de setup

| Campo | Valor |
|---|---|
| Arquivos | `README.md`, `scripts/setup.sh` |
| Depende de | todas as anteriores |
| Nome da sessão DAG | `dag-l8-t22-deps-all-prev` |
| Validação | Clone fresh + setup.sh + `npm run dev:mock` funciona em <2min |
| Horas | 4h |

#### Prompt da tarefa 22

```xml
<role>
Você é o próprio autor escrevendo a documentação que o "você de 6 meses no futuro" vai 
precisar quando esquecer como o projeto funciona. Não é doc para terceiros — é doc para 
o próprio maintainer. Mais curta que longa, mais específica que genérica.
</role>

<task>
(1) Criar README.md com quickstart, flags, diagrama ASCII da arquitetura, troubleshooting 
dos 5 erros mais comuns, e nota sobre limitações conhecidas. (2) Criar scripts/setup.sh 
que instala dependências e valida pré-requisitos (Node 22+, copilot CLI, git). (3) 
Adicionar seção "Architecture Decision Log" super curta com 5-6 decisões principais.
</task>

<readme_structure>
<![CDATA[
# multi-copilot-orchestrator

Orquestrador pessoal para rodar N instâncias do GitHub Copilot CLI em paralelo, 
cada uma em sua própria git worktree, com UI em terminal.

## Requisitos

- Node.js 22+
- Git 2.5+ (suporte a worktrees)
- `@github/copilot` instalado globalmente e autenticado (`copilot auth`)
- Linux, macOS, ou WSL

## Setup

    git clone <repo>
    cd multi-copilot-orchestrator
    ./scripts/setup.sh
    npm run dev:mock -- "hello"    # valida setup sem gastar rate limit

## Uso

    # 1 agente
    npm run dev -- "refactor the auth module"
    
    # 3 agentes em paralelo
    npm run dev -- -n 3 "task 1" "task 2" "task 3"
    
    # Modo mock (sem Copilot real)
    npm run dev:mock -- -n 2 "a" "b"
    
    # Com tmux para detach/reattach
    tmux new-session -s orch "npm run dev -- 'long task'"
    # Ctrl+b d para destacar, `tmux attach -t orch` para voltar

## Flags

| Flag | Default | Descrição |
|---|---|---|
| -n, --agents | `prompts.length` | Número de agentes |
| --mock | false | Usa mock ACP |
| --mock-scenario | happy | happy\|slow\|error\|rate_limit |
| --log-level | info | debug\|info\|warn\|error |
| -h, --help | — | Mostra ajuda |

## Arquitetura

    ┌─ tmux session (opcional, wrapper) ────────────────────┐
    │  ┌─ Node (1 processo) ──────────────────────────────┐ │
    │  │  Ink render → stdout                             │ │
    │  │  Orchestrator                                    │ │
    │  │   ├─ WorktreeManager → git worktree add/remove   │ │
    │  │   ├─ AgentSupervisor[0] ─ stdio ─┐               │ │
    │  │   ├─ AgentSupervisor[1] ─ stdio ─┤               │ │
    │  │   └─ AgentSupervisor[N] ─ stdio ─┤               │ │
    │  │                                   ↓               │ │
    │  │                            copilot --acp --stdio  │ │
    │  │                             (1 por agente, cwd =  │ │
    │  │                              worktree respectiva) │ │
    │  └───────────────────────────────────────────────────┘ │
    └────────────────────────────────────────────────────────┘

Arquitetura A (tudo em um Ink). Alternativa B (tmux como grid real) foi descartada por 
complicar IPC sem ganho proporcional. Ver `docs/architecture-decisions.md` se existir.

## Troubleshooting

### "rate limited, retry 1/3 in 58s"
Esperado quando N ≥ 3. Aguarde ou reduza N. Veja Issue #845 do copilot-cli.

### Worktrees não são limpos após crash
    npm run cleanup

### Processos zumbi após kill -9
    npm run reap

### UI com flicker ou layout quebrado
Alguma parte do código vazou print no stdout. Verifique logs recentes:
    grep -l "console.log\|process.stdout.write" src/**/*.ts
(o único stdout legítimo é do Ink em src/index.ts)

### "auth required" no primeiro uso
    copilot auth

## Limitações conhecidas

- Máximo prático: 3-4 agentes simultâneos (CPU e rate limit).
- Não funciona em Windows nativo (sem WSL).
- Modo ACP auto-aprova tool calls — NÃO rodar em repos não-confiáveis.
- Scroll interno por painel não existe; histórico completo fica nos logs.
- Rate limit é hard-fail (não throttle); o retry custom ajuda mas não resolve.

## Architecture Decision Log

1. **Ink em vez de tmux panes** — um único React tree simplifica estado e evita IPC.
2. **simple-git via .raw() para worktrees** — sem API dedicada mas estável.
3. **pino síncrono** — perde throughput mas nunca perde log em crash.
4. **execa sobre child_process** — cleanup mais robusto e API mais ergonômica.
5. **parseArgs nativo (não yargs)** — menos dep, suficiente para 4 flags.
6. **Mock mode in-process (não binário fake)** — zero latência, controle total.

## Layout

    src/
      acp/            # tipos e state machine
      agent/          # AgentSupervisor (1 por Copilot child)
      worktree/       # WorktreeManager (simple-git)
      orchestrator/   # coordena N supervisors
      ui/             # componentes Ink
      logging/        # pino
      mock/           # fake ACP + MockCopilotProcess
      cli.ts          # parseArgs
      index.ts        # entry point
    scripts/          # setup, cleanup, reap, spikes
]]></readme_structure>

<setup_sh_spec>
<![CDATA[
#!/usr/bin/env bash
set -euo pipefail

# 1. Check Node version
node_major=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$node_major" -lt 22 ]; then
  echo "ERROR: Node 22+ required (found $(node -v))" >&2
  exit 1
fi

# 2. Check git
if ! command -v git >/dev/null; then
  echo "ERROR: git not found" >&2
  exit 1
fi

# 3. Check copilot CLI (warn only — mock mode funciona sem)
if ! command -v copilot >/dev/null; then
  echo "WARN: 'copilot' CLI não encontrado. Instale com:" >&2
  echo "  npm i -g @github/copilot" >&2
  echo "Ou use apenas o modo --mock." >&2
fi

# 4. Install deps
npm ci || npm install

# 5. Typecheck
npm run typecheck

# 6. Run tests
npm test -- --run

# 7. Smoke test do mock
timeout 30 npm run dev:mock -- "setup smoke test" || {
  echo "ERROR: smoke test falhou" >&2
  exit 1
}

echo "✓ Setup completo"
]]></setup_sh_spec>

<acceptance_criteria>
1. Clone fresh em tmp, rodar `./scripts/setup.sh` → sucesso em &lt;2min.
2. README abre em markdown viewer sem erros de sintaxe.
3. Diagrama ASCII alinhado (nenhuma linha quebrada em larguras típicas 80/120).
4. Todas as flags mencionadas no README de fato existem no cli.ts.
5. Todos os scripts mencionados (`npm run cleanup`, `npm run reap`, `npm run dev:mock`) 
   existem em package.json.
6. Troubleshooting cobre os 5 problemas mais prováveis do uso real.
7. setup.sh é executável (`chmod +x`) e tem shebang.
8. `npx tsc --noEmit` sem erros (nada mudou no código, mas rode para garantir).
</acceptance_criteria>

<constraints>
- README DEVE caber em &lt;200 linhas. Concisão > completude.
- NÃO inclua screenshots (é CLI) nem badges (é projeto pessoal).
- NÃO inclua seção "Contributing" — é projeto solo.
- NÃO inclua licença elaborada — uma linha MIT no final basta ou deixe sem licença.
- setup.sh DEVE ser idempotente — rodar 2x não quebra.
- NÃO adicione CI/GitHub Actions neste projeto.
</constraints>
```

---

## Seção 3: Definition of Done por semana

### Semana 1 — agente end-to-end

- [ ] `npm run dev -- "explain this repo"` exibe 1 painel Ink com streaming real
- [ ] `npm run dev -- --mock "hello"` funciona sem Copilot instalado
- [ ] Ctrl+C limpa worktree criada e mata processo Copilot
- [ ] `pgrep -f "copilot.*acp"` vazio após encerramento
- [ ] `git worktree list` mostra apenas main após encerramento
- [ ] `vitest run` passa em WorktreeManager e phase-machine (≥20 testes totais)
- [ ] Logs não aparecem em stdout (UI íntegra)
- [ ] docs/acp-findings.md documenta formato real do wire protocol

### Semana 2 — N agentes em paralelo

- [ ] `npm run dev -- -n 3 "a" "b" "c"` abre grid com 3 painéis streamando
- [ ] Stagger de ~2s entre spawns visível nos logs
- [ ] Ctrl+C mata os 3 processos e limpa todas as worktrees
- [ ] StatusBar mostra contagem e distribuição de fases correta
- [ ] `--mock` funciona com N agentes
- [ ] Zero conflito de stash entre worktrees (cada em diretório isolado)
- [ ] UI responsiva com 3 agentes, sem freeze visível

### Semana 3 — hardening

- [ ] `kill -9` em um processo copilot → painel fica vermelho, outros continuam
- [ ] Nenhum zumbi após crash (`pgrep` limpo em <10s após `npm run reap`)
- [ ] Worktrees locked após crash são limpas no próximo startup
- [ ] `npm run cleanup` remove worktrees órfãs
- [ ] Rate limit (simulado via `--mock-scenario=rate_limit`) pausa e retenta
- [ ] Log NDJSON legível com `cat | jq .` mostrando timeline

### Semana 4 — polish

- [ ] `npm run dev:mock -- -n 3` funciona em máquina limpa após clone + setup
- [ ] README com quickstart, flags, arquitetura, troubleshooting
- [ ] Código sem `any` explícito em módulos core
- [ ] Coverage ≥60% em lógica pura (phase-machine, WorktreeManager, types)
- [ ] setup.sh idempotente e smoke test funcional

---

## Seção 4: Gates de descoberta

| # | Unknown | Semana de exposição | Plano B |
|---|---|---|---|
| G1 | Formato exato do discriminador em session/update (sessionUpdate? kind?) | S1, tarefa 4 | Capturar NDJSON raw no spike; gerar tipos a partir dos dados reais com parsing defensivo e fallback para `unknown_update` |
| G2 | Issue #845 ainda ativo — requestPermission nunca chega em ACP | S1, tarefa 4 | Se confirmado, handler vira no-op. Se corrigido, implementar auto-approve proper (~2h extras) |
| G3 | Duas sessões simultâneas compartilham estado global (cache, telemetria) | S2, tarefa 10 | Testar com processos separados; se colidir, adicionar `--disable-telemetry`; último recurso: limitar a 1 por vez |
| G4 | session/cancel mid-stream deixa arquivo meio escrito | S2, tarefa 14 | Fazer `git checkout .` na worktree após cancel; documentar como limitação conhecida |
| G5 | Cold-start do Copilot CLI > 10s torna UX ruim | S1, tarefa 7 | Mostrar spinner "Initializing Copilot..." no painel; timeout 15s com retry; 30s = fail |
| G6 | Ink fullscreen consome última linha (regressão 6.x) | S1, tarefa 8 | Usar `incremental: true`; se persistir, calcular `rows - 1` como altura máxima |
| G7 | Memory leak do copilot-language-server em sessões longas | S3 | Monitor de RSS a cada 30s no log; restart automático se >2GB |
| G8 | Rate limit com 3 agentes simultâneos | S2, tarefa 13 | Stagger já planejado; se insuficiente, token bucket global (1 prompt/5s); descope para 2 agentes |

---

## Seção 5: Critérios de descope

| Condição | Corte | Impacto |
|---|---|---|
| S1 estourar em +3 dias | Cortar Ink temporariamente; entregar agente com output em logs NDJSON puro | Atrasa S2 ~3 dias, garante ACP sólido |
| S2 estourar em +3 dias | Hard-cap em 2 agentes; layout fixo 2 painéis | Simplifica layout, reduz pressão de rate limit |
| ACP streaming de chunks flaky | Cortar `agent_thought_chunk` da UI; mostrar só `tool_call` + `agent_message_chunk` | Perde visibilidade de "pensamento" |
| Ink com 4+ agentes inaceitável | Hard-cap em 3; reduzir maxFps para 5 | UX degradada mas funcional |
| Rate limit bloqueia iteração | Desenvolver 100% em mock durante S2-S3; Copilot real só em S4 | Risco de descobrir incompatibilidade tarde |
| Issue #752 do Ink incontornável | Abandonar fullscreen; usar Static + painel único em foco | Perde visualização simultânea |
| S3 sem folga para hardening | Cortar retry/backoff e monitor de memória; manter só crash cleanup básico | Menos resiliente mas funcional |

---

## Seção 6: Estratégia de testes

**Com teste unitário obrigatório (cobertura ≥80%):**
- **WorktreeManager** — disco real em /tmp, determinístico. ~9 testes.
- **phase-machine** — puro, zero I/O. ~12 testes.
- **Parsing de session/update** — fixtures reais do spike. ~6 testes.
- **cli.ts parseArgs** — flags válidas e inválidas. ~5 testes.

**Sem teste automatizado (validação manual):**
- **UI Ink** — frágil em vitest, não captura problemas visuais. Validação via `dev:mock`.
- **Integração com Copilot real** — flaky, caro. Spike manual + uso real.
- **Orchestrator** — integração; testar via uso real com mock.

**Padrão de mock para ACP:**
O `fake-acp-stream.ts` (tarefa 2) é o script base; `MockCopilotProcess.ts` (tarefa 21) é 
a fachada in-memory usada em tempo de execução. Ambos simulam initialize → newSession → 
session/update sequence → prompt response.

**Coverage alvo:** 65% de lógica pura. 0% de UI. Medido via `vitest --coverage`.

---

## Seção 7: Riscos de projeto

| Risco | Prob | Impacto | Mitigação |
|---|---|---|---|
| SDK `@agentclientprotocol/sdk` quebra API durante 4 semanas (pré-1.0) | Média | Alto | Pinar versão exata (`"0.17.0"`); fallback: NDJSON manual via readline (~4h) |
| Copilot CLI atualiza automaticamente e muda formato ACP | Média | Alto | Pinar `@github/copilot` global; capturar NDJSON raw no spike como referência fixa |
| Descobrir que precisa node-pty afinal | Baixa | Médio | Reservar 4h na S3; execa com `stdio: 'pipe'` deve bastar, node-pty é fallback |
| Ink performance não aguenta 4+ agentes | Média | Médio | `maxFps: 15` + `incremental` desde o início; hard-cap em 3 como descope |
| Rate limit impede iteração com Copilot real | Alta | Alto | Mock mode desde dia 1; Copilot real só para validação pontual (2-3/dia) |
| Motivação decai na S3 (hardening é tedioso) | Média | Médio | Variar tarefas (UI errors + logging + cleanup); se necessário, pular para S4 |
| Worktree base dir enche disco | Baixa | Baixo | Cleanup no shutdown; hard cap de 5 worktrees simultâneas |
| tmux adiciona complexidade | Baixa | Baixo | tmux é apenas wrapper externo; NÃO integrar no código Node |

---

## Seção 8: Deliverable final concreto

Ao final da Semana 4, o projeto roda assim: abrir terminal, entrar no repositório-alvo, e 
executar `tmux new-session -s orch "npx tsx /path/to/multi-copilot/src/index.ts -n 3 'refactor auth' 'add tests for API' 'update README'"`. 
Após ~5 segundos de inicialização (criação de worktrees + cold start do Copilot), a tela 
exibe um **grid de 3 painéis** lado a lado, cada um com o ID do agente no topo, a fase 
atual (🧠 thinking / 🔧 tool_call / 💬 responding) com ícone distinto, e o texto 
streamando em tempo real. Tool calls aparecem com nome e argumentos, respostas finais 
aparecem como texto corrido com as últimas 3 linhas visíveis. Na base da tela, a 
**StatusBar** mostra "3 agents │ 🧠 1  📋 0  🔧 1  💬 1  ✅ 0  ❌ 0 │ 04:12 │ Ctrl+C to 
quit". O usuário pode fazer **detach do tmux** com `Ctrl+b d` e reattach com 
`tmux attach -t orch` sem perder estado. Para encerrar, **Ctrl+C** dispara shutdown 
coordenado: unmount do Ink, cancel das sessões ACP, SIGTERM nos processos Copilot, 
remoção das 3 worktrees, exit 130. Os resultados dos agentes ficam nos commits feitos em 
suas worktrees antes do cleanup — o Orchestrator loga os diffs finais no NDJSON. O 
diretório `~/.local/share/copilot-orch/logs/` contém o log completo da sessão, parseável 
com `jq`. O README contém: quickstart de 5 linhas, tabela de flags, diagrama ASCII da 
arquitetura, troubleshooting para os 5 problemas mais comuns (rate limit, worktree 
locked, zumbi, flicker, auth), e ADL de 6 decisões. O projeto roda localmente, é mantível 
pelo próprio autor, e resolve o problema core: **ver N agentes Copilot trabalhando em 
paralelo em tempo real, cada um em worktree isolada, com feedback imediato por fase**.