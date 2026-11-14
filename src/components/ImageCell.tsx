import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n/useI18n';
import { imageDownloadUrl, imageFileName, imageFromValue, imageSrc, type ImageInfo } from '../lib/images';
import { IconClose, IconDownload } from './Icons';

interface ImageThumbProps {
  value: unknown;
  column: string;
  /** Index of the row, used for the download file name. */
  rowIndex?: number;
  onOpen?: (payload: {
    src: string;
    info: ImageInfo;
    column: string;
    rowIndex: number;
  }) => void;
}

/** Small inline preview used inside grid cells. */
export function ImageThumb({ value, column, rowIndex = 0, onOpen }: ImageThumbProps) {
  const info = imageFromValue(value);
  if (!info) return null;
  const src = imageSrc(value, info);

  return (
    <button
      type="button"
      className="img-thumb"
      title={`${info.mime.toUpperCase()} · ${info.width ? `${info.width}×${info.height} · ` : ''}${
        value instanceof Uint8Array ? `${value.length} B` : 'data-URI'
      }`}
      onClick={(event) => {
        event.stopPropagation();
        onOpen?.({ src, info, column, rowIndex });
      }}
    >
      <img src={src} alt={column} loading="lazy" decoding="async" />
    </button>
  );
}

interface ImageViewerProps {
  src: string;
  info: ImageInfo;
  column: string;
  rowIndex?: number;
  onClose: () => void;
}

/** Full screen image viewer with a download action. */
export function ImageViewer({ src, info, column, rowIndex = 0, onClose }: ImageViewerProps) {
  const { t } = useI18n();
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // A blob URL keeps the real MIME type, so the saved file is recognised as
  // "PNG image" / "JPEG image" by the browser and by Windows.
  const [href, setHref] = useState(src);
  useEffect(() => {
    const url = imageDownloadUrl(src, info.mime);
    setHref(url);
    return () => {
      if (url !== src) URL.revokeObjectURL(url);
    };
  }, [src, info.mime]);

  const fileName = imageFileName(column, info, rowIndex);
  const format = info.ext.toUpperCase();

  return createPortal(
    <div className="image-viewer" role="dialog" aria-modal="true" aria-label={column}>
      <div className="absolute inset-0 bg-black/75" onClick={onClose} />

      <div className="relative flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
          <div className="min-w-0">
            <div className="truncate text-sm font-bold">{column}</div>
            <div className="text-[11.5px] text-white/70">
              {format}
              {info.width ? ` · ${info.width}×${info.height}` : ''}
              {' · '}
              <span className="font-mono">{fileName}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn bg-white/10 text-white hover:bg-white/20"
              onClick={() => setZoom((z) => (z >= 3 ? 1 : z + 0.5))}
            >
              {Math.round(zoom * 100)}%
            </button>
            <a
              className="btn bg-white/10 text-white hover:bg-white/20"
              href={href}
              download={fileName}
            >
              <IconDownload size={15} />
              {t('table.downloadImage')}
              <span className="rounded bg-white/15 px-1 text-[10px] font-black">{format}</span>
            </a>
            <button
              type="button"
              className="btn bg-white/10 text-white hover:bg-white/20"
              onClick={onClose}
              aria-label={t('common.close')}
            >
              <IconClose size={16} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center overflow-auto p-6">
          <img
            src={src}
            alt={column}
            className="max-h-full max-w-full rounded-lg bg-white/5 object-contain shadow-2xl"
            style={{ transform: `scale(${zoom})` }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
