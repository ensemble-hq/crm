import { createOpenAI } from '@ai-sdk/openai';
import { type AIAdapter, AISdkAdapter, OpenAIAdapter } from '@mariachi/ai';
import { AnthropicAdapter } from '@mariachi/ai/anthropic';
import { ValidationError } from '@mariachi/core';
import type { ModelProvider } from '../../../src/contracts/assistant';

/**
 * Which models the assistant can run on. The assistant itself is written against one small
 * interface (Mariachi's `AIAdapter`: messages and tools in, text and tool calls out), so it has no
 * idea whose model it is talking to. The customer picks a provider and a model in settings and
 * supplies their own key or endpoint.
 *
 * To add a provider, call `registerModelProvider` with how to build its adapter. A plugin in
 * `plugins/` does exactly that when the server starts; nothing else in the CRM changes.
 */

export type ModelConnection = { model: string; apiKey?: string; baseUrl?: string };

export type ModelProviderDefinition = ModelProvider & { create(connection: ModelConnection): AIAdapter };

const providers = new Map<string, ModelProviderDefinition>();

export function registerModelProvider(definition: ModelProviderDefinition): void {
  providers.set(definition.id, definition);
}

export function modelProviders(): ModelProvider[] {
  return [...providers.values()].map(({ create: _create, ...described }) => described);
}

export function modelProvider(id: string): ModelProviderDefinition {
  const found = providers.get(id);
  if (!found) throw new ValidationError(`There is no model provider called "${id}".`);
  return found;
}

registerModelProvider({
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  hint: 'Uses your own Anthropic API key.',
  needsKey: true,
  needsBaseUrl: false,
  defaultModel: 'claude-opus-5-5',
  create: (connection) => new AnthropicAdapter({ apiKey: connection.apiKey, defaultModel: connection.model }),
});

registerModelProvider({
  id: 'openai',
  label: 'OpenAI',
  hint: 'Uses your own OpenAI API key.',
  needsKey: true,
  needsBaseUrl: false,
  defaultModel: 'gpt-4o',
  create: (connection) => new OpenAIAdapter({ apiKey: connection.apiKey, defaultModel: connection.model }),
});

registerModelProvider({
  id: 'compatible',
  label: 'Your own endpoint',
  hint: 'Any server that speaks the OpenAI chat completions format: a model you host, a gateway, or another vendor. Give its address and the model name it expects. The model must support tool calling.',
  needsKey: false,
  needsBaseUrl: true,
  defaultModel: '',
  create: (connection) => {
    if (!connection.baseUrl) throw new ValidationError('Your own endpoint needs an address.');
    const endpoint = createOpenAI({ baseURL: connection.baseUrl, apiKey: connection.apiKey || 'none' });
    return new AISdkAdapter('compatible', (modelId) => endpoint.chat(modelId), connection.model);
  },
});
