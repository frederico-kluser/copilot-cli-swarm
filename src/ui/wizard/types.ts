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

export const DEFAULT_MODELS = [
  { label: 'Auto (default)', value: '' },
  { label: 'GPT-5', value: 'gpt-5' },
  { label: 'GPT-5 Mini', value: 'gpt-5-mini' },
  { label: 'Claude Sonnet 4', value: 'claude-sonnet-4' },
] as const;

export type WizardStep = 'agents_count' | 'model_select' | 'prompt_mode' | 'prompts' | 'model_overrides' | 'review';
