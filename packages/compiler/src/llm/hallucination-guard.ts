import type { WorkflowIR, WorkflowTarget } from '@trace2code/workflow-ir';
import type { ElementEvidence } from '@trace2code/protocol';
import type { CompilerEvidenceContext } from './provider.js';

export interface HallucinationVerificationResult {
  valid: boolean;
  violations: string[];
}

export class HallucinationGuard {
  /**
   * Verifies that the generated WorkflowIR is strictly grounded in trace evidence.
   */
  static verify(ir: WorkflowIR, context: CompilerEvidenceContext): HallucinationVerificationResult {
    const violations: string[] = [];

    // Collect all ground truth elements from steps and extra evidence
    const allElements: ElementEvidence[] = [];
    for (const step of context.steps) {
      if (step.target) allElements.push(step.target);
      if (step.payload?.source) allElements.push(step.payload.source as ElementEvidence);
      if (step.payload?.destination) allElements.push(step.payload.destination as ElementEvidence);
    }
    if (context.elements) {
      allElements.push(...context.elements);
    }

    // Collect all ground truth URLs
    const visitedUrls = new Set<string>();
    if (context.pageUrls) {
      for (const u of context.pageUrls) visitedUrls.add(u);
    }
    for (const step of context.steps) {
      if (step.payload?.url) visitedUrls.add(step.payload.url as string);
      if (typeof step.value === 'string' && (step.value.startsWith('http://') || step.value.startsWith('https://'))) {
        visitedUrls.add(step.value);
      }
    }

    // Collect secret markers to prevent plaintext leakage
    const knownSecrets = new Set<string>();
    for (const mark of context.userMarks || []) {
      if (mark.kind === 'secret') {
        if (mark.details?.secretValue) knownSecrets.add(String(mark.details.secretValue));
        if (mark.label && mark.label !== 'secret') knownSecrets.add(mark.label);
      }
    }

    // Check each step in the workflow
    for (const step of ir.steps) {
      // 1. Verify Target Grounding
      if ('target' in step.action && step.action.target) {
        const target = step.action.target as WorkflowTarget;
        if (!this.isTargetGrounded(target, allElements)) {
          violations.push(
            `Step '${step.id}' target is ungrounded / hallucinated: ${JSON.stringify(target)}`
          );
        }
      }

      // 2. Verify Drag Source & Destination Grounding
      if (step.action.type === 'drag') {
        if (!this.isTargetGrounded(step.action.source, allElements)) {
          violations.push(
            `Step '${step.id}' drag source target is ungrounded / hallucinated: ${JSON.stringify(step.action.source)}`
          );
        }
        if (!this.isTargetGrounded(step.action.destination, allElements)) {
          violations.push(
            `Step '${step.id}' drag destination target is ungrounded / hallucinated: ${JSON.stringify(step.action.destination)}`
          );
        }
      }

      // 3. Verify URL Grounding
      if (step.action.type === 'navigate') {
        const navUrl = step.action.url;
        if (!this.isUrlGrounded(navUrl, visitedUrls)) {
          violations.push(
            `Step '${step.id}' navigated to ungrounded / hallucinated URL '${navUrl}'`
          );
        }
      }

      // 4. Verify Secret Leakage
      if ('value' in step.action && step.action.value && 'constant' in step.action.value) {
        const constVal = step.action.value.constant;
        for (const secret of knownSecrets) {
          if (secret && constVal.includes(secret)) {
            violations.push(
              `Step '${step.id}' leaked plaintext secret '${secret}' in constant value`
            );
          }
        }
      }

      // Check intent for secret leakage
      for (const secret of knownSecrets) {
        if (secret && step.intent.includes(secret)) {
          violations.push(
            `Step '${step.id}' leaked plaintext secret '${secret}' in intent description`
          );
        }
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  private static isTargetGrounded(target: WorkflowTarget, elements: ElementEvidence[]): boolean {
    if (elements.length === 0) {
      return true; // No elements recorded (e.g. empty trace)
    }

    if (target.css === 'body' || target.css === 'html') {
      return true;
    }

    for (const el of elements) {
      // Test ID match
      if (target.testId && el.testIds) {
        if (Object.values(el.testIds).includes(target.testId)) return true;
      }

      // Role + Accessible Name match
      if (target.role && target.name) {
        if (
          el.role?.toLowerCase() === target.role.toLowerCase() &&
          (el.accessibleName === target.name ||
            (el.accessibleName && el.accessibleName.toLowerCase().includes(target.name.toLowerCase())))
        ) {
          return true;
        }
      }

      // Label match
      if (target.label) {
        if (el.ariaLabel === target.label || el.accessibleName === target.label) return true;
      }

      // Text match
      if (target.text && el.text) {
        if (el.text.trim() === target.text.trim() || el.text.includes(target.text)) return true;
      }

      // ID match
      if (target.css && el.id && target.css === `#${el.id}`) {
        return true;
      }

      // Name match
      if (target.css && el.name && target.css === `[name="${el.name}"]`) {
        return true;
      }

      // CSS Selector match
      if (target.css && el.cssCandidates && el.cssCandidates.includes(target.css)) {
        return true;
      }

      // XPath match
      if (target.xpath && el.xpathCandidate && target.xpath === el.xpathCandidate) {
        return true;
      }

      // Tag match fallback
      if (target.css && el.tagName && target.css.toLowerCase() === el.tagName.toLowerCase()) {
        return true;
      }
    }

    return false;
  }

  private static isUrlGrounded(url: string, visitedUrls: Set<string>): boolean {
    if (visitedUrls.size === 0) return true;
    if (visitedUrls.has(url)) return true;

    try {
      const parsed = new URL(url);
      for (const visited of visitedUrls) {
        try {
          const visitedParsed = new URL(visited);
          // Same origin and matching pathname prefix
          if (visitedParsed.origin === parsed.origin) {
            return true;
          }
        } catch {
          if (visited.includes(url) || url.includes(visited)) return true;
        }
      }
    } catch {
      // Relative URL or fragment
      return true;
    }

    return false;
  }
}
