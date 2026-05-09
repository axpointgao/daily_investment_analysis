// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('index.html theme bootstrap', () => {
  it('does not preload the removed dark-theme bootstrap script', () => {
    const indexHtml = readFileSync(resolve(__dirname, '..', 'index.html'), 'utf8');

    expect(indexHtml).not.toContain("const storageKey = 'theme'");
    expect(indexHtml).not.toContain("root.classList.add(theme)");
    expect(indexHtml).toContain('<script type="module" src="/src/main.tsx"></script>');
  });
});
