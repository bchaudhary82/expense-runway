/**
 * Reconciliation — turning match results into a list of things a person must
 * decide, and refusing to build a report until they have.
 *
 * This is the accounting discipline of the manual process, which is the whole
 * reason the team would trust the tool. Every statement line and every receipt
 * has to be accounted for. A report with a quiet gap in it is worse than no
 * report, because it looks finished.
 *
 * NO AI HERE, and no network. Pure functions over the match result, so the
 * blocking rule can be tested exhaustively for free — `npm run verify:blocking`.
 *
 * The four flag types come from PRD.md:
 *   missing-receipt   a statement line with nothing attached
 *   extra-receipt     a receipt that matches no line
 *   ambiguous         a receipt that fits several lines equally well
 *   duplicate         the same receipt supplied twice
 *   amount-mismatch   a near-match where the amounts disagree (tip, FX, partial)
 */
import type { StatementRow } from "@/lib/statement/parseStatement";
import { amountToNumber, formatMoney } from "@/lib/statement/format";
import {
  MAX_DAY_GAP,
  matchReceipts,
  merchantOverlap,
  toDayNumber,
  type Match,
  type ReceiptCandidate,
} from "./match";

export type FlagKind =
  | "missing-receipt"
  | "extra-receipt"
  | "ambiguous"
  | "duplicate"
  | "amount-mismatch";

export interface FlagChoice {
  id: string;
  label: string;
  /** What this choice does to the report, in plain language. */
  effect: string;
  /**
   * The receipt this choice would attach, so the screen can show a thumbnail.
   *
   * Without it, four unreadable receipts from the same hotel produce four
   * buttons all reading "Attach: WESTIN HOTELS & RESORTS" — identical, and
   * therefore impossible to choose between. The picture is the only thing that
   * distinguishes them.
   */
  imageIndex?: number;
}

export interface Flag {
  id: string;
  kind: FlagKind;
  /** Plain-language statement of the problem. Never an error code. */
  message: string;
  rowIndex?: number;
  imageIndex?: number;
  /** For ambiguous: the lines it could belong to. */
  rowIndexes?: number[];
  choices: FlagChoice[];
}

/** flagId -> chosen choice id. Choices that attach a receipt encode it as "attach:<imageIndex>". */
export type Resolutions = Record<string, string>;

export interface ReconcileState {
  matches: Match[];
  flags: Flag[];
  /** Receipts the matcher attached on its own, before any human decision. */
  autoAssignments: Record<number, number>;
}

const ATTACH = "attach:";

/**
 * A refund, a reversal, or a corrected charge.
 *
 * These have no receipt to find. Raising a "receipt missing" block against one
 * demands something that cannot honestly be produced, and the only ways out on
 * offer — "receipt lost" or "personal charge" — both describe the line as
 * something it isn't. The line still appears in the report and still counts in
 * the total; it simply isn't asked for a receipt.
 */
function isCreditRow(row: StatementRow): boolean {
  return (
    amountToNumber(row.billedAmount) < 0 || amountToNumber(row.expenseAmount) < 0
  );
}

/**
 * Receipts that are the same receipt supplied twice — e.g. an Uber trip that
 * appears both in the .docx summary and as a separate screenshot. Same merchant,
 * same amount, same day. The first is kept; the rest are flagged for removal.
 */
