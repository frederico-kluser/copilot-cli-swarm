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
  { label: 'Claude Opus 4.6 (High thinking)', value: 'claude-opus-4.6', description: 'Pensamento High' },
  { label: 'GPT-5.4 (Xhigh thinking)', value: 'gpt-5.4', description: 'Pensamento Xhigh' },
];

export type WizardStep = 'agents_count' | 'model_select' | 'prompt_mode' | 'prompts' | 'model_overrides' | 'review';
