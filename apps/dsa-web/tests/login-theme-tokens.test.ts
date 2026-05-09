// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REQUIRED_SHADCN_TOKENS = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--primary',
  '--primary-foreground',
  '--muted',
  '--muted-foreground',
  '--border',
  '--input',
  '--ring',
  '--radius',
];

describe('shadcn theme tokens', () => {
  it('defines the official shadcn light tokens and no login-specific token layer', () => {
    const css = readFileSync(resolve(__dirname, '..', 'src', 'index.css'), 'utf8');
    const rootMatch = css.match(/:root\s*\{([\s\S]*?)\n\}/);

    expect(rootMatch).not.toBeNull();
    const rootBlock = rootMatch?.[1] ?? '';

    for (const token of REQUIRED_SHADCN_TOKENS) {
      expect(rootBlock).toContain(token);
    }

    expect(css).not.toContain('--login-');
    expect(css).not.toContain('.dark {');
  });
});
