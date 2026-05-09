import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from '../ThemeProvider';
import { ThemeToggle } from '../ThemeToggle';

describe('ThemeToggle', () => {
  it('renders nothing because the Web UI is fixed to the shadcn light theme', () => {
    const { container } = render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
