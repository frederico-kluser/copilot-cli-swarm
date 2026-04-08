import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput, Select, ConfirmInput } from '@inkjs/ui';
import type { WizardConfig, AgentConfig, WizardStep } from './types.js';
import { DEFAULT_MODELS } from './types.js';

interface WizardScreenProps {
  onComplete: (config: WizardConfig) => void;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function WizardScreen({ onComplete }: WizardScreenProps) {
  const [step, setStep] = useState<WizardStep>('agents_count');
  const [agentCount, setAgentCount] = useState(1);
  const [globalModel, setGlobalModel] = useState('');
  const [sharedPrompt, setSharedPrompt] = useState(true);
  const [prompts, setPrompts] = useState<string[]>([]);
  const [currentPromptIndex, setCurrentPromptIndex] = useState(0);
  const [modelOverrides, setModelOverrides] = useState<(string | undefined)[]>([]);
  const [overrideIndex, setOverrideIndex] = useState(0);
  const [wantOverrides, setWantOverrides] = useState<boolean | null>(null);

  // Step: agents_count
  if (step === 'agents_count') {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color="cyan">Multi-Copilot Orchestrator</Text>
        <Text dimColor>---</Text>
        <Box marginTop={1}>
          <Text>Numero de agentes (1-6): </Text>
          <TextInput
            placeholder="1"
            onSubmit={(value) => {
              const n = parseInt(value || '1', 10);
              if (n >= 1 && n <= 6) {
                setAgentCount(n);
                setPrompts([]);
                setModelOverrides(Array.from({ length: n }, () => undefined));
                setStep('model_select');
              }
            }}
          />
        </Box>
        <Text dimColor>Maximo 6 agentes por sessao</Text>
      </Box>
    );
  }

