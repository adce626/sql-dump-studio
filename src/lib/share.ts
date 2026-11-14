/**
 * Encodes a view state into a compact URL-safe string so a table view can be
 * shared with a simple link (no server, no database).
 */
export function encodeState(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return '';
  }
}

/** Reverses {@link encodeState}. Returns null when the payload is invalid. */
export function decodeState<T>(encoded: string | null | undefined): T | null {
  if (!encoded) return null;
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

/** Builds the shareable URL for the current location plus the encoded state. */
export function shareUrl(state: unknown): string {
  const encoded = encodeState(state);
  const url = new URL(window.location.href);
  const [path] = url.hash.split('?');
  url.hash = `${path}?v=${encoded}`;
  return url.toString();
}