function findDuplicates(receipts: ReceiptCandidate[]): Map<number, number> {
  const firstSeen = new Map<string, number>();
  const duplicateOf = new Map<number, number>();

  for (const r of receipts) {
    if (!r.amount || !r.date) continue;
    const key = [
      r.amount,
      r.date,
      (r.merchant ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""),
    ].join("|");
    const seen = firstSeen.get(key);
    if (seen === undefined) firstSeen.set(key, r.imageIndex);
    else duplicateOf.set(r.imageIndex, seen);
  }

  /* Pages of one multi-page document, rather than two receipts.
     A hotel folio runs to two pages and every page repeats the same total, so
     each page arrives looking like a separate receipt for the same amount. One
     page matches its statement line and the other is left over, reported as a
     receipt that matches nothing — which is confusing, because it plainly does.
     Same FILE, same merchant, same total is the signal: those are pages, not
     purchases. The dates differ between pages, which is why the check above
     misses them.
     Deliberately narrow: pages of a scanned batch are separate receipts and
     almost never share both a merchant and an exact total. "They're different
     receipts" remains one click away either way. */
  const byDocument = new Map<string, number>();
  for (const r of receipts) {
    if (!r.amount || duplicateOf.has(r.imageIndex)) continue;
    const key = [
      r.source,
      r.amount,
      (r.merchant ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""),
    ].join("|");
    const seen = byDocument.get(key);
    if (seen === undefined) byDocument.set(key, r.imageIndex);
    else duplicateOf.set(r.imageIndex, seen);
  }

  return duplicateOf;
}

/**
 * A receipt and a line that look like the same purchase but disagree on amount —
 * a tip added after the fact, a currency conversion, a partial refund. The
 * matcher rejects these outright because it requires the amount to agree, which
 * is correct: it shouldn't guess. But leaving them as an unrelated
 * "missing receipt" plus "extra receipt" hides the connection from the user.
 */
function findAmountMismatches(
  rows: StatementRow[],
  receipts: ReceiptCandidate[],
  freeRows: Set<number>,
  freeImages: Set<number>,
): { rowIndex: number; imageIndex: number }[] {
  const out: { rowIndex: number; imageIndex: number }[] = [];
  const takenRows = new Set<number>();
  const takenImages = new Set<number>();

  for (const r of receipts) {
    // A missing date is allowed here. It is the case this exists for: the scan
    // that lost its date is exactly the scan whose receipt gets orphaned.
    if (!freeImages.has(r.imageIndex) || !r.amount) continue;
    if (takenImages.has(r.imageIndex)) continue;
    const rDay = r.date ? toDayNumber(r.date) : null;

    for (const [i, row] of rows.entries()) {
      if (!freeRows.has(i) || takenRows.has(i)) continue;

      /* The date is used when it can be trusted, and set aside when it can't.

         A faded till receipt lost the first digit of "1/31/2026" to the scan,
         so the month is unreadable and every date-based check fails — leaving a
         statement line reported as having no receipt while its receipt sits
         alongside, reported as matching nothing. The two belong together and
         the tool should say so.

         With the date out of play the merchant has to carry the weight, so it
         must overlap strongly AND be the only candidate. Nothing is attached
         automatically: this raises a flag showing both amounts, and a person
         decides. */
      const rowDay = toDayNumber(row.date);
      if (rowDay === null) continue;
      const dateFits = rDay !== null && Math.abs(rowDay - rDay) <= MAX_DAY_GAP;
      if (!r.merchant) continue;
      const merchantFits = merchantOverlap(row.vendor, r.merchant) >= 0.5;
      if (!merchantFits) continue;
      if (!dateFits) {
        const otherCandidates = rows.filter(
          (o, j) =>
            j !== i &&
            freeRows.has(j) &&
            !takenRows.has(j) &&
            merchantOverlap(o.vendor, r.merchant!) >= 0.5,
        );
        if (otherCandidates.length > 0) continue;
      }

      // The amounts must actually DISAGREE. Without this the check swallowed
      // pairs whose amounts were identical — which is not a mismatch, it's an
      // ambiguous receipt that the user needs to place. The ambiguity flag then
      // never appeared, and a receipt could have been attached to the wrong one
      // of two identical lines without anyone being asked.
      const cents = (v: string) => Math.round(amountToNumber(v) * 100);
      const receiptCents = Math.round(Number(r.amount) * 100);
      if (
        Math.abs(receiptCents) === Math.abs(cents(row.billedAmount)) ||
        Math.abs(receiptCents) === Math.abs(cents(row.expenseAmount))
      ) {
        continue;
      }

      out.push({ rowIndex: i, imageIndex: r.imageIndex });
      takenRows.add(i);
      takenImages.add(r.imageIndex);
      break;
    }
  }
  return out;
}

