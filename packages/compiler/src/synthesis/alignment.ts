import type { SemanticTraceStep } from '@trace2code/distiller';
import type { ElementEvidence } from '@trace2code/protocol';

export interface AlignedColumn {
  /**
   * The steps from each demonstration trace corresponding to this column.
   * If a demonstration trace omitted this step, its entry is null.
   * Length is always equal to the number of demonstration traces.
   */
  steps: (SemanticTraceStep | null)[];
  /**
   * Consensus action type (e.g. 'click', 'fill', 'navigate', etc.)
   */
  action: string;
  /**
   * Consensus target (from the first or highest-quality available target evidence).
   */
  target?: ElementEvidence;
  /**
   * Whether this step is optional (i.e. skipped in at least one demonstration).
   */
  isOptional: boolean;
  /**
   * Number of demonstrations that executed this step.
   */
  presentCount: number;
  /**
   * Total number of demonstrations.
   */
  totalCount: number;
}

export interface AlignmentResult {
  columns: AlignedColumn[];
  totalTraces: number;
}

/**
 * Computes the similarity score between two semantic trace steps.
 * Positive score indicates a likely match, negative score indicates mismatch.
 */
export function computeStepSimilarity(
  stepA: SemanticTraceStep,
  stepB: SemanticTraceStep
): number {
  // If actions differ, heavily penalize alignment
  if (stepA.action !== stepB.action) {
    return -10;
  }

  let score = 3; // Base match score for identical action type

  // 1. Navigation action matching
  if (stepA.action === 'navigate') {
    const urlA = (stepA.payload?.url as string) || (stepA.value as string) || '';
    const urlB = (stepB.payload?.url as string) || (stepB.value as string) || '';

    if (urlA && urlB) {
      if (urlA === urlB) {
        score += 5;
      } else {
        try {
          const pathA = new URL(urlA).pathname;
          const pathB = new URL(urlB).pathname;
          if (pathA === pathB) {
            score += 3;
          }
        } catch {
          // Ignore URL parse failures
        }
      }
    }
    return score;
  }

  // 2. DOM Target actions matching
  const targetA = stepA.target;
  const targetB = stepB.target;

  if (!targetA && !targetB) {
    return score;
  }

  if (!targetA || !targetB) {
    return score - 3;
  }

  // Tag name comparison
  if (targetA.tagName && targetB.tagName) {
    if (targetA.tagName.toLowerCase() === targetB.tagName.toLowerCase()) {
      score += 1;
    } else {
      score -= 3;
    }
  }

  // Explicit Test IDs match
  if (targetA.testIds && targetB.testIds) {
    const testIdsA = Object.values(targetA.testIds);
    const testIdsB = Object.values(targetB.testIds);
    const hasCommonTestId = testIdsA.some((id) => testIdsB.includes(id));
    if (hasCommonTestId) {
      score += 5;
    }
  }

  // Stable element ID match
  if (targetA.id && targetB.id && targetA.id === targetB.id) {
    score += 4;
  }

  // Name attribute match
  if (targetA.name && targetB.name && targetA.name === targetB.name) {
    score += 3;
  }

  // Role and Accessible Name match
  if (targetA.role && targetB.role && targetA.role === targetB.role) {
    if (targetA.accessibleName && targetB.accessibleName && targetA.accessibleName === targetB.accessibleName) {
      score += 4;
    } else {
      score += 1;
    }
  }

  // Aria Label match
  if (targetA.ariaLabel && targetB.ariaLabel && targetA.ariaLabel === targetB.ariaLabel) {
    score += 3;
  }

  // Text match
  if (targetA.text && targetB.text && targetA.text.trim() === targetB.text.trim()) {
    score += 2;
  }

  // CSS Candidates overlap
  if (targetA.cssCandidates && targetB.cssCandidates) {
    const hasOverlap = targetA.cssCandidates.some((c) => targetB.cssCandidates?.includes(c));
    if (hasOverlap) {
      score += 2;
    }
  }

  return score;
}

/**
 * Computes profile similarity between an aligned column and a candidate step.
 */
