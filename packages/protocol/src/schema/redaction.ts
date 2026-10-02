import { z } from 'zod';

export const RedactedValueSchema = z.object({
  kind: z.literal('redacted'),
  reason: z.string(),
  hint: z.string().optional(),
});

export type RedactedValue = z.infer<typeof RedactedValueSchema>;

export function isRedactedValue(val: unknown): val is RedactedValue {
  return (
    typeof val === 'object' &&
    val !== null &&
    (val as Record<string, unknown>).kind === 'redacted' &&
    typeof (val as Record<string, unknown>).reason === 'string'
  );
}

export function createRedactedValue(reason: string, hint?: string): RedactedValue {
  return {
    kind: 'redacted',
    reason,
    ...(hint ? { hint } : {}),
  };
}

export function assertNoLeakedSecrets(obj: unknown, forbiddenStrings: string[]): void {
  if (forbiddenStrings.length === 0) return;
  const json = JSON.stringify(obj);
  for (const secret of forbiddenStrings) {
    if (secret && secret.length > 0 && json.includes(secret)) {
      throw new Error(`Security Violation: Plaintext secret detected in serialized data!`);
    }
  }
}
