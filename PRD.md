# Expense Report Builder — PRD (Product Requirements Document) — v1

*Status: **APPROVED FOR BUILD** — July 30, 2026. Eval set built and run (90/90, 100%); architecture revised on the results; design spec written. Build pack ready at `claude-code-pack/`.*

## Headline finding from the evals (July 30, 2026)

The corporate credit card statement PDF has a real text layer. A deterministic parser — **no AI at all** — reproduced **90/90 line items across five months (Feb–Jun 2026), every field exact**, including USD→CAD conversions and 22-character truncated vendor names, matching the reports that were actually filed.

This changes the architecture. The numbers that land in the report are extracted with code, not a model. Consequences:

- **Accuracy on amounts and dates: 100%, verified** — not "probably fine"
- **Cost for the report itself: $0** — the API is only touched for receipt images
- **Corporate CC statement data never leaves the server** — a materially stronger privacy story than the original design
- **Speed: instant** — no API round-trip for the primary path

Full detail: `claude-code-pack/evals/README.md`.

## Problem
Bilal's work team files expenses fully manually: gather rideshare receipts, scan paper receipts, pull the corporate CC statement and hotel folios, assemble a Word document line by line, then key everything into JD Edwards. ~1 hour/month per person, error-prone, universally disliked. No expense software (no Concur/Ramp) and no JDE API access.

## Solution
A passcode-protected web app that does what Bilal + Claude already do manually in Cowork: ingest a month's receipt files, extract line items with the Claude API, let the user review and add purposes, and output the finished Word doc in the exact team format.

## Goals
1. Report prep drops from ~1 hour to under 5 minutes
2. Live URL + documented Claude Code build = AI-resume portfolio artifact
3. Zero stored data — safe enough for corporate receipts

## Non-Goals
- No JD Edwards integration (no API access — Word doc is the deliverable)
- No revenue, billing, or public launch
- No user accounts / multi-tenancy
- No mobile app (responsive web is enough)

## User Flow (v1)
Presented as a four-step flow that mirrors the airline's booking flow — see `claude-code-pack/DESIGN.md`.

1. **Gate:** enter shared passcode
2. **Upload:** drag in any mix of files — the corporate CC statement PDF (required), plus rideshare receipt docx, scanned paper receipt PDFs, hotel folios
3. **Extract — two separate paths, do not merge them:**
   - **Statement → deterministic parser.** Produces every line item that appears in the report: date, expense amount, billed amount, expensed currency, billed currency, vendor. No AI, no network call, 100% verified.
   - **Receipt images → Claude vision.** Only to pull date/amount/merchant for matching. These values are *never* written into the report; they exist to answer "which statement line does this receipt belong to?"
   - **The receipt image itself is a third thing, and it does go into the report.** It's the original file, not a model's output, so the rule above is intact. Extracting the images is deterministic — `jszip` for the rideshare `.docx`, page rendering for the scanned PDF — and so is placing them. Only the matching needs a model.
4. **Reconcile:** statement lines cross-matched against receipts. Unmatched statement lines flagged ("receipt missing"), unmatched receipts flagged ("not on statement"). Resolve every flag to proceed.
5. **Review:** editable table — delete personal charges, type purpose per line (with a "copy purpose down" convenience). Statement values are authoritative and shown as read-only by default; an explicit override is available but logged in the summary.
6. **Generate:** Word doc in team format, chronological order:
   ```
   Jun 08 2026    $34.42    $34.42    CAD    CAD    RIDESHARE CO/TRIP
   Client site travel — Calgary
   [receipt image for this expense]
   ```
7. **Download.** Server holds nothing; refresh = clean slate

**Exact output format** — *corrected July 30, 2026; the earlier description of this was wrong.*

The document opens with a screenshot of the corporate card statement, then repeats one block per expense: **transaction line, purpose line, receipt image**, the image sitting after its own entry. Fields separated by four spaces. Purpose defaults to `[ADD PURPOSE HERE]` if left empty, matching current practice. Foreign-currency rows show the original amount first and the CAD amount second, e.g. `Apr 20 2026    $3.00    $4.21    USD    CAD    ORCA`.

**One expense per page.** Page 1 is the statement screenshot alone; every page after it holds exactly one transaction line, its purpose line and its receipt. Implemented as an **explicit page-break run at the end of each image**, not the `pageBreakBefore` paragraph property — that property is what the filed reports use, but renderers ignore it and the document flows continuously, putting an image and the *following* entry's text on each page. *Corrected July 31, 2026 after three failed attempts; the failure preserved the correct page count, so it was invisible to structural checks and only showed up when the document was rendered and read page by page.*

