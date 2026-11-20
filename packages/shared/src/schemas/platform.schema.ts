import { z } from 'zod';
import { UserRole, UserRoleSchema } from './auth.schema.js';
import { FlowExecutionStepLog } from './flow.schema.js';

export const LogLevelSchema = z.enum(['INFO', 'WARN', 'ERROR', 'DEBUG']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const ConversationStatusSchema = z.enum([
  'BOT_ACTIVE',
  'PENDING_AGENT',
  'AGENT_ACTIVE',
  'RESOLVED'
]);
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;

export interface ConversationMessageDto {
  id: string;
  senderType: 'CONTACT' | 'BOT' | 'AGENT' | 'SYSTEM';
  senderName: string;
  content: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'audio' | 'document';
  executedNodeId?: string;
  executedNodeLabel?: string;
  createdAt: string;
}

export interface ConversationDto {
  id: string;
  botId: string;
  botName: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
  chatwootConversationId: number | null;
  status: ConversationStatus;
  assignedAgentName: string | null;
  currentFlowName: string | null;
  currentNodeId: string | null;
  collectedVariables: Record<string, string>;
  tags: string[];
  handoffReason: string | null;
  lastMessagePreview: string;
  lastActivityAt: string;
  messages: ConversationMessageDto[];
  executionTrace: FlowExecutionStepLog[];
}

export interface ContactDto {
  id: string;
  organizationId: string;
  name: string;
  phoneNumber: string;
  email: string | null;
  nationalId: string | null;
  chatwootContactId: number | null;
  tags: string[];
  variables: Record<string, string>;
  conversationsCount: number;
  lastInteractionAt: string;
  createdAt: string;
}

export interface BotLogDto {
  id: string;
  organizationId?: string;
  botId: string | null;
  botName: string;
  level: LogLevel;
  event: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export const CreateUserInputSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().trim().toLowerCase(),
  password: z.string().min(8).max(128),
  role: UserRoleSchema.default('OPERATOR')
});
export type CreateUserInput = z.infer<typeof CreateUserInputSchema>;

export const UpdateUserInputSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  role: UserRoleSchema.optional(),
  isActive: z.boolean().optional()
});
export type UpdateUserInput = z.infer<typeof UpdateUserInputSchema>;

export interface OrganizationUserDto {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export const CreateApiKeyInputSchema = z.object({
  name: z.string().min(2).max(80),
  scopes: z.array(z.string()).default(['bots:read', 'flows:execute', 'webhooks:write'])
});
export type CreateApiKeyInput = z.infer<typeof CreateApiKeyInputSchema>;

export const HandoffActionInputSchema = z.object({
  action: z.enum(['RETURN_TO_BOT', 'TRANSFER_TO_AGENT', 'RESOLVE']),
  reason: z.string().max(400).optional()
});
export type HandoffActionInput = z.infer<typeof HandoffActionInputSchema>;

export const UpdateContactInputSchema = z.object({
  tags: z.array(z.string().min(1).max(64)).max(50).optional(),
  variables: z.record(z.string(), z.string().max(1000)).optional()
});
export type UpdateContactInput = z.infer<typeof UpdateContactInputSchema>;

export interface ApiKeyDto {
  id: string;
  organizationId?: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
  rawKeyPreview?: string;
}

export const OutboundWebhookConfigInputSchema = z.object({
  name: z.string().min(2).max(80),
  targetUrl: z.string().url(),
  events: z.array(z.string()).min(1),
  secretToken: z.string().min(8),
  isActive: z.boolean().default(true)
});
export type OutboundWebhookConfigInput = z.infer<typeof OutboundWebhookConfigInputSchema>;

export interface OutboundWebhookConfigDto {
  id: string;
  organizationId?: string;
  name: string;
  targetUrl: string;
  events: string[];
  maskedSecret: string;
  isActive: boolean;
  createdAt: string;
}

export interface DashboardMetricsDto {
  activeBots: number;
  totalBots: number;
  messagesToday: number;
  activeConversations: number;
  handoffCountToday: number;
  automationRatePercent: number;
  hourlyMessages: Array<{ label: string; inbound: number; outbound: number }>;
  weeklyFlowPerformance: Array<{ day: string; resolvedByBot: number; transferredToAgent: number }>;
  topTriggeredNodes: Array<{ nodeTitle: string; flowName: string; executions: number }>;
}

export const AiProviderIdSchema = z.enum(['openai', 'anthropic', 'gemini']);
export type AiProviderId = z.infer<typeof AiProviderIdSchema>;

export const UpsertAiProviderKeyInputSchema = z.object({
  provider: AiProviderIdSchema,
  apiKey: z.string().trim().min(10).max(300)
});
export type UpsertAiProviderKeyInput = z.infer<typeof UpsertAiProviderKeyInputSchema>;

export interface AiProviderConfigDto {
  provider: AiProviderId;
  label: string;
  hasKey: boolean;
  maskedKey: string | null;
  source: 'organization' | 'env' | 'none';
  updatedAt: string | null;
}
