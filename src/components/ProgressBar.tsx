import { useI18n } from '../i18n/useI18n';
import type { ProgressInfo } from '../lib/client';

const PHASE_LABELS: Record<string, string> = {
  reading: 'reading',
  parsing: 'parsing',
  indexing: 'indexing',
  loading: 'loading',
};

export function ProgressBar({ progress }: { progress: ProgressInfo | null }) {
  const { t } = useI18n();
  if (!progress) return null;
  const pct = Math.max(0, Math.min(100, Math.round(progress.pct)));
  const phase = PHASE_LABELS[progress.phase] ?? progress.phase;

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between text-xs font-semibold text-text-soft">
        <span>
          {t('common.loading')} {phase}
          {progress.detail ? ` — ${progress.detail}` : ''}
        </span>
        <span className="mono">{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
