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
function handleValidate(file: string) {
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
}

program
  .command('validate <file>')
  .description('Validate a canonical trace JSONL file against protocol schemas')
  .action(handleValidate);

const traceCmd = program.command('trace').description('Trace operations');
traceCmd
  .command('validate <file>')
  .description('Validate a canonical trace JSONL file against protocol schemas')
  .action(handleValidate);


// trace2code record
program
  .command('record')
  .description('Record browser interaction session')
  .option('-i, --integration <type>', 'Browser integration (controller | extension)', 'controller')
  .option('-c, --capture <mode>', 'Capture mode (full | distilled)', 'full')
  .option('-n, --name <name>', 'Run name', 'demonstration-run')
  .option('-u, --url <url>', 'Initial URL to open', 'http://localhost:3000')
  .option('--headless', 'Run browser in headless mode', false)
  .action(async (options: { integration: string; capture: string; name: string; url: string; headless: boolean }) => {
    if (options.integration === 'controller') {
      const { PlaywrightRecorder } = await import('@trace2code/recorder-playwright');
      console.log(`Starting Trace2Code controller recorder (${options.capture} mode)...`);
      const recorder = new PlaywrightRecorder({
        name: options.name,
        headless: options.headless,
        config: {
          captureMode: options.capture as 'full' | 'distilled',
        },
      });

      const { run, page } = await recorder.start(options.url);
      console.log(`Recording started! Run ID: ${run.id}`);
      console.log(`Target URL: ${options.url}`);
      console.log(`Press Enter or close the browser to finish recording...`);

      // Wait for user input or browser close
      await new Promise<void>((resolve) => {
        if (process.stdin.isTTY) {
          process.stdin.resume();
          process.stdin.once('data', () => resolve());
        }
        page.on('close', () => resolve());
      });

      console.log('Finalizing recording...');
      const summary = await recorder.stop();
      console.log(`Recording complete!`);
      console.log(`  - Events captured: ${summary.eventCount}`);
      console.log(`  - Trace file: ${summary.tracePath}`);

      // Automatically register to local SQLite store
      try {
        const { TraceStore } = await import('@trace2code/trace-store');
        const dbPath = path.resolve(process.cwd(), '.trace2code', 'store.db');
        const store = new TraceStore(dbPath);
        await store.init();
        store.importJsonl(summary.tracePath);
        store.close();
        console.log(`  - Registered in SQLite store (.trace2code/store.db)`);
      } catch (_) {}

      process.exit(0);
    } else {
      console.log(`Extension recording mode selected. Awaiting extension stream or start daemon.`);
    }
  });

// trace2code runs
program
  .command('runs')
  .description('List recorded runs in local SQLite store')
  .action(async () => {
    const { TraceStore } = await import('@trace2code/trace-store');
    const dbPath = path.resolve(process.cwd(), '.trace2code', 'store.db');
    const store = new TraceStore(dbPath);
    await store.init();
    const runs = store.listRuns();
    store.close();

    if (runs.length === 0) {
      console.log('No runs recorded yet in local store.');
      return;
    }

    console.log(`Recorded Runs (${runs.length}):`);
    runs.forEach((r) => {
      console.log(`  - [${r.id}] "${r.name}" (${r.captureMode}, ${r.integration}) @ ${r.startedAt}`);
    });
  });

// trace2code inspect <run-id>
program
  .command('inspect [runId]')
  .description('Inspect run in developer web dashboard')
  .option('-p, --port <number>', 'Server port', '4300')
  .action(async (runId?: string, options?: { port: string }) => {
    const { createInspectorServer } = await import('@trace2code/inspector');
    const port = parseInt(options?.port || '4300', 10);
    const inspector = createInspectorServer({ port });
    const { url } = await inspector.start();

    console.log(`Trace2Code Inspector running at: ${url}`);
    if (runId) {
      console.log(`Inspect run URL: ${url}/run/${runId}`);
    }
    console.log(`Press Ctrl+C to stop inspector.`);
  });

// trace2code export <run-id> [out]
program
  .command('export <runId> [outFile]')
  .description('Export a run from SQLite store to JSONL')
  .action(async (runId: string, outFile?: string) => {
    const { TraceStore } = await import('@trace2code/trace-store');
    const dbPath = path.resolve(process.cwd(), '.trace2code', 'store.db');
    const store = new TraceStore(dbPath);
    await store.init();
    const outPath = path.resolve(process.cwd(), outFile || `${runId}.jsonl`);

    store.exportJsonl(runId, outPath);
    store.close();
    console.log(`Run ${runId} successfully exported to ${outPath}`);
  });

// trace2code import <file>
program
  .command('import <file>')
  .description('Import a JSONL trace file into local SQLite store')
  .action(async (file: string) => {
    const { TraceStore } = await import('@trace2code/trace-store');
    const dbPath = path.resolve(process.cwd(), '.trace2code', 'store.db');
    const store = new TraceStore(dbPath);
    await store.init();
    const inPath = path.resolve(process.cwd(), file);

    const run = store.importJsonl(inPath);
    store.close();
    console.log(`Successfully imported run "${run.name}" (ID: ${run.id}) into SQLite store.`);
  });

program.parse(process.argv);


