import { z } from 'zod';

export const ScreenshotsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  strategy: z.enum(['boundary', 'all-actions', 'failure-only']).default('boundary'),
  maskSensitiveFields: z.boolean().default(true),
});

export const NetworkConfigSchema = z.object({
  enabled: z.boolean().default(true),
  captureBodies: z.boolean().default(false),
  redactHeaders: z.array(z.string()).default(['authorization', 'cookie', 'set-cookie', 'x-api-key']),
});

export const PointerMoveConfigSchema = z.object({
  sampleHz: z.number().positive().default(20),
});

export const PrivacyConfigSchema = z.object({
  redactPasswords: z.boolean().default(true),
  redactAuthorizationHeaders: z.boolean().default(true),
  redactCookies: z.boolean().default(true),
  sensitiveSelectors: z.array(z.string()).default([
    'input[type="password"]',
    'input[name*="password" i]',
    'input[autocomplete*="password" i]',
    'input[name*="cvv" i]',
    'input[name*="card" i]',
    '[data-secret="true"]',
  ]),
});

export const CompilerConfigSchema = z.object({
  inferParameters: z.boolean().default(true),
  inferPostconditions: z.boolean().default(true),
});

export const RecordingConfigSchema = z.object({
  captureMode: z.enum(['full', 'distilled']).default('full'),
  pointerMove: PointerMoveConfigSchema.optional(),
  screenshots: ScreenshotsConfigSchema.default({ enabled: true, strategy: 'boundary', maskSensitiveFields: true }),
  network: NetworkConfigSchema.default({ enabled: true, captureBodies: false, redactHeaders: ['authorization', 'cookie', 'set-cookie', 'x-api-key'] }),
  privacy: PrivacyConfigSchema.default({
    redactPasswords: true,
    redactAuthorizationHeaders: true,
    redactCookies: true,
    sensitiveSelectors: [
      'input[type="password"]',
      'input[name*="password" i]',
      'input[autocomplete*="password" i]',
      'input[name*="cvv" i]',
      'input[name*="card" i]',
      '[data-secret="true"]',
    ],
  }),
  compiler: CompilerConfigSchema.optional(),
});

export type RecordingConfig = z.infer<typeof RecordingConfigSchema>;
