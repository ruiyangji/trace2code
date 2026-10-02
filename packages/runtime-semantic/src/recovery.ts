import type { Page, Locator } from 'playwright';
import type { WorkflowTarget, WorkflowStep } from '@trace2code/workflow-ir';
import { formatPlaywrightLocator } from '@trace2code/compiler';
import type { ElementCandidate, CandidateMatch, RecoveryDecision } from './types.js';

/**
 * Calculates string similarity using token overlap and Levenshtein distance (0..1).
 */
export function calculateTextSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();
  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) return 0.85;

  // Word token overlap (Jaccard similarity)
  const tokens1 = new Set(s1.split(/\s+/));
  const tokens2 = new Set(s2.split(/\s+/));
  const intersection = new Set([...tokens1].filter((x) => tokens2.has(x)));
  const union = new Set([...tokens1, ...tokens2]);
  const jaccard = union.size > 0 ? intersection.size / union.size : 0;

  // Levenshtein distance
  const track = Array(s2.length + 1)
    .fill(null)
    .map(() => Array(s1.length + 1).fill(null));
  for (let i = 0; i <= s1.length; i += 1) track[0][i] = i;
  for (let j = 0; j <= s2.length; j += 1) track[j][0] = j;
  for (let j = 1; j <= s2.length; j += 1) {
    for (let i = 1; i <= s1.length; i += 1) {
      const indicator = s1[i - 1] === s2[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1,
        track[j - 1][i] + 1,
        track[j - 1][i - 1] + indicator
      );
    }
  }
  const maxLen = Math.max(s1.length, s2.length);
  const lev = maxLen > 0 ? Math.max(0, 1 - track[s2.length][s1.length] / maxLen) : 0;

  return Math.max(jaccard, lev);
}

export class SemanticRecoveryEngine {
  /**
   * Scans live DOM to discover interactive element candidates.
   */
  async extractCandidates(page: Page): Promise<ElementCandidate[]> {
    return await page.evaluate(() => {
      const elements: any[] = [];
      const selector =
        'button, a, input, select, textarea, [role="button"], [role="checkbox"], [role="textbox"], [role="link"], [role="combobox"], [onclick]';
      const nodes = document.querySelectorAll(selector);

      nodes.forEach((node) => {
        const el = node as HTMLElement;
        const rect = el.getBoundingClientRect();
        // Ignore invisible elements
        if (rect.width <= 0 && rect.height <= 0) return;

        const tagName = el.tagName.toLowerCase();
        let role = el.getAttribute('role');
        if (!role) {
          if (tagName === 'button') role = 'button';
          else if (tagName === 'a') role = 'link';
          else if (tagName === 'input') {
            const inputType = el.getAttribute('type') || 'text';
            if (inputType === 'checkbox') role = 'checkbox';
            else if (inputType === 'radio') role = 'radio';
            else role = 'textbox';
          } else if (tagName === 'select') {
            role = 'combobox';
          }
        }

        // Check explicit labels, enclosing label, or sibling label in form row
        const nearbyLabel =
          (el as any).labels?.[0]?.textContent?.trim() ||
          el.closest('label')?.textContent?.trim() ||
          el.parentElement?.querySelector('label')?.textContent?.trim() ||
          (el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim() : undefined);

        const accessibleName =
          el.getAttribute('aria-label') ||
          nearbyLabel ||
          el.textContent?.trim() ||
          el.getAttribute('title') ||
          undefined;

        elements.push({
          tagName,
          id: el.id || undefined,
          role,
          name: el.getAttribute('name') || undefined,
          text: el.textContent?.trim() || undefined,
          ariaLabel: accessibleName,
          testId: el.getAttribute('data-testid') || el.getAttribute('data-test-id') || undefined,
          type: el.getAttribute('type') || undefined,
          cssCandidates: el.id ? [`#${el.id}`] : [],
        });
      });

      return elements;
    });
  }