**Every image fits a 6.5in × 8.0in box**, aspect ratio preserved. Letter with 1in margins leaves 6.5 × 9.0in of content and the spare inch carries the two text lines. *Added July 31, 2026: page breaks alone did not stop the staggering, because images were scaled by width only — a till receipt is roughly 1:4, so one came out 10–11in tall and overflowed onto the following page, taking the next entry with it.* The filed reports keep every image within 1.92–6.50in wide and 1.88–8.00in tall.

**There is no blank line.** The original spec described the first paragraph of each block as blank; it is actually the receipt image, which reads as empty text when a `.docx` is inspected programmatically. All five filed reports contain **zero** genuinely blank paragraphs, and each contains `1 + expenses` images — one screenshot of the statement plus one receipt per line. A text-only report is therefore roughly 9 KB where the real filed article is 2–5 MB.

This was caught on July 30, 2026 *after* step 4 shipped, because both the eval ground truth and the step-4 verifier compared text only, and an image paragraph has no text to compare. See "Known gap in the eval set" below.

## Reconciliation & Error Handling (core requirement — not optional)
The app must replicate the accounting discipline of the manual workflow. Every statement line and every receipt must be accounted for before a report can be generated.

**Self-check against the statement (added July 30, 2026):**
Every statement prints its own transaction count and billed total on page 1. The parsed rows must match both, and this is checked on every upload and shown to the user as "Balances to the statement". This is the strongest single guarantee in the tool: it needs no ground truth, no filed report and no human, so it works on months nobody has ever verified. It exists because the July statement contained a refund line the parser silently dropped — a check against the statement's own summary catches that class of bug immediately (18 parsed vs 19 declared), where a ground-truth comparison could not.

**Refunds and credits:** these appear as ordinary transactions with the minus sign inside the dollar sign (`$-12.24`). They belong in the report exactly as printed — omitting one overstates the claim.

**Never a silent drop:** any line inside the transaction table that begins with a date either becomes a row or is surfaced to the user as unreadable. A report quietly missing a line looks complete and is wrong.

**Reconciliation rules:**
- Every corporate CC statement line must match a receipt (by date ± 1–2 days, amount, merchant similarity)
- **Missing receipt:** statement line with no receipt → flagged, listed by name/date/amount; user must resolve (upload receipt, mark "receipt lost — proceed anyway," or mark personal/excluded)
- **Extra receipt:** receipt with no statement line → flagged (possible cash expense, wrong month, or duplicate); user chooses include/exclude
- **Duplicates:** same date+amount+merchant appearing twice (e.g., in rideshare docx AND on statement) → auto-deduplicated, shown for confirmation
- **Amount mismatch:** receipt and statement differ (tip, FX) → flagged with both values; statement amount wins by default, user can override
- Report generation is **blocked** until every flag is resolved — no silent gaps

**Error handling & messaging:**
- Unreadable/failed file → clear per-file message ("Couldn't read page 2 of X — retry, replace, or enter manually"), never a silent drop
- Unparseable line items → manual-entry fallback row pre-filled with whatever was extracted
- Every generated report ends with a reconciliation summary the user saw before download (N expenses, total, all statement lines matched)
- Low-confidence extractions (blurry photo, odd format) visually flagged in the review table for double-checking

## Architecture
| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js + TypeScript + Tailwind | Same as Google Maps Scraper plan |
| Hosting | Vercel | Free tier fine for team-sized traffic |
| **Statement extraction** | **`unpdf` / `pdfjs-dist` — deterministic, no AI** | Port of `evals/reference/parse_statement.py`. Must pass 90/90 before shipping |
| **Receipt extraction** | Claude API vision — reconciliation only | Scanned paper receipts and rideshare docx have no text layer. Start on Haiku 4.5; escalate only if match rate is poor |
| Doc generation | `docx` npm package | Text lines plus embedded receipt images. *Revised July 30, 2026 — this was scoped as "flat paragraphs, trivial" before the images were discovered.* |
| Receipt image extraction | `jszip` for the rideshare `.docx`; PDF page rendering for scans and the statement screenshot | Deterministic, no AI |
| Design | airline-booking-flow inspired, clearly a tool | Full spec in `claude-code-pack/DESIGN.md` |
| Auth | Shared passcode (env var), rate-limited | No accounts |
| Storage | None | Files processed in memory, results live client-side |

**Input file types confirmed from five months of real data:**

