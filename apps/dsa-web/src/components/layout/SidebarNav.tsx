import React, { useState } from 'react';
import { BarChart3, BriefcaseBusiness, FileSearch, Home, LogOut, MessageSquareQuote, SearchCheck, Settings2 } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useAgentChatStore } from '../../stores/agentChatStore';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { StatusDot } from '../common/StatusDot';
import { Button } from '@/components/ui/button';

type SidebarNavProps = {
  collapsed?: boolean;
  onNavigate?: () => void;
};

type NavItem = {
  key: string;
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  badge?: 'stock-completion' | 'fund-completion';
};

const NAV_ITEMS: NavItem[] = [
  { key: 'home', label: '首页', to: '/', icon: Home, exact: true },
  { key: 'chat', label: '问股', to: '/chat', icon: MessageSquareQuote, badge: 'stock-completion' },
  { key: 'screener', label: '选股', to: '/screener', icon: SearchCheck },
  { key: 'fund-chat', label: '诊基', to: '/fund-chat', icon: FileSearch, badge: 'fund-completion' },
  { key: 'portfolio', label: '持仓', to: '/portfolio', icon: BriefcaseBusiness },
  { key: 'backtest', label: '回测', to: '/backtest', icon: BarChart3 },
  { key: 'settings', label: '设置', to: '/settings', icon: Settings2 },
];

const LOGO_SRC = '/dsa-logo.svg';

export const SidebarNav: React.FC<SidebarNavProps> = ({ collapsed = false, onNavigate }) => {
  const { authEnabled, logout } = useAuth();
  const stockCompletionBadge = useAgentChatStore((state) => state.stockCompletionBadge);
  const fundCompletionBadge = useAgentChatStore((state) => state.fundCompletionBadge);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className={cn('mb-4 flex items-center gap-2 px-1', collapsed ? 'justify-center' : '')}>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border bg-background">
          <img src={LOGO_SRC} alt="" className="h-7 w-7" aria-hidden="true" />
        </div>
        {!collapsed ? (
          <p className="min-w-0 truncate text-sm font-semibold text-foreground">DSA</p>
        ) : null}
      </div>

      <nav className="flex flex-1 flex-col gap-1.5" aria-label="主导航">
        {NAV_ITEMS.map(({ key, label, to, icon: Icon, exact, badge }) => (
          <NavLink
            key={key}
            to={to}
            end={exact}
            onClick={onNavigate}
            aria-label={label}
            className={({ isActive }) =>
              cn(
                'group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors',
                collapsed ? 'justify-center px-0' : '',
                isActive
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={cn('h-5 w-5 shrink-0', isActive ? 'text-foreground' : 'text-current')} />
                {!collapsed ? <span className="truncate">{label}</span> : null}
                {((badge === 'stock-completion' && stockCompletionBadge) ||
                  (badge === 'fund-completion' && fundCompletionBadge)) ? (
                  <StatusDot
                    tone="info"
                    data-testid={badge === 'fund-completion' ? 'fund-chat-completion-badge' : 'chat-completion-badge'}
                    className={cn(
                      'absolute right-3 border-2 border-background',
                      collapsed ? 'right-2 top-2' : ''
                    )}
                    aria-label={badge === 'fund-completion' ? '诊基有新消息' : '问股有新消息'}
                  />
                ) : null}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {authEnabled ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => setShowLogoutConfirm(true)}
          className={cn(
            'mt-5 w-full justify-start gap-3 text-muted-foreground',
            collapsed ? 'justify-center px-2' : ''
          )}
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {!collapsed ? <span>退出</span> : null}
        </Button>
      ) : null}

      <ConfirmDialog
        isOpen={showLogoutConfirm}
        title="退出登录"
        message="确认退出当前登录状态吗？退出后需要重新输入密码。"
        confirmText="确认退出"
        cancelText="取消"
        isDanger
        onConfirm={() => {
          setShowLogoutConfirm(false);
          onNavigate?.();
          void logout();
        }}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </div>
  );
};
