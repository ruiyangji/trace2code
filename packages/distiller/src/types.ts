import type { ElementEvidence, RedactedValue } from '@trace2code/protocol';

export type SemanticActionType =
  | 'navigate'
  | 'click'
  | 'dblclick'
  | 'fill'
  | 'clear'
  | 'check'
  | 'uncheck'
  | 'selectOption'
  | 'uploadFile'
  | 'drag'
  | 'press'
  | 'submit'
  | 'openTab'
  | 'closeTab'
  | 'switchTab'
  | 'mark';

export interface SemanticTraceStep {
  id: string;
  seq: number;
  timestampMs: number;
  tabId: string;
  frameId: string;
  action: SemanticActionType;
  target?: ElementEvidence;
  value?: string | RedactedValue;
  payload?: Record<string, unknown>;
  postcondition?: {
    urlMatches?: string;
    semantic?: string;
    elementVisible?: string;
  };
}
