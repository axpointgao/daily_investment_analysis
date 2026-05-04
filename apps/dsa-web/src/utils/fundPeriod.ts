const FUND_PERIOD_LABELS: Record<string, string> = {
  Z: '近1周',
  Y: '近1月',
  '3Y': '近3月',
  '6Y': '近6月',
  '1N': '近1年',
  '2N': '近2年',
  '3N': '近3年',
  '5N': '近5年',
};

export function formatFundPeriodLabel(period?: string): string {
  const normalized = period?.trim() ?? '';
  return FUND_PERIOD_LABELS[normalized] || normalized || '--';
}
