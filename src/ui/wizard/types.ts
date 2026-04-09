export interface AgentConfig {
  id: string;
  prompt: string;
  model?: string;
}

export interface WizardConfig {
  agents: number;
  model: string;
  agentConfigs: AgentConfig[];
}

export interface ModelOption {
  label: string;
  value: string;
  description?: string;
}

export const DEFAULT_MODELS: ModelOption[] = [
  { label: 'Auto (default)', value: 'auto', description: 'Usa modelo padrao do Copilot' },
  { label: 'Claude Opus 4.6 (Max reasoning)', value: 'claude-opus-4.6', description: 'Raciocinio maximo — Anthropic' },
  { label: 'GPT-5.4 (Max reasoning)', value: 'gpt-5.4', description: 'Raciocinio maximo — OpenAI' },
];

export type WizardStep = 'agents_count' | 'model_select' | 'prompt_mode' | 'prompts' | 'model_overrides' | 'review';
