import { describe, it, expect } from 'vitest';
import { LocatorScoringSystem } from './locator.js';
import type { ElementEvidence } from '@trace2code/protocol';

describe('Milestone 5: LocatorScoringSystem Unit Tests', () => {
  const scoring = new LocatorScoringSystem();

  it('ranks explicit test IDs as highest priority (score 100)', () => {
    const evidence: ElementEvidence = {
      tagName: 'button',
      role: 'button',
      accessibleName: 'Submit Form',
      id: 'submit-btn',
      testIds: { 'data-testid': 'custom-submit-btn' },
      cssCandidates: ['#submit-btn', 'button.primary'],
    };

    const candidates = scoring.rankCandidates(evidence);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].strategy).toBe('test-id');
    expect(candidates[0].score).toBe(100);
    expect(candidates[0].playwrightCode).toBe('page.getByTestId("custom-submit-btn")');
  });

  it('ranks role and accessible name second (score 90)', () => {
    const evidence: ElementEvidence = {
      tagName: 'button',
      role: 'button',
      accessibleName: 'Save Changes',
      testIds: {},
      cssCandidates: ['button.btn-save'],
    };

    const candidates = scoring.rankCandidates(evidence);
    expect(candidates[0].strategy).toBe('role-name');
    expect(candidates[0].score).toBe(90);
    expect(candidates[0].playwrightCode).toContain('page.getByRole("button", { name: "Save Changes", exact: true })');
  });

  it('disambiguates duplicate labels using ancestor container scope', () => {
    // Shipping Email vs Billing Email
    const shippingEvidence: ElementEvidence = {
      tagName: 'input',
      role: 'textbox',
      accessibleName: 'Email Address',
      id: 'shipping-email',
      testIds: {},
      cssCandidates: ['#shipping-email'],
      ancestorSummary: ['div#shipping-address-group', 'section#section-duplicate-labels'],
    };

    const billingEvidence: ElementEvidence = {
      tagName: 'input',
      role: 'textbox',
      accessibleName: 'Email Address',
      id: 'billing-email',
      testIds: {},
      cssCandidates: ['#billing-email'],
      ancestorSummary: ['div#billing-address-group', 'section#section-duplicate-labels'],
    };

    const shippingCandidates = scoring.rankCandidates(shippingEvidence);
    const billingCandidates = scoring.rankCandidates(billingEvidence);

    expect(shippingCandidates[0].containerScope).toBe('#shipping-address-group');
    expect(shippingCandidates[0].playwrightCode).toContain('page.locator("#shipping-address-group")');

    expect(billingCandidates[0].containerScope).toBe('#billing-address-group');
    expect(billingCandidates[0].playwrightCode).toContain('page.locator("#billing-address-group")');
  });

  it('detects dynamic identifiers and deprioritizes them', () => {
    const evidence: ElementEvidence = {
      tagName: 'div',
      id: 'dynamic-item-987654321', // Dynamic ID with timestamp/random numbers
      text: 'Dynamic Item Added',
      testIds: {},
      cssCandidates: ['.dynamic-item'],
    };

    const candidates = scoring.rankCandidates(evidence);
    // Should NOT choose #dynamic-item-987654321 as top candidate; chooses text or CSS
    expect(candidates[0].strategy).not.toBe('css');
    expect(candidates[0].strategy).toBe('text');
  });

  it('resolves nested span buttons to parent button role and name', () => {
    // <button aria-label="Apply"><span>Apply now</span></button>
    const evidence: ElementEvidence = {
      tagName: 'span',
      role: 'button',
      accessibleName: 'Apply',
      text: 'Apply now',
      testIds: {},
      cssCandidates: ['button.apply > span'],
    };

    const candidates = scoring.rankCandidates(evidence);
    expect(candidates[0].strategy).toBe('role-name');
    expect(candidates[0].expression).toBe('role=button[name="Apply"]');
  });
});
