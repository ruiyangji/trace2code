import { z } from 'zod';

export const WorkflowTargetSchema = z.object({
  role: z.string().optional(),
  name: z.string().optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  testId: z.string().optional(),
  css: z.string().optional(),
  xpath: z.string().optional(),
  containerScope: z.string().optional(),
  exact: z.boolean().optional(),
});

export type WorkflowTarget = z.infer<typeof WorkflowTargetSchema>;

export const WorkflowValueSchema = z.union([
  z.object({ input: z.string() }),
  z.object({ constant: z.string() }),
  z.object({ secret: z.string() }),
]);

export type WorkflowValue = z.infer<typeof WorkflowValueSchema>;

export const WorkflowActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('navigate'),
    url: z.string(),
  }),
  z.object({
    type: z.literal('click'),
    target: WorkflowTargetSchema,
  }),
  z.object({
    type: z.literal('fill'),
    target: WorkflowTargetSchema,
    value: WorkflowValueSchema,
  }),
  z.object({
    type: z.literal('check'),
    target: WorkflowTargetSchema,
  }),
  z.object({
    type: z.literal('uncheck'),
    target: WorkflowTargetSchema,
  }),
  z.object({
    type: z.literal('selectOption'),
    target: WorkflowTargetSchema,
    value: WorkflowValueSchema,
  }),
  z.object({
    type: z.literal('uploadFile'),
    target: WorkflowTargetSchema,
    value: WorkflowValueSchema,
  }),
  z.object({
    type: z.literal('drag'),
    source: WorkflowTargetSchema,
    destination: WorkflowTargetSchema,
  }),
]);

export type WorkflowAction = z.infer<typeof WorkflowActionSchema>;

export const WorkflowPostconditionSchema = z.object({
  urlMatches: z.string().optional(),
  elementVisible: WorkflowTargetSchema.optional(),
  textMatches: z.string().optional(),
  semantic: z.string().optional(),
});

export type WorkflowPostcondition = z.infer<typeof WorkflowPostconditionSchema>;

export const WorkflowStepSchema = z.object({
  id: z.string(),
  intent: z.string(),
  action: WorkflowActionSchema,
  postcondition: WorkflowPostconditionSchema.optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional().default('high'),
});

export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const WorkflowInputSchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'file']),
  description: z.string().optional(),
  default: z.unknown().optional(),
  required: z.boolean().default(true),
});

export type WorkflowInput = z.infer<typeof WorkflowInputSchema>;

export const WorkflowIRSchema = z.object({
  version: z.literal('0.1').default('0.1'),
  name: z.string(),
  description: z.string().optional(),
  inputs: z.record(WorkflowInputSchema).default({}),
  steps: z.array(WorkflowStepSchema),
});

export type WorkflowIR = z.infer<typeof WorkflowIRSchema>;

export function validateWorkflowIR(data: unknown): { valid: boolean; data?: WorkflowIR; errors: string[] } {
  const result = WorkflowIRSchema.safeParse(data);
  if (result.success) {
    // Cross-validate that any step input references match declared inputs
    const errors: string[] = [];
    const declaredInputs = Object.keys(result.data.inputs);

    for (const step of result.data.steps) {
      if ('value' in step.action && step.action.value && 'input' in step.action.value) {
        const inputKey = step.action.value.input;
        if (!declaredInputs.includes(inputKey)) {
          errors.push(`Step '${step.id}' references undeclared input '${inputKey}'`);
        }
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }
    return { valid: true, data: result.data, errors: [] };
  } else {
    return {
      valid: false,
      errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
    };
  }
}