  // Step: model_select
  if (step === 'model_select') {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color="cyan">Multi-Copilot Orchestrator</Text>
        <Text dimColor>---</Text>
        <Text dimColor>Agentes: {agentCount}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Modelo global (pode customizar por agente depois):</Text>
          <Box marginTop={1}>
            <Select
              options={DEFAULT_MODELS.map((m) => ({ label: m.label, value: m.value }))}
              onChange={(value) => {
                setGlobalModel(value);
                setStep('prompt_mode');
              }}
            />
          </Box>
        </Box>
      </Box>
    );
  }

  // Step: prompt_mode
  if (step === 'prompt_mode') {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color="cyan">Multi-Copilot Orchestrator</Text>
        <Text dimColor>---</Text>
        <Text dimColor>Agentes: {agentCount} | Modelo: {globalModel || 'auto'}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Usar o mesmo prompt para todos os agentes?</Text>
          <Box marginTop={1}>
            <ConfirmInput
              defaultChoice="confirm"
              onConfirm={() => {
                setSharedPrompt(true);
                setCurrentPromptIndex(0);
                setPrompts([]);
                setStep('prompts');
              }}
              onCancel={() => {
                setSharedPrompt(false);
                setCurrentPromptIndex(0);
                setPrompts([]);
                setStep('prompts');
              }}
            />
          </Box>
          <Text dimColor>Y = prompt unico | N = prompt individual por agente</Text>
        </Box>
      </Box>
    );
  }

  // Step: prompts
  if (step === 'prompts') {
    const totalNeeded = sharedPrompt ? 1 : agentCount;
    const label = sharedPrompt
      ? 'Prompt (para todos os agentes):'
      : `Prompt do Agente ${currentPromptIndex + 1}/${agentCount}:`;

    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color="cyan">Multi-Copilot Orchestrator</Text>
        <Text dimColor>---</Text>
        <Text dimColor>Agentes: {agentCount} | Modelo: {globalModel || 'auto'}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>{label}</Text>
          {prompts.map((p, i) => (
            <Text key={i} dimColor>  Agente {i + 1}: {p}</Text>
          ))}
          <Box marginTop={1}>
            <Text color="green">{`> `}</Text>
            <TextInput
              placeholder="Digite o prompt..."
              onSubmit={(value) => {
                if (!value.trim()) return;
                const newPrompts = [...prompts, value.trim()];
                setPrompts(newPrompts);

                if (newPrompts.length >= totalNeeded) {
                  if (agentCount > 1) {
                    setWantOverrides(null);
                    setStep('model_overrides');
                  } else {
                    finalize(newPrompts, []);
                  }
                } else {
                  setCurrentPromptIndex(currentPromptIndex + 1);
                }
              }}
            />
          </Box>
        </Box>
      </Box>
    );
  }

  // Step: model_overrides
  if (step === 'model_overrides') {
    // First ask if user wants to customize models per agent
    if (wantOverrides === null) {
      return (
        <Box flexDirection="column" paddingX={1} paddingY={1}>
          <Text bold color="cyan">Multi-Copilot Orchestrator</Text>
          <Text dimColor>---</Text>
          <Text dimColor>Agentes: {agentCount} | Modelo: {globalModel || 'auto'}</Text>
          <Box marginTop={1} flexDirection="column">
            <Text>Customizar modelo por agente?</Text>
            <Box marginTop={1}>
              <ConfirmInput
                defaultChoice="cancel"
                onConfirm={() => {
                  setWantOverrides(true);
                  setOverrideIndex(0);
                }}
                onCancel={() => {
                  setWantOverrides(false);
                  finalize(prompts, []);
                }}
              />
            </Box>
            <Text dimColor>N = usar modelo global para todos</Text>
          </Box>
        </Box>
      );
    }

    // Show select per agent
    const agentPrompt = sharedPrompt ? prompts[0]! : prompts[overrideIndex]!;
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color="cyan">Multi-Copilot Orchestrator</Text>
        <Text dimColor>---</Text>
        <Text dimColor>Agentes: {agentCount} | Modelo global: {globalModel || 'auto'}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Modelo do Agente {overrideIndex + 1}/{agentCount}:</Text>
          <Text dimColor>  Prompt: {agentPrompt.slice(0, 60)}{agentPrompt.length > 60 ? '...' : ''}</Text>
          {modelOverrides.slice(0, overrideIndex).map((m, i) => (
            <Text key={i} dimColor>  Agente {i + 1}: {m || globalModel || 'auto'}</Text>
          ))}
          <Box marginTop={1}>
            <Select
              options={[
                { label: `Global (${globalModel || 'auto'})`, value: '' },
                ...DEFAULT_MODELS.filter((m) => m.value !== '').map((m) => ({ label: m.label, value: m.value })),
              ]}
              onChange={(value) => {
                const newOverrides = [...modelOverrides];
                newOverrides[overrideIndex] = value || undefined;
                setModelOverrides(newOverrides);

                if (overrideIndex + 1 >= agentCount) {
                  finalize(prompts, newOverrides);
                } else {
                  setOverrideIndex(overrideIndex + 1);
                }
              }}
            />
          </Box>
        </Box>
      </Box>
    );
  }

  // Step: review
  if (step === 'review') {
    const configs = buildAgentConfigs(prompts, modelOverrides);
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color="cyan">Multi-Copilot Orchestrator</Text>
        <Text dimColor>---</Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Resumo da configuracao:</Text>
          <Text>  Agentes: {agentCount}</Text>
          <Text>  Modelo global: {globalModel || 'auto'}</Text>
          <Box marginTop={1} flexDirection="column">
            {configs.map((c, i) => (
              <Box key={c.id} flexDirection="column">
                <Text>  Agente {i + 1} ({c.id}):</Text>
                <Text dimColor>    Prompt: {c.prompt.slice(0, 70)}{c.prompt.length > 70 ? '...' : ''}</Text>
                <Text dimColor>    Modelo: {c.model || globalModel || 'auto'}</Text>
              </Box>
            ))}
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text>Lancar agentes?</Text>
            <Box marginTop={1}>
              <ConfirmInput
                defaultChoice="confirm"
                onConfirm={() => {
                  onComplete({
                    agents: agentCount,
                    model: globalModel,
                    agentConfigs: configs,
                  });
                }}
                onCancel={() => {
                  // Go back to beginning
                  setStep('agents_count');
                  setPrompts([]);
                  setModelOverrides([]);
                  setCurrentPromptIndex(0);
                  setOverrideIndex(0);
                  setWantOverrides(null);
                }}
              />
            </Box>
            <Text dimColor>N = recomecar configuracao</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  return null;

  function buildAgentConfigs(
    currentPrompts: string[],
    overrides: (string | undefined)[],
  ): AgentConfig[] {
    return Array.from({ length: agentCount }, (_, i) => ({
      id: generateId(),
      prompt: sharedPrompt ? currentPrompts[0]! : currentPrompts[i]!,
      model: overrides[i] || undefined,
    }));
  }

  function finalize(
    currentPrompts: string[],
    overrides: (string | undefined)[],
  ): void {
    if (overrides.some((m) => m !== undefined)) {
      setStep('review');
    } else {
      // Skip review if no overrides — go directly to review for confirmation
      setStep('review');
    }
  }
}