function describeRow(row: StatementRow): string {
  return `${row.vendor} — ${row.date}, ${formatMoney(row.billedAmount)}`;
}

/** What was read off the receipt. May be nothing at all. */
function describeReceipt(r: ReceiptCandidate): string {
  const bits: string[] = [];
  if (r.merchant) bits.push(r.merchant);
  if (r.date) bits.push(r.date);
  if (r.amount) bits.push(formatMoney(r.amount));
  return bits.length ? bits.join(" — ") : "nothing could be read from it";
}

/**
 * Where the receipt physically came from — file and page.
 *
 * Always present, always unique, and unaffected by how well the image read. It
 * is what makes two receipts telling the same story tellable apart.
 */
function whereFrom(r: ReceiptCandidate): string {
  return r.page ? `${r.source}, page ${r.page}` : r.source;
}

export function reconcile(
  rows: StatementRow[],
  receipts: ReceiptCandidate[],
): ReconcileState {
  /* One folio is one receipt.
     A folio runs to several pages, repeats its total on each, and — depending
     on the hotel — splits charges across them, so page two might show a room
     charge on its own. Every page after the first is dropped outright rather
     than raised as a duplicate or as a receipt matching nothing: it is neither.
     The page carrying the folio total is page one, which is what matching uses.
     Detection is deterministic, from markers in the PDF's own text layer. */
  const foliosSeen = new Set<string>();
  const collapsed: ReceiptCandidate[] = [];
  const extraFolioPages: ReceiptCandidate[] = [];
  for (const r of receipts) {
    if (!r.documentGroup) {
      collapsed.push(r);
      continue;
    }
    if (foliosSeen.has(r.documentGroup)) {
      extraFolioPages.push(r);
      continue;
    }
    foliosSeen.add(r.documentGroup);
    collapsed.push(r);
  }
  receipts = collapsed;

  const duplicateOf = findDuplicates(receipts);
  // Duplicates never enter matching — otherwise a copy could claim a line and
  // leave the original looking like an extra receipt.
  const forMatching = receipts.filter((r) => !duplicateOf.has(r.imageIndex));

  const result = matchReceipts(rows, forMatching);

  const autoAssignments: Record<number, number> = {};
  for (const m of result.matches) autoAssignments[m.rowIndex] = m.imageIndex;

  const byImage = new Map(receipts.map((r) => [r.imageIndex, r]));
  const flags: Flag[] = [];

  const freeRows = new Set(result.rowsWithoutReceipt);
  const freeImages = new Set([
    ...result.unmatched,
    ...result.ambiguous.map((a) => a.imageIndex),
  ]);

  /* Rescue receipts whose AMOUNT is unreadable.

     The mirror of the date rescue in match.ts. A faded till receipt can lose
     its entire amounts column to the scanner while the merchant and date stay
     perfectly legible — one here reads "WestJet Head Office - Main Cafe,
     Feb 11 2026" with the total simply gone.

     Allowed only when the evidence leaves no room: the date is within the
     window of exactly ONE line still needing a receipt, the merchants have
     something in common, and no other loose receipt is competing for it.
     Marked low so a person looks. */
  for (const imageIndex of [...freeImages]) {
    const r = byImage.get(imageIndex);
    if (!r || r.amount || !r.date) continue;

    const rDay = toDayNumber(r.date);
    if (rDay === null) continue;

    const fits = [...freeRows].filter((i) => {
      const rowDay = toDayNumber(rows[i].date);
      if (rowDay === null || Math.abs(rowDay - rDay) > MAX_DAY_GAP) return false;
      return !r.merchant || merchantOverlap(rows[i].vendor, r.merchant) > 0;
    });
    if (fits.length !== 1) continue;

    const rivals = [...freeImages].filter((other) => {
      if (other === imageIndex) return false;
      const o = byImage.get(other);
      if (!o?.date) return false;
      const oDay = toDayNumber(o.date);
      return oDay !== null && Math.abs(oDay - rDay) <= MAX_DAY_GAP;
    });
    if (rivals.length > 0) continue;

    const rowIndex = fits[0];
    autoAssignments[rowIndex] = imageIndex;
    freeRows.delete(rowIndex);
    freeImages.delete(imageIndex);
  }


  // Amount mismatches first — they explain a row and a receipt at once, so
  // finding them removes two confusing flags and replaces them with one clear one.
  const mismatches = findAmountMismatches(rows, receipts, freeRows, freeImages);
  for (const { rowIndex, imageIndex } of mismatches) {
    freeRows.delete(rowIndex);
    freeImages.delete(imageIndex);
    const row = rows[rowIndex];
    const r = byImage.get(imageIndex)!;
    const statementAmount = amountToNumber(row.billedAmount);
    const receiptAmount = Number(r.amount ?? 0);
    const diff = Math.abs(statementAmount - receiptAmount);
    // A tip is a small addition. A large gap is far more likely to be a misread
    // total on a faint scan, and saying "a tip explains it" would be wrong.
    const looksLikeATip =
      receiptAmount > 0 && diff / Math.max(statementAmount, receiptAmount) <= 0.3;

    flags.push({
      id: `mismatch:${rowIndex}:${imageIndex}`,
      kind: "amount-mismatch",
      rowIndex,
      imageIndex,
      message:
        `This receipt looks like the same purchase as ${describeRow(row)}, but the ` +
        `amounts differ by ${formatMoney(diff)} — the receipt reads ` +
        `${formatMoney(r.amount ?? "0")}. ` +
        (looksLikeATip
          ? `A tip added after the receipt printed, or a currency conversion, ` +
            `usually explains a gap this size.`
          : `That is too large a gap for a tip, so the total was probably ` +
            `misread on a faint scan — worth checking the receipt itself. The ` +
            `report uses the statement amount either way.`),
      /* Every choice here has to describe what it actually does.
         "No, different purchase" used to promise "the line goes back to
         needing a receipt". It didn't: the flag counted as resolved, the
         report built with nothing under that line, and the receipt was
         quietly dropped. A button that misdescribes its own effect is worse
         than a blunt one — so the alternatives are now the same two honest
         endings a missing receipt gets, and each says the receipt goes
         unused. */
      choices: [
        {
          id: `${ATTACH}${imageIndex}`,
          label: "Yes, same purchase — attach it",
          effect:
            "The receipt goes under this line. The report uses the statement " +
            "amount, as it always does.",
        },
        {
          id: "receipt-lost",
          label: "Not the same — include the line anyway",
          effect:
            "The line appears in the report with no receipt beneath it, and " +
            "this receipt isn't used.",
        },
        {
          id: "exclude",
          label: "Not the same — remove this line from the report",
          effect:
            "The line is removed from the report and from the total, and " +
            "this receipt isn't used.",
        },
      ],
    });
  }

  for (const [imageIndex, originalIndex] of duplicateOf) {
    const r = byImage.get(imageIndex)!;
    flags.push({
      id: `duplicate:${imageIndex}`,
      kind: "duplicate",
      imageIndex,
      message:
        `${describeReceipt(r)} appears twice — ` +
        `${whereFrom(byImage.get(originalIndex)!)} and ${whereFrom(r)}. ` +
        `Either it was supplied twice, or these are two pages of one document ` +
        `that repeats its total. Only one copy belongs in the report.`,
      choices: [
        {
          id: "drop-duplicate",
          label: "Drop the duplicate",
          effect: "One copy is kept and attached to its line.",
        },
        {
          id: "keep-both",
          label: "They're different receipts",
          effect: "Both are kept and matched separately.",
        },
      ],
    });
  }

  for (const a of result.ambiguous) {
    if (!freeImages.has(a.imageIndex)) continue;
    const r = byImage.get(a.imageIndex)!;
    flags.push({
      id: `ambiguous:${a.imageIndex}`,
      kind: "ambiguous",
      imageIndex: a.imageIndex,
      rowIndexes: a.rowIndexes,
      message:
        `${whereFrom(r)} — ${describeReceipt(r)} — fits ${a.rowIndexes.length} statement lines ` +
        `equally well. Guessing would be wrong about half the time, so it needs ` +
        `you to pick.`,
      choices: a.rowIndexes.map((i) => ({
        id: `row:${i}`,
        label: describeRow(rows[i]),
        effect: "The receipt is attached to this line.",
      })),
    });
  }

  for (const rowIndex of freeRows) {
    const row = rows[rowIndex];
    if (isCreditRow(row)) continue;
    const spare = [...freeImages].filter(
      (i) => !mismatches.some((m) => m.imageIndex === i),
    );
    flags.push({
      id: `missing:${rowIndex}`,
      kind: "missing-receipt",
      rowIndex,
      message: `${describeRow(row)} is on your statement, but no receipt matches it.`,
      choices: [
        ...spare.map((i) => {
          const r = byImage.get(i)!;
          return {
            id: `${ATTACH}${i}`,
            label: `${whereFrom(r)} — ${describeReceipt(r)}`,
            effect: "That receipt is used for this line.",
            imageIndex: i,
          };
        }),
        {
          id: "receipt-lost",
          label: "Receipt lost — include anyway",
          effect: "The line appears in the report with no receipt beneath it.",
        },
        {
          id: "exclude",
          /* "Personal charge — leave it out" sat one card away from the extra
             receipt's "Leave it out", which does nothing at all. Two buttons a
             few words apart, one of which silently drops a line and its money
             from the report. Say which thing leaves. */
          label: "Personal charge — remove this line from the report",
          effect: "The line is removed from the report and from the total.",
        },
      ],
    });
  }

  for (const imageIndex of freeImages) {
    if (mismatches.some((m) => m.imageIndex === imageIndex)) continue;
    if (result.ambiguous.some((a) => a.imageIndex === imageIndex)) continue;
    const r = byImage.get(imageIndex)!;
    flags.push({
      id: `extra:${imageIndex}`,
      kind: "extra-receipt",
      imageIndex,
      message:
        `${whereFrom(r)} — ${describeReceipt(r)} — doesn't match any line on ` +
        `your statement. It may be a cash expense, a different month, paid on ` +
        `another card, or simply too faint to read.`,
      choices: [
        {
          id: "ignore",
          /* Renamed away from "Leave it out" — see the note on the missing
             receipt's exclude choice. This one removes NOTHING: it files the
             receipt away and leaves the statement untouched. */
          label: "Set this receipt aside",
          effect:
            "The receipt isn't attached to any line. No line is added to or " +
            "removed from the report.",
        },
      ],
    });
  }

  void extraFolioPages; // dropped deliberately — they are pages, not receipts

  return { matches: result.matches, flags, autoAssignments };
}

