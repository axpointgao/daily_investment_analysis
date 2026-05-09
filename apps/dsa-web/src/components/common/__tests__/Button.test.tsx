import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '../Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);

    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('uses button type by default and exposes the selected variant', () => {
    render(<Button variant="danger">Delete</Button>);

    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('data-variant', 'destructive');
    expect(button).toHaveClass('bg-destructive/10');
  });

  it('disables the button when loading and shows loading text', () => {
    render(<Button isLoading loadingText="Saving">Save</Button>);

    const button = screen.getByRole('button', { name: /saving/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Saving')).toBeInTheDocument();
  });

  it('maps danger to the shadcn destructive variant', () => {
    render(<Button variant="danger">Bulk Delete</Button>);

    const button = screen.getByRole('button', { name: 'Bulk Delete' });
    expect(button).toHaveAttribute('data-variant', 'destructive');
    expect(button).toHaveClass('text-destructive');
  });

  it.each([
    ['primary', 'default'],
    ['outline', 'outline'],
    ['link', 'link'],
  ] as const)('maps the common %s variant to the shadcn %s variant', (variant, expectedVariant) => {
    render(<Button variant={variant}>Quick Action</Button>);

    const button = screen.getByRole('button', { name: 'Quick Action' });
    expect(button).toHaveAttribute('data-variant', expectedVariant);
  });
});
