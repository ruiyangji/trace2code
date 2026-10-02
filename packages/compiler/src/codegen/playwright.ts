import fs from 'node:fs';
import path from 'node:path';
import type { WorkflowIR, WorkflowStep, WorkflowTarget, WorkflowValue } from '@trace2code/workflow-ir';

export interface GeneratedFileMap {
  [filePath: string]: string;
}

export interface GeneratedProject {
  files: GeneratedFileMap;
  writeToDisk(outputDir: string): void;
}

function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase())
    .replace(/^([a-z])/, (_, chr) => chr.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '');
}

/**
 * Formats a WorkflowTarget into idiomatic Playwright locator expression.
 */
export function formatPlaywrightLocator(target: WorkflowTarget): string {
  const prefix = target.containerScope
    ? `page.locator(${JSON.stringify(target.containerScope)}).`
    : 'page.';

  // 1. Explicit Test ID
  if (target.testId) {
    return `${prefix}getByTestId(${JSON.stringify(target.testId)})`;
  }

  // 2. Role + Accessible Name
  if (target.role && target.name) {
    const opts = target.exact !== false ? ', exact: true' : '';
    return `${prefix}getByRole(${JSON.stringify(target.role)}, { name: ${JSON.stringify(target.name)}${opts} })`;
  }

  // 3. Label
  if (target.label) {
    const opts = target.exact !== false ? ', { exact: true }' : '';
    return `${prefix}getByLabel(${JSON.stringify(target.label)}${opts})`;
  }

  // 4. Text
  if (target.text) {
    const opts = target.exact !== false ? ', { exact: true }' : '';
    return `${prefix}getByText(${JSON.stringify(target.text)}${opts})`;
  }

  // 5. CSS selector
  if (target.css) {
    return `${prefix}locator(${JSON.stringify(target.css)})`;
  }

  // 6. XPath selector
  if (target.xpath) {
    return `${prefix}locator(${JSON.stringify(`xpath=${target.xpath}`)})`;
  }

  return `${prefix}locator('body')`;
}

/**
 * Resolves a WorkflowValue to TypeScript code.
 */
export function formatValueExpression(value?: WorkflowValue): string {
  if (!value) return "''";

  if ('input' in value) {
    return `inputs?.${value.input} ?? ''`;
  }

  if ('secret' in value) {
    return `process.env[${JSON.stringify(value.secret)}] ?? ''`;
  }

  if ('constant' in value) {
    return JSON.stringify(value.constant);
  }

  return "''";
}

/**
 * Generates workflow.ts from WorkflowIR.
 */
export function generateWorkflowSource(ir: WorkflowIR): string {
  const funcName = `run${toPascalCase(ir.name)}`;
  const inputInterfaceName = `${toPascalCase(ir.name)}Inputs`;

  // Build input interface properties
  const inputPropLines: string[] = [];
  for (const [key, input] of Object.entries(ir.inputs || {})) {
    const tsType = input.type === 'number' ? 'number' : input.type === 'boolean' ? 'boolean' : 'string';
    const optionalMark = input.required ? '' : '?';
    inputPropLines.push(`  /** ${input.description || key} */\n  ${key}${optionalMark}: ${tsType};`);
  }

  const hasInputs = inputPropLines.length > 0;
  const inputTypeDeclaration = hasInputs
    ? `export interface ${inputInterfaceName} {\n${inputPropLines.join('\n')}\n}\n`
    : `export type ${inputInterfaceName} = Record<string, never>;\n`;

  const inputParam = hasInputs
    ? `inputs: ${inputInterfaceName}`
    : `inputs?: ${inputInterfaceName}`;

  // Build step execution lines
  const stepLines: string[] = [];

  for (const step of ir.steps) {
    stepLines.push(`  // ${step.id}: ${step.intent || step.action.type}`);

    switch (step.action.type) {
      case 'navigate': {
        stepLines.push(`  await page.goto(${JSON.stringify(step.action.url)});`);
        break;
      }

      case 'click': {
        const locatorCode = formatPlaywrightLocator(step.action.target);
        stepLines.push(`  await ${locatorCode}.click();`);
        break;
      }

      case 'fill': {
        const locatorCode = formatPlaywrightLocator(step.action.target);
        const valExpr = formatValueExpression(step.action.value);
        stepLines.push(`  await ${locatorCode}.fill(${valExpr});`);
        break;
      }

      case 'check': {
        const locatorCode = formatPlaywrightLocator(step.action.target);
        stepLines.push(`  await ${locatorCode}.check();`);
        break;
      }

      case 'uncheck': {
        const locatorCode = formatPlaywrightLocator(step.action.target);
        stepLines.push(`  await ${locatorCode}.uncheck();`);
        break;
      }

      case 'selectOption': {
        const locatorCode = formatPlaywrightLocator(step.action.target);
        const valExpr = formatValueExpression(step.action.value);
        stepLines.push(`  await ${locatorCode}.selectOption(${valExpr});`);
        break;
      }

      case 'uploadFile': {
        const locatorCode = formatPlaywrightLocator(step.action.target);
        const valExpr = formatValueExpression(step.action.value);
        stepLines.push(`  await ${locatorCode}.setInputFiles(${valExpr});`);
        break;
      }

      case 'drag': {
        const sourceCode = formatPlaywrightLocator(step.action.source);
        const destCode = formatPlaywrightLocator(step.action.destination);
        stepLines.push(`  await ${sourceCode}.dragTo(${destCode});`);
        break;
      }
    }

    // Postconditions
    if (step.postcondition) {
      if (step.postcondition.urlMatches) {
        stepLines.push(
          `  await expect(page).toHaveURL(new RegExp(${JSON.stringify(step.postcondition.urlMatches)}));`
        );
      }
      if (step.postcondition.elementVisible) {
        const targetLocator = formatPlaywrightLocator(step.postcondition.elementVisible);
        stepLines.push(`  await expect(${targetLocator}).toBeVisible();`);
      }
      if (step.postcondition.textMatches) {
        stepLines.push(
          `  await expect(page.getByText(${JSON.stringify(step.postcondition.textMatches)})).toBeVisible();`
        );
      }
    }

    stepLines.push('');
  }

  return `import { type Page, expect } from '@playwright/test';

${inputTypeDeclaration}
/**
 * ${ir.description || ir.name}
 *
 * Generated automatically by Trace2Code compiler.
 * Zero LLM runtime dependency.
 */
export async function ${funcName}(page: Page, ${inputParam}): Promise<void> {
${stepLines.join('\n')}
}
`;
}

