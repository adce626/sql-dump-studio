import { useRef, useState, type DragEvent } from 'react';
import { useI18n } from '../i18n/useI18n';
import { IconFile, IconUpload } from './Icons';

interface DropZoneProps {
  onFile: (file: File) => void;
  accept?: string;
  busy?: boolean;
}

export function DropZone({ onFile, accept, busy }: DropZoneProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={[
        'relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-14 text-center transition',
        dragging ? 'border-accent bg-accent-soft/60' : 'border-border bg-surface/60',
      ].join(' ')}
    >
      <span className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
        <IconUpload size={26} />
      </span>
      <div>
        <p className="text-base font-bold text-text">{busy ? t('home.opening') : t('home.drop')}</p>
        <p className="mt-1 text-sm text-muted">{t('home.subtitle')}</p>
      </div>

      <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={busy}>
        <IconFile size={16} />
        {t('home.browse')}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={
          accept ??
          '.sql,.sql.gz,.gz,.tar,.tgz,.tar.gz,.sqlite,.sqlite3,.db,.dump,.bak,.backup,.ibd,.frm,.mdf,.ldf,.txt'
        }
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }}
      />

      <p className="max-w-lg text-xs text-muted">{t('home.hint')}</p>
    </div>
  );
}
