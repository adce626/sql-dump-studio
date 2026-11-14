/**
 * Helpers for detecting and rendering images that are stored inside SQL dumps.
 *
 * Images usually live in BLOB columns (`longblob`, `bytea`, `image`, ...) but
 * they are also frequently dumped as a base64 data-URI inside a TEXT column.
 * Both shapes are supported here.
 */

export interface ImageInfo {
  /** MIME type of the detected image. */
  mime: string;
  /** Short file extension (without the dot). */
  ext: string;
  /** Width/height in pixels when the format stores them in the header. */
  width?: number;
  height?: number;
}

const DATA_URI_RE = /^data:image\/([a-z0-9.+-]+);base64,/i;

/** Detects an image format from its magic bytes. */
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  if (!bytes || bytes.length < 4) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    const width = bytes.length >= 24 ? readU32(bytes, 16) : undefined;
    const height = bytes.length >= 24 ? readU32(bytes, 20) : undefined;
    return { mime: 'image/png', ext: 'png', width, height };
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }

  // GIF: "GIF87a" / "GIF89a"
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    const width = bytes.length >= 10 ? readU16(bytes, 6) : undefined;
    const height = bytes.length >= 10 ? readU16(bytes, 8) : undefined;
    return { mime: 'image/gif', ext: 'gif', width, height };
  }

  // WEBP: "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }

  // BMP: "BM"
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return { mime: 'image/bmp', ext: 'bmp' };
  }

  // ICO: 00 00 01 00
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) {
    return { mime: 'image/x-icon', ext: 'ico' };
  }

  // SVG is text based: <svg … or <?xml … <svg
  if (bytes.length >= 5) {
    const head = String.fromCharCode(...bytes.subarray(0, Math.min(256, bytes.length))).trim();
    if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
      return { mime: 'image/svg+xml', ext: 'svg' };
    }
  }

  return null;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  );
}

function readU16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

/** Maps an image mime subtype to the file extension that should be used. */
function extFromMime(subtype: string): string {
  const value = subtype.toLowerCase();
  if (value === 'jpeg' || value === 'jpg') return 'jpg';
  if (value === 'svg+xml') return 'svg';
  if (value === 'x-icon' || value === 'vnd.microsoft.icon') return 'ico';
  const clean = value.replace(/^x-/, '').replace(/\+.*$/, '');
  return clean || 'img';
}

/** Returns the image descriptor of a cell value, or null when it is not an image. */
export function imageFromValue(value: unknown): ImageInfo | null {
  if (value instanceof Uint8Array) return sniffImage(value);
  if (typeof value === 'string') {
    const match = DATA_URI_RE.exec(value.trim());
    if (match) {
      const subtype = match[1].toLowerCase();
      return { mime: `image/${subtype}`, ext: extFromMime(subtype) };
    }
  }
  return null;
}

/** True when the value is a base64 encoded image stored inside a TEXT column. */
export function isDataUriImage(value: unknown): boolean {
  return typeof value === 'string' && DATA_URI_RE.test(value.trim());
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function hashBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  const limit = Math.min(bytes.length, 256);
  for (let i = 0; i < limit; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${bytes.length}:${hash.toString(36)}`;
}

const urlCache = new Map<string, string>();
const URL_CACHE_LIMIT = 400;

/**
 * Builds a `data:` URL for the image. Results are cached so the same blob
 * (a logo repeated on every row) is only encoded once.
 */
export function imageSrc(value: unknown, info: ImageInfo): string {
  if (isDataUriImage(value)) return (value as string).trim();
  if (!(value instanceof Uint8Array)) return '';

  const key = `${info.mime}:${hashBytes(value)}`;
  const cached = urlCache.get(key);
  if (cached) return cached;

  const src = `data:${info.mime};base64,${toBase64(value)}`;
  if (urlCache.size >= URL_CACHE_LIMIT) {
    const oldest = urlCache.keys().next().value;
    if (oldest) urlCache.delete(oldest);
  }
  urlCache.set(key, src);
  return src;
}

/** Trailing extension of a column/file name: `residence_card_front.img` → `img`. */
const EXT_SUFFIX_RE = /\.[A-Za-z0-9]{1,6}$/;

/**
 * Strips a file-name-like extension from a column name so the real format can
 * be appended: `residence_card_front.img` → `residence_card_front`.
 */
export function imageBaseName(column: string): string {
  const trimmed = column.trim();
  const withoutExt = trimmed.replace(EXT_SUFFIX_RE, '');
  const safe = (withoutExt || trimmed || 'image').replace(/[^\w.-]+/g, '_');
  return safe;
}

/**
 * Suggested file name when the image is downloaded. The extension always comes
 * from the sniffed format (png, jpg, gif, …) and never from the column name.
 */
export function imageFileName(column: string, info: ImageInfo, index?: number): string {
  const base = imageBaseName(column);
  return index === undefined ? `${base}.${info.ext}` : `${base}_${index + 1}.${info.ext}`;
}

/** Parses a `data:` URL back into raw bytes. */
export function bytesFromDataUrl(src: string): Uint8Array | null {
  const match = /^data:([^;,]*)((?:;[^,]*)*),([\s\S]*)$/i.exec(src.trim());
  if (!match) return null;
  const params = match[2] ?? '';
  const payload = match[3] ?? '';
  try {
    if (/;base64/i.test(params)) {
      const binary = atob(payload.replace(/\s+/g, ''));
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
      return out;
    }
    const decoded = decodeURIComponent(payload);
    const out = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) out[i] = decoded.charCodeAt(i) & 0xff;
    return out;
  } catch {
    return null;
  }
}

/**
 * Builds a blob URL so the downloaded file carries the real MIME type — this is
 * what makes Windows/Chrome show "PNG image" instead of a generic file.
 */
export function imageDownloadUrl(src: string, mime: string): string {
  const bytes = bytesFromDataUrl(src);
  if (!bytes) return src;
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return URL.createObjectURL(new Blob([copy.buffer], { type: mime }));
}