/**
 * Generates input.schema.json from WorkflowIR inputs.
 */
export function generateInputSchema(ir: WorkflowIR): string {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, input] of Object.entries(ir.inputs || {})) {
    properties[key] = {
      type: input.type,
      description: input.description,
      default: input.default,
    };
    if (input.required) {
      required.push(key);
    }
  }

  const schema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: `${toPascalCase(ir.name)}Inputs`,
    description: `Input parameters for ${ir.name}`,
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
    additionalProperties: false,
  };

  return JSON.stringify(schema, null, 2);
}

/**
 * Generates workflow.test.ts for automated Playwright test execution.
 */
export function generateTestFile(ir: WorkflowIR): string {
  const funcName = `run${toPascalCase(ir.name)}`;
  const inputInterfaceName = `${toPascalCase(ir.name)}Inputs`;
  const hasInputs = Object.keys(ir.inputs || {}).length > 0;

  const mockInputEntries: string[] = [];
  for (const [key, input] of Object.entries(ir.inputs || {})) {
    const val =
      input.default !== undefined
        ? JSON.stringify(input.default)
        : input.type === 'number'
        ? '100'
        : input.type === 'boolean'
        ? 'true'
        : `'test-${key}'`;
    mockInputEntries.push(`      ${key}: ${val},`);
  }

  const inputsCallArg = hasInputs
    ? `{\n${mockInputEntries.join('\n')}\n    }`
    : '{}';

  return `import { test, expect } from '@playwright/test';
import { ${funcName} } from './workflow.js';

test.describe('${ir.name}', () => {
  test('executes demonstration workflow successfully', async ({ page }) => {
    await ${funcName}(page, ${inputsCallArg});
  });
});
`;
}

/**
 * Generates README.md with instructions.
 */
export function generateReadme(ir: WorkflowIR): string {
  return `# ${ir.name}

${ir.description || 'Trace2Code compiled browser demonstration.'}

## Standalone Execution Instructions

This project is a standalone Playwright TypeScript automation suite compiled by Trace2Code.
It executes with **zero LLM dependencies** at runtime.

### 1. Install Dependencies
\`\`\`bash
npm install
\`\`\`

### 2. Run Automation Tests
\`\`\`bash
npx playwright test
\`\`\`

### 3. Run in Headed Mode
\`\`\`bash
npx playwright test --headed
\`\`\`

### 4. Input Parameters
See \`input.schema.json\` for schema and parameter constraints.
`;
}

/**
 * Generates standalone package.json and config files.
 */
export function generatePackageJson(ir: WorkflowIR): string {
  const pkg = {
    name: `@workflow/${ir.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`,
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: {
      test: 'playwright test',
      typecheck: 'tsc --noEmit',
    },
    devDependencies: {
      '@playwright/test': '^1.49.0',
      '@types/node': '^20.17.0',
      typescript: '^5.7.2',
    },
  };

  return JSON.stringify(pkg, null, 2);
}

export function generatePlaywrightConfig(): string {
  return `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.test.ts',
  timeout: 30000,
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
});
`;
}

export function generateTsConfig(): string {
  return `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["**/*.ts"]
}
`;
}

/**
 * Compiles a WorkflowIR into a complete, standalone Playwright TypeScript project bundle.
 */
export function compileWorkflowToPlaywright(ir: WorkflowIR): GeneratedProject {
  const files: GeneratedFileMap = {
    'workflow.ts': generateWorkflowSource(ir),
    'workflow.test.ts': generateTestFile(ir),
    'input.schema.json': generateInputSchema(ir),
    'package.json': generatePackageJson(ir),
    'playwright.config.ts': generatePlaywrightConfig(),
    'tsconfig.json': generateTsConfig(),
    'README.md': generateReadme(ir),
  };

  return {
    files,
    writeToDisk(outputDir: string) {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      for (const [filename, content] of Object.entries(files)) {
        const filePath = path.join(outputDir, filename);
        fs.writeFileSync(filePath, content, 'utf-8');
      }
    },
  };
}
