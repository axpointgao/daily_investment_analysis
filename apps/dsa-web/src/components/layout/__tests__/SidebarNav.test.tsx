import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SidebarNav } from '../SidebarNav';

const mockLogout = vi.fn().mockResolvedValue(undefined);
const mockThemeToggle = vi.fn((props?: { collapsed?: boolean }) => {
  void props;
  return null;
});

const completionBadgeState = { stock: true, fund: false };

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    authEnabled: true,
    logout: mockLogout,
  }),
}));

vi.mock('../../../stores/agentChatStore', () => ({
  useAgentChatStore: (selector: (state: { stockCompletionBadge: boolean; fundCompletionBadge: boolean }) => unknown) =>
    selector({
      stockCompletionBadge: completionBadgeState.stock,
      fundCompletionBadge: completionBadgeState.fund,
    }),
}));

vi.mock('../../theme/ThemeToggle', () => ({
  ThemeToggle: (props: { collapsed?: boolean }) => mockThemeToggle(props),
}));

describe('SidebarNav', () => {
  it('shows the shared completion badge only when chat completion is pending', () => {
    completionBadgeState.stock = true;
    completionBadgeState.fund = false;

    const { rerender } = render(
      <MemoryRouter initialEntries={['/chat']}>
        <SidebarNav />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('chat-completion-badge')).toBeInTheDocument();
    expect(screen.getByLabelText('问股有新消息')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '诊基' })).toBeInTheDocument();
    expect(screen.queryByTestId('fund-chat-completion-badge')).not.toBeInTheDocument();

    completionBadgeState.stock = false;
    completionBadgeState.fund = true;
    rerender(
      <MemoryRouter initialEntries={['/chat']}>
        <SidebarNav />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('chat-completion-badge')).not.toBeInTheDocument();
    expect(screen.getByTestId('fund-chat-completion-badge')).toBeInTheDocument();
    expect(screen.getByLabelText('诊基有新消息')).toBeInTheDocument();
  });

  it('does not render a theme toggle in fixed light mode', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <SidebarNav collapsed />
      </MemoryRouter>,
    );

    expect(mockThemeToggle).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /切换主题/ })).not.toBeInTheDocument();
  });

  it('opens the logout confirmation and confirms logout', async () => {
    render(
      <MemoryRouter initialEntries={['/chat']}>
        <SidebarNav />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '退出' }));

    expect(await screen.findByRole('heading', { name: '退出登录' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认退出' }));
    expect(mockLogout).toHaveBeenCalled();
  });
});