export interface AppliedResolutions {
  /** rowIndex -> imageIndex, after human decisions. */
  assignments: Record<number, number>;
  /** Rows removed from the report entirely — personal charges. */
  excludedRows: number[];
  /** Flags still needing a decision. Report generation is blocked while non-empty. */
  outstanding: Flag[];
  /**
   * One receipt claimed by more than one statement line. Blocks generation.
   *
   * The flag list is built ONCE and never re-derived, so every spare receipt is
   * offered inside every "receipt missing" card at the same time, and an
   * ambiguous receipt is additionally offered its own card. Three spare
   * receipts against three receipt-less lines put the same three buttons in
   * three places, and nothing in the model stopped the same receipt being
   * attached to two different lines: `assignments` is rowIndex -> imageIndex,
   * so two rows can hold the same image and generation embeds it under both.
   *
   * That is the worst failure this tool has, because it is silent. The report
   * builds, the totals add up, and one receipt sits under two expenses looking
   * entirely deliberate — including, on a real July statement, under a charge
   * and under the refund that reversed it.
   *
   * The screen prevents the conflict by refusing to offer a receipt that is
   * already spoken for. This is the backstop, because a disabled button is a
   * courtesy and not a control.
   */
  conflicts: { imageIndex: number; rowIndexes: number[] }[];
}

