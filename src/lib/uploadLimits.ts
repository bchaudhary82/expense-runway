/**
 * The upload size ceiling, checked in the browser before anything is sent.
 *
 * Vercel rejects a request body over 4.5 MB with a 413 — at the edge, before the
 * app ever sees it. Two consequences that both showed up on the first real use:
 *
 *  1. The rejection comes back as PLAIN TEXT ("Request Entity Too Large"), not
 *     JSON. Client code that assumes JSON throws while parsing, lands in a
 *     generic catch, and reports something untrue — in our case "couldn't reach
 *     the server", which sent the user to check their wifi.
 *  2. You find out after waiting for the whole upload.
 *
 * The browser knows the total before sending a byte, so it should say so
 * immediately and name the files responsible.
 */

/** Vercel's hard limit on a request body. */
export const PLATFORM_LIMIT_BYTES = 4.5 * 1024 * 1024;

/**
 * What we allow, leaving room for multipart encoding overhead — the boundary
 * markers and per-part headers add a few KB, and being rejected by 3 KB after a
 * check said "fine" would be worse than a slightly conservative limit.
 */
export const MAX_UPLOAD_BYTES = 4.2 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export interface SizeCheck {
  ok: boolean;
  totalBytes: number;
  /** Plain-language problem statement, or null when it fits. */
  message: string | null;
  /** Biggest files first, so the user knows what to remove. */
  largest: { name: string; bytes: number }[];
}

export function checkUploadSize(files: File[]): SizeCheck {
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const largest = [...files]
    .sort((a, b) => b.size - a.size)
    .slice(0, 3)
    .map((f) => ({ name: f.name, bytes: f.size }));

  if (totalBytes <= MAX_UPLOAD_BYTES) {
    return { ok: true, totalBytes, message: null, largest };
  }

  const over = totalBytes - MAX_UPLOAD_BYTES;
  return {
    ok: false,
    totalBytes,
    largest,
    message:
      `These files come to ${formatBytes(totalBytes)}, and the limit for one ` +
      `upload is ${formatBytes(MAX_UPLOAD_BYTES)} — about ${formatBytes(over)} ` +
      `too much. Remove what isn't needed and try again.`,
  };
}

/**
 * A finished report from a previous month, mistakenly added as an input.
 *
 * An easy mistake, because the finished report lives in the same folder as the
 * inputs. It's also usually the biggest file there, so it's the first thing
 * worth pointing at when an upload is too large — and even if it fitted, the
 * app would treat it as a receipt source and pull a duplicate of every receipt
 * out of it.
 */
export function looksLikeAFinishedReport(name: string): boolean {
  return /expense\s*report/i.test(name) && /\.docx$/i.test(name);
}

/** Reads a response that might be JSON or might be a platform error page. */
export async function readError(response: Response): Promise<string> {
  if (response.status === 413) {
    return (
      `That upload was too large for the server to accept ` +
      `(the limit is ${formatBytes(PLATFORM_LIMIT_BYTES)}). Remove the largest ` +
      `files and try again.`
    );
  }
  const body = await response.text();
  try {
    const parsed = JSON.parse(body) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    // Not JSON — a platform error page rather than one of ours.
  }
  return body.trim().length > 0 && body.length < 200
    ? body.trim()
    : `The server returned an error (${response.status}).`;
}