**Accepted receipt file types** *(added July 31, 2026)*: PDF, Word `.docx`, and images (`.jpg`, `.jpeg`, `.png`, `.webp`). A photo of a receipt is a normal input. `.heic` — the iPhone camera default — cannot be decoded and is reported to the user with export instructions rather than skipped. Previously a dropped image was accepted by the drop zone, listed as "set aside", and then silently ignored at generation time: a real receipt disappearing without a word.

| Input | Text layer? | Path |
|---|---|---|
| `Corporate_CC_*.pdf` (statement) | Yes | Deterministic parser — no AI |
| Hotel folios (`*folio*.pdf`) | Yes | Deterministic parser — no AI |
| `* paper receipts.pdf` | No — 12 pages of scans | Claude vision |
| `* rideshare receipts.docx` | No — embedded images | Claude vision |

**Cost estimate (revised down):** the report itself costs $0. Only receipt images hit the API — roughly 15–25 images per month per person, a fraction of a cent to a few cents per report. Team of 5–10 monthly users ≈ **well under $1/month** total API spend.

## Eval Results (built and run July 30, 2026)
`03 Areas/Work Expense Reports/` contained five months of real inputs AND the finished, filed reports — real ground truth, not a guess. Eval set built at `claude-code-pack/evals/`.

| Month | Rows | Billed total | Result |
|---|---|---|---|
| February 2026 | 19 | $1,061.99 | 19/19 exact |
| March 2026 | 15 | $442.15 | 15/15 exact |
| April 2026 | 18 | $1,875.07 | 18/18 exact |
| May 2026 | 13 | $522.35 | 13/13 exact |
| June 2026 | 25 | $1,720.32 | 25/25 exact |
| **Total** | **90** | | **90/90 (100%)** |

The cheapest possible model turned out to be *no model*. Receipt-image matching still needs vision; that eval runs during the build, against the $100 sandbox credits, once the reconciliation step exists.

**Regression rule:** the production parser is TypeScript. Port the algorithm, re-run the eval, **90/90 or it does not ship.**

### Known gap in the eval set (found July 30, 2026)

The 90 ground-truth rows capture **text only**. The filed reports also contain images — one screenshot of the statement plus one receipt per expense — and nothing in the eval set recorded that.

| Month | Expenses | Images in filed report | Blank paragraphs |
|---|---|---|---|
| February 2026 | 19 | 20 | 0 |
| March 2026 | 15 | 16 | 0 |
| April 2026 | 18 | 19 | 0 |
| May 2026 | 13 | 14 | 0 |
| June 2026 | 25 | 26 | 0 |

Consequence: the step-4 verifier reported "25/25 lines match ground truth exactly" for a document that was missing 26 images and about 4.7 MB. It wasn't a false pass — every text line really was correct — it was a **true pass on an incomplete question**.

The lesson is worth keeping: an eval only defends the properties someone thought to write down. The 90-row set was built by reading the filed reports as text, so it could only ever test text. Ground truth now carries an `expectedImages` count, and the report verifier states plainly which properties it has and hasn't checked rather than printing a bare PASS.

**Privacy note:** `evals/ground-truth/*.json` holds real merchant names and amounts. Gitignored. Publish the scores, never the data.

## Build Process Requirements (portfolio)
- Built in **Claude Code**, vibe-coding style
- Keep a build log: prompts used, sessions, decisions — this is portfolio evidence, not just the app
- Follow the Google Maps Scraper project pattern: repo gets its own CLAUDE.md + this PRD + FIRST_SESSION.md

## Build Budget & Model Routing (July 2026)
Two separate cost pipes — don't confuse them:

**Pipe 1 — Bilal's Pro subscription (building).** Claude Code runs on the Pro plan at no extra cost, drawing from plan usage hours (Sonnet included; ~40–80 active hrs/week — ample). Build cost: **$0**. Opus available on Pro in limited amounts for occasional escalation.

**Pipe 2 — API (running the deployed app).** The live app can't use a personal subscription; it calls the Claude API with its own key, billed per token. Per-MTok pricing (July 2026): Sonnet 5 $2/$10 intro through Aug 31 (then $3/$15), Opus 4.8 $5/$25, Fable 5 $10/$50, Haiku 4.5 $1/$5.

**Money rules (per Bilal, July 2026):**
- The **$100 API credit (expires Sept 17)** is Bilal's personal sandbox for ALL projects — evals for this tool can draw from it, but the deployed tool does NOT.
- At launch, create a **dedicated Anthropic Console workspace** for the tool with its own API key, and set a **$20/month spend limit** plus email alert thresholds on it (Console → Settings → Workspaces → *workspace* → Limits). Built-in, no code needed.

  *Corrected July 30, 2026:* an earlier version said to give the workspace "its own loaded balance (~$20)." **Anthropic credits are organization-wide — a workspace cannot hold its own funds.** Workspaces exist to separate projects while keeping billing central. The control that actually exists is a monthly spend *limit*, which caps what the workspace may draw from the shared balance. Two consequences worth being clear about:
  - The tool's spend **will** draw on the same balance as the $100 promotional credit. The separation the original plan assumed isn't available; the spend limit is what bounds the risk, and per-workspace cost reporting is how spend gets attributed.
  - Workspace limits cannot exceed the organization's limits, and cannot be set on the Default Workspace.

