import type { ElementEvidence } from '@trace2code/protocol';

export type LocatorStrategy =
  | 'test-id'
  | 'role-name'
  | 'label'
  | 'placeholder'
  | 'text'
  | 'css'
  | 'xpath'
  | 'coordinates';

export interface ScoredLocator {
  strategy: LocatorStrategy;
  score: number;
  expression: string;
  playwrightCode: string;
  containerScope?: string;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
}

export class LocatorScoringSystem {
  /**
   * Evaluates and ranks locator candidates for a target element according to the evidence preference hierarchy.
   */
  rankCandidates(evidence?: ElementEvidence): ScoredLocator[] {
    if (!evidence) {
      return [];
    }

    const candidates: ScoredLocator[] = [];
    const container = this.resolveContainerScope(evidence);

    // 1. Explicit Test ID (Score: 100)
    if (evidence.testIds) {
      for (const [attr, val] of Object.entries(evidence.testIds)) {
        if (val) {
          const code = `page.getByTestId(${JSON.stringify(val)})`;
          candidates.push({
            strategy: 'test-id',
            score: 100,
            expression: `[${attr}="${val}"]`,
            playwrightCode: code,
            confidence: 'high',
            rationale: `Explicit test identifier attribute '${attr}'`,
          });
        }
      }
    }

    // 2. Role + Accessible Name (Score: 90)
    if (evidence.role && evidence.accessibleName) {
      const scopePrefix = container ? `page.locator(${JSON.stringify(container)}).` : 'page.';
      const code = `${scopePrefix}getByRole(${JSON.stringify(evidence.role)}, { name: ${JSON.stringify(evidence.accessibleName)}, exact: true })`;
      candidates.push({
        strategy: 'role-name',
        score: container ? 92 : 90,
        expression: `role=${evidence.role}[name="${evidence.accessibleName}"]`,
        playwrightCode: code,
        containerScope: container,
        confidence: 'high',
        rationale: container
          ? `Container-scoped accessible role and name disambiguating from duplicates`
          : `Standard ARIA accessibility role '${evidence.role}' and accessible name '${evidence.accessibleName}'`,
      });
    }

    // 3. Label Association (Score: 85)
    if (evidence.accessibleName && (evidence.tagName === 'input' || evidence.tagName === 'textarea' || evidence.tagName === 'select')) {
      const scopePrefix = container ? `page.locator(${JSON.stringify(container)}).` : 'page.';
      const code = `${scopePrefix}getByLabel(${JSON.stringify(evidence.accessibleName)}, { exact: true })`;
      candidates.push({
        strategy: 'label',
        score: container ? 88 : 85,
        expression: `label="${evidence.accessibleName}"`,
        playwrightCode: code,
        containerScope: container,
        confidence: 'high',
        rationale: container
          ? `Container-scoped form label association`
          : `Associated form label '${evidence.accessibleName}'`,
      });
    }

    // 4. Stable Semantic Attributes (name, id without random digits) (Score: 75-80)
    if (evidence.id && !this.isDynamicIdentifier(evidence.id)) {
      candidates.push({
        strategy: 'css',
        score: 80,
        expression: `#${evidence.id}`,
        playwrightCode: `page.locator('#${evidence.id}')`,
        confidence: 'medium',
        rationale: `Stable unique element id '#${evidence.id}'`,
      });
    }

    if (evidence.name) {
      const scopePrefix = container ? `page.locator(${JSON.stringify(container)}).` : 'page.';
      candidates.push({
        strategy: 'css',
        score: 75,
        expression: `${evidence.tagName}[name="${evidence.name}"]`,
        playwrightCode: `${scopePrefix}locator('${evidence.tagName}[name="${evidence.name}"]')`,
        containerScope: container,
        confidence: 'medium',
        rationale: `Form element name attribute '${evidence.name}'`,
      });
    }

    // 5. Visible Text (Score: 70)
    if (evidence.text && evidence.text.length > 0 && evidence.text.length < 50) {
      const scopePrefix = container ? `page.locator(${JSON.stringify(container)}).` : 'page.';
      candidates.push({
        strategy: 'text',
        score: 70,
        expression: `text="${evidence.text}"`,
        playwrightCode: `${scopePrefix}getByText(${JSON.stringify(evidence.text)}, { exact: true })`,
        containerScope: container,
        confidence: 'medium',
        rationale: `Exact visible inner text '${evidence.text}'`,
      });
    }

    // 6. Structural CSS Candidates (Score: 60)
    if (evidence.cssCandidates && evidence.cssCandidates.length > 0) {
      for (const sel of evidence.cssCandidates) {
        if (!candidates.some((c) => c.expression === sel)) {
          candidates.push({
            strategy: 'css',
            score: 60,
            expression: sel,
            playwrightCode: `page.locator(${JSON.stringify(sel)})`,
            confidence: 'medium',
            rationale: `Inferred structural CSS selector candidate '${sel}'`,
          });
        }
      }
    }

    // 7. XPath (Score: 40)
    if (evidence.xpathCandidate) {
      candidates.push({
        strategy: 'xpath',
        score: 40,
        expression: evidence.xpathCandidate,
        playwrightCode: `page.locator('xpath=' + ${JSON.stringify(evidence.xpathCandidate)})`,
        confidence: 'low',
        rationale: `Structural DOM hierarchy XPath fallback`,
      });
    }

    // 8. Coordinates (Last resort: Score 10)
    if (evidence.rect) {
      const centerX = Math.round(evidence.rect.x + evidence.rect.width / 2);
      const centerY = Math.round(evidence.rect.y + evidence.rect.height / 2);
      candidates.push({
        strategy: 'coordinates',
        score: 10,
        expression: `(${centerX}, ${centerY})`,
        playwrightCode: `page.mouse.click(${centerX}, ${centerY})`,
        confidence: 'low',
        rationale: `Positional screen coordinates center (${centerX}, ${centerY}) as emergency fallback`,
      });
    }

    // Sort descending by score
    return candidates.sort((a, b) => b.score - a.score);
  }

  /**
   * Detects container scope from ancestor summary to disambiguate duplicate labels/roles.
   * E.g. '#shipping-address-group' or '#billing-address-group'.
   */
  private resolveContainerScope(evidence: ElementEvidence): string | undefined {
    if (!evidence.ancestorSummary) return undefined;

    for (const anc of evidence.ancestorSummary) {
      if (anc.includes('#')) {
        const idMatch = anc.match(/#([a-zA-Z0-9_-]+)/);
        if (idMatch && !this.isDynamicIdentifier(idMatch[1])) {
          return `#${idMatch[1]}`;
        }
      }
    }
    return undefined;
  }

  /**
   * Checks if an ID appears randomly generated or dynamic (e.g. contains hashes or uuid segments).
   */
  private isDynamicIdentifier(id: string): boolean {
    // E.g. :r1:, input-172788480, btn_abc1234, etc.
    return (
      /^:[a-z0-9]+:$/i.test(id) ||
      /\d{6,}/.test(id) ||
      /^[a-f0-9]{8}-[a-f0-9]{4}/.test(id) ||
      /dynamic-item-\d+/.test(id)
    );
  }
}
