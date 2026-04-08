// ACP types — baseado na spec ACP JSON-RPC 2.0 + wire format do Copilot CLI
// SDK version: inferido da spec; capture date: 2026-04-08

// --- AgentPhase ---

export type AgentPhase =
  | 'spawning'
  | 'idle'
  | 'thinking'
  | 'planning'
  | 'tool_call'
  | 'responding'
  | 'done'
  | 'error'
  | 'rate_limited';

// --- Session Update discriminated union ---

export interface AgentThoughtChunk {
  sessionUpdate: 'agent_thought_chunk';
  content: { text: string };
}

export interface PlanEntry {
  content: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed';
}

export interface Plan {
  sessionUpdate: 'plan';
  entries: PlanEntry[];
}

export interface ToolCall {
  sessionUpdate: 'tool_call';
  toolCallId: string;
  title: string;
  kind: string;
  rawInput: unknown;
}

export interface ToolCallUpdate {
  sessionUpdate: 'tool_call_update';
  toolCallId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  error?: string;
}

export interface AgentMessageChunk {
  sessionUpdate: 'agent_message_chunk';
  content: { type: 'text'; text: string };
}

export interface ConfirmationRequest {
  sessionUpdate: 'confirmation_request';
  toolCallId: string;
  title: string;
  message?: string;
}

export interface SessionConfigValue {
  value: string;
  name: string;
  description?: string;
}

export interface SessionConfigValueGroup {
  group: string;
  options: SessionConfigValue[];
}

export type SessionConfigSelectOptionEntry = SessionConfigValue | SessionConfigValueGroup;

interface BaseSessionConfigOption {
  id: string;
  name: string;
  description?: string;
  category?: string;
}

export interface SessionSelectConfigOption extends BaseSessionConfigOption {
  type: 'select';
  currentValue: string;
  options: SessionConfigSelectOptionEntry[];
}

export interface SessionBooleanConfigOption extends BaseSessionConfigOption {
  type: 'boolean';
  currentValue: boolean;
}

export interface SessionUnknownConfigOption extends BaseSessionConfigOption {
  type: string;
  currentValue: unknown;
  options?: unknown;
}

export type SessionConfigOption =
  | SessionSelectConfigOption
  | SessionBooleanConfigOption
  | SessionUnknownConfigOption;

export interface ConfigOptionUpdate {
  sessionUpdate: 'config_option_update';
  configOptions: SessionConfigOption[];
}

export interface UnknownUpdate {
  sessionUpdate: string;
  [key: string]: unknown;
}

export type SessionUpdate =
  | AgentThoughtChunk
  | Plan
  | ToolCall
  | ToolCallUpdate
  | AgentMessageChunk
  | ConfirmationRequest
  | ConfigOptionUpdate
  | UnknownUpdate;

// --- Type guards ---

export const isAgentThoughtChunk = (u: SessionUpdate): u is AgentThoughtChunk =>
  u.sessionUpdate === 'agent_thought_chunk';

export const isAgentMessageChunk = (u: SessionUpdate): u is AgentMessageChunk =>
  u.sessionUpdate === 'agent_message_chunk';

export const isToolCall = (u: SessionUpdate): u is ToolCall =>
  u.sessionUpdate === 'tool_call';

export const isToolCallUpdate = (u: SessionUpdate): u is ToolCallUpdate =>
  u.sessionUpdate === 'tool_call_update';

export const isPlan = (u: SessionUpdate): u is Plan =>
  u.sessionUpdate === 'plan';

export const isConfirmationRequest = (u: SessionUpdate): u is ConfirmationRequest =>
  u.sessionUpdate === 'confirmation_request';

export const isConfigOptionUpdate = (u: SessionUpdate): u is ConfigOptionUpdate =>
  u.sessionUpdate === 'config_option_update';

export const isSessionConfigValueGroup = (
  entry: SessionConfigSelectOptionEntry,
): entry is SessionConfigValueGroup => 'group' in entry;

export const isSessionSelectConfigOption = (
  option: SessionConfigOption,
): option is SessionSelectConfigOption => option.type === 'select';

// --- JSON-RPC types ---

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// --- ACP Client-side method types (requests FROM agent TO client) ---

export type PermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: PermissionOptionKind;
}

export interface RequestPermissionParams {
  sessionId: string;
  toolCall: { toolCallId: string; title?: string; kind?: string };
  options: PermissionOption[];
}

export type RequestPermissionOutcome =
  | { outcome: 'selected'; optionId: string }
  | { outcome: 'cancelled' };

export interface RequestPermissionResult {
  outcome: RequestPermissionOutcome;
}

export interface SessionNewResult {
  sessionId: string;
  configOptions?: SessionConfigOption[];
}

export interface SessionPromptResult {
  stopReason?: string;
}

export interface SessionSetConfigOptionParams {
  sessionId: string;
  configId: string;
  type?: string;
  value: string | boolean;
}

export interface SessionSetConfigOptionResult {
  configOptions?: SessionConfigOption[];
}

export function cloneSessionConfigOptions(
  configOptions?: SessionConfigOption[] | null,
): SessionConfigOption[] | null {
  if (!configOptions) {
    return null;
  }

  return configOptions.map((option) => {
    if (isSessionSelectConfigOption(option)) {
      return {
        ...option,
        options: option.options.map((entry) => {
          if (isSessionConfigValueGroup(entry)) {
            return {
              ...entry,
              options: entry.options.map((value) => ({ ...value })),
            };
          }

          return { ...entry };
        }),
      };
    }

    return { ...option };
  });
}

export function flattenSessionConfigOptions(
  option: SessionSelectConfigOption,
): SessionConfigValue[] {
  return option.options.flatMap((entry) => {
    if (isSessionConfigValueGroup(entry)) {
      return entry.options.map((value) => ({ ...value }));
    }

    return [{ ...entry }];
  });
}

export function getModelConfigOption(
  configOptions?: SessionConfigOption[] | null,
): SessionSelectConfigOption | null {
  if (!configOptions) {
    return null;
  }

  const selectOptions = configOptions.filter(isSessionSelectConfigOption);

  return selectOptions.find((option) => option.category === 'model')
    ?? selectOptions.find((option) => option.id === 'model' || option.id === 'models')
    ?? selectOptions.find((option) => option.name.trim().toLowerCase() === 'model')
    ?? null;
}

export function getAvailableModels(
  configOptions?: SessionConfigOption[] | null,
): SessionConfigValue[] {
  const option = getModelConfigOption(configOptions);
  if (!option) {
    return [];
  }

  return flattenSessionConfigOptions(option);
}

export function getCurrentModel(
  configOptions?: SessionConfigOption[] | null,
): string | null {
  return getModelConfigOption(configOptions)?.currentValue ?? null;
}

export function getCurrentModelLabel(
  configOptions?: SessionConfigOption[] | null,
): string | null {
  const currentModel = getCurrentModel(configOptions);
  if (!currentModel) {
    return null;
  }

  const currentOption = getAvailableModels(configOptions).find((option) => option.value === currentModel);
  return currentOption?.name ?? currentModel;
}
