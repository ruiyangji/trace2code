import { z } from 'zod';
import { ElementEvidenceSchema } from './evidence.js';

export const RawTraceEventTypeSchema = z.enum([
  'pointermove',
  'pointerdown',
  'pointerup',
  'click',
  'dblclick',
  'wheel',
  'keydown',
  'keyup',
  'input',
  'change',
  'focus',
  'blur',
  'navigation',
  'network',
  'page-state',
  'mark',
]);

export type RawTraceEventType = z.infer<typeof RawTraceEventTypeSchema>;

export const RawTraceEventSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  timestampMs: z.number().nonnegative(),
  tabId: z.string(),
  frameId: z.string().default('main'),
  type: RawTraceEventTypeSchema,
  payload: z.unknown(),
  target: ElementEvidenceSchema.optional(),
});

export type RawTraceEvent = z.infer<typeof RawTraceEventSchema>;

// Navigation event payload
export const NavigationPayloadSchema = z.object({
  url: z.string(),
  previousUrl: z.string().optional(),
  type: z.enum(['load', 'spa-pushState', 'spa-replaceState', 'hashchange', 'reload']),
  timestampMs: z.number().optional(),
});

export type NavigationPayload = z.infer<typeof NavigationPayloadSchema>;

// Mark event payload
export const MarkPayloadSchema = z.object({
  kind: z.enum(['step', 'parameter', 'secret', 'note']),
  label: z.string(),
  details: z.record(z.unknown()).optional(),
});

export type MarkPayload = z.infer<typeof MarkPayloadSchema>;

// Network event payload
export const NetworkPayloadSchema = z.object({
  url: z.string(),
  method: z.string(),
  status: z.number().optional(),
  requestHeaders: z.record(z.string()).optional(),
  responseHeaders: z.record(z.string()).optional(),
  resourceType: z.string().optional(),
});

export type NetworkPayload = z.infer<typeof NetworkPayloadSchema>;
