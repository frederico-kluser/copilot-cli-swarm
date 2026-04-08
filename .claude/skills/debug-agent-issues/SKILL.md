---
name: debug-agent-issues
description: >-
  Systematic debugging for agent crashes, zombie processes, rate limits,
  worktree leaks, and UI corruption. Decision tree with diagnostic commands.
  Use when investigating agent errors, hung processes, or cleanup issues.
---
# Debug Agent Issues — Árvore de Decisão

## Passo 1: Coletar contexto

Execute o script de diagnóstico:
```bash
./scripts/collect-diagnostics.sh
```

Ou colete manualmente:
```bash
# Processos copilot ativos
pgrep -fla "copilot.*acp" || echo "Nenhum processo copilot"

# Worktrees pendentes
git worktree list

# Diretórios em tmpdir
ls -la /tmp/copilot-orch/ 2>/dev/null || echo "Diretório não existe"

# PIDs rastreados
cat ~/.local/state/copilot-orch/pids.json 2>/dev/null || echo "Sem PIDs"

# Último log
ls -t ~/.local/share/copilot-orch/logs/*.ndjson 2>/dev/null | head -1 | xargs tail -20
```

## Passo 2: Classificar o problema

### Agente crashou (painel vermelho com [!!])

1. **Ler o erro no painel** — mensagem inclui signal/exit code + últimas linhas de stderr
2. Se `exit 1 — auth required` → rodar `copilot auth`
3. Se `signal SIGKILL` → alguém matou o processo externamente ou OOM killer
4. Se `exit 1` genérico → verificar nos logs:
   ```bash
   cat $(ls -t ~/.local/share/copilot-orch/logs/*.ndjson | head -1) | \
     grep '"agentId"' | grep '"level":50' | tail -5 | jq .
   ```
5. Se `initialize failed` → Copilot CLI não está instalado ou não está autenticado

### Processos zumbi (pgrep mostra copilot após sair)

1. Tentar primeiro: `npm run reap`
2. Se não resolver: `pkill -9 -f "copilot.*acp"`
3. Verificar se PIDs file está atualizado: `cat ~/.local/state/copilot-orch/pids.json`
4. Se pids.json tem entries com `parentPid` de processo morto → próximo startup vai limpar automaticamente

### Worktrees não foram limpas

1. Verificar: `git worktree list` — worktrees com path em `/tmp/copilot-orch/` são do orquestrador
2. Tentar: `npm run cleanup`
3. Se cleanup falha com "locked": o worktree está locked por crash anterior
   ```bash
   git worktree unlock /tmp/copilot-orch/agent-XXXX
   git worktree remove --force /tmp/copilot-orch/agent-XXXX
   ```
4. Nuclear option: `rm -rf /tmp/copilot-orch/ && git worktree prune`

### Rate limit (painel amarelo com [~~])

1. **Comportamento esperado** — o retry automático (60s/120s/300s) está funcionando
2. Verificar nos logs quantos retries:
   ```bash
   cat $(ls -t ~/.local/share/copilot-orch/logs/*.ndjson | head -1) | \
     grep "rate_limited" | jq '{agentId, attempt: .attempt, waitMs}'
   ```
3. Se 3 retries e ainda falha → aguardar mais tempo ou reduzir N de agentes
4. Se rate limit com N=1 → rate limit global da conta, não do orquestrador

### UI corrompida (layout quebrado, caracteres estranhos)

1. **Causa quase certa**: algo vazou para stdout
   ```bash
   grep -rn "console\.log\|process\.stdout\.write" src/ --include="*.ts" --include="*.tsx" \
     | grep -v "__tests__" | grep -v "fake-acp-stream"
   ```
2. Se o terminal ficou em raw mode após crash: `reset` ou `stty sane`
3. Se layout fica freezado: Ink pode ter perdido updates — verificar que `exitOnCtrlC: false` está configurado

### Mock funciona mas real não

1. Verificar que `copilot` está no PATH: `which copilot`
2. Verificar auth: `copilot auth status`
3. Verificar que a worktree tem conteúdo git válido: `git -C /tmp/copilot-orch/agent-XXX status`
4. Rate limit é mais provável com real — começar com N=1

## Gotchas de debug

- **stderr buffer é rolling 4KB.** Mensagens de erro longas são truncadas — as últimas 3 linhas são preservadas no `state.error`.
- **Logs são síncronos.** `pino.destination({ sync: true })` garante que logs não se perdem em crash. Porém, o último log antes de SIGKILL pode não existir.
- **Mock PID range.** MockCopilotProcess usa PIDs falsos (900000+). Nunca tentar `kill` nesses PIDs.
- **Stagger pode mascarar rate limit.** Se todos os agentes completam antes do stagger acabar, o rate limit pode não aparecer. Testar com `--mock-scenario=rate_limit`.
