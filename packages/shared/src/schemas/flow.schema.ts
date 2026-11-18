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
  data: z.record(z.unknown())
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
