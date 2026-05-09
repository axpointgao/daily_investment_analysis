import type React from 'react';
import type {
  ReportDetails as ReportDetailsType,
  ReportMeta,
  ReportSummary as ReportSummaryType,
} from '../../types/analysis';
import { Badge, Card, ScoreGauge } from '../common';
import { formatDateTime } from '../../utils/format';
import { getReportText, normalizeReportLanguage } from '../../utils/reportLanguage';

interface ReportOverviewProps {
  meta: ReportMeta;
  summary: ReportSummaryType;
  details?: ReportDetailsType;
  isHistory?: boolean;
}

type BoardStatus = 'leading' | 'lagging';

type BoardSignal = {
  status: BoardStatus;
  changePct?: number;
};

const normalizeBoardName = (value?: string): string =>
  (value || '').trim().replace(/\s+/g, ' ');

const coerceFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/%$/, '');
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const buildBoardSignalMap = (details?: ReportDetailsType): Map<string, BoardSignal> => {
  const signalMap = new Map<string, BoardSignal>();
  const topBoards = Array.isArray(details?.sectorRankings?.top) ? details.sectorRankings.top : [];
  const bottomBoards = Array.isArray(details?.sectorRankings?.bottom) ? details.sectorRankings.bottom : [];

  topBoards.forEach((item) => {
    const normalizedName = normalizeBoardName(item?.name);
    if (!normalizedName) {
      return;
    }
    signalMap.set(normalizedName, {
      status: 'leading',
      changePct: coerceFiniteNumber(item.changePct),
    });
  });

  bottomBoards.forEach((item) => {
    const normalizedName = normalizeBoardName(item?.name);
    if (!normalizedName) {
      return;
    }
    signalMap.set(normalizedName, {
      status: 'lagging',
      changePct: coerceFiniteNumber(item.changePct),
    });
  });

  return signalMap;
};

const getPriceChangeStyle = (changePct: number | undefined): React.CSSProperties | undefined => {
  if (changePct === undefined || changePct === null) {
    return undefined;
  }

  if (changePct > 0) {
    return { color: 'var(--foreground)' };
  }

  if (changePct < 0) {
    return { color: 'var(--destructive)' };
  }

  return undefined;
};

const formatChangePct = (changePct: number | undefined): string => {
  if (changePct === undefined || changePct === null) {
    return '--';
  }
  const sign = changePct > 0 ? '+' : '';
  return `${sign}${changePct.toFixed(2)}%`;
};

const getBoardStatusLabel = (status: BoardStatus, text: ReturnType<typeof getReportText>): string => {
  if (status === 'leading') {
    return text.leadingBoard;
  }
  return text.laggingBoard;
};

const getBoardStatusVariant = (status: BoardStatus): 'success' | 'danger' => {
  if (status === 'leading') {
    return 'success';
  }
  return 'danger';
};

export const ReportOverview: React.FC<ReportOverviewProps> = ({
  meta,
  summary,
  details,
}) => {
  const reportLanguage = normalizeReportLanguage(meta.reportLanguage);
  const text = getReportText(reportLanguage);
  const relatedBoards = (Array.isArray(details?.belongBoards) ? details.belongBoards : [])
    .filter((board) => normalizeBoardName(board?.name).length > 0)
    .slice(0, 3);
  const boardSignals = buildBoardSignalMap(details);

  return (
    <div className="space-y-5">
      {/* 主信息区 - 两列布局，items-stretch 确保右侧与左侧同高 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
        {/* 左侧：股票信息与结论 */}
        <div className="lg:col-span-2 space-y-5">
          {/* 股票头部 */}
          <Card padding="md">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-[28px] font-bold leading-tight text-foreground">
                    {meta.stockName || meta.stockCode}
                  </h2>
                  <Badge variant="info" className="shadow-none">股票</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs px-2 py-0.5 font-mono text-xs">
                    {meta.stockCode}
                  </span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    {formatDateTime(meta.createdAt)}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">收盘价</p>
                <p className="mt-1 text-xl font-bold font-mono text-foreground" style={getPriceChangeStyle(meta.changePct)}>
                  {meta.currentPrice != null ? meta.currentPrice.toFixed(2) : '--'}
                </p>
                <p className="text-xs font-mono" style={getPriceChangeStyle(meta.changePct)}>
                  {formatChangePct(meta.changePct)}
                </p>
              </div>
            </div>

            {/* 关键结论 */}
            <div className="border-border border-t pt-5">
              <span className="text-xs font-medium uppercase text-muted-foreground">{text.keyInsights}</span>
              <p className="mt-2 w-full whitespace-pre-wrap text-left text-[15px] leading-7 text-foreground">
                {summary.analysisSummary || text.noAnalysisSummary}
              </p>
            </div>
          </Card>

          {/* 操作建议和趋势预测 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 操作建议 */}
            <Card padding="sm">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border bg-muted">
                  <svg className="h-4 w-4 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                </div>
                <div className="space-y-1.5">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground">{text.actionAdvice}</h4>
                  <p className="text-sm leading-6">
                    {summary.operationAdvice || text.noAdvice}
                  </p>
                </div>
              </div>
            </Card>

            {/* 趋势预测 */}
            <Card padding="sm">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border bg-muted">
                  <svg className="h-4 w-4 text-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <div className="space-y-1.5">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground">{text.trendPrediction}</h4>
                  <p className="text-sm leading-6">
                    {summary.trendPrediction || text.noPrediction}
                  </p>
                </div>
              </div>
            </Card>
          </div>

          {relatedBoards.length > 0 && (
            <Card padding="sm" className="text-left">
              <div className="mb-3 flex items-baseline gap-2">
                <span className="text-xs font-medium uppercase text-muted-foreground">{text.boardLinkage}</span>
                <h3 className="mt-0.5 text-base font-semibold text-foreground">{text.relatedBoards}</h3>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {relatedBoards.map((board, index) => {
                  const boardName = normalizeBoardName(board.name);
                  const signal = boardSignals.get(boardName);
                  return (
                    <div
                      key={`${boardName}-${board.code || index}`}
                      className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card/40 px-2.5 py-1.5 text-sm"
                    >
                      <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs px-2 py-0.5 text-xs font-medium">
                        {boardName}
                      </span>
                      {board.type && (
                        <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                          {board.type}
                        </span>
                      )}
                      {signal && (
                        <Badge
                          variant={getBoardStatusVariant(signal.status)}
                          className="shadow-none"
                        >
                          {getBoardStatusLabel(signal.status, text)}
                        </Badge>
                      )}
                      {signal && signal.changePct !== undefined && signal.changePct !== null && (
                        <span
                          className="text-xs font-mono"
                          style={getPriceChangeStyle(signal.changePct)}
                        >
                          {formatChangePct(signal.changePct)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>

        {/* 右侧：情绪指标 - 填满格子高度，消除与 STRATEGY POINTS 之间的空隙 */}
        <div className="flex flex-col self-stretch min-h-full">
          <Card padding="md" className="!overflow-visible flex-1 flex flex-col min-h-0">
            <div className="text-center flex-1 flex flex-col justify-center">
              <h3 className="mb-5 text-sm font-medium tracking-wide text-foreground">{text.marketSentiment}</h3>
              <ScoreGauge score={summary.sentimentScore ?? 50} size="lg" language={reportLanguage} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
