import { z } from 'zod';
import { RedactedValueSchema } from './redaction.js';

export const RectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export const ElementEvidenceSchema = z.object({
  tagName: z.string(),
  role: z.string().optional(),
  accessibleName: z.string().optional(),
  ariaLabel: z.string().optional(),
  text: z.string().optional(),
  value: z.union([z.string(), RedactedValueSchema]).optional(),
  id: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  testIds: z.record(z.string()).default({}),
  cssCandidates: z.array(z.string()).default([]),
  xpathCandidate: z.string().optional(),
  rect: RectSchema.optional(),
  nearbyText: z.array(z.string()).optional(),
  ancestorSummary: z.array(z.string()).optional(),
  framePath: z.array(z.string()).optional(),
});

export type ElementEvidence = z.infer<typeof ElementEvidenceSchema>;
