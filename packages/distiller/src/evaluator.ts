import type { Page, Locator } from 'playwright';
import type { SemanticTraceStep } from './types.js';
import { LocatorScoringSystem, type ScoredLocator } from './locator.js';

export interface EvaluationStepDiagnostic {
  stepId: string;
  action: string;
  success: boolean;
  chosenLocator?: ScoredLocator;
  allCandidates: ScoredLocator[];
  matchedCount: number;
  isAmbiguous: boolean;
  isFallback: boolean;
  error?: string;
}

export interface ReplayEvaluationReport {
  totalSteps: number;
  resolvedCount: number;
  targetResolutionSuccessRate: number; // 0 to 1 (e.g. 1.0 = 100%)
  actionSuccessRate: number;
  ambiguousLocatorRate: number;
  fallbackLocatorRate: number;
  diagnostics: EvaluationStepDiagnostic[];
}

export class SemanticReplayEvaluator {
  private scoring = new LocatorScoringSystem();

  async evaluateWorkflow(page: Page, steps: SemanticTraceStep[]): Promise<ReplayEvaluationReport> {
    const diagnostics: EvaluationStepDiagnostic[] = [];
    let resolvedCount = 0;
    let actionSuccessCount = 0;
    let ambiguousCount = 0;
    let fallbackCount = 0;

    for (const step of steps) {
      if (step.action === 'navigate') {
        const url = (step.payload as any)?.url;
        let success = true;
        try {
          if (url && !page.url().includes(url)) {
            await page.goto(url, { waitUntil: 'domcontentloaded' });
          }
        } catch (e: any) {
          success = false;
        }

        diagnostics.push({
          stepId: step.id,
          action: 'navigate',
          success,
          allCandidates: [],
          matchedCount: 1,
          isAmbiguous: false,
          isFallback: false,
        });
        resolvedCount++;
        if (success) actionSuccessCount++;
        continue;
      }

      const candidates = this.scoring.rankCandidates(step.target);
      if (candidates.length === 0) {
        diagnostics.push({
          stepId: step.id,
          action: step.action,
          success: false,
          allCandidates: [],
          matchedCount: 0,
          isAmbiguous: false,
          isFallback: false,
          error: 'No locator candidates could be inferred from target evidence',
        });
        continue;
      }

      let chosenLocator: ScoredLocator | undefined;
      let chosenPlaywrightLocator: Locator | null = null;
      let matchedCount = 0;
      let isFallback = false;

      // Iterate through ranked candidates until an unambiguous match is found
      for (let i = 0; i < candidates.length; i++) {
        const cand = candidates[i];
        if (cand.strategy === 'coordinates') continue;

        try {
          const loc = this.buildPlaywrightLocator(page, cand);
          const count = await loc.count();

          if (count === 1) {
            chosenLocator = cand;
            chosenPlaywrightLocator = loc;
            matchedCount = 1;
            if (i > 1) isFallback = true;
            break;
          } else if (count > 1) {
            // Ambiguous! Try to disambiguate or record
            ambiguousCount++;
          }
        } catch (_) {
          // Candidate syntax or resolution failed, continue to next
        }
      }

      if (!chosenPlaywrightLocator && candidates.length > 0) {
        // Fallback to highest scored candidate
        chosenLocator = candidates[0];
        try {
          chosenPlaywrightLocator = this.buildPlaywrightLocator(page, chosenLocator);
          matchedCount = await chosenPlaywrightLocator.count();
        } catch (_) {}
        isFallback = true;
      }

      let actionSuccess = false;
      let actionError: string | undefined;

      if (matchedCount >= 1 && chosenPlaywrightLocator) {
        resolvedCount++;
        try {
          if (step.action === 'click') {
            await chosenPlaywrightLocator.first().click({ timeout: 2000 });
            actionSuccess = true;
          } else if (step.action === 'fill') {
            const val = typeof step.value === 'string' ? step.value : '';
            await chosenPlaywrightLocator.first().fill(val, { timeout: 2000 });
            actionSuccess = true;
          } else if (step.action === 'check') {
            await chosenPlaywrightLocator.first().check({ timeout: 2000 });
            actionSuccess = true;
          } else if (step.action === 'uncheck') {
            await chosenPlaywrightLocator.first().uncheck({ timeout: 2000 });
            actionSuccess = true;
          } else if (step.action === 'selectOption') {
            const optVal = typeof step.value === 'string' ? step.value : '';
            await chosenPlaywrightLocator.first().selectOption(optVal, { timeout: 2000 });
            actionSuccess = true;
          } else {
            actionSuccess = true;
          }
          actionSuccessCount++;
        } catch (err: any) {
          actionError = err.message;
        }
      }

      if (isFallback) fallbackCount++;

      diagnostics.push({
        stepId: step.id,
        action: step.action,
        success: actionSuccess,
        chosenLocator,
        allCandidates: candidates,
        matchedCount,
        isAmbiguous: matchedCount > 1,
        isFallback,
        error: actionError,
      });
    }

    const totalSteps = steps.length;
    return {
      totalSteps,
      resolvedCount,
      targetResolutionSuccessRate: totalSteps > 0 ? resolvedCount / totalSteps : 1.0,
      actionSuccessRate: totalSteps > 0 ? actionSuccessCount / totalSteps : 1.0,
      ambiguousLocatorRate: totalSteps > 0 ? ambiguousCount / totalSteps : 0,
      fallbackLocatorRate: totalSteps > 0 ? fallbackCount / totalSteps : 0,
      diagnostics,
    };
  }

  private buildPlaywrightLocator(page: Page, candidate: ScoredLocator): Locator {
    let base: any = page;
    if (candidate.containerScope) {
      base = page.locator(candidate.containerScope);
    }

    switch (candidate.strategy) {
      case 'test-id': {
        const testIdVal = candidate.expression.replace(/^\[[^=]+="|"\]$/g, '');
        return base.getByTestId(testIdVal);
      }
      case 'role-name': {
        const match = candidate.expression.match(/^role=([^[]+)\[name="([^"]+)"\]$/);
        if (match) {
          return base.getByRole(match[1] as any, { name: match[2], exact: true });
        }
        return base.locator(candidate.expression);
      }
      case 'label': {
        const labelText = candidate.expression.replace(/^label="|"$|\'/g, '');
        return base.getByLabel(labelText, { exact: true });
      }
      case 'text': {
        const txt = candidate.expression.replace(/^text="|"$|\'/g, '');
        return base.getByText(txt, { exact: true });
      }
      default:
        return base.locator(candidate.expression);
    }
  }
}
