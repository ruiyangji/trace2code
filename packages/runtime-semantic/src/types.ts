import type { WorkflowTarget, WorkflowStep } from '@trace2code/workflow-ir';

export interface ElementCandidate {
  tagName: string;
  id?: string;
  role?: string;
  name?: string;
  text?: string;
  ariaLabel?: string;
  testId?: string;
  type?: string;
  cssCandidates: string[];
}

export interface CandidateMatch {
  candidate: ElementCandidate;
  score: number;
  target: WorkflowTarget;
  locator: string;
  reasons: string[];
}

export interface RecoveryDecision {
  stepId: string;
  stepIntent: string;
  originalTarget: WorkflowTarget;
  failedLocator: string;
  chosenTarget: WorkflowTarget;
  chosenLocator: string;
  confidence: number;
  rationale: string;
  postconditionVerified: boolean;
  patchDiff?: string;
  timestampMs: number;
}

export interface ExecutionResult {
  success: boolean;
  stepsExecuted: number;
  recoveredSteps: number;
  decisions: RecoveryDecision[];
  error?: string;
}
