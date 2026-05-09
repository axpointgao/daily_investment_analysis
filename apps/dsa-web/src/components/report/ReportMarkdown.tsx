import type React from 'react';
import { useEffect, useState, useCallback } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText } from 'lucide-react';
import { historyApi } from '../../api/history';
import { Drawer } from '../common/Drawer';
import { Tooltip } from '../common/Tooltip';
import { Button } from '@/components/ui/button';
import { getReportText, normalizeReportLanguage } from '../../utils/reportLanguage';
import type { AnalysisEntryType, ReportLanguage } from '../../types/analysis';
import { markdownToPlainText } from '../../utils/markdown';

interface ReportMarkdownProps {
  recordId: number;
  stockName?: string;
  stockCode?: string;
  displayName?: string;
  displayCode?: string;
  assetType?: AnalysisEntryType;
  onClose: () => void;
  reportLanguage?: ReportLanguage;
}

/**
 * Markdown report drawer component
 * Uses common Drawer component to display full Markdown format analysis report
 */
export const ReportMarkdown: React.FC<ReportMarkdownProps> = ({
  recordId,
  stockName,
  stockCode,
  displayName,
  displayCode,
  assetType = 'stock',
  onClose,
  reportLanguage = 'zh',
}) => {
  const text = getReportText(normalizeReportLanguage(reportLanguage));
  const loadReportFailedText = text.loadReportFailed;
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(true);
  const [copiedType, setCopiedType] = useState<'markdown' | 'text' | null>(null);
  const headerTitle = displayName || stockName || displayCode || stockCode || '';

  // Handle close with animation
  const handleClose = useCallback(() => {
    setIsOpen(false);
    // Delay actual close to allow animation to complete
    setTimeout(onClose, 300);
  }, [onClose]);

  // Handle copy markdown source
  const handleCopyMarkdown = useCallback(async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopiedType('markdown');
      setTimeout(() => setCopiedType(null), 2000);
    } catch (error) {
      console.error('Copy failed:', error);
    }
  }, [content]);

  // Handle copy plain text
  const handleCopyPlainText = useCallback(async () => {
    if (!content) return;
    try {
      const plainText = markdownToPlainText(content);
      await navigator.clipboard.writeText(plainText);
      setCopiedType('text');
      setTimeout(() => setCopiedType(null), 2000);
    } catch (error) {
      console.error('Copy failed:', error);
    }
  }, [content]);

  useEffect(() => {
    let isMounted = true;

    const fetchMarkdown = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const markdownContent = assetType === 'fund'
          ? await historyApi.getMixedMarkdown(recordId)
          : await historyApi.getMarkdown(recordId);
        if (isMounted) {
          setContent(markdownContent);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : loadReportFailedText);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchMarkdown();

    return () => {
      isMounted = false;
    };
  }, [assetType, recordId, loadReportFailedText]);

  return (
    <Drawer
      isOpen={isOpen}
      onClose={handleClose}
      width="!w-[min(92vw,72rem)] !max-w-[72rem] sm:!max-w-[72rem]"
      zIndex={100}
      backdropClassName="bg-background/56 backdrop-blur-[2px]"
      showCloseButton={false}
    >
      {/* Custom Header */}
      <div className="mb-4 flex items-start justify-between gap-3">
        {/* Left: Icon + Title */}
        <div className="flex items-center gap-3 flex-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border bg-muted text-foreground">
            <FileText className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">{headerTitle}</h2>
            <p className="text-xs text-muted-foreground">{text.fullReport}</p>
          </div>
        </div>

        {/* Right: Toolbar */}
        <div className="flex shrink-0 items-center gap-1">
          {/* Copy Markdown button */}
          <Tooltip content={text.copyMarkdownSource}>
            <span className="inline-flex">
              <button
                type="button"
                onClick={handleCopyMarkdown}
                disabled={isLoading || !content || copiedType !== null}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                aria-label={text.copyMarkdownSource}
              >
                {copiedType === 'markdown' ? (
                  <svg className="h-4 w-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                  </svg>
                )}
              </button>
            </span>
          </Tooltip>

          {/* Copy plain text button */}
          <Tooltip content={text.copyPlainText}>
            <span className="inline-flex">
              <button
                type="button"
                onClick={handleCopyPlainText}
                disabled={isLoading || !content || copiedType !== null}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                aria-label={text.copyPlainText}
              >
                {copiedType === 'text' ? (
                  <svg className="h-4 w-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                )}
              </button>
            </span>
          </Tooltip>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={text.dismiss}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center h-64">
          <div className="rounded-full border-muted border-t-primary h-10 w-10 animate-spin border-[3px]" />
          <p className="mt-4 text-muted-foreground text-sm">{text.loadingReport}</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center h-64">
          <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center mb-3">
            <svg className="w-6 h-6 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p className="text-destructive text-sm">{error}</p>
          <button
            type="button"
            onClick={handleClose}
            className="mt-4 rounded-lg px-4 py-2 text-sm text-muted-foreground"
          >
            {text.dismiss}
          </button>
        </div>
      ) : (
        <div
          className="prose prose-sm max-w-none
            prose-headings:text-foreground prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2
            prose-h1:text-xl
            prose-h2:text-lg
            prose-h3:text-base
            prose-p:leading-relaxed prose-p:mb-3 prose-p:last:mb-0
            prose-strong:text-foreground prose-strong:font-semibold
            prose-ul:my-2 prose-ol:my-2 prose-li:my-1
            prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
            prose-pre:border
            prose-table:border-collapse
            prose-hr:my-4
            prose-a:no-underline hover:prose-a:underline
            prose-blockquote:text-muted-foreground whitespace-pre-line break-words
          "
        >
          <Markdown remarkPlugins={[remarkGfm]}>
            {content}
          </Markdown>
        </div>
      )}

      {/* Footer */}
      <div className="border-border mt-6 flex justify-end border-t pt-4">
        <Button
          type="button"
          onClick={handleClose}
          variant="outline"
        >
          {text.dismiss}
        </Button>
      </div>
    </Drawer>
  );
};
