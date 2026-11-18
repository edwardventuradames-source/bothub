import { z } from 'zod';

export const WhatsAppDriverTypeSchema = z.enum(['BAILEYS', 'CLOUD_API']);
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

export const CreateBotInputSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(300).optional(),
  phoneNumber: z.string().max(30).optional(),
  driver: WhatsAppDriverTypeSchema.default('BAILEYS'),
  isActive: z.boolean().default(true),
  inactivityTimeoutMinutes: z.number().int().min(1).max(1440).default(15),
  inactivityCloseMessage: z.string().max(1000).optional(),
  typingDelayMs: z.number().int().min(0).max(15000).default(1200),
  rateLimitPerMinute: z.number().int().min(1).max(300).default(30)
});
export type CreateBotInput = z.infer<typeof CreateBotInputSchema>;

export const ChatwootConfigInputSchema = z.object({
  baseUrl: z.string().url(),
  accountId: z.number().int().positive(),
  inboxId: z.number().int().positive(),
  apiAccessToken: z.string().min(8),
  webhookToken: z.string().min(8),
  handoffReturnCommand: z.string().min(2).max(40).default('#bot')
});
export type ChatwootConfigInput = z.infer<typeof ChatwootConfigInputSchema>;