**Routing plan (Berman pattern):**
- Strategy/architecture: Fable 5 in Cowork (subscription — done)
- Build: Sonnet 5 in Claude Code on Pro subscription ($0)
- Escalation: Opus for bugs Sonnet can't crack
- Runtime extraction: Haiku 4.5 or Sonnet 5 per eval results — pennies per report (~5–10¢/monthly report)
- Evals: run against the $100 sandbox credits before Sept 17

## Cost Observability (to think about — not yet committed)
Two layers discussed July 2026:
1. **Console-native (free, no build):** workspace spend cap, threshold email alerts, per-model usage charts, optional auto top-up
2. **In-app usage log (portfolio piece):** app records each report generation (user, line-item count, est. cost) and notifies Bilal (email or Telegram — familiar stack). Resume line: "built cost observability into the product."

## Portfolio Highlights (claim these in the write-up)
1. **Eval-driven architecture change** — built a 90-row ground-truth eval set from five months of real filed reports, and the evals killed the AI from the main path. Result: 100% accuracy, $0 cost, and corporate data that never leaves the server. *"I ran the evals and deleted the AI"* is the strongest line in the whole project.
2. Model routing for cost optimization (Berman discipline applied) — AI used only where it's actually required: images with no text layer
3. Privacy by design (zero server-side storage; statement data never sent to a third party)
4. Reconciliation engine with blocking error handling (accounting-grade rigor)
5. Cost observability (spend caps, alerts, in-app usage log)
6. Design system reverse-engineered from live computed styles rather than eyeballed — real tokens, documented provenance, deliberate "familiar but not impersonating" line

## Known limits at launch (measured July 31, 2026)

| | Measured | Ceiling | Headroom |
|---|---|---|---|
| Files uploaded, June | 3.31 MB | 4.5 MB per request | ~26% |
| Document returned, June | 3.42 MB | 4.5 MB per response | ~24% |
| Report generation time | ~17s | 300s on Vercel Hobby | ample |
| Passcode attempts | 5 per 15 min, per IP | in-memory, per instance | see below |

**There is no daily or per-document quota.** The 4.5 MB is per request, in each
direction. A colleague filing three months of backlog in one afternoon is three
separate runs sharing no counter, and bandwidth (~100 GB/month on the free tier)
is nowhere near relevant at ~7 MB per report.

**What will actually bite:** a month with substantially more receipts than
June's 25 exceeds 4.5 MB and fails with `413`. Tracked as build-order item 10.

**Rate limiting** counts per serverless instance, so it doesn't hold against
parallel attempts. With a five-word passcode (~10²⁴ combinations) the passcode
itself is what makes guessing infeasible; the limiter's remaining job is
protecting against API hammering. Tracked as item 11.

## Risks
| Risk | Mitigation |
|---|---|
| Employer objects to corporate CC data on a personal tool | **Still open — ask before team rollout.** Position much improved: statement data is parsed locally and never sent to any AI provider. Only receipt images touch the API. Worst case, portfolio demo runs on dummy receipts and colleagues keep the manual option |
| Tool is mistaken for an official corporate system | DESIGN.md draws the line: the airline's palette and layout patterns, but own name, own wordmark, no airline logo or marks, no company name in the product name |
| Statement PDF format changes | Eval suite is the tripwire — re-run against a new month and it fails loudly rather than silently producing wrong numbers. Fallback: manual-entry rows |
| Extraction errors erode trust | Deterministic parser for the numbers (90/90 verified); review screen before generation; AI values never written into the report |
| Receipt formats we haven't seen | v1 supports the 4 known types; graceful "couldn't parse, enter manually" fallback row |

## Milestones
1. ~~Manual review pass → model + eval decisions~~ — done July 30, 2026
2. ~~Eval set built and run~~ — done, 90/90
3. ~~PRD finalized → v1~~ — done
4. **Claude Code build** (scaffold → statement parser + eval → reconciliation → review UI → docx → passcode → deploy) — *in progress*
5. Pilot with own July receipts, then 1–2 colleagues
6. Employer check, then team rollout + portfolio write-up
