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

// trace2code distill <run-id>
program
  .command('distill <runId>')
  .description('Perform offline semantic distillation and locator ranking on a recorded trace')
  .option('-o, --output <file>', 'Output JSON file path')
  .action(async (runId: string, options?: { output?: string }) => {
    const { TraceStore } = await import('@trace2code/trace-store');
    const { distillRawTrace, LocatorScoringSystem } = await import('@trace2code/distiller');
    const dbPath = path.resolve(process.cwd(), '.trace2code', 'store.db');
    const store = new TraceStore(dbPath);
    await store.init();

    const run = store.getRun(runId);
    if (!run) {
      console.error(`Error: Run ${runId} not found in store.`);
      store.close();
      process.exit(1);
    }

    const events = store.getEvents(runId);
    store.close();

    console.log(`Distilling trace for run "${run.name}" (${events.length} raw events)...`);
    const steps = distillRawTrace(events);
    const scoring = new LocatorScoringSystem();

    const outputSteps = steps.map((s) => ({
      ...s,
      rankedLocators: scoring.rankCandidates(s.target),
    }));

    console.log(`Semantic Distillation Complete: ${outputSteps.length} semantic steps generated.`);
    outputSteps.forEach((s) => {
      const targetStr = s.target?.accessibleName ? `"${s.target.accessibleName}"` : s.target?.id ? `#${s.target.id}` : '';
      const topLocator = s.rankedLocators[0]?.playwrightCode || 'n/a';
      console.log(`  Step ${s.seq + 1}: ${s.action} ${targetStr} -> ${topLocator}`);
    });

    const outPath = options?.output || path.resolve(process.cwd(), '.trace2code', 'runs', runId, 'distilled.json');
    const outDir = path.dirname(outPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(outputSteps, null, 2), 'utf-8');
    console.log(`Saved distilled steps to ${outPath}`);
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

// trace2code compile <run-id>
program
  .command('compile <runId>')
  .description('Compile a recorded demonstration into Workflow IR or Playwright TypeScript source code')
  .option('-t, --target <format>', 'Target output format (playwright-ts | ir)', 'playwright-ts')
  .option('--ir', 'Shortcut to output Workflow IR JSON')
  .option('-o, --output <path>', 'Output destination (file for IR, directory for playwright-ts)')
  .option('-p, --provider <name>', 'Inference provider (deterministic-rules | gemini)', 'deterministic-rules')
  .action(async (runId: string, options: { target: string; ir?: boolean; output?: string; provider?: string }) => {
    const { TraceStore } = await import('@trace2code/trace-store');
    const { distillRawTrace } = await import('@trace2code/distiller');
    const {
      SemanticCompiler,
      DeterministicRuleCompilerProvider,
      GeminiCompilerProvider,
      compileWorkflowToPlaywright,
    } = await import('@trace2code/compiler');

    const dbPath = path.resolve(process.cwd(), '.trace2code', 'store.db');
    const store = new TraceStore(dbPath);
    await store.init();

    let run = store.getRun(runId);
    let events = store.getEvents(runId);

    // If not found in store, check if runId is a path to a jsonl file
    if (!run && fs.existsSync(path.resolve(process.cwd(), runId))) {
      const imported = store.importJsonl(path.resolve(process.cwd(), runId));
      run = imported;
      events = store.getEvents(run.id);
    }

    if (!run || events.length === 0) {
      console.error(`Error: Run '${runId}' not found in store or empty trace.`);
      store.close();
      process.exit(1);
    }

    store.close();

    console.log(`Compiling demonstration run "${run.name}" (${events.length} raw events)...`);
    const semanticSteps = distillRawTrace(events);

    // Extract user marks
    const userMarks = events
      .filter((e) => e.type === 'mark')
      .map((e) => {
        const payload = e.payload as any;
        return {
          kind: (payload?.kind || 'note') as any,
          label: payload?.label || '',
          details: payload?.details,
          targetSeq: e.seq,
          timestampMs: e.timestampMs,
        };
      });

    const providerInstance =
      options.provider === 'gemini'
        ? new GeminiCompilerProvider()
        : new DeterministicRuleCompilerProvider();

    const compiler = new SemanticCompiler(providerInstance);
    const result = await compiler.compile({
      workflowName: run.name,
      steps: semanticSteps,
      userMarks,
    });

    if (!result.valid || !result.ir) {
      console.error(`Compilation failed with ${result.errors.length} errors:`);
      result.errors.forEach((err) => console.error(`  - ${err}`));
      process.exit(1);
    }

    console.log(`Workflow compiled successfully!`);
    console.log(`  - Provider: ${result.stats.provider}`);
    console.log(`  - Steps: ${result.stats.stepCount}`);
    console.log(`  - Declared Inputs: ${result.stats.inputCount}`);

    const targetFormat = options.ir ? 'ir' : options.target;

    if (targetFormat === 'ir') {
      const formattedJson = JSON.stringify(result.ir, null, 2);
      if (options.output) {
        const outPath = path.resolve(process.cwd(), options.output);
        const outDir = path.dirname(outPath);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(outPath, formattedJson, 'utf-8');
        console.log(`  - Workflow IR saved to ${outPath}`);
      } else {
        console.log('\n--- Workflow IR ---');
        console.log(formattedJson);
      }
    } else {
      // Playwright TypeScript project bundle
      const project = compileWorkflowToPlaywright(result.ir);
      const outputDir = path.resolve(
        process.cwd(),
        options.output || path.join('.trace2code', 'compiled', result.ir.name)
      );
      project.writeToDisk(outputDir);

      console.log(`\nStandalone Playwright TypeScript Project Generated:`);
      console.log(`  - Destination Directory: ${outputDir}`);
      console.log(`  - Files:`);
      Object.keys(project.files).forEach((f) => console.log(`      • ${f}`));
      console.log(`\nTo execute independently without LLM:`);
      console.log(`  cd ${outputDir} && npm install && npx playwright test`);
    }
  });

program.parse(process.argv);


