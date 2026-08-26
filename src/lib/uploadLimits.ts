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

/* ---------------------------------------------------------------------------
   Files that are named but not actually here.
   --------------------------------------------------------------------------- */

/**
 * How long to wait for a single byte before giving up on a file.
 *
 * Touching a cloud-only file is often what makes OneDrive start fetching it, so
 * a slow answer usually means "downloading now" rather than "broken". Waiting is
 * therefore the right default — but not forever, because the alternative to a
 * bounded wait here is an unbounded one on the upload, which is the failure this
 * check exists to remove.
 */
const FIRST_BYTE_TIMEOUT_MS = 15_000;

export interface ReadCheck {
  ok: boolean;
  /** Names of the files whose contents could not be read. */
  unreadable: string[];
  /** The same files as objects, so a caller can mark them in a list exactly. */
  unreadableFiles: File[];
  /** Plain-language problem statement, or null when every file is here. */
  message: string | null;
}

/** Can one byte of this file actually be produced? */
async function readableWithin(file: File, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      file.slice(0, 1).arrayBuffer(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), ms);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Refuse to upload files whose contents aren't on this computer.
 *
 * THE SIZE CHECK ABOVE CANNOT CATCH THIS, and the reason is the whole point of
 * this function: a size is METADATA. Work expense files live in OneDrive or
 * SharePoint with Files On-Demand, where a cloud-only placeholder reports its
 * real name and its real size while holding no contents at all. So the file
 * list looks perfectly normal, the size check passes, and the upload dies the
 * moment the browser tries to read the bytes — with no HTTP reply, which the
 * page could only report as a connection fault. Bilal lost a session to exactly
 * that on his work laptop.
 *
 * Reading ONE BYTE is the smallest question that distinguishes a real file from
 * a placeholder, and unlike the size it cannot be answered from metadata.
 *
 * Names the files, because "some of your files aren't available" leaves a person
 * comparing a folder against a list. The size check already sets this
 * precedent by naming the biggest files.
 */
export async function checkFilesReadable(
  files: File[],
  /**
   * Where in the flow this ran. The diagnosis is identical; the remedy is not.
   * At the Upload step a person adds the files again and loses nothing. Later
   * on they lose the reconciliation work, and a message that glosses over that
   * is the same kind of lie as the ones this file already exists to correct.
   */
  stage: "upload" | "midflow" = "upload",
): Promise<ReadCheck> {
  const checked = await Promise.all(
    files.map(async (file) => ({
      file,
      ok: await readableWithin(file, FIRST_BYTE_TIMEOUT_MS),
    })),
  );

  const unreadableFiles = checked.filter((c) => !c.ok).map((c) => c.file);
  if (unreadableFiles.length === 0) {
    return { ok: true, unreadable: [], unreadableFiles: [], message: null };
  }

  const unreadable = unreadableFiles.map((f) => f.name);
  const list = unreadable.map((n) => `"${n}"`).join(", ");
  return {
    ok: false,
    unreadable,
    unreadableFiles,
    message:
      `${unreadable.length === 1 ? "1 file isn't" : `${unreadable.length} files aren't`} ` +
      `on this computer yet: ${list}. Files kept in OneDrive or SharePoint show ` +
      `their name and size while the contents are still in the cloud, so there ` +
      `is nothing to send. Open the folder and wait for the solid green check ` +
      `beside each one — not the cloud outline.` +
      (stage === "upload"
        ? ` Then add them again.`
        : ` You will then have to go back to Upload and add your files again, ` +
          `which starts this report over.`),
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

/* ---------------------------------------------------------------------------
   When there is no reply at all.
   --------------------------------------------------------------------------- */

/**
 * How long the browser waits before it stops expecting a reply.
 *
 * Deliberately LONGER than the server's own `maxDuration` of 120s. If this were
 * shorter, the page would give up on work the server was still legitimately
 * doing and blame the network for its own impatience. The margin is for the
 * upload and the reply travelling, which on a slow office link is not nothing.
 *
 * Without any timeout a killed connection can leave `fetch` hanging with the
 * spinner turning forever, which is the worst outcome of the three: no error,
 * no result, nothing to act on.
 */
export const CLIENT_TIMEOUT_MS = 150_000;

/** A timeout signal, where the browser has one. Older managed browsers don't. */
export function timeoutSignal(ms = CLIENT_TIMEOUT_MS): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(ms)
    : undefined;
}

/**
 * Turn a thrown request into a sentence that is actually true.
 *
 * `catch { "couldn't reach the server" }` was a guess wearing the clothes of a
 * fact. It is reached by at least three different failures, only one of which
 * is a connection problem, and it sent a user to check their wifi while their
 * wifi was fine. That is the FOURTH time this app has described something other
 * than what happened — see the 413 reported as a connection fault, the expired
 * session that never existed, and the button that promised to defer a decision
 * it was making.
 *
 * The three cases are genuinely different and want different next steps:
 *
 *   timed out      the server was still working, or died without saying so
 *   cut off        a reply started and stopped — something in between closed it
 *   never started  the request didn't complete a round trip at all
 *
 * The last one is the interesting one on a managed work laptop. The page itself
 * loaded and the passcode POST worked, so the site is reachable and TLS is
 * fine; what is different about this request is that it carries megabytes of
 * files. Upload inspection is exactly the thing corporate proxies and DLP do,
 * and a corporate card statement leaving for an outside domain is exactly what
 * they are configured to stop. Saying so is more useful than "check your
 * connection", and the hotspot test settles it in a minute.
 *
 * Always logs the underlying error, because the browser's own wording
 * ("Failed to fetch" / "Load failed" / "NetworkError") is the one clue worth
 * having and throwing it away is how this took a session to diagnose.
 */
export function describeTransportFailure(error: unknown): string {
  console.error("[expense-runway] request failed without a usable reply:", error);

  const name = error instanceof Error ? error.name : "";

  if (name === "TimeoutError") {
    return (
      `The server didn't reply within ${Math.round(CLIENT_TIMEOUT_MS / 1000)} ` +
      `seconds, so the page stopped waiting. A month with a lot of receipts can ` +
      `genuinely take that long to read — try again with fewer files to see ` +
      `whether it's the volume.`
    );
  }

  if (name === "AbortError") {
    return "That request was cancelled before it finished. Try again.";
  }

  if (name === "SyntaxError") {
    return (
      `The server began replying and the connection closed before the reply ` +
      `finished, so there's nothing to show. That usually means something ` +
      `between this laptop and the app cut the connection rather than the app ` +
      `itself failing.`
    );
  }

  /* This wording was pointed at a corporate proxy on the first diagnosis, and
     the real cause turned out to be the files. Work expense files live in
     OneDrive or SharePoint, and a cloud-only placeholder shows its real name
     and size from metadata while the bytes are not on the disk — so the file
     list looks perfectly normal and the upload dies the moment the browser
     tries to read it. Leading with the network sent a person to test their
     connection, which was never the problem. Most likely cause first. */
  return (
    `The upload stopped before the app received anything. The most common cause ` +
    `is a file that isn't fully downloaded to this computer: files kept in ` +
    `OneDrive or SharePoint show their name and size while the contents are ` +
    `still in the cloud, and there is nothing to send. Copy the files to your ` +
    `desktop first — wait for the solid green check, not the cloud outline — ` +
    `and add them again from there. If they were already on the desktop, ` +
    `something on the network is stopping the upload instead.`
  );
}
