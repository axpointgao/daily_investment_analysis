import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AnalysisReport } from '../../../types/analysis';
import { FundReportSummary } from '../FundReportSummary';

describe('FundReportSummary', () => {
  it('renders Tiantian period codes as readable Chinese labels', () => {
    const report: AnalysisReport = {
      meta: {
        id: -1,
        assetType: 'fund',
        queryId: 'fund-1',
        fundCode: '000274',
        fundName: '广发亚太中高收益债(QDII)A',
        reportType: 'detailed',
        createdAt: '2026-05-03T10:00:00',
        latestNav: 1.2038,
        navDate: '2026-04-29',
        dailyReturnPct: 0.35,
      },
      summary: {
        analysisSummary: '谨慎观察',
        allocationRating: '谨慎观察',
        suitabilityScore: 55,
      },
      metrics: {
        performance: [
          { period: 'Z', returnPct: -0.2 },
          { period: 'Y', returnPct: 0.52 },
          { period: '3Y', returnPct: -1.38 },
          { period: '1N', returnPct: 0.43 },
        ],
      },
    };

    render(<FundReportSummary report={report} />);

    expect(screen.getByText('近1周')).toBeInTheDocument();
    expect(screen.getByText('近1月')).toBeInTheDocument();
    expect(screen.getByText('近3月')).toBeInTheDocument();
    expect(screen.getByText('近1年')).toBeInTheDocument();
    expect(screen.queryByText('1N')).not.toBeInTheDocument();
  });

  it('renders beginner-friendly metric labels and tooltip triggers', () => {
    const report: AnalysisReport = {
      meta: {
        id: -1,
        assetType: 'fund',
        queryId: 'fund-2',
        fundCode: '000001',
        fundName: '华夏成长混合',
        reportType: 'detailed',
        createdAt: '2026-05-03T10:00:00',
        latestNav: 1.2038,
        navDate: '2026-04-29',
        dailyReturnPct: 0.35,
      },
      summary: {
        analysisSummary: '适合观察',
        allocationRating: '谨慎观察',
        suitabilityScore: 60,
      },
      metrics: {
        risk: {
          sampleCount: 120,
          startDate: '2024-01-01',
          endDate: '2026-04-30',
          totalReturnPct: 12.34,
          annualReturnPct: 5.67,
          maxDrawdownPct: -18.9,
          annualVolatilityPct: 13.2,
        },
      },
    };

    render(<FundReportSummary report={report} />);

    expect(screen.getByText('区间收益')).toBeInTheDocument();
    expect(screen.queryByText('累计收益')).not.toBeInTheDocument();
    expect(screen.getByText('+12.34%')).toBeInTheDocument();
    expect(screen.getByText('1.2038')).toHaveClass('text-red-600');
    expect(screen.getByText('2026-04-29 +0.35%')).toHaveClass('text-red-600');
    expect(screen.getAllByRole('button', { name: '指标说明' })).toHaveLength(4);
  });
});
