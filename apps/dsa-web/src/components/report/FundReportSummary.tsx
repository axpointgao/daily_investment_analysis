import type React from 'react';
import type { AnalysisReport, FundPerformanceItem } from '../../types/analysis';
import { Badge, Card, ScoreGauge } from '../common';
import { formatDateTime } from '../../utils/format';

interface FundReportSummaryProps {
  report: AnalysisReport;
}

const formatPercent = (value?: number): string => {
  if (value === undefined || value === null || !Number.isFinite(value)) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

const formatValue = (value: unknown): string => {
  if (value === undefined || value === null || value === '') return '--';
  return String(value);
};

const valueColor = (value?: number): React.CSSProperties | undefined => {
  if (value === undefined || value === null) return undefined;
  if (value > 0) return { color: 'var(--home-price-up)' };
  if (value < 0) return { color: 'var(--home-price-down)' };
  return undefined;
};

const MetricCard: React.FC<{ label: string; value: string; muted?: string; tone?: React.CSSProperties }> = ({
  label,
  value,
  muted,
  tone,
}) => (
  <Card variant="bordered" padding="sm" className="home-panel-card">
    <span className="label-uppercase">{label}</span>
    <p className="mt-2 text-xl font-semibold text-foreground font-mono" style={tone}>
      {value}
    </p>
    {muted ? <p className="mt-1 text-xs text-muted-text">{muted}</p> : null}
  </Card>
);

const SectionList: React.FC<{ title: string; items?: string[] }> = ({ title, items = [] }) => {
  if (!items.length) return null;
  return (
    <Card variant="bordered" padding="sm" className="home-panel-card">
      <span className="label-uppercase">{title}</span>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-secondary-text">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan/70" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
};

const PerformanceTable: React.FC<{ items?: FundPerformanceItem[] }> = ({ items = [] }) => {
  const rows = items.filter((item) => item.period).slice(0, 8);
  if (!rows.length) return null;
  return (
    <Card variant="bordered" padding="sm" className="home-panel-card overflow-hidden">
      <span className="label-uppercase">阶段收益</span>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="text-muted-text">
            <tr className="border-b border-subtle">
              <th className="py-2 pr-4 font-medium">区间</th>
              <th className="py-2 pr-4 font-medium">收益</th>
              <th className="py-2 pr-4 font-medium">同类均值</th>
              <th className="py-2 pr-4 font-medium">沪深300</th>
              <th className="py-2 font-medium">排名</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item, index) => (
              <tr key={`${item.period}-${index}`} className="border-b border-subtle/60 last:border-0">
                <td className="py-2 pr-4 text-foreground">{item.period}</td>
                <td className="py-2 pr-4 font-mono" style={valueColor(item.returnPct)}>
                  {formatPercent(item.returnPct)}
                </td>
                <td className="py-2 pr-4 font-mono">{formatPercent(item.peerAvgPct)}</td>
                <td className="py-2 pr-4 font-mono">{formatPercent(item.hs300Pct)}</td>
                <td className="py-2 font-mono">
                  {item.rank && item.peerCount ? `${item.rank}/${item.peerCount}` : '--'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

export const FundReportSummary: React.FC<FundReportSummaryProps> = ({ report }) => {
  const { meta, summary, metrics, details } = report;
  const risk = metrics?.risk || {};
  const profile = metrics?.profile || {};
  const managers = Array.isArray(metrics?.manager) ? metrics.manager : [];
  const managerNames = managers
    .map((item) => formatValue(item.managerNames))
    .filter((item) => item !== '--')
    .slice(0, 3)
    .join(' / ');

  return (
    <div className="space-y-5 pb-8 animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
        <div className="lg:col-span-2 space-y-5">
          <Card variant="gradient" padding="md" className="home-report-hero">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-[28px] font-bold leading-tight text-foreground">
                    {meta.fundName || meta.fundCode}
                  </h2>
                  <Badge variant="info" className="shadow-none">场外基金</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <span className="home-accent-chip px-2 py-0.5 font-mono text-xs">
                    {meta.fundCode}
                  </span>
                  {meta.fundType ? (
                    <span className="home-board-pill rounded-full px-2 py-0.5 text-xs">
                      {meta.fundType}
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-text">{formatDateTime(meta.createdAt)}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-text">最新净值</p>
                <p className="mt-1 text-xl font-bold font-mono text-foreground">
                  {meta.latestNav !== undefined ? meta.latestNav.toFixed(4) : '--'}
                </p>
                <p className="text-xs font-mono" style={valueColor(meta.dailyReturnPct)}>
                  {meta.navDate || '--'} {formatPercent(meta.dailyReturnPct)}
                </p>
              </div>
            </div>

            <div className="home-divider border-t pt-5">
              <span className="label-uppercase">关键结论</span>
              <p className="mt-2 max-w-[62ch] whitespace-pre-wrap text-left text-[15px] leading-7 text-foreground">
                {summary.analysisSummary || '暂无分析结论。'}
              </p>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card
              variant="bordered"
              padding="sm"
              hoverable
              className="home-panel-card home-insight-card"
              style={{ ['--home-insight-tone' as string]: 'var(--home-strategy-buy)' }}
            >
              <div className="space-y-1.5">
                <h4 className="home-insight-title text-[11px] font-medium uppercase tracking-[0.16em]">配置建议</h4>
                <p className="home-insight-body text-sm leading-6">
                  {summary.allocationRating || '谨慎观察'}
                </p>
                {summary.holdingAdvice ? (
                  <p className="text-xs leading-5 text-secondary-text">{summary.holdingAdvice}</p>
                ) : null}
              </div>
            </Card>
            <Card
              variant="bordered"
              padding="sm"
              hoverable
              className="home-panel-card home-insight-card"
              style={{ ['--home-insight-tone' as string]: 'var(--home-strategy-stop)' }}
            >
              <div className="space-y-1.5">
                <h4 className="home-insight-title text-[11px] font-medium uppercase tracking-[0.16em]">风险说明</h4>
                <p className="home-insight-body text-sm leading-6">
                  {summary.riskSummary || '暂无风险摘要。'}
                </p>
              </div>
            </Card>
          </div>
        </div>

        <Card variant="bordered" padding="md" className="home-panel-card flex flex-col items-center justify-center">
          <span className="label-uppercase mb-3 text-secondary-text">适配评分</span>
          <ScoreGauge score={summary.suitabilityScore ?? 50} size="lg" showLabel={false} />
          {summary.suitableFor ? (
            <p className="mt-4 text-center text-sm leading-6 text-secondary-text">{summary.suitableFor}</p>
          ) : null}
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="累计收益" value={formatPercent(risk.totalReturnPct)} tone={valueColor(risk.totalReturnPct)} />
        <MetricCard label="年化收益" value={formatPercent(risk.annualReturnPct)} tone={valueColor(risk.annualReturnPct)} />
        <MetricCard label="最大回撤" value={formatPercent(risk.maxDrawdownPct)} tone={valueColor(risk.maxDrawdownPct)} />
        <MetricCard label="年化波动" value={formatPercent(risk.annualVolatilityPct)} muted={`${risk.sampleCount || 0} 条净值样本`} />
      </div>

      {risk.reason ? (
        <Card variant="bordered" padding="sm" className="home-panel-card border-warning/30 bg-warning/5 text-sm text-warning">
          {risk.reason}
        </Card>
      ) : null}

      <PerformanceTable items={metrics?.performance} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card variant="bordered" padding="sm" className="home-panel-card">
          <span className="label-uppercase">基金资料</span>
          <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
            <p><span className="text-muted-text">基金公司：</span>{formatValue(profile.fundCompany)}</p>
            <p><span className="text-muted-text">基金经理：</span>{managerNames || formatValue(profile.managerNames)}</p>
            <p><span className="text-muted-text">成立日期：</span>{formatValue(profile.establishDate)}</p>
            <p><span className="text-muted-text">基金规模：</span>{formatValue(profile.latestScale)}</p>
            <p><span className="text-muted-text">业绩基准：</span>{formatValue(profile.benchmark)}</p>
          </div>
        </Card>
        <Card variant="bordered" padding="sm" className="home-panel-card">
          <span className="label-uppercase">风险收益</span>
          <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
            <p><span className="text-muted-text">区间：</span>{formatValue(risk.startDate)} 至 {formatValue(risk.endDate)}</p>
            <p><span className="text-muted-text">当前回撤：</span>{formatPercent(risk.currentDrawdownPct)}</p>
            <p><span className="text-muted-text">Sharpe：</span>{formatValue(risk.sharpe)}</p>
            <p><span className="text-muted-text">Calmar：</span>{formatValue(risk.calmar)}</p>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SectionList title="优势" items={details?.advantages} />
        <SectionList title="风险" items={details?.risks} />
        <SectionList title="观察项" items={details?.watchItems} />
      </div>
    </div>
  );
};

export default FundReportSummary;
