import type React from 'react';
import type { ReportLanguage, ReportStrategy as ReportStrategyType } from '../../types/analysis';
import { Card } from '../common';
import { DashboardPanelHeader } from '../dashboard';
import { getReportText, normalizeReportLanguage } from '../../utils/reportLanguage';

interface ReportStrategyProps {
  strategy?: ReportStrategyType;
  language?: ReportLanguage;
}

interface StrategyItemProps {
  label: string;
  value?: string;
}

const StrategyItem: React.FC<StrategyItemProps> = ({
  label,
  value,
}) => (
  <div className="relative rounded-lg border bg-card p-3">
    <div className="flex flex-col">
      <span className="mb-0.5 text-xs text-muted-foreground">{label}</span>
      <span className="text-foreground text-lg font-bold font-mono" style={!value ? { color: 'var(--muted-foreground)' } : undefined}>
        {value || '—'}
      </span>
    </div>
  </div>
);

/**
 * 策略点位区组件 - 终端风格
 */
export const ReportStrategy: React.FC<ReportStrategyProps> = ({ strategy, language = 'zh' }) => {
  if (!strategy) {
    return null;
  }

  const reportLanguage = normalizeReportLanguage(language);
  const text = getReportText(reportLanguage);

  const strategyItems = [
    {
      label: text.idealBuy,
      value: strategy.idealBuy,
    },
    {
      label: text.secondaryBuy,
      value: strategy.secondaryBuy,
    },
    {
      label: text.stopLoss,
      value: strategy.stopLoss,
    },
    {
      label: text.takeProfit,
      value: strategy.takeProfit,
    },
  ];

  return (
    <Card padding="md">
      <DashboardPanelHeader
        eyebrow={text.strategyPoints}
        title={text.sniperLevels}
        className="mb-3"
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {strategyItems.map((item) => (
          <StrategyItem key={item.label} {...item} />
        ))}
      </div>
    </Card>
  );
};
