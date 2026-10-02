import { z } from 'zod';

export const PageSnapshotSchema = z.object({
  url: z.string(),
  title: z.string(),
  viewport: z.object({
    width: z.number(),
    height: z.number(),
  }),
  semanticDom: z.string().optional(),
  accessibilityTree: z.string().optional(),
  screenshotRef: z.string().optional(),
  timestampMs: z.number(),
});

export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;
