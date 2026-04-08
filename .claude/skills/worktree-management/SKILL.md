---
name: worktree-management
description: >-
  Git worktree lifecycle using simple-git .raw() API. Covers create, list,
  destroy, orphan pruning, and locked worktree handling. Use when working with
  WorktreeManager, git worktrees, or agent isolation.
---
# Worktree Management — simple-git .raw() patterns

## Por que worktrees

Cada agente Copilot precisa de um diretório de trabalho isolado para evitar conflitos de arquivo entre N agentes operando em paralelo. Git worktrees permitem N checkouts do mesmo repositório sem N clones completos.

## API do WorktreeManager (`src/worktree/WorktreeManager.ts`)

```typescript
class WorktreeManager {
  constructor(repoDir: string)

  create(opts: { id: string; baseBranch: string }): Promise<WorktreeInfo>
  list(): Promise<WorktreeInfo[]>
  destroy(info: WorktreeInfo, opts?: { force?: boolean }): Promise<void>
  destroyAll(): Promise<void>
  isLocked(wtPath: string): Promise<boolean>
  pruneOrphans(): Promise<number>
}

interface WorktreeInfo { id: string; path: string; branch: string }
class DirtyWorktreeError extends Error {}
```

## Padrões de uso com simple-git

simple-git **não tem API dedicada para worktrees**. Tudo usa `.raw()`:

```typescript
import { simpleGit } from 'simple-git';
const git = simpleGit(repoDir);

// Criar worktree + branch
await git.raw(['worktree', 'add', wtPath, '-b', branchName, baseBranch]);

// Listar (formato porcelain, parse manual)
const raw = await git.raw(['worktree', 'list', '--porcelain']);

// Remover
await git.raw(['worktree', 'remove', '--force', wtPath]);

// Prune referências mortas
await git.raw(['worktree', 'prune']);

// Status de uma worktree específica
const wtGit = simpleGit(worktreePath);
const status = await wtGit.status();  // status.isClean()
```

## Parse do formato porcelain

```
worktree /caminho/do/repo
HEAD abc123...
branch refs/heads/main

worktree /tmp/copilot-orch/agent-x
HEAD def456...
branch refs/heads/agent/x

```

Blocos separados por linha vazia. Cada bloco tem `worktree`, `HEAD`, `branch`. A worktree principal (path === repoDir) deve ser filtrada no `list()`.

## Convenções de path

- Base: `os.tmpdir() + '/copilot-orch'` (ex: `/tmp/copilot-orch/`)
- Worktree: `{base}/agent-{id}` (ex: `/tmp/copilot-orch/agent-abc123`)
- Branch: `agent/{id}` (ex: `agent/abc123`)
- ID válido: apenas `[a-z0-9-]` (regex check no create)

## Ciclo de vida

1. `create()` → `mkdirSync(base, {recursive})` → `git worktree add` → registra em `Map<id, WorktreeInfo>`
2. Agente trabalha na worktree...
3. `destroy()` → verifica dirty → force clean se necessário → `git worktree remove --force` → `git branch -D` → remove do Map
4. `destroyAll()` → destroy cada uma → `git worktree prune`

## Gotchas

- **Nunca destruir a worktree principal.** `destroy()` tem guard: `if (path.resolve(info.path) === this.repoDir) throw`. Violar isso corrompe o repositório.
- **DirtyWorktreeError.** Se a worktree tem mudanças não commitadas e `force` é false, `destroy()` lança `DirtyWorktreeError`. Com `force: true`, faz `checkout -- .` + `clean -fd` antes de remover.
- **Branch default não é sempre `main`.** Nos testes e no index.ts, detectar via `git.branchLocal().current`. Nunca hardcodar `'main'`.
- **IDs de teste devem ser únicos.** Usar `randomUUID().slice(0,6)` para evitar colisão entre runs paralelos de testes que compartilham `/tmp/copilot-orch/`.
- **Worktrees locked.** Após crash, `.git/worktrees/{name}/locked` pode persistir. `pruneOrphans()` faz `git worktree unlock` antes de tentar `remove`.
- **Cleanup de disco.** Além de `git worktree prune`, `pruneOrphans()` varre `/tmp/copilot-orch/` por diretórios `agent-*` que não estão mais listados no git.

## Padrão de teste

```typescript
let testRepoDir: string;
let wm: WorktreeManager;
let defaultBranch: string;

beforeEach(async () => {
  testRepoDir = path.join(os.tmpdir(), `wt-test-${randomUUID()}`);
  fs.mkdirSync(testRepoDir, { recursive: true });
  const git = simpleGit(testRepoDir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');
  fs.writeFileSync(path.join(testRepoDir, 'README.md'), '# test\n');
  await git.add('.');
  await git.commit('initial commit');
  const branchSummary = await git.branchLocal();
  defaultBranch = branchSummary.current;
  wm = new WorktreeManager(testRepoDir);
});

afterEach(async () => {
  await wm.destroyAll();
  fs.rmSync(testRepoDir, { recursive: true, force: true });
});
```

Sempre usar `defaultBranch` detectada, nunca `'main'` hardcoded. Sempre limpar em afterEach.