function computeProfileStepSimilarity(
  columnSteps: (SemanticTraceStep | null)[],
  step: SemanticTraceStep
): number {
  let total = 0;
  let count = 0;
  for (const s of columnSteps) {
    if (s !== null) {
      total += computeStepSimilarity(s, step);
      count++;
    }
  }
  return count > 0 ? total / count : -2;
}

const GAP_PENALTY = -2;

/**
 * Performs Needleman-Wunsch alignment between an existing multi-sequence profile and a single trace.
 */
function alignProfileWithTrace(
  profile: (SemanticTraceStep | null)[][],
  trace: SemanticTraceStep[],
  profileWidth: number
): (SemanticTraceStep | null)[][] {
  const m = profile.length;
  const n = trace.length;

  if (m === 0) {
    return trace.map((step) => [...Array(profileWidth).fill(null), step]);
  }

  if (n === 0) {
    return profile.map((col) => [...col, null]);
  }

  // Initialize scoring and traceback matrices
  const score: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  const traceback: ('diag' | 'up' | 'left')[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill('diag')
  );

  for (let i = 1; i <= m; i++) {
    score[i][0] = i * GAP_PENALTY;
    traceback[i][0] = 'up';
  }

  for (let j = 1; j <= n; j++) {
    score[0][j] = j * GAP_PENALTY;
    traceback[0][j] = 'left';
  }

  // Dynamic programming
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const sim = computeProfileStepSimilarity(profile[i - 1], trace[j - 1]);
      const matchScore = score[i - 1][j - 1] + sim;
      const deleteScore = score[i - 1][j] + GAP_PENALTY;
      const insertScore = score[i][j - 1] + GAP_PENALTY;

      let bestScore = matchScore;
      let dir: 'diag' | 'up' | 'left' = 'diag';

      if (deleteScore > bestScore) {
        bestScore = deleteScore;
        dir = 'up';
      }
      if (insertScore > bestScore) {
        bestScore = insertScore;
        dir = 'left';
      }

      score[i][j] = bestScore;
      traceback[i][j] = dir;
    }
  }

  // Traceback
  let i = m;
  let j = n;
  const alignedCols: (SemanticTraceStep | null)[][] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && traceback[i][j] === 'diag') {
      alignedCols.push([...profile[i - 1], trace[j - 1]]);
      i--;
      j--;
    } else if (i > 0 && (j === 0 || traceback[i][j] === 'up')) {
      alignedCols.push([...profile[i - 1], null]);
      i--;
    } else {
      alignedCols.push([...Array(profileWidth).fill(null), trace[j - 1]]);
      j--;
    }
  }

  alignedCols.reverse();
  return alignedCols;
}

/**
 * Performs Progressive Multiple Sequence Alignment across N demonstration traces using Needleman-Wunsch.
 */
export function alignMultiTraceSequences(traces: SemanticTraceStep[][]): AlignmentResult {
  const totalTraces = traces.length;

  if (totalTraces === 0) {
    return { columns: [], totalTraces: 0 };
  }

  if (totalTraces === 1) {
    const columns: AlignedColumn[] = traces[0].map((step) => ({
      steps: [step],
      action: step.action,
      target: step.target,
      isOptional: false,
      presentCount: 1,
      totalCount: 1,
    }));
    return { columns, totalTraces: 1 };
  }

  // Initialize profile with trace 0
  let profile: (SemanticTraceStep | null)[][] = traces[0].map((step) => [step]);

  // Progressively align subsequent traces
  for (let k = 1; k < totalTraces; k++) {
    profile = alignProfileWithTrace(profile, traces[k], k);
  }

  // Convert aligned rows into AlignedColumn structures
  const columns: AlignedColumn[] = profile.map((colSteps) => {
    const presentSteps = colSteps.filter((s): s is SemanticTraceStep => s !== null);
    const repStep = presentSteps[0];
    const bestTarget = presentSteps.find((s) => s.target)?.target;

    return {
      steps: colSteps,
      action: repStep?.action || 'unknown',
      target: bestTarget,
      isOptional: presentSteps.length < totalTraces,
      presentCount: presentSteps.length,
      totalCount: totalTraces,
    };
  });

  return {
    columns,
    totalTraces,
  };
}
