import React from 'react';
import type { AnalysisResult, AnalysisReport } from '../../types/analysis';
import { ReportOverview } from './ReportOverview';
import { ReportStrategy } from './ReportStrategy';
import { ReportNews } from './ReportNews';
import { ReportDetails } from './ReportDetails';
import { FundReportSummary } from './FundReportSummary';
import { getReportText, normalizeReportLanguage } from '../../utils/reportLanguage';

interface ReportSummaryProps {
  data: AnalysisResult | AnalysisReport;
  isHistory?: boolean;
}

const hiddenModelNames = new Set(['unknown', 'error', 'none', 'null', 'n/a']);

const resolveReport = (data: AnalysisResult | AnalysisReport): AnalysisReport => (
  'report' in data ? data.report : data
);

export const ReportSummary: React.FC<ReportSummaryProps> = ({
  data,
  isHistory = false,
}) => {
  const report = resolveReport(data);
  if (report.meta.assetType === 'fund') {
    return <FundReportSummary report={report} />;
  }

  const recordId = report.meta.id;

  const { meta, summary, strategy, details } = report;
  const reportLanguage = normalizeReportLanguage(meta.reportLanguage);
  const text = getReportText(reportLanguage);
  const modelUsed = (meta.modelUsed || '').trim();
  const shouldShowModel = Boolean(
    modelUsed && !hiddenModelNames.has(modelUsed.toLowerCase()),
  );

  return (
    <div className="space-y-5 pb-8 animate-fade-in">
      <ReportOverview
        meta={meta}
        summary={summary}
        details={details}
        isHistory={isHistory}
      />

      <ReportStrategy strategy={strategy} language={reportLanguage} />

      <ReportNews recordId={recordId} limit={8} language={reportLanguage} />

      <ReportDetails details={details} recordId={recordId} language={reportLanguage} />

      {shouldShowModel && (
        <p className="px-1 text-xs text-muted-foreground">
          {text.analysisModel}: {modelUsed}
        </p>
      )}
    </div>
  );
};
