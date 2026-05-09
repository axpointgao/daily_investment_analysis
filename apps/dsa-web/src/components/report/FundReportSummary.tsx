import type React from 'react';
import { CircleHelp } from 'lucide-react';
import type { AnalysisReport, FundPerformanceItem } from '../../types/analysis';
import { Badge, Card, ScoreGauge, Tooltip } from '../common';
import { formatDateTime } from '../../utils/format';
import { formatFundPeriodLabel } from '../../utils/fundPeriod';

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
  if (value > 0) return { color: 'var(--foreground)' };
  if (value < 0) return { color: 'var(--destructive)' };
  return undefined;
};

const formatRiskRange = (startDate?: string, endDate?: string): string => {
  if (!startDate && !endDate) return '统计区间暂无数据';
  if (!startDate) return `统计区间：-- 至 ${endDate}`;
  if (!endDate) return `统计区间：${startDate} 至 --`;
  return `统计区间：${startDate} 至 ${endDate}`;
};

const ANNUAL_RETURN_TIP = '按当前区间折算的一年收益率，用于横向比较；短期数据可能失真。';
const MAX_DRAWDOWN_TIP = '衡量基金抗跌能力。越接近 0，下跌控制越好；越负，极端下跌风险越高。参考：债券型 0%~-5%较低，混合型 -10%~-20%常见，股票型/指数型低于 -30%需关注。';
const ANNUAL_VOLATILITY_TIP = '衡量基金上下波动的剧烈程度。数值越高，涨跌越不稳定；数值越低，走势越平稳。参考：5%以内较平稳，10%-20%中等，超过25%波动较高。';

const MetricHelp: React.FC<{ content: string }> = ({ content }) => (
  <Tooltip content={content}>
    <span
      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      role="button"
      tabIndex={0}
      aria-label="指标说明"
    >
      <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  </Tooltip>
);

const MetricCard: React.FC<{ label: string; value: string; muted?: string; tone?: React.CSSProperties; tooltip?: string }> = ({
  label,
  value,
  muted,
  tone,
  tooltip,
}) => (
  <Card padding="sm">
    <span className="text-xs font-medium uppercase text-muted-foreground inline-flex items-center gap-1.5">
      {label}
      {tooltip ? <MetricHelp content={tooltip} /> : null}
    </span>
    <p className="mt-2 text-xl font-semibold text-foreground font-mono" style={tone}>
      {value}
    </p>
    {muted ? <p className="mt-1 text-xs text-muted-foreground">{muted}</p> : null}
  </Card>
);

