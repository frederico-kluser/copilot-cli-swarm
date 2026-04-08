import { parseArgs } from 'node:util';

export interface ParsedArgs {
  help: boolean;
  listModels: boolean;
  interactive: boolean;
  mock: boolean;
  mockScenario: 'happy' | 'slow' | 'error' | 'rate_limit';
  agents: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  model?: string;
  prompts: string[];
}

const VALID_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
const VALID_SCENARIOS = ['happy', 'slow', 'error', 'rate_limit'] as const;

export function parseCli(argv: string[]): ParsedArgs {
  const { values, positionals } = parseArgs({
    args: argv.slice(2),
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      'list-models': { type: 'boolean', default: false },
      mock: { type: 'boolean', default: false },
      'mock-scenario': { type: 'string', default: 'happy' },
      agents: { type: 'string', short: 'n' },
      'log-level': { type: 'string', default: 'info' },
      model: { type: 'string' },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.help) {
    return {
      help: true,
      listModels: false,
      interactive: false,
      mock: false,
      mockScenario: 'happy',
      agents: 1,
      logLevel: 'info',
      model: undefined,
      prompts: [],
    };
  }

  const logLevel = values['log-level'] as string;
  if (!VALID_LOG_LEVELS.includes(logLevel as typeof VALID_LOG_LEVELS[number])) {
    throw new Error(`--log-level inválido: "${logLevel}". Use: ${VALID_LOG_LEVELS.join(', ')}`);
  }

  const mockScenario = values['mock-scenario'] as string;
  if (!VALID_SCENARIOS.includes(mockScenario as typeof VALID_SCENARIOS[number])) {
    throw new Error(`--mock-scenario inválido: "${mockScenario}". Use: ${VALID_SCENARIOS.join(', ')}`);
  }

  const model = typeof values.model === 'string' && values.model.trim().length > 0
    ? values.model.trim()
    : undefined;

  const prompts = positionals.filter((p) => p.trim().length > 0);
  const interactive = !values['list-models'] && prompts.length === 0;

  let agents = prompts.length || 1;
  if (values.agents !== undefined) {
    agents = parseInt(values.agents, 10);
    if (!Number.isFinite(agents) || agents < 1) {
      throw new Error(`--agents deve ser um inteiro positivo, recebido: "${values.agents}"`);
    }
  }

  return {
    help: false,
    listModels: values['list-models'] as boolean,
    interactive,
    mock: values.mock as boolean,
    mockScenario: mockScenario as ParsedArgs['mockScenario'],
    agents,
    logLevel: logLevel as ParsedArgs['logLevel'],
    model,
    prompts,
  };
}

export function expandPromptsForAgents(prompts: string[], agents: number): string[] {
  if (prompts.length === 1) {
    return Array.from({ length: agents }, () => prompts[0]!);
  }

  return Array.from({ length: agents }, (_, index) => prompts[index % prompts.length]!);
}

export function printHelp(): void {
  process.stderr.write(`
Uso: multi-copilot [opções] <prompt>...

Opções:
  -n, --agents N         Número de agentes (default: número de prompts)
      --model ID         Seleciona o modelo inicial do Copilot
      --list-models      Lista modelos disponíveis e sai
      --mock             Usar mock ACP em vez de Copilot real
      --mock-scenario S  happy|slow|error|rate_limit (default: happy)
      --log-level L      debug|info|warn|error (default: info)
  -h, --help             Mostra esta ajuda

Sem argumentos, abre o wizard interativo para configurar agentes.

Exemplos:
  multi-copilot                        Wizard interativo
  multi-copilot "refactor auth module"
  multi-copilot -n 4 "Create a file called index.txt with the text hello world inside"
  multi-copilot --model gpt-5 "fix flaky tests"
  multi-copilot --list-models
  multi-copilot -n 3 "task 1" "task 2" "task 3"
  multi-copilot --mock "dev test"
`);
}
