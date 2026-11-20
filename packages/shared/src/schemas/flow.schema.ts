import { z } from 'zod';

export const FlowNodeTypeSchema = z.enum([
  'TRIGGER',
  'MESSAGE',
  'BUTTONS',
  'LIST',
  'QUESTION',
  'CONDITION',
  'DELAY',
  'HTTP_REQUEST',
  'ASSIGN_TAG',
  'HANDOFF',
  'AI_PROMPT',
  'END'
]);
export type FlowNodeType = z.infer<typeof FlowNodeTypeSchema>;

export const TriggerMatchModeSchema = z.enum([
  'EXACT',
  'CONTAINS',
  'REGEX',
  'FIRST_MESSAGE',
  'MAIN_MENU',
  'OUT_OF_HOURS'
]);
export type TriggerMatchMode = z.infer<typeof TriggerMatchModeSchema>;

export const QuestionValidationTypeSchema = z.enum([
  'TEXT',
  'NUMBER',
  'EMAIL',
  'NATIONAL_ID',
  'DATE'
]);
export type QuestionValidationType = z.infer<typeof QuestionValidationTypeSchema>;

export const FlowNodePositionSchema = z.object({
  x: z.number(),
  y: z.number()
});

export const FlowNodeSchema = z.object({
  id: z.string(),
  type: FlowNodeTypeSchema,
  position: FlowNodePositionSchema,
  data: z.record(z.string(), z.unknown())
});
export type FlowNode = z.infer<typeof FlowNodeSchema>;

export const FlowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
  label: z.string().optional()
});
export type FlowEdge = z.infer<typeof FlowEdgeSchema>;

export const CreateFlowInputSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(400).optional(),
  botId: z.string().nullable().optional(),
  isMainMenu: z.boolean().default(false)
});
export type CreateFlowInput = z.infer<typeof CreateFlowInputSchema>;

export const UpdateFlowInputSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(400).optional(),
  botId: z.string().nullable().optional(),
  isMainMenu: z.boolean().optional()
});
export type UpdateFlowInput = z.infer<typeof UpdateFlowInputSchema>;

export const SaveFlowGraphInputSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(400).optional(),
  botId: z.string().nullable().optional(),
  nodes: z.array(FlowNodeSchema),
  edges: z.array(FlowEdgeSchema),
  publish: z.boolean().default(false)
});
export type SaveFlowGraphInput = z.infer<typeof SaveFlowGraphInputSchema>;

export const FlowSimulationRequestSchema = z.object({
  inputMessage: z.string().min(1).max(2000),
  currentNodeId: z.string().nullable().optional(),
  awaitingQuestionNodeId: z.string().nullable().optional(),
  variables: z.record(z.string(), z.string()).default({}),
  tags: z.array(z.string()).default([]),
  nodes: z.array(FlowNodeSchema).optional(),
  edges: z.array(FlowEdgeSchema).optional()
});
export type FlowSimulationRequest = z.input<typeof FlowSimulationRequestSchema>;

export interface FlowHttpExecutionLog {
  method: string;
  url: string;
  statusCode: number | null;
  ok: boolean;
  durationMs: number;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  responseHeaders: Record<string, string>;
  responseBody: string;
  responseVariable: string;
  responsePath: string | null;
  responsePathMatched: boolean;
  extractedValue: string;
  errorMessage: string | null;
}

export const TestFlowHttpNodeInputSchema = z.object({
  node: FlowNodeSchema,
  variables: z.record(z.string(), z.string()).default({})
});
export type TestFlowHttpNodeInput = z.input<typeof TestFlowHttpNodeInputSchema>;

export interface TestFlowHttpNodeResponse {
  ok: boolean;
  httpDetails: FlowHttpExecutionLog;
}

export interface FlowExecutionStepLog {
  nodeId: string;
  nodeType: FlowNodeType;
  title: string;
  detail: string;
  timestamp: string;
  httpDetails?: FlowHttpExecutionLog;
}

export interface FlowSimulationBotReply {
  id: string;
  text: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'audio' | 'document';
  buttons?: Array<{ id: string; label: string }>;
  listItems?: Array<{ id: string; title: string; description?: string }>;
  delayMs?: number;
}

export interface FlowSimulationResponse {
  replies: FlowSimulationBotReply[];
  nextNodeId: string | null;
  awaitingQuestionNodeId: string | null;
  variables: Record<string, string>;
  tags: string[];
  assignedTags?: string[];
  handoffRequested: boolean;
  handoffSummary: string | null;
  completed: boolean;
  trace: FlowExecutionStepLog[];
}

export interface FlowVersionDto {
  id: string;
  versionNumber: number;
  status: 'DRAFT' | 'PUBLISHED';
  nodes: FlowNode[];
  edges: FlowEdge[];
  publishedAt: string | null;
  createdAt: string;
}

export interface FlowDto {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  botId: string | null;
  botName: string | null;
  isMainMenu: boolean;
  activeVersionNumber: number;
  draftVersion: FlowVersionDto;
  publishedVersion: FlowVersionDto | null;
  versions?: FlowVersionDto[];
  updatedAt: string;
  createdAt: string;
}
