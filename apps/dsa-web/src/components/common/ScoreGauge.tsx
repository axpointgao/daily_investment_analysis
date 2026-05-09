import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import { getSentimentColor, getSentimentLabel, type ReportLanguage } from '../../types/analysis';
import { cn } from '@/lib/utils';
import { normalizeReportLanguage, getReportText } from '../../utils/reportLanguage';

interface ScoreGaugeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
  language?: ReportLanguage;
}

type GaugeVisualStyle = {
  svgFilter?: string;
  glowBlur: number;
  glowOpacity: number;
  glowStrokeExtra: number;
  valueTextShadow?: string;
};

/**
 * Sentiment score gauge with an animated glowing ring.
 * Dynamically calculates colors based on sentiment score.
 */
export const ScoreGauge: React.FC<ScoreGaugeProps> = ({
  score,
  size = 'md',
  showLabel = true,
  className = '',
  language = 'zh',
}) => {
  // Animated score state.
  const [animatedScore, setAnimatedScore] = useState(0);
  const [displayScore, setDisplayScore] = useState(0);
  const animationRef = useRef<number | null>(null);
  const prevScoreRef = useRef(0);

  // Animate transitions between score updates.
  useEffect(() => {
    const startScore = prevScoreRef.current;
    const endScore = score;
    const duration = 1000; // Animation duration in ms.
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Use an ease-out cubic curve for a smoother finish.
      const easeOut = 1 - Math.pow(1 - progress, 3);

      const currentScore = startScore + (endScore - startScore) * easeOut;
      setAnimatedScore(currentScore);
      setDisplayScore(Math.round(currentScore));

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        prevScoreRef.current = endScore;
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [score]);

  const reportLanguage = normalizeReportLanguage(language);
  const text = getReportText(reportLanguage);
  const label = getSentimentLabel(score, reportLanguage);

  // Size configuration for each gauge variant.
  const sizeConfig = {
    sm: { width: 100, stroke: 8, fontSize: 'text-2xl', labelSize: 'text-xs', gap: 6 },
    md: { width: 140, stroke: 10, fontSize: 'text-4xl', labelSize: 'text-sm', gap: 8 },
    lg: { width: 180, stroke: 12, fontSize: 'text-5xl', labelSize: 'text-base', gap: 10 },
  };

  const { width, stroke, fontSize, labelSize, gap } = sizeConfig[size];
  const radius = (width - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  // Start from the top and render a 270-degree arc.
  const arcLength = circumference * 0.75;
  const progress = (animatedScore / 100) * arcLength;

  const sentimentColorStyles: Record<string, { endColor: string; glowFilter: string }> = {
    '#ef4444': { endColor: '#dc2626', glowFilter: 'rgba(239, 68, 68, 0.24)' },
    '#f97316': { endColor: '#ea580c', glowFilter: 'rgba(249, 115, 22, 0.24)' },
    '#eab308': { endColor: '#ca8a04', glowFilter: 'rgba(234, 179, 8, 0.24)' },
    '#22c55e': { endColor: '#16a34a', glowFilter: 'rgba(34, 197, 94, 0.24)' },
    '#10b981': { endColor: '#059669', glowFilter: 'rgba(16, 185, 129, 0.24)' },
  };

  const color = getSentimentColor(animatedScore);
  const colors = {
    color,
    endColor: sentimentColorStyles[color]?.endColor ?? color,
    glowFilter: sentimentColorStyles[color]?.glowFilter ?? `${color}3d`,
  };
  const uniqueId = `${color.replace('#', '')}-${score}-${animatedScore.toFixed(0)}`;
  const gaugeTheme: GaugeVisualStyle = {
    svgFilter: `drop-shadow(0 0 8px ${colors.glowFilter})`,
    glowBlur: 3,
    glowOpacity: 0.2,
    glowStrokeExtra: Math.max(3, gap * 0.5),
    valueTextShadow: undefined,
  };

  return (
    <div className={cn('flex flex-col items-center', className)}>
      {showLabel && (
        <span className="mb-3 text-xs font-medium uppercase text-muted-foreground">
          {text.fearGreedIndex}
        </span>
      )}

      <div className="relative" style={{ width, height: width }}>
        <svg
          className="gauge-ring overflow-visible"
          width={width}
          height={width}
          style={gaugeTheme.svgFilter ? { filter: gaugeTheme.svgFilter } : {}}
        >
          <defs>
            <linearGradient id={`gauge-gradient-${uniqueId}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={colors.color} stopOpacity="0.9" />
              <stop offset="100%" stopColor={colors.endColor} stopOpacity="1" />
            </linearGradient>

            <filter id={`gauge-glow-${uniqueId}`}>
              <feGaussianBlur stdDeviation={gaugeTheme.glowBlur} result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Background track */}
          <circle
            cx={width / 2}
            cy={width / 2}
            r={radius}
            fill="none"
            stroke="#e5e5e5"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arcLength} ${circumference}`}
            transform={`rotate(135 ${width / 2} ${width / 2})`}
          />

          <circle
            cx={width / 2}
            cy={width / 2}
            r={radius}
            fill="none"
            stroke={colors.color}
            strokeWidth={stroke + gaugeTheme.glowStrokeExtra}
            strokeLinecap="round"
            strokeDasharray={`${progress} ${circumference}`}
            transform={`rotate(135 ${width / 2} ${width / 2})`}
            opacity={gaugeTheme.glowOpacity}
            filter={`url(#gauge-glow-${uniqueId})`}
          />

          {/* Progress arc */}
          <circle
            cx={width / 2}
            cy={width / 2}
            r={radius}
            fill="none"
            stroke={`url(#gauge-gradient-${uniqueId})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${progress} ${circumference}`}
            transform={`rotate(135 ${width / 2} ${width / 2})`}
          />
        </svg>

        {/* Center value */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={cn('font-bold text-foreground', fontSize)}
            style={gaugeTheme.valueTextShadow ? { textShadow: gaugeTheme.valueTextShadow } : {}}
          >
            {displayScore}
          </span>
          {showLabel && (
            <span
              className={`${labelSize} font-semibold mt-1`}
              style={{ color: colors.endColor }}
            >
              {label.toUpperCase()}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
