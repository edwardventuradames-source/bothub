import { z } from 'zod';

export const WhatsAppDriverTypeSchema = z.enum(['CHATWOOT', 'BAILEYS', 'CLOUD_API']);
export type WhatsAppDriverType = z.infer<typeof WhatsAppDriverTypeSchema>;

export const BotConnectionStatusSchema = z.enum([
  'CONNECTED',
  'DISCONNECTED',
  'WAITING_QR',
  'RECONNECTING',
  'PAUSED',
  'ERROR'
]);
export type BotConnectionStatus = z.infer<typeof BotConnectionStatusSchema>;

export const BusinessHoursDaySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isOpen: z.boolean(),
  openTime: z.string(),
  closeTime: z.string()
});
export type BusinessHoursDay = z.infer<typeof BusinessHoursDaySchema>;

export const QuickReplyInputSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1).max(100),
  keywords: z.array(z.string()),
  responseText: z.string().min(1).max(2000),
  matchMode: z.enum(['EXACT', 'CONTAINS', 'REGEX']).default('CONTAINS'),
  isActive: z.boolean().default(true)
});
export type QuickReplyInput = z.infer<typeof QuickReplyInputSchema>;

export const CreateBotInputSchema = z.object({
  name: z.string().min(2).max(80).trim(),
  description: z.string().max(300).optional().nullable(),
  phoneNumber: z.string().max(30).optional().nullable(),
  driver: WhatsAppDriverTypeSchema.default('BAILEYS'),
  activeFlowId: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
  timezone: z.string().default('America/Bogota'),
  businessHoursEnabled: z.boolean().default(false),
  outOfHoursMessage: z.string().max(1000).optional().nullable(),
  inactivityTimeoutMinutes: z.number().int().min(1).max(1440).default(15),
  inactivityCloseMessage: z.string().max(1000).optional().nullable(),
  typingDelayMs: z.number().int().min(0).max(15000).default(1200),
  rateLimitPerMinute: z.number().int().min(1).max(300).default(30),
  businessHours: z.array(BusinessHoursDaySchema).optional(),
  quickReplies: z.array(QuickReplyInputSchema).optional()
});
export type CreateBotInput = z.infer<typeof CreateBotInputSchema>;

export const UpdateBotInputSchema = CreateBotInputSchema.partial();
export type UpdateBotInput = z.infer<typeof UpdateBotInputSchema>;

export const CloudApiConfigInputSchema = z.object({
  phoneNumberId: z.string().min(4).max(64).trim(),
  wabaId: z.string().min(4).max(64).trim(),
  accessToken: z.string().min(8).trim(),
  verifyToken: z.string().min(6).max(128).trim(),
  appSecret: z.string().min(8).max(128).trim().optional().or(z.literal(''))
});
export type CloudApiConfigInput = z.infer<typeof CloudApiConfigInputSchema>;

export const CloudApiCredentialsInputSchema = z.object({
  phoneNumberId: z.string().min(4).max(64).trim(),
  businessAccountId: z.string().min(4).max(64).trim().optional(),
  wabaId: z.string().min(4).max(64).trim().optional(),
  accessToken: z.string().min(8).trim(),
  verifyToken: z.string().min(6).max(128).trim(),
  appSecret: z.string().min(8).max(128).optional()
});
export type CloudApiCredentialsInput = z.infer<typeof CloudApiCredentialsInputSchema>;

export interface CloudApiConfigDto {
  phoneNumberId: string;
  wabaId: string;
  hasAccessToken: boolean;
  hasAppSecret: boolean;
  maskedAccessToken: string;
  verifyTokenPreview: string;
  webhookPath: string;
}

export const ChatwootConfigInputSchema = z.object({
  baseUrl: z.string().url(),
  accountId: z.number().int().positive(),
  inboxId: z.number().int().positive(),
  apiAccessToken: z.string().trim().optional().default(''),
  webhookToken: z.string().trim().optional().default(''),
  handoffReturnCommand: z.string().min(2).max(40).default('#bot'),
  isActive: z.boolean().optional().default(true)
});
export type ChatwootConfigInput = z.infer<typeof ChatwootConfigInputSchema>;

export interface ChatwootConfigDto {
  baseUrl: string;
  accountId: number;
  inboxId: number;
  hasApiAccessToken: boolean;
  maskedApiAccessToken: string;
  webhookTokenPreview: string;
  webhookEndpointPath: string;
  handoffReturnCommand: string;
  isActive: boolean;
  lastSyncedAt: string | null;
}

export interface BotDto {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  phoneNumber: string;
  driver: WhatsAppDriverType;
  status: BotConnectionStatus;
  isActive: boolean;
  activeFlowId: string | null;
  activeFlowName: string | null;
  timezone: string;
  businessHoursEnabled?: boolean;
  outOfHoursMessage: string;
  inactivityTimeoutMinutes: number;
  inactivityCloseMessage: string;
  typingDelayMs: number;
  rateLimitPerMinute: number;
  messagesToday: number;
  activeConversations: number;
  handoffRate: number;
  qrCodeData: string | null;
  qrExpiresAt: string | null;
  lastConnectedAt: string | null;
  chatwootConfig: ChatwootConfigDto | null;
  cloudApiConfig: CloudApiConfigDto | null;
  businessHours: BusinessHoursDay[];
  quickReplies: Required<QuickReplyInput>[];
  createdAt: string;
  updatedAt: string;
}

export const WhatsAppQrEventSchema = z.object({
  botId: z.string(),
  qrDataUrl: z.string().optional(),
  qrCodeData: z.string().optional(),
  rawQr: z.string().optional(),
  generatedAt: z.string().optional(),
  qrExpiresAt: z.string().nullable().optional(),
  expiresInSeconds: z.number().int().optional()
});
export type WhatsAppQrEvent = z.infer<typeof WhatsAppQrEventSchema>;

export const WhatsAppStatusEventSchema = z.object({
  botId: z.string(),
  status: BotConnectionStatusSchema,
  phoneNumber: z.string().nullable().optional(),
  driver: WhatsAppDriverTypeSchema.optional(),
  qrDataUrl: z.string().nullable().optional(),
  qrCodeData: z.string().nullable().optional(),
  qrExpiresAt: z.string().nullable().optional(),
  lastConnectedAt: z.string().nullable().optional(),
  lastError: z.string().nullable().optional(),
  updatedAt: z.string().optional()
});
export type WhatsAppStatusEvent = z.infer<typeof WhatsAppStatusEventSchema>;

export const BotSummaryDtoSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  phoneNumber: z.string().nullable(),
  driver: WhatsAppDriverTypeSchema,
  status: BotConnectionStatusSchema,
  isActive: z.boolean(),
  inactivityTimeoutMinutes: z.number().int(),
  inactivityCloseMessage: z.string().nullable(),
  typingDelayMs: z.number().int(),
  rateLimitPerMinute: z.number().int(),
  hasCloudApiConfig: z.boolean(),
  chatwootInboxId: z.number().int().nullable(),
  chatwootConnected: z.boolean(),
  flowsCount: z.number().int(),
  conversationsCount: z.number().int(),
  messagesTodayCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type BotSummaryDto = z.infer<typeof BotSummaryDtoSchema>;
