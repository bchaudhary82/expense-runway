# Expense Runway — build instructions for Claude Code

Read this first, every session. Then `PRD.md`, then `DESIGN.md`.

## What we're building

A passcode-protected web app for my work team. Upload a month of
expense files → reconcile receipts against the corporate card statement → add a
purpose to each line → download a Word doc in the exact team format. The team
then keys it into JD Edwards by hand (no JDE API access — the Word doc is the
ceiling, and that's fine).

Today the whole thing is manual and takes about an hour a month per person.
Target: under five minutes.

## Who you're working with

Bilal is non-technical and learning as he builds. This is deliberate
vibe-coding — the build process is itself the portfolio artifact.

- Explain what you're doing in plain English before you do it. No unexplained jargon.
- One clear step at a time. Don't dump five files and move on.
- When something breaks, say what broke and what you're trying next.
- When there's a real choice to make, ask — don't silently pick.
- Keep `BUILD_LOG.md` updated at the end of every session: what was built, what
  decisions got made and why, what's next. This is portfolio evidence.

## Non-negotiables

0. **Verify rendered output, not just structure.** Any change to
   `src/lib/report/buildReport.ts` must pass `npm run verify:layout`, which
   exports the document to PDF and reads what actually landed on each page.
   *Added July 31, 2026 after four rounds on one bug:* `pageBreakBefore` was
   valid markup that the renderer ignored, so every XML assertion — counts,
   positions, dimensions, page geometry — passed while the layout was wrong, and
   the page count even came out correct. **Structural checks on a file format do
   not verify what the format renders.**

1. **The statement parser must pass 90/90 on the eval suite before anything
   ships.** Reference run: `cd evals && python3 run_eval.py`. Amounts and dates
   are where trust dies — no partial credit.
   *Added July 30, 2026:* every statement must also pass its **self-check** —
   each one prints its own transaction count and billed total on page 1, and the
   parsed rows must match both. This holds on months with no filed report to
   compare against, which is how a dropped refund line got caught.
1b. **Never discard a statement line silently.** Any line beginning with a date
   inside the transaction table either parses into a row or is returned in
   `skipped` and shown to the user. A report that is quietly missing a line
   looks complete and is wrong — the worst failure this tool can produce.
2. **Never send corporate credit card statement data to the Claude API.** It
   parses deterministically. That's the privacy story and the accuracy story.
   The API is only for receipt *images*.
3. **AI-extracted *values* never land in the report.** Every number, date,
   currency code and vendor name in the output Word doc comes from the parsed
   statement. Receipt extraction exists to answer "which statement line does
   this receipt belong to?" — nothing more.
   *Clarified July 30, 2026:* the receipt **image itself does go in the
   document** — it is the original file, not something a model produced, so this
   rule is untouched by it. What must never happen is a model's reading of a
   receipt becoming a number on the report.
4. **Report generation is blocked until every reconciliation flag is
   resolved.** No silent gaps. That's the whole accounting discipline of the
   manual process, and it's why the team will trust it.
5. **Nothing is stored server-side.** Files processed in memory, results live in
   the browser, refresh = clean slate.
6. **Never commit `evals/ground-truth/`.** Real merchant names and amounts from a
   real corporate card. It's gitignored — keep it that way.
   *Extended July 31, 2026:* the gitignore is not the whole story. **BUILD_LOG.md
   also contains real merchant names, amounts, dates and statement filenames
   carrying the card identifier `……`** — they got there as worked examples
   while debugging. CLAUDE.md and FIRST_SESSION.md each carry one too. That data
   is fine in a **private** repo and is NOT fine in a public one. Before this
   project is ever made public or written up, the build log must be redacted:
   swap real merchants for the invented ones already used in `verify-blocking.ts`
   (`COFFEE BAR`, `RIDE CO`, `GRILL HOUSE`), and drop the statement filenames.
   The lessons survive redaction untouched; the merchant names carry none of the
   value.
7. **No airline logo, marks, or company name in the product name.** See DESIGN.md.

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- `unpdf` or `pdfjs-dist` for PDF text + word coordinates
- `mammoth` or `jszip` to pull embedded images out of the rideshare `.docx`
- `docx` npm package for output
- `@anthropic-ai/sdk` for receipt vision — start on **Haiku 4.5**
- Vercel for hosting; passcode in an env var

## The one algorithm that matters

`evals/reference/parse_statement.py` is a working, proven parser. It scores
90/90 on five months of real statements. Port it to TypeScript exactly as
written — including the column-position logic for splitting vendor from
location. A regex-only approach was already tried and it mangles every
multi-word vendor name. Read the docstring before you touch it.

**Accepted receipt file types** *(added July 31, 2026)*: PDF, Word `.docx`,
and image files — `.jpg`, `.jpeg`, `.png`, `.webp`. Photographed receipts are a
normal input, not an edge case. `.heic` (the iPhone default) **cannot** be
decoded and must be reported to the user with instructions to export as JPEG —
never skipped silently. Anything else is refused by name, per non-negotiable 1b.

**Refunds and credits are normal.** They print with the minus sign inside the
dollar sign — `$-12.24`, not `-$12.24` — and the amount pattern must allow it.
None of the five eval months contains a refund; July 2026 was the first, and the
original pattern silently dropped it, overstating the report by the refunded
amount. Refund rows carry through to the report exactly as printed.

## The six checks

| Command | Asks | Costs |
|---|---|---|
| `npm run eval` | Does the statement parse exactly? 90/90 + self-check on every month | free |
| `npm run verify:report` | Is the .docx structurally right — order, images, sizes, page setup? | free |
| `npm run verify:layout` | **Does it actually render one expense per page?** | free |
| `npm run verify:blocking` | Are all five flag types raised, is generation blocked until each is resolved, and do deletions re-key receipts and purposes correctly? | free |
| `npm run verify:auth` | Can a session token be forged or extended, and does the lockout hold? | free |
| `npm run eval:receipts` | Does each receipt reach the right line? | ~7¢ |

The first five run on every change. The last needs an API key and only matters
when receipt matching changes.

## Build order

Do these in order. Don't skip ahead — each step is testable on its own.

1. **Scaffold** — Next.js + Tailwind + the design tokens from DESIGN.md. One
   page, the four-step stepper, nothing functional. Bilal should be able to
   look at it and recognise the booking-flow feel.
2. **Statement parser + eval** — port the Python, wire up a TS eval that reads
   `evals/ground-truth/*.json`. **Stop here until it's 90/90.**
3. **Upload + parse** — drag files in, statement gets parsed, line items appear
   in a table. Still no AI.
4. **docx generation** — the table becomes a downloadable Word doc: the
   transaction and purpose lines, in order, correctly formatted. This is the
   *text skeleton* of the report; the images arrive in step 5. **Done.**
5. **Receipts — extraction, matching, and embedding.** Three separate jobs, and
   only the middle one needs AI:
   - **Extract (no AI):** pull the embedded images out of the rideshare `.docx` with
     `jszip`, render the scanned paper-receipt PDF pages to images, render the
     statement PDF's transaction page for the screenshot at the top.
   - **Match (Haiku vision):** read date / amount / merchant off each receipt
     image purely to decide which statement line it belongs to.
   - **Embed (no AI):** place each receipt image after its own entry, and the
     statement screenshot at the top.

   A receipt embedded under the wrong expense is a real error in a filed
   document and looks completely plausible. Treat mis-assignment as seriously as
   a wrong amount.
6. **Reconciliation + blocking** — match, flag, block. **Done.**
7. **Purposes + review polish** — editable purpose column, copy-down. **Done.**
8. **Passcode + rate limiting.** **Done.**
9. **Deploy to Vercel.**

### Settled, do not re-open

- **The per-row amount override stays.** Reviewed Aug 10, 2026 and kept
  deliberately. It lets a statement amount be replaced by hand, and it is
  guarded three ways: the amount turns amber, a banner names the count, and
  every override is listed again on the download screen before the file is
  built. Bilal: *"It's a great function to have."* Do not remove it as
  unnecessary risk — the visibility is the safeguard, and it was a considered
  call, not an oversight.

### After launch — known work, in priority order

Agreed July 31, 2026 after measuring the real Vercel limits. Not optional
polish: items 10 and 11 are things that will break or bite in normal use.

10. **Reclaim payload headroom.** ~20 min. Vercel caps request AND response
    bodies at **4.5 MB each**. Measured on June: **3.31 MB up, 3.42 MB down** —
    roughly 30% headroom. A month with ~35 receipts, or a colleague whose
    scanner produces heavier files, hits `413 FUNCTION_PAYLOAD_TOO_LARGE` and
    the report doesn't build.
    *First move:* drop `JPEG_QUALITY` 92 → ~85 and `MAX_EDGE` 2000 → 1600 in
    `extract.ts`, which roughly halves both figures. **Re-check legibility on
    the faded thermal receipt** (`June paper receipts.pdf`, image 16) — that one
    is the canary, and quality settings have already shipped unreadable receipts
    once (session 5).

11. ~~**Rate limiting in a shared store.**~~ **DONE AND VERIFIED LIVE Aug 10,
    2026** — confirmed in production via `/api/status`:
    `sharedRateLimitStore: true`. Counts live in Upstash Redis when
    `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are both set, and in
    per-instance memory otherwise, so nothing breaks locally or in the checks.
    Vercel applies environment variables only to deployments built *after* they
    are added, so "the variables are set" and "the limiter is shared" are
    different claims — if a deploy ever loses them the limiter silently reverts
    to per-instance counting, and `/api/status` is how to tell.
    Uses Redis `INCR` rather than read-modify-write: two simultaneous guesses
    that both read 3 and both write 4 have spent two attempts and recorded one.
    `verify:auth` proves this against a fake Upstash server over real HTTP —
    mutating the client to read-modify-write makes 5 parallel attempts count as
    3 and leaves the account unlocked. A store outage falls back to in-memory
    counting rather than failing closed, so an Upstash problem can't lock the
    team out of their own expense reports. Original entry: `rateLimit.ts` counts in memory,
    per serverless instance, so parallel or distributed attempts get more than
    five tries. Swap the Map for Upstash Redis or Vercel KV (free tiers cover
    this volume comfortably); the function signatures don't change.
    *Note:* with a five-word passcode the limiter is no longer the thing
    standing between an attacker and the data — it's there to stop someone
    hammering the API and burning function invocations. Do it before wider
    rollout, not before launch.

13. ~~**The report filename names the wrong month.**~~ **DONE Aug 10, 2026.** Named from `declared.statementDate`, which the parser already read and the self-check already corroborates. `npm run eval` now asserts the filename on all six statements, with the expectation taken from each fixture's own filename so both sides can't drift together. Mutation-tested. Original entry: ~30 min, but needs a
    decision first. `reportFileName()` takes the month of the **earliest
    transaction**, and a card statement's billing cycle crosses month
    boundaries: measured across the five fixtures, Feb spans Jan+Feb, May spans
    Apr+May, Jul spans Jun+Jul — so three of five come out named for the
    previous month. February 2026 downloads as "Expense Report — January
    2026.docx".
    **The convention is settled** (Bilal, Aug 2026): statements are issued on
    the **27th**, and the report is named for the month of that statement date.
    Anything transacted after the 27th falls into the next month's statement,
    which is exactly why the earliest transaction is the wrong thing to read.
    A Feb 27 statement is the February report even though its first line is
    dated Jan 30. Confirmed against the fixtures — every statement's
    transactions begin after the 27th of the prior month (Feb: Jan 30 → Feb 12;
    May: Apr 30 → May 21; Jul: Jun 26 → Jul 15).

    So: **read `Statement Date` off page 1** and take its month. The field is
    printed on every statement, so nothing has to be inferred.

    *The trap, resolved.* Searching page text for the label reported "Feb 27
    2026" for three different statements — which turned out not to be a parsing
    fault at all. **Page 1 lists a summary row for the PREVIOUS statement above
    this one's**, so the first match is legitimately the month before. The
    parser already sidesteps this: `findDeclaredTotals()` reads "Statement Date:"
    off the transaction page and then matches the page-1 summary row belonging
    to that date. Nothing new had to be parsed.

    The name is editable at download, so this is friction, not breakage.

14. ~~**"Copy down" overwrites purposes that were already written."**~~ **DONE Aug 10, 2026.** It now fills only the empty lines below and names its own scope — the button reads "↓ fill N below" and disables when N is 0. Original entry: ~15 min.
    It copies a row's purpose into *every* row below it that isn't excluded,
    including ones already filled in. That is destructive and unexplained —
    the button says "↓ copy down" with no indication of how far it reaches.
    Bilal's words: "I don't fully understand the use of that button." Either
    scope it to empty rows only, or label what it does and make it undoable.
    The underlying use case is real: a trip produces a run of expenses sharing
    one purpose.

15. ~~**Bold the transaction line on each page.**~~ **DONE Aug 10, 2026.** Bold on the transaction line only; `verify:report` now asserts bold sits on exactly paragraphs 1, 4, 7 … as an exact set, so emphasis landing on the wrong paragraph fails. Mutation-tested both ways. Original entry: ~15 min. The line lifted from
    the card statement is the thing a reviewer's eye should land on first, and
    it currently reads too faint against the receipt image below it. Bold that
    paragraph only — not the purpose line. Per non-negotiable 0, this needs
    `npm run verify:layout`, and `verify:report` will need its expectation
    updated to assert the run is bold.

18. **The Upload step has no way forward.** ~10 min. Once files are read, the
    only route to Reconcile is clicking the stepper at the top, which reads as
    navigation rather than as the next thing to do. Bilal: *"there isn't a clear
    direction to go to the reconcile step."*

    Measured, not assumed: **this affects exactly one screen.** `ReconcileStep`
    and `PurposesStep` both take an `onContinue` and render a Continue button;
    `UploadStep` takes no such prop, and its only button is "Read my files". So
    this is an inconsistency to close, not a pattern to invent — add
    `onContinue` to `UploadStep`, wire it to `setStep(1)` in `page.tsx`
    alongside the existing `setStep(2)` and `setStep(3)`, and show it only once
    a statement has parsed, so it can never lead to an empty Reconcile screen.

17. **Possibly remove "fill below".** ~10 min. **On hold — Bilal chose to leave
    it in place for now (Aug 10, 2026).** Revisit only if it goes unused.
    Original reasoning: Bilal, Aug 10 2026:
    *"Every transaction we always have is a unique transaction for a unique
    thing in our team. The reason generally is going to be somewhat different."*
    The feature was built on an assumption about repeated trip expenses that
    does not hold for this team, so the button is a control nobody needs sitting
    next to every row. Confirm against one more real month before deleting —
    if it is genuinely never used, remove it and its column width with it.

16. **Extraction in the browser.** ~half a day. The proper fix for item 10:
    unzip the `.docx` and render PDF pages client-side, so only small receipt
    images cross the wire for matching and the finished document is assembled
    locally. Removes the payload ceiling entirely and means receipt files never
    reach the server at all. Only worth doing if 10 stops being enough.

Steps 1–4 need no API key. Get an API key in place before step 5.

## Output format (exact)

> **Corrected July 30, 2026.** The previous version of this section was wrong —
> it described a blank line where the receipt image actually goes. See
> BUILD_LOG.md, "Session 4b — the format was wrong."

The report opens with a screenshot of the corporate card statement, then repeats
a three-part block per expense:

```
[screenshot of the whole corporate card statement]    ← once, at the top

Jun 08 2026    $34.42    $34.42    CAD    CAD    RIDESHARE CO/TRIP
Client site travel — Calgary
[receipt image for this expense]

Apr 20 2026    $3.00    $4.21    USD    CAD    ORCA
[ADD PURPOSE HERE]
[receipt image for this expense]
```

Transaction line, purpose line, **receipt image** — in that order, the image
after its own entry. Four spaces between fields. Chronological. Foreign
currency: original amount first, CAD second. Empty purpose defaults to
`[ADD PURPOSE HERE]`.

**One expense per page.** Page 1 is the statement screenshot alone; every page
after it holds exactly one transaction line, its purpose line and its receipt.

Use an **explicit page-break run** (`<w:br w:type="page"/>`) at the END of every
image paragraph, except the last. Do **not** use the `pageBreakBefore` paragraph
property — the filed reports use it, but renderers ignore it, and the document
then flows continuously so each page ends up carrying an image plus the *next*
entry's text. That failure keeps the page count correct (26 for June), so it
cannot be caught by counting.

Also set `keepNext` on the transaction and purpose paragraphs, so they can never
be separated from their receipt.

*Corrected July 31, 2026 after three failed attempts.* **Verify layout by
rendering the document and reading page by page** — structural checks on the XML
passed every time while the output was wrong.

**Every image must fit a 6.5in × 8.0in box**, aspect ratio preserved, scaled up
or down to fill it. Letter with 1in margins leaves 6.5 × 9.0in of content; the
spare inch holds the transaction and purpose lines. *Added July 31, 2026 — page
breaks alone did not fix the staggering, because images were being scaled by
width only. A till receipt is roughly 1:4, so a width-constrained one came out
10–11in tall, overflowed the page and dragged the next entry with it.* Measured
from the filed reports: every image there is within 1.92–6.50in wide and
1.88–8.00in tall, and none exceeds the printable area. `verify:report` checks
every image, not just the largest.

Paragraph count is therefore `1 + (3 × expenses)`, and image count is
`1 + expenses`.

**There is no blank line anywhere in the document.** An image paragraph holds no
text, so reading a `.docx` as plain text makes it look blank — that is how the
error got written down. Verified across all five filed reports:

| Month | Expenses | Paragraphs | Images | Genuinely blank paragraphs |
|---|---|---|---|---|
| February 2026 | 19 | 58 | 20 | **0** |
| March 2026 | 15 | 46 | 16 | **0** |
| April 2026 | 18 | 55 | 19 | **0** |
| May 2026 | 13 | 40 | 14 | **0** |
| June 2026 | 25 | 76 | 26 | **0** |

Confirmed by opening the images, not just counting them: in the June report,
image 1 is a screenshot of the statement table, image 2 is the rideshare receipt for
CA$31.04 on June 7 sitting under the June 7 line, and image 26 is the taco bar
receipt for $36.16 under the final line.

## Reference data (already in this folder)

Everything the build needs is inside `evals/` — no need to look outside it:

- `evals/fixtures/statements/` — five real corporate card statements, Feb–Jun 2026
- `evals/fixtures/receipts-june/` — June's receipts: scanned paper PDF, rideshare docx, two hotel folios
- `evals/ground-truth/` — the 90 verified line items from the reports actually filed
- `evals/reference/parse_statement.py` — the proven parser
- `evals/run_eval.py` — reference scorer

`fixtures/` and `ground-truth/` are real corporate card data. Both are
gitignored. Never commit them, never deploy them, never put them in the
portfolio write-up.

## Working style

Bilal is using the Claude Code desktop app, not the terminal. Don't hand him
shell commands to run himself — run them yourself and explain what happened.
