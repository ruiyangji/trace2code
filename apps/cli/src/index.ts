#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { validateTraceLines } from '@trace2code/protocol';

const program = new Command();

program
  .name('trace2code')
  .description('Trace2Code - Browser Demonstration Compiler')
  .version('0.1.0');

// trace validate <file>
const traceCmd = program.command('trace').description('Trace operations');

traceCmd
  .command('validate <file>')
  .description('Validate a canonical trace JSONL file against protocol schemas')
  .action((file: string) => {
    const filePath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found at ${filePath}`);
      process.exit(1);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const result = validateTraceLines(lines);

    if (result.valid) {
      console.log(`Trace valid! Run ID: ${result.run?.id}, Event Count: ${result.eventCount}`);
      if (result.warnings.length > 0) {
        console.warn(`Warnings (${result.warnings.length}):`);
        result.warnings.forEach((w) => console.warn(`  - ${w}`));
      }
      process.exit(0);
    } else {
      console.error(`Trace validation failed (${result.errors.length} errors):`);
      result.errors.forEach((err) => console.error(`  - ${err}`));
      process.exit(1);
    }
  });

// Also support `trace2code validate <file>` directly
program
  .command('validate <file>')
  .description('Validate a canonical trace JSONL file')
  .action((file: string) => {
    const traceVal = traceCmd.commands.find((c) => c.name() === 'validate');
    if (traceVal) {
      traceVal.parse([file], { from: 'user' });
    }
  });

program.parse(process.argv);