const SectionList: React.FC<{ title: string; items?: string[] }> = ({ title, items = [] }) => {
  if (!items.length) return null;
  return (
    <Card padding="sm">
      <span className="text-xs font-medium uppercase text-muted-foreground">{title}</span>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
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
    <Card padding="sm" className="overflow-hidden">
      <span className="text-xs font-medium uppercase text-muted-foreground">阶段收益</span>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-2 pr-4 font-medium">区间</th>
              <th className="py-2 pr-4 font-medium">收益</th>
              <th className="py-2 pr-4 font-medium">同类均值</th>
              <th className="py-2 pr-4 font-medium">沪深300</th>
              <th className="py-2 font-medium">排名</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item, index) => (
              <tr key={`${item.period}-${index}`} className="border-b border-border/60 last:border-0">
                <td className="py-2 pr-4 text-foreground">{formatFundPeriodLabel(item.period)}</td>
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
  const riskRangeTip = formatRiskRange(risk.startDate, risk.endDate);
  const managerNames = managers
    .map((item) => formatValue(item.managerNames))
    .filter((item) => item !== '--')
    .slice(0, 3)
    .join(' / ');

  return (
    <div className="space-y-5 pb-8 animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
        <div className="lg:col-span-2 space-y-5">
          <Card padding="md">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-[28px] font-bold leading-tight text-foreground">
                    {meta.fundName || meta.fundCode}
                  </h2>
                  <Badge variant="info" className="shadow-none">场外基金</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs px-2 py-0.5 font-mono text-xs">
                    {meta.fundCode}
                  </span>
                  {meta.fundType ? (
                    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                      {meta.fundType}
                    </span>
                  ) : null}
                  <span className="text-xs text-muted-foreground">{formatDateTime(meta.createdAt)}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">最新净值</p>
                <p className="mt-1 text-xl font-bold font-mono text-foreground">
                  {meta.latestNav !== undefined ? meta.latestNav.toFixed(4) : '--'}
                </p>
                <p className="text-xs font-mono" style={valueColor(meta.dailyReturnPct)}>
                  {meta.navDate || '--'} {formatPercent(meta.dailyReturnPct)}
                </p>
              </div>
            </div>

            <div className="border-border border-t pt-5">
              <span className="text-xs font-medium uppercase text-muted-foreground">关键结论</span>
              <p className="mt-2 w-full whitespace-pre-wrap text-left text-[15px] leading-7 text-foreground">
                {summary.analysisSummary || '暂无分析结论。'}
              </p>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card padding="sm">
              <div className="space-y-1.5">
                <h4 className="text-xs font-medium uppercase text-muted-foreground">配置建议</h4>
                <p className="text-sm leading-6">
                  {summary.allocationRating || '谨慎观察'}
                </p>
                {summary.holdingAdvice ? (
                  <p className="text-xs leading-5 text-muted-foreground">{summary.holdingAdvice}</p>
                ) : null}
              </div>
            </Card>
            <Card padding="sm">
              <div className="space-y-1.5">
                <h4 className="text-xs font-medium uppercase text-muted-foreground">风险说明</h4>
                <p className="text-sm leading-6">
                  {summary.riskSummary || '暂无风险摘要。'}
                </p>
              </div>
            </Card>
          </div>
        </div>

        <Card padding="md" className="flex flex-col items-center justify-center">
          <span className="text-xs font-medium uppercase text-muted-foreground mb-3 text-muted-foreground">适配评分</span>
          <ScoreGauge score={summary.suitabilityScore ?? 50} size="lg" showLabel={false} />
          {summary.suitableFor ? (
            <p className="mt-4 text-center text-sm leading-6 text-muted-foreground">{summary.suitableFor}</p>
          ) : null}
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="区间收益" value={formatPercent(risk.totalReturnPct)} tone={valueColor(risk.totalReturnPct)} tooltip={riskRangeTip} />
        <MetricCard label="年化收益" value={formatPercent(risk.annualReturnPct)} tone={valueColor(risk.annualReturnPct)} tooltip={ANNUAL_RETURN_TIP} />
        <MetricCard label="最大回撤" value={formatPercent(risk.maxDrawdownPct)} tone={valueColor(risk.maxDrawdownPct)} tooltip={MAX_DRAWDOWN_TIP} />
        <MetricCard label="年化波动" value={formatPercent(risk.annualVolatilityPct)} muted={`${risk.sampleCount || 0} 条净值样本`} tooltip={ANNUAL_VOLATILITY_TIP} />
      </div>

      {risk.reason ? (
        <Card padding="sm" className="border-amber-500/30 bg-amber-500/5 text-sm text-amber-600">
          {risk.reason}
        </Card>
      ) : null}

      <PerformanceTable items={metrics?.performance} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card padding="sm">
          <span className="text-xs font-medium uppercase text-muted-foreground">基金资料</span>
          <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
            <p><span className="text-muted-foreground">基金公司：</span>{formatValue(profile.fundCompany)}</p>
            <p><span className="text-muted-foreground">基金经理：</span>{managerNames || formatValue(profile.managerNames)}</p>
            <p><span className="text-muted-foreground">成立日期：</span>{formatValue(profile.establishDate)}</p>
            <p><span className="text-muted-foreground">基金规模：</span>{formatValue(profile.latestScale)}</p>
            <p><span className="text-muted-foreground">业绩基准：</span>{formatValue(profile.benchmark)}</p>
          </div>
        </Card>
        <Card padding="sm">
          <span className="text-xs font-medium uppercase text-muted-foreground">风险收益</span>
          <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
            <p><span className="text-muted-foreground">区间：</span>{formatValue(risk.startDate)} 至 {formatValue(risk.endDate)}</p>
            <p><span className="text-muted-foreground">当前回撤：</span>{formatPercent(risk.currentDrawdownPct)}</p>
            <p><span className="text-muted-foreground">Sharpe：</span>{formatValue(risk.sharpe)}</p>
            <p><span className="text-muted-foreground">Calmar：</span>{formatValue(risk.calmar)}</p>
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
