import { z } from 'zod';
import { RecordingConfigSchema } from './config.js';

export const BrowserMetadataSchema = z.object({
  name: z.string(),
  version: z.string(),
  userAgent: z.string().optional(),
  viewport: z
    .object({
      width: z.number(),
      height: z.number(),
    })
    .optional(),
});

export type BrowserMetadata = z.infer<typeof BrowserMetadataSchema>;

export const TabMetadataSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string().optional(),
  createdAtMs: z.number().optional(),
});

export type TabMetadata = z.infer<typeof TabMetadataSchema>;

export const RecordingRunSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  startedAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T/)),
  endedAt: z.string().optional(),
  integration: z.enum(['extension', 'controller']),
  captureMode: z.enum(['full', 'distilled']),
  browser: BrowserMetadataSchema,
  config: RecordingConfigSchema,
  tabs: z.array(TabMetadataSchema).default([]),
});

export type RecordingRun = z.infer<typeof RecordingRunSchema>;
