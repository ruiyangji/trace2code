import { createRedactedValue, type RedactedValue } from '@trace2code/protocol';

export interface RedactionEngineConfig {
  redactPasswords?: boolean;
  redactAuthorizationHeaders?: boolean;
  redactCookies?: boolean;
  sensitiveSelectors?: string[];
}

export class RedactionEngine {
  private sensitiveSelectors: string[];
  private redactPasswords: boolean;
  private redactHeadersList: string[];

  constructor(config?: RedactionEngineConfig) {
    this.redactPasswords = config?.redactPasswords ?? true;
    this.sensitiveSelectors = config?.sensitiveSelectors ?? [
      'input[type="password"]',
      'input[name*="password" i]',
      'input[autocomplete*="password" i]',
      'input[name*="cvv" i]',
      'input[name*="card" i]',
      '[data-secret="true"]',
    ];
    this.redactHeadersList = [];
    if (config?.redactAuthorizationHeaders ?? true) {
      this.redactHeadersList.push('authorization', 'proxy-authorization');
    }
    if (config?.redactCookies ?? true) {
      this.redactHeadersList.push('cookie', 'set-cookie');
    }
  }

  isSensitiveElement(elementData: {
    tagName?: string;
    type?: string;
    name?: string;
    id?: string;
    attributes?: Record<string, string>;
  }): boolean {
    if (!this.redactPasswords) return false;

    if (elementData.type?.toLowerCase() === 'password') {
      return true;
    }
    if (elementData.name && /password|passwd|secret|cvv|creditcard/i.test(elementData.name)) {
      return true;
    }
    if (elementData.id && /password|passwd|secret|cvv|creditcard/i.test(elementData.id)) {
      return true;
    }
    if (elementData.attributes?.['data-secret'] === 'true') {
      return true;
    }
    return false;
  }

  redactElementValue(value: unknown, reason = 'password-field'): RedactedValue {
    return createRedactedValue(reason);
  }

  sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {};
    for (const [key, val] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      if (this.redactHeadersList.includes(lowerKey)) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = val;
      }
    }
    return sanitized;
  }
}
