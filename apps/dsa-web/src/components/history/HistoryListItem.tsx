import type React from 'react';
import type { HistoryItem } from '../../types/analysis';
import { getSentimentColor } from '../../types/analysis';
import { formatDateTime } from '../../utils/format';

interface HistoryListItemProps {
  item: HistoryItem;
  isViewing: boolean;
  isChecked: boolean;
  isDeleting: boolean;
  onToggleChecked: (recordId: number) => void;
  onClick: (recordId: number) => void;
}

const getOperationBadgeLabel = (advice?: string) => {
  const normalized = advice?.trim();
  if (!normalized) {
    return '情绪';
  }
  if (normalized.includes('减仓')) {
    return '减仓';
  }
  if (normalized.includes('卖')) {
    return '卖出';
  }
  if (normalized.includes('观望') || normalized.includes('等待')) {
    return '观望';
  }
  if (normalized.includes('买') || normalized.includes('布局')) {
    return '买入';
  }
  if (normalized.includes('适合配置')) {
    return '适配';
  }
  if (normalized.includes('谨慎观察')) {
    return '观察';
  }
  if (normalized.includes('不建议')) {
    return '不新增';
  }
  if (normalized.includes('可替换')) {
    return '替换';
  }
  const first = normalized.split(/[，。；、\s]/)[0] || '建议';
  return first.length > 4 ? `${first.slice(0, 4)}.` : first;
};

export const HistoryListItem: React.FC<HistoryListItemProps> = ({
  item,
  isViewing,
  isChecked,
  isDeleting,
  onToggleChecked,
  onClick,
}) => {
  const sentimentColor = item.sentimentScore !== undefined ? getSentimentColor(item.sentimentScore) : null;
  const itemType = item.type || 'stock';
  const displayCode = item.displayCode || item.stockCode || item.fundCode || '';
  const displayName = item.displayName || item.stockName || item.fundName || displayCode;
  const badgeLabel = getOperationBadgeLabel(item.operationAdvice);

  return (
    <div className="flex items-start gap-2 group">
      <div className="pt-6">
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => onToggleChecked(item.id)}
          disabled={isDeleting}
          className="h-3.5 w-3.5 cursor-pointer rounded border-subtle-hover bg-transparent accent-primary focus:ring-primary/30 disabled:opacity-50"
        />
      </div>
      <button
        type="button"
        onClick={() => onClick(item.id)}
        title={displayName}
        className={`home-history-item min-w-0 flex-1 text-left p-2.5 group/item ${
          isViewing ? 'home-history-item-selected' : ''
        }`}
      >
        <div className="relative z-10 flex min-w-0 items-stretch gap-2.5">
          {sentimentColor && (
            <div
              className="my-1 w-1 rounded-full flex-shrink-0"
              style={{
                backgroundColor: sentimentColor,
                boxShadow: `0 0 10px ${sentimentColor}40`,
              }}
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex min-w-0 items-start gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold leading-5 text-foreground tracking-tight">
                {displayName}
              </span>
              {sentimentColor && (
                <span
                  className="home-history-sentiment-badge inline-flex max-w-[5.25rem] shrink-0 items-center justify-center truncate rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-4 shadow-none"
                  style={{
                    color: sentimentColor,
                    borderColor: `${sentimentColor}30`,
                    backgroundColor: `${sentimentColor}10`,
                  }}
                >
                  <span className="truncate">{badgeLabel}</span>
                  {item.sentimentScore !== undefined ? (
                    <span className="ml-1 font-mono">{item.sentimentScore}</span>
                  ) : null}
                </span>
              )}
            </div>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-[4.25rem] text-[11px] text-secondary-text font-mono">
                {displayCode}
              </span>
              <span className="home-board-pill inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-[10px] leading-4">
                {itemType === 'fund' ? '基金' : '股票'}
              </span>
            </div>
            <div className="mt-1 text-[11px] leading-4 text-muted-text">
              {formatDateTime(item.createdAt)}
            </div>
          </div>
        </div>
      </button>
    </div>
  );
};