/**
 * Apply the user's decisions and report what's still outstanding.
 *
 * Used by the UI to decide whether the download button is enabled, and by the
 * server to refuse the request if it isn't. The server check matters: a disabled
 * button is a courtesy, not a control.
 */
export function applyResolutions(
  state: ReconcileState,
  resolutions: Resolutions,
): AppliedResolutions {
  const assignments = { ...state.autoAssignments };
  const excludedRows: number[] = [];
  const outstanding: Flag[] = [];

  for (const flag of state.flags) {
    const choice = resolutions[flag.id];
    if (!choice) continue;

    if (choice.startsWith(ATTACH) && flag.rowIndex !== undefined) {
      assignments[flag.rowIndex] = Number(choice.slice(ATTACH.length));
    } else if (choice.startsWith("row:") && flag.imageIndex !== undefined) {
      assignments[Number(choice.slice(4))] = flag.imageIndex;
    } else if (choice === "exclude" && flag.rowIndex !== undefined) {
      excludedRows.push(flag.rowIndex);
    }
    // "receipt-lost", "ignore", "drop-duplicate", "keep-both" and "not-related"
    // need no assignment — they resolve the flag by accepting the situation.
  }

  /* Outstanding is worked out AFTER every assignment is known, because one
     card's answer can settle another card's question.

     "This receipt matches no line on your statement" and "this receipt fits two
     lines equally well" are both asking where a receipt goes. Attach that
     receipt to a line from a "receipt missing" card and both have been answered
     — but the cards stayed on screen still asking, and the only button left on
     the extra-receipt card read "the receipt isn't used" while the receipt was,
     by then, plainly used. Bilal hit exactly this with an Uber receipt on a
     July statement and asked, reasonably, which one the report would believe.

     Answering it here rather than on screen keeps the server's refusal and the
     Continue button working from the same rule. A flag whose subject has been
     dealt with elsewhere is not outstanding. */
  const assignedImages = new Set(Object.values(assignments));
  for (const flag of state.flags) {
    if (resolutions[flag.id]) continue;
    const settledElsewhere =
      (flag.kind === "extra-receipt" || flag.kind === "ambiguous") &&
      flag.imageIndex !== undefined &&
      assignedImages.has(flag.imageIndex);
    if (!settledElsewhere) outstanding.push(flag);
  }

  /* Invert the assignments: any receipt reached from two rows is a conflict. */
  const rowsByImage = new Map<number, number[]>();
  for (const [rowText, imageIndex] of Object.entries(assignments)) {
    const list = rowsByImage.get(imageIndex) ?? [];
    list.push(Number(rowText));
    rowsByImage.set(imageIndex, list);
  }
  const conflicts = [...rowsByImage.entries()]
    .filter(([, rowIndexes]) => rowIndexes.length > 1)
    .map(([imageIndex, rowIndexes]) => ({ imageIndex, rowIndexes }));

  return { assignments, excludedRows, outstanding, conflicts };
}

/**
 * Which receipts are already spoken for, ignoring one card's own answer.
 *
 * The screen uses this to grey out a receipt that another line has already
 * claimed. The card's own resolution has to be excluded or every answered card
 * would report itself as a conflict and disable the choice it is displaying.
 *
 * Returns imageIndex -> the rowIndex holding it. Auto-matched receipts are
 * included, since a receipt the matcher placed on its own is just as spoken for
 * as one a person placed by hand.
 */
export function claimsExcluding(
  state: ReconcileState,
  resolutions: Resolutions,
  flagId: string,
): Map<number, number> {
  const others = { ...resolutions };
  delete others[flagId];
  const { assignments } = applyResolutions(state, others);

  const claimed = new Map<number, number>();
  for (const [rowText, imageIndex] of Object.entries(assignments)) {
    claimed.set(imageIndex, Number(rowText));
  }
  return claimed;
}

/**
 * Drop the preview image before sending readings on to generation.
 *
 * The thumbnail exists only so a person can see what they're deciding about on
 * screen. It has no business travelling back to the server.
 */
export function stripThumb<T extends { thumb?: string }>(r: T): Omit<T, "thumb"> {
  const copy = { ...r };
  delete copy.thumb;
  return copy;
}