  /**
   * Scores element candidates against a failed target and action intent.
   */
  rankCandidatesForTarget(
    target: WorkflowTarget,
    actionType: string,
    candidates: ElementCandidate[]
  ): CandidateMatch[] {
    const matches: CandidateMatch[] = [];

    const targetText = target.name || target.text || target.label || '';
    const targetId = target.css?.replace(/^#/, '') || '';

    for (const c of candidates) {
      let score = 0;
      const reasons: string[] = [];

      // 1. Action compatibility
      if (actionType === 'click' && (c.tagName === 'button' || c.role === 'button' || c.role === 'link' || c.tagName === 'a')) {
        score += 25;
        reasons.push('Action type matches clickable element');
      } else if (actionType === 'fill' && (c.tagName === 'input' || c.tagName === 'textarea' || c.role === 'textbox')) {
        score += 25;
        reasons.push('Action type matches text field element');
      } else if ((actionType === 'check' || actionType === 'uncheck') && (c.type === 'checkbox' || c.role === 'checkbox')) {
        score += 25;
        reasons.push('Action type matches checkbox element');
      } else if (actionType === 'selectOption' && (c.tagName === 'select' || c.role === 'combobox')) {
        score += 25;
        reasons.push('Action type matches dropdown element');
      }

      // 2. Test ID matching
      if (target.testId && c.testId) {
        if (target.testId === c.testId) {
          score += 100;
          reasons.push(`Exact testId match: ${c.testId}`);
        } else if (c.testId.includes(target.testId) || target.testId.includes(c.testId)) {
          score += 55;
          reasons.push(`Versioned / mutated testId match: ${c.testId}`);
        }
      }

      // 3. Text / Accessible Name similarity
      const candidateText = c.ariaLabel || c.text || '';
      if (targetText && candidateText) {
        const sim = calculateTextSimilarity(targetText, candidateText);
        if (sim >= 0.8) {
          score += Math.round(sim * 50);
          reasons.push(`High text similarity (${Math.round(sim * 100)}%): "${candidateText}"`);
        } else if (sim >= 0.3) {
          score += Math.round(sim * 35);
          reasons.push(`Moderate text similarity (${Math.round(sim * 100)}%): "${candidateText}"`);
        }
      }

      // 4. Role alignment
      if (target.role && c.role && target.role.toLowerCase() === c.role.toLowerCase()) {
        score += 20;
        reasons.push(`Matching ARIA role: ${c.role}`);
      }

      // 5. ID / Name mutation matching (e.g. #sample-btn vs #sample-btn-v2)
      if (targetId && c.id) {
        const idSim = calculateTextSimilarity(targetId, c.id);
        if (idSim >= 0.6) {
          score += Math.round(idSim * 40);
          reasons.push(`Matching ID root: #${c.id}`);
        }
      }

      // Synthesize replacement target
      const replacementTarget: WorkflowTarget = {
        role: c.role,
        name: c.ariaLabel || c.text,
        testId: c.testId,
        css: c.id ? `#${c.id}` : undefined,
        containerScope: target.containerScope,
        exact: true,
      };

      const locator = formatPlaywrightLocator(replacementTarget);

      matches.push({
        candidate: c,
        score,
        target: replacementTarget,
        locator,
        reasons,
      });
    }

    return matches.sort((a, b) => b.score - a.score);
  }

  /**
   * Generates a unified git diff patch showing the replacement in workflow source code.
   */
  generatePatchDiff(failedLocator: string, replacementLocator: string): string {
    return [
      `--- a/workflow.ts`,
      `+++ b/workflow.ts`,
      `@@ -step +step @@`,
      `-  await ${failedLocator};`,
      `+  await ${replacementLocator};`,
    ].join('\n');
  }

  /**
   * Attempts recovery for a failed step by finding and executing the best matching candidate.
   */
  async attemptRecovery(
    page: Page,
    step: WorkflowStep,
    originalTarget: WorkflowTarget
  ): Promise<RecoveryDecision> {
    const failedLocator = formatPlaywrightLocator(originalTarget);
    const candidates = await this.extractCandidates(page);
    const ranked = this.rankCandidatesForTarget(originalTarget, step.action.type, candidates);

    if (ranked.length === 0 || ranked[0].score < 30) {
      throw new Error(
        `Recovery Mode failed for ${step.id}: No viable semantic candidates found (top score: ${ranked[0]?.score ?? 0})`
      );
    }

    const chosen = ranked[0];
    const confidence = Math.min(1.0, chosen.score / 100);
    const replacementLocator = chosen.locator;

    // Execute alternative action
    const locator = page.locator(
      chosen.target.css ||
        (chosen.target.testId
          ? `[data-testid="${chosen.target.testId}"]`
          : chosen.candidate.id
          ? `#${chosen.candidate.id}`
          : chosen.candidate.tagName)
    );

    switch (step.action.type) {
      case 'click':
        await locator.click();
        break;
      case 'fill': {
        const val = 'value' in step.action && step.action.value && 'constant' in step.action.value
          ? step.action.value.constant
          : 'recovered-input';
        await locator.fill(val);
        break;
      }
      case 'check':
        await locator.check();
        break;
      case 'uncheck':
        await locator.uncheck();
        break;
      case 'selectOption': {
        const val = 'value' in step.action && step.action.value && 'constant' in step.action.value
          ? step.action.value.constant
          : 'ca';
        await (locator as any).selectOption(val);
        break;
      }
    }

    // Verify postconditions
    let postconditionVerified = true;
    if (step.postcondition?.urlMatches) {
      const regex = new RegExp(step.postcondition.urlMatches);
      postconditionVerified = regex.test(page.url());
    }
    if (step.postcondition?.elementVisible?.css) {
      const visible = await page.locator(step.postcondition.elementVisible.css).isVisible().catch(() => false);
      postconditionVerified = postconditionVerified && visible;
    }

    const patchDiff = this.generatePatchDiff(failedLocator, replacementLocator);

    return {
      stepId: step.id,
      stepIntent: step.intent,
      originalTarget,
      failedLocator,
      chosenTarget: chosen.target,
      chosenLocator: replacementLocator,
      confidence,
      rationale: chosen.reasons.join('; '),
      postconditionVerified,
      patchDiff,
      timestampMs: Date.now(),
    };
  }
}
