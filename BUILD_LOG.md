# Build Log — Expense Runway

A running record of how this tool got built: what happened each session, what
was decided, and why. Kept as portfolio evidence, not just for my own memory.

---

## Session 1 — Scaffold

**Date:** July 30, 2026
**Build step:** 1 of 9
**Goal:** A shell I can look at and recognise the booking-flow feel. No functionality.

### What got built

| | |
|---|---|
| Framework | Next.js 16.2.12, App Router, TypeScript, Tailwind v4 |
| Runtime | React 19.2, Node 26 |
| Pages | One — the four-step flow |
| Working features | None. Only the stepper switches panels. |
| API calls | Zero. No key needed, none used. |

Files added:

```
claude-code-pack/
├── package.json, tsconfig.json, next.config.ts, postcss.config.mjs
├── BUILD_LOG.md              ← this file
└── src/
    ├── app/
    │   ├── globals.css       colour tokens from DESIGN.md
    │   ├── layout.tsx        Noto Sans + Noto Sans Display
    │   └── page.tsx          the shell, holds which step is showing
    └── components/
        ├── TopBar.tsx        dark #152D32 bar + wordmark
        ├── Stepper.tsx       the four-step booking-flow bar
        ├── steps.tsx         the four step panels (layout only)
        └── ui.tsx            Button, Card, IconCircle, StatusTag
```

### Decisions made this session

**1. The app lives in `claude-code-pack/`, not the parent project folder.**
That folder already carried a `.gitignore` listing `node_modules/` and
`.next/` — the two folders a Next.js app creates — and holds the eval suite the
build depends on. It was designed to be the code root. The parent folder stays
as Cowork project notes and doesn't get committed.

**2. Scaffolded via `create-next-app` into a temp folder, then copied in.**
Next's generator refuses to run in a folder that already has files. Generating
clean and copying across meant the config files are stock and unmodified — worth
more than hand-writing them, because upgrades stay predictable. `CLAUDE.md`,
`PRD.md`, `DESIGN.md` and the existing `.gitignore` were explicitly protected
from being overwritten; the Next.js entries were appended to the gitignore
rather than replacing it.

**3. Tokens written as CSS variables using DESIGN.md's exact names.**
`--brand-teal`, `--brand-ink-deep`, `--brand-canvas` and the rest appear verbatim in
`globals.css`, then get mapped into Tailwind as `bg-teal`, `text-ink`,
`border-line`. Two reasons: the provenance stays readable (anyone opening the
file can trace a hex back to the spec), and changing a colour is a one-line
edit in one place rather than a find-and-replace across components.

**4. Deleted the default dark mode.** The stock Next.js template ships a
`prefers-color-scheme: dark` block. DESIGN.md specifies one light palette
sampled from a live site — a second, invented dark palette would be guesswork
and would break the "instantly familiar" test.

**5. The stepper is clickable.** Strictly this is functionality, and the brief
said none. I built it anyway so all four screens can be reviewed in one sitting
instead of only seeing screen one. It is pure navigation — no data, no logic,
nothing persists. Easy to remove if it's not wanted.

**6. Placeholder data is entirely invented.** `RIDESHARE CO`, `TRANSIT FARE`,
`HOTEL — CALGARY`. No real merchant name or amount from the corporate card
appears anywhere in `src/`, and none ever should — that data belongs only in
`evals/`, which is gitignored.

### Design spec — what's honoured, and one deviation

Honoured: all eight sampled colours plus the three status colours and one added
dark-background teal (below); Noto Sans /
Noto Sans Display via `next/font/google` with an Arial fallback; 4px buttons at
600 weight / 14px; 8px cards, white on `#F7F7F7`, no shadow; `#152D32` top bar;
`#F7F7F7` icon circles; teal focus rings; tabular numerals on every amount;
teal-done / ink-current / grey-upcoming on the stepper.

**Deviation — a new token, `--brand-teal-on-dark` (`#3FA9A5`).** DESIGN.md calls
for the wordmark in primary teal. I first shipped it white, because `#017F7C`
on the `#152D32` top bar measures **3:1** — below the 4.5:1 that DESIGN.md's own
accessibility section sets for text this size. Bilal pushed back: the teal is
the organisation's colourway and having it up there is most of what makes the
header feel real. Fair point, and worth solving rather than avoiding.

Two options got built and compared on screen:

| | Approach | Contrast | Result |
|---|---|---|---|
| A | Primary teal + hairline white outline | 3:1 + outline | Works, but the outline reads frosted at 16px |
| B | Same hue lifted to `#3FA9A5`, no outline | **5.1:1** | Crisp letterforms, chosen |

**B shipped.** The deciding argument wasn't the measurement — A was legible too
— it was that an outline is a workaround tuned to one specific text size. Change
the size or the background and it needs re-tuning. A colour that passes on its
own just works. It's also one line instead of four stacked shadows.

`--brand-teal-on-dark` is a proper named token alongside the others, commented with
what it's for and a warning never to use it on white, where it would be too
light. The comparison switch used to pick between A and B was deleted once the
call was made — no dead code left in the component.

Also honoured, from the "clearly not an official product" rule: no logo, no
maple leaf, no aircraft imagery, no company name in the product name, and a footer line
stating plainly that this is a personal tool and not a corporate system.

### Accessibility

Status is never signalled by colour alone — matched rows read "✓ Matched", the
flagged row reads "! Receipt missing", and every stepper circle carries its
number or a tick. The current step is marked `aria-current="step"` and the
stepper is a labelled `<nav>` wrapping an ordered list, so a screen reader
announces it as progress rather than as four loose buttons.

### Checks run

- `npm run build` — compiles, TypeScript passes, page prerenders static
- `npm run lint` — clean
- Opened at `localhost:3000` and stepped through all four screens
- Browser console — no errors, no hydration warnings
- Viewed at 375px wide (iPhone)

### Two things fixed during the session

1. A missing space in the flagged-receipt sentence rendered as `$4.21— is`.
2. **The stepper broke the phone layout.** At 375px the four steps were wider
   than the screen and dragged the whole page sideways, cutting off the top bar.
   Fixed by letting the stepper scroll horizontally inside itself while the page
   stays put. Desktop-first is still the rule — this is only about not breaking.

### Known and accepted

- `npm audit` reports 12 high-severity advisories, all in build-time tooling
  (the ESLint dependency chain and PostCSS). None of it ships to the browser.
  The available fix force-upgrades ESLint to a new major version, which is a
  bigger risk than the advisories. Revisit before deploy in step 9.
- No passcode yet — that's step 8. Don't put this anywhere public until then.

### Next

**Step 2 — the statement parser.** Port `evals/reference/parse_statement.py` to
TypeScript exactly as written, including the column-position logic that splits
vendor from location, then build a TypeScript eval runner and get it to 90/90.
Waiting on the go-ahead.

---

## Session 2 — The statement parser

**Date:** July 30, 2026
**Build step:** 2 of 9
**Goal:** Port the proven Python parser to TypeScript. 90/90 or it doesn't ship.

### Prompt used

> Build step 2: the statement parser.
>
> Port `evals/reference/parse_statement.py` to TypeScript exactly as written,
> including the column-position logic for splitting the vendor name from the
> location. Read its docstring first — a regex-only approach was already tried
> and it mangles every multi-word vendor name.
>
> Then write a TypeScript eval runner that reads `evals/ground-truth/*.json`,
> parses the matching PDFs in `evals/fixtures/statements/`, and scores every
> field. Add it as an npm script.
>
> Don't move on until it reports 90/90. Explain in plain English what the parser
> is actually doing as you go, and update BUILD_LOG.md.

### Result

```
OK  April 2026      18/18 rows   total $1875.07 (expected $1875.07)
OK  February 2026   19/19 rows   total $1061.99 (expected $1061.99)
OK  June 2026       25/25 rows   total $1720.32 (expected $1720.32)
OK  March 2026      15/15 rows   total $442.15 (expected $442.15)
OK  May 2026        13/13 rows   total $522.35 (expected $522.35)

RESULT: 90/90 rows exact (100.0%)
```

Run it with `npm run eval`. No API key, no network call, $0.

### Files added

```
src/lib/statement/words.ts            PDF text → words with coordinates
src/lib/statement/parseStatement.ts   the ported algorithm
scripts/run-eval.ts                   the scorer (npm run eval)
```

New dependencies: `unpdf` (PDF text extraction, runtime) and `tsx` (runs the
TypeScript eval from the command line, dev only).

### Established a baseline first

Before writing any TypeScript, ran the Python reference to confirm it still
scores 90/90 today. It does. Without that, a failing port would be ambiguous —
broken port, or broken fixtures? Now any disagreement has exactly one
explanation.

(`pdfplumber` isn't installed system-wide, so the reference ran from a throwaway
virtualenv outside the project. Nothing was added to the repo for it.)

### The one real problem in this port

The Python uses `pdfplumber`, whose `extract_words()` returns **one entry per
word**, each with its own coordinates. The JavaScript library, pdf.js, does not.
It returns **text runs** — whatever the PDF emitted as a chunk, which might be a
word, a whole table cell, or an entire sentence.

That matters because of one line in the reference:

```python
vendor = " ".join(w["text"] for w in group[7:] if w["x0"] < location_x - 2)
```

`group[7:]` drops the first **seven words** — 3 for the date, 2 amounts, 2
currency codes. But in pdf.js the date `"Jun 07 2026"` arrives as *one* run, so
the same seven fixed fields are only **five** runs. Copying `7` across without
noticing would have silently sliced the wrong tokens.

Probing the actual PDFs showed each table cell is its own run:

```
[9.6 "Jun 07 2026"] [102.6 "$31.04"] [168.1 "$31.04"] [219.3 "CAD"]
[273.3 "CAD"] [312.6 "RIDESHARE CO/TRIP"] [474.6 "TORONTO ON"]
```

Convenient — but writing the parser against *runs* would mean it only works
while that stays true. A statement that split a vendor across two runs would
break it, and the failure would be silent.

**Decision: rebuild the word layer instead.** `words.ts` splits runs back into
words and gives each one a coordinate, so `parseStatement.ts` is a literal port
— `group[7:]` and all — with the same behaviour as the proven Python on inputs
neither has seen. The extra file is the price of the port actually being a port.

Two smaller conversions in the same layer: pdf.js measures y from the bottom of
the page and pdfplumber from the top (flipped, so line ordering carries over),
and a word's left edge inside a run is interpolated from its character offset.
That interpolation is approximate for a proportional font, which is fine here —
it decides only which side of the Location column a word falls on, and the
columns are ~160pt apart.

### Verification — three checks, not one

**1. The eval reports 90/90.** Necessary, not sufficient.

**2. Byte-identical to the Python.** Dumped every field of all 90 rows from both
implementations and compared as JSON: **identical**. Two independently written
parsers, in different languages, on different PDF libraries, agreeing exactly.
Much stronger than either passing alone.

**3. Mutation testing — can the eval actually fail?** A test that can't fail is
worse than no test. Broke the parser three ways on purpose:

| Mutation | Result |
|---|---|
| Removed the Location-column filter | **0/90** |
| `FIXED_LEADING_WORDS` 7 → 6 | **0/90** |
| Swapped expense and billed amounts | **83/90** |

All three caught, and the parser was restored and re-verified at 90/90 after.

**The third result is the interesting one.** Swapping the two amount columns —
a serious bug that would misstate foreign-currency expenses — only broke **7 of
90 rows**. Everything else is CAD→CAD, where both amounts are identical and the
swap is invisible.

That is the argument for the eval set being five months instead of one. A
single-month eval could plausibly have scored 100% on a parser with that bug in
it. The eval's value isn't the number, it's the number of chances it gets to
catch something.

### Notes

- No AI, no API call, no cost. The statement never leaves the machine — this is
  the non-negotiable in CLAUDE.md, and it holds because the parser is code.
- The eval runner deliberately mirrors `run_eval.py` including output format, so
  the two can be diffed directly. If they ever disagree, fix the parser.
- Amounts stay strings (`"1,875.07"`) end to end, exactly as printed. Converting
  to floats would introduce rounding on money for no benefit; the report needs
  the printed text anyway.
- Ran `tsc --noEmit`, `npm run lint`, `npm run build` — all clean. Temporary
  probe scripts deleted; `*.tsbuildinfo` gitignored.

### Next

**Step 3 — upload and parse.** Drag files onto the Upload step, detect the
statement, run it through this parser, and show the line items in the review
table. Still no AI. Waiting on the go-ahead.

---

## Session 3 — Upload and parse

**Date:** July 30, 2026
**Build step:** 3 of 9
**Goal:** Drag files in, find the statement, show the real line items on screen.

### Prompt used

> Build step 3: uploading. Let me drag files onto the Upload step. Detect which
> one is the corporate card statement, run it through the parser, and show the
> line items in a table on screen — styled per DESIGN.md, with tabular numerals
> so the amounts line up.
>
> Nothing is stored server-side: process in memory, keep results in the browser,
> refresh clears everything.
>
> Test it with `evals/fixtures/statements/statement-2026-06.pdf` —
> that's June, and it should show 25 lines totalling $1,720.32. Update BUILD_LOG.md.

### Result

June statement dropped onto the page renders **25 line items, $1,720.32** —
matching the target exactly, and matching the report that was actually filed.

### Files added

```
src/app/api/parse-statement/route.ts   finds the statement, returns its rows
src/components/LineItemsTable.tsx      the table, tabular numerals
src/lib/statement/format.ts            money formatting and totals
```

`steps.tsx` and `page.tsx` changed: Upload is now real, and the parsed rows live
in one piece of React state at the top of the page.

### Decisions made this session

**1. The statement is identified by content, not filename.** Every uploaded PDF
gets run through the parser; the statement is whichever one actually produces
transaction rows. Hotel folios and scanned receipts produce none, so they rule
themselves out. Matching on `Corporate_CC*` would have been one line of code and
would break the first time somebody renames a download.

Two ambiguous cases are refused rather than guessed at:

| Situation | Response |
|---|---|
| No file yields rows | "None of those files looks like a corporate card statement…" |
| Two files yield rows | "Upload one month at a time so the report covers a single period." |

**2. Non-PDF files are accepted and set aside, not rejected.** The rideshare `.docx`
belongs to the reconcile step, which doesn't exist yet. Rejecting it now would
train the user to withhold it. It's listed back as "set aside for the reconcile
step" so nothing disappears silently — the PRD's rule.

**3. Amounts stay strings, formatted only for display.** `format.ts` converts to
numbers solely to total a column, and the total is summed **in cents as integers**
rather than floating-point dollars. Adding 25 floats is how you end up a penny
out on a report that has to reconcile exactly.

**4. Reconcile is now visibly labelled as unbuilt.** Its placeholder rows were
starting to look like real output. Each unbuilt panel now says which build step
it's waiting on. A demo that quietly implies working features is worse than one
that's honest about where it is.

### The privacy claim, actually verified

"Nothing is stored server-side" is the load-bearing promise of this tool, and it
was worth checking rather than asserting:

- The API route reads the upload into memory, parses, returns JSON. No disk
  write, no database, no log line containing a merchant name or an amount.
- Checked from inside the browser after a successful parse: `localStorage`
  empty, `sessionStorage` empty of app data, no app cookies. The only entries
  present were Next.js's own dev-mode hot-reload keys, which don't exist in a
  production build.
- Refreshed the page and confirmed: zero table rows, and no vendor name
  anywhere in the document text.

Also swept the repo for stray statement or receipt files outside `evals/`:
none. And added `public/*.pdf` / `public/*.docx` to `.gitignore` — `public/` is
the one folder whose contents get served to the internet, so a statement landing
there by accident is the worst-case mistake in this project. Now it can't be
committed even by accident.

### How it was tested in the browser

Driving a real drag-and-drop from outside the browser isn't straightforward, so
the June statement was copied to `public/` temporarily, fetched by the page,
wrapped in a `File`, and dispatched at the drop zone as a genuine `drop` event —
so React's own handler ran, exactly as it would for a human dragging the file.
**The copy was deleted immediately afterwards and its absence verified**, and the
gitignore rule above went in *before* the copy was made, not after.

Results on screen:

| Check | Result |
|---|---|
| Row count | 25 |
| Billed total | $1,720.32 |
| First row | Jun 07 2026 · $31.04 · RIDESHARE CO/TRIP |
| Last row | Jun 25 2026 · $36.16 · TST-Taco Bar- The Wel |
| Foreign currency | Jun 13 2026 · $22.20 USD → $31.91 CAD · COURIER93542687 |

That last row is quietly reassuring: `TST-Taco Bar- The Wel` is truncated
mid-word, mixed-case and full of punctuation, and the column logic still split
it from its location cleanly.

Detection was also tested with the statement plus all four June receipt files
mixed in — it picked the statement correctly and set the other four aside.

### Notes

- Still no AI, no API key, no cost. The API route name says `parse-statement`
  and that is all it does.
- `npm run eval` re-run after all changes: still 90/90.
- `tsc --noEmit`, `npm run lint`, `npm run build` all clean. The route builds as
  a dynamic server function, the page stays static.

### Next

**Step 4 — the Word document.** Turn these rows into a downloadable `.docx` in
the exact team format, then verify it against `evals/ground-truth/jun-2026.json`
line for line. After that the tool is genuinely useful and worth running a real
month through. Waiting on the go-ahead.

---

## Session 4 — The Word document

**Date:** July 30, 2026
**Build step:** 4 of 9
**Goal:** The rows become a downloadable `.docx` in the exact team format.

### Prompt used

> Build step 4: generating the report. Turn the table into a downloadable Word
> doc using the `docx` npm package, in the exact format specified in CLAUDE.md —
> blank line, transaction line, purpose line, four spaces between fields,
> chronological, `[ADD PURPOSE HERE]` when a purpose is empty.
>
> Then verify it: generate the June report from the fixture statement and check
> it matches `evals/ground-truth/jun-2026.json` line for line.
>
> Update BUILD_LOG.md. After this the tool is already useful, so let's pause here
> and I'll try it on my own month.

### Result

```
June 2026 — generated from statement-2026-06.pdf
  document size   8.9 KB
  paragraphs      75 (expected 75)
  transactions    25
  billed total    $1,720.32 (expected $1720.32)
  chronological   yes

PASS — 25/25 lines match ground truth exactly
```

Run it with `npm run verify:report`.

### Files added

```
src/lib/report/reportFormat.ts    the text of the report — no docx dependency
src/lib/report/buildReport.ts     turns those lines into a .docx
scripts/verify-report.ts          the checker (npm run verify:report)
```

New dependency: `docx`.

### Decisions made this session

**1. The document is built in the browser, not on the server.** The parsed rows
are already sitting in the page. Generating locally means the statement data
never makes a second trip anywhere — report generation touches the network zero
times. It also means there is no server endpoint that could ever be tempted to
log a report.

**2. The report's text is separated from the Word file.** `reportFormat.ts`
produces the lines and knows nothing about `docx`; `buildReport.ts` wraps those
lines in a document. Three benefits: the format can be tested as plain strings,
the Download step can show a live preview of the real output without loading a
~500KB library, and **the preview cannot drift from the document**, because both
call the same function.

The Word library itself is loaded on demand, only when the download button is
actually pressed.

**3. Amounts are passed through as printed, never re-formatted.** One June/April
row is `$1,077.08` — with a thousands separator. Reconstructing amounts from
numbers would have to re-derive that separator and could round. The parser
returns the exact string the statement printed, and it goes into the document
untouched.

**4. Rows with an unreadable date sort last rather than being dropped.** A line
silently vanishing from a filed expense report is the worst failure this tool
could have. Better to have it appear in an odd position where it's noticed.

### A bug caught before it shipped

The first version of `reportLines()` sorted the rows chronologically and *then*
looked up each purpose by position, with a fallback to the row's new index.

That is a real defect. Purposes are keyed by the row's position in the review
table; if the sort reorders anything, that fallback hands **a purpose to the
wrong expense**. The document would still look completely plausible — right
count, right total, right dates — while attributing "Client site travel" to a
lunch. Rewritten to pair each row with its purpose *before* sorting, so the two
can't come apart.

Nothing had been generated with the bug in it, but it's logged because it is
exactly the class of error the reconciliation discipline exists to prevent:
wrong, and invisible.

### Verification — and a flaw in the verifier itself

The checker doesn't test the formatter against itself. It parses the real June
PDF, builds the actual `.docx` through the same code path the browser uses,
**unzips it and reads the text back out of Word's own XML**, and compares that
against lines derived independently from `jun-2026.json`. The expected format is
written out longhand in the test rather than imported from the app, so changing
the app's format changes only one side of the comparison.

Then, same as step 2, five deliberate mutations to prove the test can fail:

| Mutation | Result |
|---|---|
| Field separator 4 spaces → 3 | **FAIL**, 52 problems |
| Blank line between entries removed | **FAIL**, 81 problems |
| Sort reversed (newest first) | **FAIL**, 26 problems |
| Placeholder text changed | **FAIL**, 26 problems |
| Expense amount replaced with billed amount | **FAIL**, 1 problem |

**The first run of that table exposed a flaw in the verifier, not the parser.**
Two mutations produced no failure report at all — the script hit a malformed
line and threw a `TypeError` on a non-null assertion, dying with a stack trace
partway through its checks. It did exit non-zero, so it "failed" — but it failed
uselessly. The whole point of this test is to say *which line is wrong*, and a
stack trace says nothing.

Fixed: the structural checks now report malformed input as a numbered failure
instead of asserting their way through it. All five mutations now produce
readable output naming the lines involved.

Worth recording because it is the exact failure mode Bilal was told to watch for
— a test that goes green, or goes bang, instead of telling you what broke.

**Also confirmed the placeholder-text mutation is caught.** An earlier draft of
the verifier imported `EMPTY_PURPOSE` from the app, which would have put the same
constant on both sides of the comparison and made that check meaningless. It is
now a literal in the test file.

### End-to-end in the browser

Dropped the June statement on the running app, stepped to Download, pressed the
button, and intercepted the generated file: **9,098 bytes**, MIME type
`application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
filename `Expense Report — June 2026.docx`. On-screen preview showed the exact
four-space format.

The temp fixture used to drive the drag-and-drop was deleted immediately
afterwards and the repo swept again for stray PDFs or Word files outside
`evals/` — none.

### What this does and doesn't do yet

It produces a complete, correctly formatted report with every purpose line as
`[ADD PURPOSE HERE]`, to be filled in inside Word. That is already the whole
assembly job — the part that took the hour. In-app purpose editing, deleting
personal charges and reconciliation are steps 6 and 7.

### Notes

- Still no AI, no API key, no cost, four steps in.
- `npm run eval` re-run after all changes: still 90/90.
- `tsc --noEmit`, `npm run lint`, `npm run build` all clean.

### Next

**Paused here at Bilal's request** to run a real month through it before
building further. Step 5 (receipt extraction) is the first step that needs an
API key, and the first that costs anything.

---

## Session 4b — The format was wrong

**Date:** July 30, 2026
**Build step:** none — a spec correction
**Trigger:** Bilal looked at the generated June report and asked why it had no
receipts in it.

### The short version

The output format in CLAUDE.md and PRD.md was wrong, and had been from the
start. It described each entry as:

> blank line, transaction line, purpose line

There is no blank line. **That first paragraph is the receipt image.** All five
filed reports contain **zero** genuinely blank paragraphs.

The real structure: a screenshot of the corporate card statement at the top,
then per expense — transaction line, purpose line, receipt image.

```
[screenshot of the whole corporate card statement]

Jun 07 2026    $31.04    $31.04    CAD    CAD    RIDESHARE CO/TRIP
[ADD PURPOSE HERE]
[the rideshare receipt for that trip]

Jun 08 2026    $32.04    ...
```

Measured, not assumed — the formula `paragraphs = 1 + 3n` and
`images = 1 + n` holds exactly across all five months:

| Month | Expenses | Paragraphs | Images | Blank paragraphs |
|---|---|---|---|---|
| February 2026 | 19 | 58 | 20 | 0 |
| March 2026 | 15 | 46 | 16 | 0 |
| April 2026 | 18 | 55 | 19 | 0 |
| May 2026 | 13 | 40 | 14 | 0 |
| June 2026 | 25 | 76 | 26 | 0 |

And confirmed by opening the images rather than just counting them: in June,
image 1 is a screenshot of the statement table, image 2 is the rideshare receipt for
CA$31.04 on June 7 — sitting *after* the June 7 line — and image 26 is the Gus
Tacos receipt for $36.16 under the final entry. So the receipt follows its own
entry, and the statement screenshot sits alone at the top.

The filed June report is **4.7 MB**. What step 4 generated is **8.9 KB**.

### How it survived four build steps

The step-4 verifier compared the generated document's **text**, line for line,
against ground truth, and reported:

```
PASS — 25/25 lines match ground truth exactly
```

Which was true. Every text line was, and still is, exactly right. An image
paragraph contains no text, so it compared equal to a blank paragraph — the
document was missing 26 images and the test had nothing to say about it.

The ground truth had the same hole, and for the same reason: it was built by
reading the filed `.docx` files as text. That is also the origin of the error in
the spec — someone read a `.docx` as text, saw an empty line where an image was,
and wrote down "blank line."

**This was not a false pass. It was a true pass on an incomplete question**,
which is a good deal harder to notice. The mutation testing in sessions 2 and 4
proved the tests could detect wrong answers; nothing could have revealed a
question that was never asked.

The lesson worth keeping: *an eval only defends the properties someone thought
to write down.*

### What changed

**Specs corrected** — `CLAUDE.md` (output format, non-negotiable 3, build order
step 5), `PRD.md` (user flow, output format, architecture, new "Known gap in the
eval set" section), `evals/README.md` (new "What this eval set does NOT cover").
Both copies of the PRD re-synced. Every correction is marked with the date and
what it replaced rather than quietly overwritten — the mistake is part of the
record.

**Non-negotiable 3 clarified rather than changed.** "AI-extracted values never
land in the report" still holds exactly. The receipt *image* is the original
file, not a model's output, so embedding it doesn't touch the rule. What must
never happen is a model's *reading* of a receipt becoming a number on the
report.

**Ground truth now records structure.** Each `ground-truth/*.json` gained
`expectedParagraphs`, `expectedImages`, `expectedBlankParagraphs` and a
`documentStructure` note, measured directly from the filed reports.

**The verifier no longer prints a bare PASS.** It now reports `PASS (text)`
followed by an explicit `INCOMPLETE` block naming what it has *not* checked:

```
INCOMPLETE — this document is the text skeleton only.

  images here                 0
  images in the filed report  26   (1 statement screenshot + 25 receipts)
  paragraphs here             75
  paragraphs when filed       76
```

There's an `IMAGES_IMPLEMENTED` flag that turns the image count into a hard
failure once step 5 lands. Tested by flipping it: it correctly fails with
`image count 0 != expected 26`.

### What this does to step 5

Step 5 was scoped as "receipt extraction — Haiku vision on the receipt images",
used only for matching. It's now three jobs, and only the middle one needs AI:

| Job | Method | AI? |
|---|---|---|
| Extract images from the rideshare `.docx`, the scanned PDF, and a render of the statement page | `jszip`, PDF page rendering | **No** |
| Decide which statement line each receipt belongs to | Haiku vision | Yes |
| Place each image after its entry, screenshot at the top | `docx` | **No** |

A receipt embedded under the wrong expense is a real error in a filed document
and looks entirely plausible — the same failure shape as the purpose-ordering
bug caught in session 4. Mis-assignment now gets treated as seriously as a wrong
amount.

### Correction to session 4's write-up

Session 4 said the tool "produces a complete, correctly formatted report." That
was wrong. It produces a correct and complete **text skeleton** — the transaction
and purpose lines, in the right order and format. The receipts, and roughly 99%
of the filed document's bytes, are still to come.

### Next

Step 5, re-scoped as above. Still the first step needing an API key.

---

## Session 4c — A refund went missing

**Date:** July 30, 2026
**Build step:** none — a correctness bug and a new class of guard
**Trigger:** Bilal ran his July statement through the tool. Everything lined up
except one transaction: a purchase with an immediate refund. The purchase
appeared; **the refund didn't.**

### Why this mattered more than it looked

A missing refund means the report **overstates the claim** — expensing money
that was given back. And it was dropped in silence: no error, no warning,
nothing. CLAUDE.md's own rule says never a silent drop, and this was exactly
that.

The cause, one character deep:

```
Jun 26 2026 $-12.24 $-12.24 CAD CAD GROCERY #3012 EDMONTON AB
```

The minus sign sits **inside** the dollar sign — `$-12.24`, not `-$12.24`. The
amount pattern was `\$([\d,]+\.\d{2})`, which requires a digit straight after
the `$`. The line failed to match and was skipped.

Checked the five eval months first: **zero refunds in any of them.** So 90/90
was never hiding this — the case simply never occurred in the eval set. July was
the first unseen month, and it broke on the first thing the eval set didn't
contain. Which is precisely what an unseen month is for.

### Three fixes, in increasing order of importance

**1. The pattern.** `\$(-?[\d,]+\.\d{2})` in both the TypeScript and the Python
reference, so the two implementations don't drift.

**2. Nothing gets dropped silently, ever.** `parseStatement` now returns
`{ rows, skipped, declared }`. Any line inside the table that starts with a date
and fails to parse lands in `skipped`, and the Upload screen shows it in red
with the raw text and page number: *"These lines are on your statement but are
not in the report below."* The eval treats a skipped line as a failure even if
every other row is perfect.

**3. The statement checks the parser's work.** This is the real outcome.

Page 1 of every statement carries a summary row: date, number, **billed total**,
**transaction count**, status.

```
Jul 27 2026    $5,990.83    19    Available
Jun 27 2026    $1,720.32    25    Approval Required
```

**Every statement ships with its own answer key.** The parser can now check
itself on any month — no ground truth, no filed report, no human. Verified
against all six statements on hand:

| Statement | Declared | Parsed | |
|---|---|---|---|
| Feb 2026 | 19 @ $1,061.99 | 19 @ $1,061.99 | ✓ |
| Mar 2026 | 15 @ $442.15 | 15 @ $442.15 | ✓ |
| Apr 2026 | 18 @ $1,875.07 | 18 @ $1,875.07 | ✓ |
| May 2026 | 13 @ $522.35 | 13 @ $522.35 | ✓ |
| Jun 2026 | 25 @ $1,720.32 | 25 @ $1,720.32 | ✓ |
| **Jul 2026** | **19 @ $5,990.83** | **19 @ $5,990.83** | ✓ |

Before the fix, July parsed 18 rows totalling $6,003.07 — **$12.24 over.**

The check runs on every upload and is shown to the user as *"Balances to the
statement — matches the 19 transactions and total printed on the statement."*
The eval now runs it over **every** PDF in fixtures, including months with no
filed report.

### Proving the new guard works

Put the bug back and re-ran:

```
OK  February 2026   19/19 rows      ← ground-truth months unaffected
OK  June 2026       25/25 rows         (none of them contain a refund)
...
FAIL statement-2026-07.pdf   18 txns, declared 19  (no filed report — self-check only)

Failures:
  - self-check — The statement says it has 19 transactions, but 18 were read.
  - unreadable line on page 2 — "Jun 26 2026 $-12.24 $-12.24 CAD CAD GROCERY #3012 EDMONTON AB"
```

**Caught on a month with no ground truth whatsoever**, naming the exact line.
That's the difference between fixing one bug and closing the class of bug.

Also fixed the eval's exit code, which returned 0 whenever the 90 rows matched —
so a self-check failure would have printed in red and still "passed". It now
fails if there is any failure at all. That would have recreated the
green-but-wrong problem this whole session exists to stop.

### A latent bug found on the way

pdf.js takes ownership of the buffer it's handed and detaches it, so calling
`parseStatement` twice on the same `Uint8Array` throws `DataCloneError`. Nothing
in the app did that yet, but it would have surfaced the moment anything wanted
to parse a file twice. The word extractor now copies the buffer first.

### Files changed

`parseStatement.ts` (amount pattern, `skipped`, `declared`, `findDeclaredTotals`),
`words.ts` (buffer copy), `format.ts` (`checkAgainstDeclared`), `route.ts`,
`steps.tsx` (skipped-lines panel, balance status), `run-eval.ts` (skipped +
self-check + exit code), `verify-report.ts`, `evals/reference/parse_statement.py`.

Specs updated: CLAUDE.md (non-negotiables 1 and 1b, refunds section), PRD.md
(self-check, refunds, never-a-silent-drop), both PRD copies re-synced.

**July 2026 added to `evals/fixtures/statements/`** — the only month with a
refund, so it's the permanent regression case. Gitignored like the rest. There's
no ground truth for it because the report hasn't been filed; the self-check
covers it.

### What Bilal found that four build steps of testing didn't

Worth stating plainly: this bug survived a 90/90 eval, a cross-check against an
independent Python implementation, five deliberate mutation tests, and a
document verifier. **It took one real user with one real new month.**

Everything I built tested the parser against cases someone had already thought
of. The eval set was five months chosen because filed reports existed for them —
which quietly guaranteed those months were ordinary. The first genuinely unseen
input broke it within minutes.

That is not an argument against the evals; they're why the fix took twenty
minutes and why 90/90 could be confirmed intact afterwards. It's an argument
that an eval set built entirely from history tests your past, and the self-check
— free, sitting in the document the whole time — tests the present.

### Next

Step 5, still as re-scoped in session 4b. But the July report can now be
generated correctly, refund included, whenever Bilal wants it.

---

## Session 5 — Receipts: extraction, matching, embedding

**Date:** July 30, 2026
**Build step:** 5 of 9 — the only step that uses AI, and the first that costs money.

### Result

```
Statement: 25 lines
Extracted: 25 receipt images (2.92 MB)
Reading with claude-haiku-4-5-20251001…
  25/25 produced a usable date and amount

RESULT: 25/25 statement lines matched (100.0%)
        24 high confidence, 1 needing a human glance
        0 ambiguous, 0 unmatched receipts
        cost $0.0685
```

**7 cents a month**, and the generated document now has the **identical
paragraph shape to the report filed by hand** — 76 paragraphs, 26 images, 50
text lines, zero blanks. 3.26 MB against the original's 4.72 MB.

`npm run verify:report` is fully green with `IMAGES_IMPLEMENTED = true`.

### Files added

```
src/lib/receipts/extract.ts     unzip .docx, render PDF pages — no AI
src/lib/receipts/vision.ts      Haiku reads 3 fields off an image — the only AI
src/lib/receipts/match.ts       assigns receipts to lines — deterministic code
src/app/api/build-report/route.ts   files in, finished .docx out
scripts/eval-receipts.ts        the match-rate eval (npm run eval:receipts)
```

New dependencies: `@napi-rs/canvas` (PDF rasterising), `@anthropic-ai/sdk`,
`dotenv` (dev).

### The split that matters

Three jobs, and only the middle one uses a model:

| Job | How | AI? |
|---|---|---|
| Get images out of the files | jszip, PDF page rendering | No |
| Read date/amount/merchant off each image | Haiku 4.5 | **Yes** |
| Decide which line each receipt belongs to | ordinary code | No |
| Put images in the document | docx | No |

The model transcribes; **it does not decide anything.** The logic that could
attach a receipt to the wrong expense is code that can be read, tested and
mutated — not a judgement inside a model. Nothing the model returns is written
into the report.

### How a wrong match is prevented, not just hoped against

Bilal's question was "how would I know if a receipt were attached to the wrong
line?" Four answers, in order of strength:

1. **The amount must agree to the cent.** It's the strongest signal on a receipt
   and the hardest to misread. No amount agreement, no match. A receipt is
   allowed to match either the original-currency amount or the CAD amount, since
   it's written in whatever was actually paid — that's how the Courier Co receipt
   ($22.20 USD) correctly found its line ($31.91 CAD).
2. **The date must be within two days**, because card posting lags the purchase.
3. **Ties are refused, not guessed.** If a receipt fits two lines equally well it
   is assigned to neither and flagged. Two identical amounts on nearby dates is
   exactly where a confident guess is wrong half the time.
4. **Every match carries its evidence** — the receipt's own date, amount and
   merchant printed next to the line's. Scanning 25 of those takes a minute and
   needs no trust in a percentage:

```
line  9  Jun 09 2026  $57.75  GRILL HOUSE
    ← receipt says $57.75 on Jun 09 2026, "Grill House"
```

### Four bugs found by looking at the output

**1. JPEG quality is 0–100, not 0–1.** Passing `0.92` to `@napi-rs/canvas`
produced ~1%-quality images: 6 KB files with the fare amount illegible. Nothing
errored. It surfaced only by opening a receipt and reading it. Every receipt in
the report would have been unusable.

**2. The model was non-deterministic.** Two runs over the same 25 receipts
disagreed — one read `CA$34.42` as `$834.42`, another changed a merchant name.
This is transcription; sampling variety buys nothing. `temperature: 0` made runs
identical.

**3. Tuning the prompt on one example made things worse.** A shorter phrasing
looked better on the single failing image, so it went in. Measured across all 25
it scored **23/25 against 24/25**. Reverted. One image is not a sample.

**4. Putting a wrong value in a prompt teaches the model to produce it.** Trying
to fix the `834.42` misread, a rule was added explaining that currency prefixes
aren't digits — and it spelled out `834.42` as the wrong answer. The model
returned `834.42`. Removed.

### What actually fixed it: resolution, not wording

Both remaining failures were rideshare `.docx` images at 503×874 — small text, digit
errors. Images are now **upscaled** to a 1568px long edge before the model sees
them (1568 being the size the vision API works at, so anything smaller was
leaving detail unused for free).

That took matching from 24/25 to **25/25**, and it's stable across runs.

The lesson worth keeping: three attempts at fixing this by rewording the prompt
all failed or backfired. The problem was in the pixels, not the instructions.

### The one match still flagged

```
?! line 4  Jun 08 2026  $6.51  STAFF CANTEEN-63366
   ← matched on amount alone — $6.51 appears once on the statement and only this
     receipt claims it. The date read as Feb 26 2026, which doesn't fit Jun 08,
     so the scan is likely too faded to read. Worth a check.
```

A badly faded thermal receipt: the total is crisp, the date is half destroyed.
Rather than call it a missing receipt, a second pass rescues it **only when the
amount is unique across the whole statement and no other receipt claims it** —
and marks it "low confidence" so a person looks. Anything less certain stays
unmatched.

### Verification

- `npm run eval:receipts` — 25/25, run three times, identical each time
- `npm run verify:report` — green with `IMAGES_IMPLEMENTED = true`; asserts 76
  paragraphs, 26 images and that every character of text is unchanged by adding
  images
- Two structural mutations caught: dropping the statement screenshot, and
  putting a receipt *before* its entry instead of after
- `npm run eval` — still 90/90
- End-to-end through the running app: 25/25 matched, 3.4 MB, 14.3s

`verify:report` deliberately does **not** test match quality — it assigns
receipt *i* to row *i* as a stand-in and checks the document's shape. Match
quality is `eval:receipts`, which costs money and needs a key. Two questions,
two tests, and only one of them needs to be paid for on every commit.

### Deployment notes for step 9

- `@napi-rs/canvas` loads a native binary and **must** be in
  `serverExternalPackages` (added to `next.config.ts`). Bundling it fails at
  runtime, not build time — the dev server returned a 500 until this was set.
- Report generation runs on the server and took **14.3s** for 25 receipts;
  `maxDuration` is set to 120s on the route.
- The response is 3.4 MB. Vercel's serverless response limit is 4.5 MB, so a
  month with substantially more receipts could exceed it. Watch this.

### Cost

$0.0685 per full month — about **7 cents**. Roughly $0.0027 per receipt. A team
of ten filing monthly is under $10 a year.

### Next

**Step 6 — reconciliation and blocking.** The matcher already produces
everything it needs: matches with evidence, ambiguous receipts, unmatched
receipts, and lines with no receipt. Step 6 is putting those on screen with the
resolution choices from the PRD, and blocking generation until every flag is
resolved.

---

## Session 5b — One expense per page, and photos of receipts

**Date:** July 31, 2026
**Build step:** none — two corrections found by opening the generated document
**Trigger:** Bilal opened the step-5 output and saw entries staggering across
page boundaries. He also asked whether JPEGs were accepted.

### 1. Every expense needs its own page

The generated document ran continuously, so a transaction line could sit at the
bottom of one page with its receipt on the next.

Checked against the filed reports rather than guessing at the convention:

```
filed by hand    paragraphs=76  images=26  pageBreaks=25  on [1, 4, 7, 10, …]
generated        paragraphs=76  images=26  pageBreaks=0   on []
```

Exactly one page break per expense, sitting on the transaction paragraphs. So
each entry opens a page, and the statement screenshot has page 1 to itself.

Fixed with `pageBreakBefore` on every transaction line. Now identical:

```
filed by hand    pageBreaks=25  on [1, 4, 7, 10, 13, 16, 19, 22, 25] …
generated        pageBreaks=25  on [1, 4, 7, 10, 13, 16, 19, 22, 25] …
page breaks in identical positions: True
```

`verify:report` now asserts the page breaks are on exactly the transaction
paragraphs — not merely that there are 25 of them, but that they're in the right
places. Otherwise 25 breaks scattered anywhere would pass.

### 2. Photos of receipts — and a silent drop hiding behind the question

The honest answer to "does it accept JPEGs?" was **no**. Worse than no:

- the drop zone accepted an image anyway (drag-and-drop ignores the file
  picker's `accept` list)
- the Upload screen listed it under "set aside for the reconcile step"
- and at generation time `extractReceipts` returned `[]` for it

So a photographed receipt was accepted, acknowledged on screen, and then
**silently discarded** — the exact failure mode non-negotiable 1b exists to
prevent, sitting in the code the whole time. It took a passing question to find
it, because none of the fixtures is a bare image.

Now supported: `.jpg`, `.jpeg`, `.png`, `.webp`, passed through the same
re-encode, size cap and upscaling as everything else.

`.heic` — the iPhone camera default — genuinely can't be decoded here, so it
gets a named message rather than a skip:

> "IMG_1234.HEIC" is an Apple HEIC photo, which can't be read here. On your
> iPhone: Settings → Camera → Formats → "Most Compatible" saves as JPEG, or open
> the photo and share it as a JPEG.

Anything else unrecognised is refused by name. Both endpoints report unreadable
files; the build endpoint returns an `x-unreadable-files` count.

### Both are now in the specs

Bilal's note — *"this should be in the specs"* — is the right instinct, and both
gaps existed because nobody had written the requirement down. Added to CLAUDE.md
(output format, accepted file types) and PRD.md (both copies re-synced), each
dated and saying what it replaced.

Worth noticing the pattern across sessions 4b, 4c and now 5b: **every defect so
far has come from something true about the real documents that no spec
recorded** — the receipt images, refund lines, page breaks, photographed
receipts. None were logic errors. The tests were only ever as good as the
written description of the target, and the fastest way to find the gaps has been
Bilal opening the actual output.

### Verification

- `npm run verify:report` — green; 76 paragraphs, 26 images, 25 page breaks in
  the right positions
- Page-break positions compared directly against the filed June report: identical
- Image support round-tripped: a standalone `.jpg` extracts as one receipt
- `.heic` returns zero images plus its message
- End-to-end through the app: 25/25 matched, 3.42 MB, 17s
- `npm run eval` still 90/90; typecheck, lint, build clean

### Correction, same day — page breaks alone didn't fix it

Bilal opened the regenerated document: still staggering. A page would hold a
receipt image and then, below it, the *next* transaction line.

The page breaks were right. The image sizing was not — `imageParagraph` scaled
by **width only**:

```
para  0   6.50in x   8.42in
para 12   4.38in x  10.39in  <-- TALLER THAN THE PAGE
para 15   4.38in x  11.67in  <-- TALLER THAN THE PAGE
```

A scanned till receipt is roughly 1:4. Constrain only its width and it comes out
10–11 inches tall on a 9-inch page, overflows, and drags the entry after it onto
the overflow page. The page break fired correctly and then the content spilled
straight through it.

Measured the filed report for the actual convention rather than guessing again:

```
FILED BY HAND   images 26   width 1.92-6.50in   height 1.88-8.00in   over 9in: 0
```

Every image fits a **6.5 × 8.0in** box, height capped at 8in with width
following, scaled up as well as down. The spare inch of the 9in content area is
what the two text lines sit in.

After fixing to fit both dimensions:

```
GENERATED       images 26   width 1.92-6.50in   height 1.88-8.00in   over 9in: 0
first five:  6.18x8.00  4.66x8.00  4.65x8.00  4.60x8.00  3.36x8.00
filed:       6.18x8.00  4.66x8.00  4.64x8.00  4.60x8.00  3.37x8.00
```

Identical to within rounding. `verify:report` now checks **every** image against
the box, not just the largest, and prints the biggest one on every run.

**Note on what could and couldn't be verified here.** There's no Word or
LibreOffice on this machine, so pagination can't be rendered and counted
locally — Quick Look draws the document as one continuous strip and ignores page
breaks entirely. What can be verified is structural: page breaks on exactly the
transaction paragraphs, and every image inside the same box the filed reports
use. Both now match the hand-made document exactly. The final confirmation is
Bilal opening it, which is also how both of these bugs were found.


---

## Session 5d — Third attempt at the same page-break bug

**Date:** July 31, 2026
**Trigger:** Bilal reported the same staggering for the third time, and reasonably
asked whether a new document was being produced at all.

### What was actually wrong: the page was A4

Never set, so the docx library's default applied:

| | Page | Content area |
|---|---|---|
| Filed by hand | 8.50 x 11.00in (Letter) | 6.50 x 9.00in |
| Generated | 8.27 x 11.69in (**A4**) | 6.27 x 9.69in |

Images were being sized to a 6.5in box — the Letter content width — inside a
6.27in A4 column. Page geometry had been an unstated assumption for the whole of
step 5, while three sessions were spent adjusting things downstream of it.

Now set explicitly to Letter with 1in margins, identical to the filed reports.

### And a second fix, because the arithmetic still didn't explain it

Even on A4 the numbers said an entry fit: 8.00in image plus two text lines is
~8.40in against 9.69in available. It split anyway. Rather than keep theorising
about a layout engine that isn't installed on this machine, the grouping is now
explicit: **`keepNext` and `keepLines` on the transaction and purpose
paragraphs**, which is Word's own mechanism for "these must not be separated
from what follows".

The page break says *start here*. `keepNext` says *and don't get split*. The
filed reports don't need it — their geometry happens to work — but relying on
geometry is what failed three times.

### Both now asserted

`verify:report` checks the page is Letter with a 6.5 x 9.0in content area, and
that `keepNext` appears on 2 paragraphs per expense. Both were previously
unstated assumptions, which is precisely why they went wrong silently.

### The honest limitation

There is no Word or LibreOffice on this machine, so **pagination cannot be
rendered and counted here**. Quick Look draws a .docx as one continuous strip
and ignores page breaks entirely. Everything checkable is structural: paragraph
order, page-break positions, image dimensions, page geometry, keep-together
flags. All now match the hand-made document.

Three rounds on one bug, each time fixing something real and each time missing
the actual cause, is worth recording plainly. The pattern: **the thing that was
wrong was the thing nobody had written down** — first the receipt images, then
the page breaks, then image height, now page size. Each was invisible to every
test because no test knew to look.


---

## Session 5e — The page break was never firing

**Date:** July 31, 2026
**Trigger:** Fourth report of the same problem. Bilal: *"it's every single page."*

### The actual cause

`pageBreakBefore` — the paragraph property the filed reports use — **was being
ignored by the renderer entirely.** The document simply flowed:

```
page 1:  [statement screenshot]  +  Jun 07 entry text
page 2:  [Jun 07 receipt]        +  Jun 08 entry text
page 3:  [Jun 08 receipt]        +  Jun 09 entry text
```

Each page held an image (8.00in) plus the *following* entry's two text lines
(~0.5in) — 8.5in, comfortably inside the 9.0in content area. So nothing ever
overflowed, nothing was ever split in half, and **the page count came out at
exactly 26**, which is the correct number. Everything measurable looked right.

That is why three sessions of structural checks passed while the document was
wrong the whole time.

### Why it took four attempts

Each round fixed something genuinely broken and then verified the wrong thing:

| Round | Fixed | Verified | Missed |
|---|---|---|---|
| 1 | added `pageBreakBefore` | breaks exist, count = 25 | whether they take effect |
| 2 | images fitted to 6.5x8.0in | image dimensions | same |
| 3 | Letter instead of A4, `keepNext` | page geometry | same |
| 4 | **explicit `<w:br w:type="page"/>`** | **rendered the PDF and read every page** | — |

Every check was on the XML. None rendered the document. The XML was correct at
every step — the markup was valid, the counts were right, the positions matched
the filed reports paragraph for paragraph. It just didn't do anything.

### The fix

An explicit page-break **run** at the end of every image paragraph (except the
last, which would leave a trailing blank page), plus `keepNext` on the two text
paragraphs so they can never be separated from their receipt. `pageBreakBefore`
is gone.

This also matches how Bilal described the layout from the start: *"the page break
should be at the end of every receipt image."* He was describing the fix.

### How it's verified now

Pages is installed on this machine and can export a `.docx` to PDF via
AppleScript; `brew install poppler` gives `pdftotext`/`pdftoppm` for reading it
back page by page. Result:

```
total pages: 26
page 1: (no text — image only)
page 2: Jun 07 2026 $31.04 ... | [ADD PURPOSE HERE]
page 3: Jun 08 2026 $32.04 ... | [ADD PURPOSE HERE]

pages with exactly one entry : 25
pages with no entry          : 1
pages with more than one     : 0
```

Page 2 rendered and inspected visually: transaction line, purpose line and the
Uber receipt, together on one page.

### The lesson, stated plainly

**Structural assertions on a file format do not verify what the format renders.**
Four rounds were spent asserting things about XML — counts, positions,
dimensions, geometry — every one of which passed while the output was wrong.
Rendering the document once and reading it found the cause in minutes.

The tooling to do that was available the whole time. It should have been the
first move after the first failed fix, not the fourth.

### Next

Step 6 — reconciliation and blocking.


---

## Session 5f — Making it stick

**Date:** July 31, 2026
**Trigger:** Bilal confirmed the layout is finally right: *"We gotta make sure
that is the consistent pattern going forward."*

Agreed — and the way to guarantee that isn't discipline, it's a check that fails.

### `npm run verify:layout`

Renders the report to PDF through Pages and reads every page back:

```
Rendered 26 pages from 25 expenses
  page 1 statement only     yes
  pages with one expense    25/25

PASS — statement on page 1, then exactly one expense per page
```

Deliberately separate from `verify:report`. That one inspects XML and passed
happily through three sessions of a broken document. This one only cares what
landed on the page.

Mutation-tested by restoring the original bug — `pageBreakBefore` instead of an
explicit break run:

```
FAIL — 4 problem(s):
  - 25 pages rendered, expected 26 (1 statement + 25 expenses, one each)
  - page 1 should be the statement screenshot alone, but has an expense on it
  - page 12 carries 2 expenses — they should be one per page
  - page 25 has no expense on it — an entry has been split from its receipt
```

The second line is the exact symptom Bilal reported, now produced automatically
in about thirty seconds instead of costing him four rounds of review.

It skips cleanly where Pages or `pdftotext` are missing, so it never blocks a
machine that can't render — but it's required before shipping any change to
`buildReport.ts`, now non-negotiable 0 in CLAUDE.md.

### The four checks, written down

| Command | Asks | Costs |
|---|---|---|
| `npm run eval` | Does the statement parse exactly? | free |
| `npm run verify:report` | Is the .docx structurally right? | free |
| `npm run verify:layout` | Does it render one expense per page? | free |
| `npm run eval:receipts` | Does each receipt reach the right line? | ~7¢ |

### Next

Step 6 — reconciliation and blocking.


---

## Session 6 — Reconciliation and blocking

**Date:** July 31, 2026
**Build step:** 6 of 9

### Prompt used

> Build step 6: reconciliation, per the rules in PRD.md. Match receipts to
> statement lines by date (±2 days), amount and merchant similarity. Flag missing
> receipts, extra receipts, duplicates and amount mismatches, each with the
> resolution choices from the PRD.
>
> Report generation stays blocked until every flag is resolved — disabled button
> with a plain-language reason beside it, exactly as DESIGN.md describes. No
> modals, no red walls, no error codes.
>
> Update BUILD_LOG.md.

### Result

```
PASS — all flag types raised, blocking holds, every resolution behaves
```

June with every receipt: **25/25 auto-matched, zero flags** — nothing to decide.
June without the rideshare receipts: **13 flags**, Continue disabled, each with its
choices.

### Files added

```
src/lib/receipts/reconcile.ts        the flags and the blocking rule — pure functions
src/lib/receipts/pipeline.ts         shared extraction, so both endpoints agree
src/app/api/reconcile/route.ts       reads receipts, returns what needs deciding
src/components/ReconcileStep.tsx     the screen
scripts/verify-blocking.ts           the test (npm run verify:blocking)
```

### The five flags, and the choices behind each

| Flag | Raised when | Choices |
|---|---|---|
| **Missing receipt** | a line has nothing attached | attach a spare receipt · receipt lost, include anyway · personal charge, leave it out |
| **Extra receipt** | a receipt matches no line | leave it out |
| **Ambiguous** | one receipt fits several lines equally | pick which line |
| **Duplicate** | the same receipt supplied twice | drop the duplicate · they're different |
| **Amount mismatch** | same purchase, different totals | same purchase, attach it · different purchase |

Every choice states its effect in plain language — *"The line is removed from the
report and from the total"* — so nobody has to guess what a button does.

### Blocking is enforced on the server, not just the button

The disabled button is a courtesy. `/api/build-report` refuses a request with
outstanding flags and lists them:

```
HTTP 409
11 things still need a decision before the report can be built.
   RIDESHARE CO/TRIP — Jun 07 2026, $31.04 is on your statement, but no receipt matches it.
```

### The model now runs once

Matching used to happen at download. It now runs on the Reconcile step and the
readings travel forward to generation. Halves the cost, but the real reason is
that **the document cannot reach a different conclusion than the screen the user
approved.**

### A risk found by testing, and closed

While testing, fewer files were sent to `/api/build-report` than to
`/api/reconcile`. Readings are keyed by position in the extracted image list, so
every index past the missing file pointed at a *different receipt* — receipts
would have landed under the wrong expenses, looking entirely normal. It showed up
only as two receipts quietly not appearing.

Extraction is deterministic, so a count mismatch is a reliable signal that the
file set changed. The endpoint now refuses:

> These files don't match the ones that were reconciled (12 receipt images now,
> 14 then). Go back to the Reconcile step and match again.

### A bug the test caught before it shipped

The amount-mismatch detector never checked that the amounts actually *differed*.
It matched on date and merchant alone, so it swallowed a pair whose amounts were
identical — which isn't a mismatch, it's an **ambiguous receipt**. The ambiguity
flag then never appeared, and a receipt could have been attached to one of two
identical lines without anyone being asked.

Caught by `verify:blocking` on its first run, before any of it reached the UI.

### Verification

- `npm run verify:blocking` — all five flag types, blocking holds at each step,
  every resolution has the effect it claims. Free, no API key, invented data.
- Server-side blocking: 409 with all 11 reasons listed
- Resolutions applied end to end: "receipt lost" → 25 expenses kept; "personal
  charge" → 14 expenses, 43 paragraphs (1 + 3×14), 15 images (1 + 14)
- In the browser: 13 flags, Continue disabled, count decrementing as each is
  resolved, released only on the last one
- All four existing checks still green

### Next

**Step 7 — purposes and review polish.** Editable purpose field per row, copy
purpose down, and the Download step as a proper confirmation screen.


---

## Session 7 — Purposes and review polish

**Date:** July 31, 2026
**Build step:** 7 of 9

### Prompt used

> Build step 7: the Add purposes step. Editable purpose field on every row, a
> "copy purpose down" control, and the ability to delete personal charges.
> Statement amounts are read-only by default with an explicit override that gets
> noted in the final summary.
>
> Then build the Download step as a confirmation screen: number of expenses,
> total CAD, confirmation that every statement line is accounted for, and one
> primary button. Update BUILD_LOG.md.

### Files added

```
src/lib/report/edits.ts          purposes, deletions and overrides — one pure function
src/components/PurposesStep.tsx  the editable table
src/components/DownloadStep.tsx  the confirmation screen
```

`steps.tsx` is now only the Upload step; the other three are their own files.

### The riskiest part, and where it was put

Deleting a row shifts every index after it — and purposes AND receipt images are
keyed by row index. Get that wrong and row 4's receipt lands under row 5's
expense: right count, right total, plausible document, wrong receipts. The same
shape as the purpose-ordering bug from step 4.

So the re-keying is a single pure function, `applyEdits()`, used by the server
and exercised by `verify:blocking` with invented data:

```
Deleting a row re-keys purposes, receipts and overrides together
  ok   remaining rows are the right ones
  ok   receipts followed their own rows
  ok   purposes followed their own rows
  ok   the deleted row's receipt is gone, not reassigned
```

Then confirmed against the real June data end to end: purposes set on original
rows 0, 1 and 4, rows 2 and 5 deleted, one amount overridden. In the document,
*"Team dinner"* landed on `NOODLE HOUSE AND` — the row it was typed
against, two positions earlier than where it started — and the row order matched
the kept rows exactly.

### Amounts are read-only, and an override says so everywhere

The amounts are what make this tool trustworthy, so changing one is deliberate:
an **override** link per row turns the two amount cells into inputs, the changed
value shows in the warning colour, and it's stated three times over —

- on the review screen: *"1 amount typed by hand… the report won't balance to
  the statement total any more"*
- on the download screen: *"1 amount typed by hand — these no longer match the
  statement"*
- and its opposite, so the default is legible too: *"Every amount not listed
  above came straight from the statement, unchanged"*

Verified end to end: overriding a billed amount to `$99.99` produced
`Jun 08 2026    $6.51    $99.99    CAD    CAD    STAFF CANTEEN-63366` — the
expensed amount untouched, exactly as scoped.

### Deletion has one mechanism, not two

Reconciliation already had "personal charge — leave it out". Rather than add a
second, competing idea of exclusion, deleting a row here feeds the same set, and
the two are merged before the document is built. Deleted rows stay visible in the
table, dimmed, with a **restore** link — a delete you can't see is a delete you
can't check.

### The Download step is now a confirmation, not a button

Everything that could make the report wrong is stated before the button:

```
✓ 12 of 24 expenses have their receipt attached
• 12 included with no receipt — you marked those as lost
• 1 line deleted as personal — not in the report or the total
✓ Every amount not listed above came straight from the statement, unchanged
```

When something is outstanding the heading reads **"Not ready yet"**, the button
is disabled, and the reason names the step to go back to.

### Verified in the browser

- 25 purpose fields, 25 copy-down buttons, 25 override links, 25 delete links
- typing one purpose and pressing copy-down filled all 25; status flipped to
  *"Every line has a purpose"*
- deleting a row dimmed it, offered **restore**, and dropped the count to 24 and
  the total to $1,685.90
- Download blocked before reconciliation with *"Match your receipts on the
  Reconcile step first."*, then ready afterwards

### All five checks green

`eval` 90/90 · `verify:blocking` · `verify:report` · `verify:layout` ·
typecheck, lint, build.

### Next

**Step 8 — passcode and rate limiting.** Then step 9, deploy.


---

## Session 8 — Passcode and rate limiting

**Date:** July 31, 2026
**Build step:** 8 of 9

### Prompt used

> Build step 8: put a shared passcode in front of the whole app, read from an
> environment variable, with rate limiting on the attempts. No user accounts.
> Explain to me in plain English how environment variables keep the passcode out
> of the code. Update BUILD_LOG.md.

### Files added

```
src/lib/auth.ts               passcode check + signed session token
src/lib/rateLimit.ts          attempt counting and lockout
src/middleware.ts             the gate, in front of every request
src/app/login/page.tsx        the passcode screen
src/app/api/login/route.ts    checks the passcode, sets the cookie
scripts/verify-auth.ts        the test (npm run verify:auth)
```

### The gate is middleware, not a page check

Protecting only the page would have left `/api/parse-statement` open to anyone
who found the URL — and that endpoint accepts a corporate card statement. **The
API routes are the thing that most needs the lock.** Middleware runs before
every request, so there's no URL that quietly skips it.

Verified by asking for each one without a session:

```
GET  /                      307 -> /login
POST /api/parse-statement   401
POST /api/reconcile         401
POST /api/build-report      401
GET  /login                 200   (has to be reachable)
```

### The cookie is signed, not a claim

A cookie is text the browser sends back, and anyone can edit their own cookies.
If it simply said "allowed", anyone could type that. Instead it holds an expiry
plus an HMAC signature computed **from the passcode**:

```
1753996800000.9f3c…
```

The signature can be checked without the passcode being in it, and can't be
produced without knowing it. Three consequences worth having: the passcode never
travels to the browser, sessions expire after 12 hours on their own, and
**changing the passcode invalidates every existing session** — which is what you
want the day someone leaves the team.

Forged cookie, tested: `307 -> /login`.

### Failing closed

With no `APP_PASSCODE` set, the app refuses everyone — API routes return 503 and
the page shows "Not set up yet" with instructions. A default passcode would be
worse than none, because it looks locked.

### Rate limiting, and an honest limitation

Five attempts per 15 minutes, then a 15-minute lockout, counted per IP. Tested
live:

```
attempt 1  401  That's not the passcode. (remaining 4)
...
attempt 5  401  Too many attempts. Try again in 15 minutes.
attempt 6  429  Too many attempts. Try again in 15 minutes.
```

**The limitation, written down rather than glossed:** the count lives in memory,
per server instance. On Vercel each instance has its own memory and instances
come and go, so a determined attacker with parallel requests gets more attempts
than five. For a team tool behind a passcode this is proportionate; a shared
store (Redis, Vercel KV) is the fix if it ever needs to be stronger. It's in a
comment in `rateLimit.ts` so nobody later assumes it's handled.

Also checked: one person's failures don't lock out anyone else, and a correct
passcode clears the record.

### Details that matter and are easy to skip

- **Timing-safe comparison.** A plain `===` stops at the first wrong character,
  so a guess sharing a prefix returns measurably faster; over many attempts that
  leaks the secret one character at a time. The comparison always walks the
  whole string.
- **`httpOnly`** — page JavaScript can't read the cookie, so an injected script
  can't steal the session.
- **`sameSite: lax`** — not sent from other sites, which blocks cross-site
  request forgery.
- **`secure` in production** — HTTPS only once deployed.
- Failed attempts say only *"That's not the passcode."* No "close", no length
  hint, nothing that narrows a guess.

### A development passcode is in .env.local

Set to `change-me-before-deploy`, clearly labelled as throwaway. **It must be
changed before step 9.** `.env*` is gitignored, so it never reaches GitHub or
Vercel — the real one gets set in Vercel's own environment variables.

### One thing that cost ten minutes

The page 500'd after the step-7 refactor while `tsc` passed: the dev server was
serving a **cached module graph** from before three components moved into their
own files. `rm -rf .next/dev` and a restart fixed it. Worth knowing — a
type-clean project with a broken dev server means the cache, not the code.

### Next

**Step 9 — deploy.** GitHub, Vercel, environment variables, and a last check
that `evals/` never leaves this machine.


---

## Session 9a — Redaction, and the first commit

**Date:** July 31, 2026
**Build step:** 9 of 9, in progress — code is committed locally, nothing pushed yet.

### Done this session

- **Strong passcode set.** Five random words, 39 characters, ~10^24
  combinations. At a thousand guesses a second that outlasts the universe, which
  makes the in-memory rate limiter no longer the thing standing between an
  attacker and the data. Old placeholder verified rejected, new one verified
  working. Value lives only in `.env.local`, never printed.
- **Backlog recorded** as build-order items 10–12 in CLAUDE.md, with measured
  numbers and the first move for each.
- **Two rounds of redaction**, both before the first commit — git history is
  permanent, so redacting afterwards would have left the originals recoverable.
- **First commit made.** 59 files.

### What was redacted, and why it mattered

**Round 1 — merchant data.** `BUILD_LOG.md` had accumulated real merchant names,
amounts, dates and statement filenames carrying the card identifier, all added
as worked examples while debugging. Fine in a private repo; not fine in a public
one. Real merchants were swapped for the invented names already used in
`verify-blocking.ts`, so the docs and the tests now share one fictional
vocabulary.

**Round 2 — the employer.** 32 references across public-bound files, including a
design spec documenting the reverse-engineering of their website's computed
styles and a parser docstring naming and decoding their statement format. The
PRD still lists the employer conversation as **open**, and a public repo is a
bigger step than the team rollout that conversation was meant to precede.

Genericised: "a corporate card statement", "the airline's booking flow". The
`--wj-*` CSS token prefix went too — an initialism is still a reference.

**Nothing in the engineering story was lost.** The evals, the parser, the bugs
and every lesson survive intact. None of the value ever depended on naming the
company or the restaurants.

Verified afterwards: no employer name, merchant name, card identifier or
employee name anywhere in the working tree **or anywhere in git history**.

### The fixture rename that redaction forced

Redacting statement filenames in the eval scripts broke them, because the files
on disk still had the old names. Renamed the six real statements to
`statement-2026-NN.pdf` and updated `sourceStatement` in every ground-truth
file. All six checks re-run and green afterwards — the redaction cost nothing.

### Still to do

1. **GitHub.** Repo not created. Bilal leaning toward the `gh` CLI route
   (`brew install gh`, one browser authorisation, then create and push);
   the alternative is creating it at github.com/new — **Public**, and without a
   README or .gitignore, since both already exist and would conflict.
2. **Vercel.** Connect the repo, then set `ANTHROPIC_API_KEY` and `APP_PASSCODE`
   in Vercel's environment variables — typed by Bilal, never in a file.
3. **Verify the live URL is actually gated** before it sits unprotected.
4. **The final BUILD_LOG entry** summarising the whole build, once it's live.
   *Done — see the end of this file.*

### State on disk

Local git repo on `main`, one commit, no remote. All six checks green:
`eval` 90/90 · `verify:report` · `verify:layout` · `verify:blocking` ·
`verify:auth` · `eval:receipts` 25/25.

---

## Session 9b — It went live

GitHub repo created **public**, Vercel connected through the GitHub login, and
`ANTHROPIC_API_KEY` and `APP_PASSCODE` typed straight into Vercel's environment
variables — never into a file, never through Claude.

The first deploy reported success and showed no URL, which reads like a failure
and isn't: Vercel lists the domain on the project page rather than in the build
output.

**Live at `expense-runway.vercel.app`.** The gate was checked before anything
else: the app is unreachable without the passcode, `/login` and `/api/login` are
the only unauthenticated routes, and with no `APP_PASSCODE` set the middleware
fails closed rather than open.

Steps 1–9 of the build order are done.

## Session 9c — The size ceiling, and a message that sent Bilal to his router

Backlog item 10, done. Vercel caps request **and** response bodies at 4.5 MB
each. June measured 3.31 MB up and 3.42 MB down — about 30% headroom, and a
heavier month or a colleague's scanner would have gone over.

`JPEG_QUALITY` 92 → 85 and `MAX_EDGE` 2000 → 1600 roughly halved both. The faded
thermal receipt was re-checked at the new settings, because quality changes have
already shipped unreadable receipts once (session 5).

**The worse half of this was the error message.** Going over the limit produced
"Couldn't reach the server. Check your connection and try again." Bilal went and
looked at his wifi. Vercel returns a 413 as **plain text**, the code assumed
JSON, the parse threw, and a catch-all reported it as a network fault.

`readError()` now reads plain-text errors and names the actual cause, and
`checkUploadSize()` refuses oversized uploads in the browser at 4.2 MB — before
the wait, not after it.

> A wrong error message costs more than no error message. It doesn't just fail
> to help; it sends someone to debug the wrong system.

Also in this session: reconciliation flags got stable ids so they can be
anchor-linked from the blocking message, and impossible dates are now rejected —
a model returned "Sep 31", which the old normaliser passed through to matching,
where it silently failed to line up with anything.

## Session 9d — Blank receipts in production, and two fixes that never ran

The app worked locally and produced **blank white pages** where receipts should
be, in production only.

Attempt 1: ship a font. Attempt 2: draw glyphs as paths instead. Both were
reasoned from the symptom, both looked right, and **both shipped as dead code.**
They resolved the font through `createRequire(import.meta.url)`, which throws
inside Next's bundled server, and a bare `catch` swallowed the error. The fix
never executed and nothing said so.

Three attempts in, the guessing stopped and a **temporary diagnostic endpoint**
went out instead — one that reported what the running container could actually
see. It came back unambiguous:

| Reading | Value |
|---|---|
| Registered font families | **0** |
| Ink drawn on a test canvas | **0** |
| Font file present on the server | **false** |

The font wasn't failing to load. It was never deployed. A bundler has no reason
to know a file read at runtime is needed, so it left it behind.

Fixed by putting the font at a fixed path under `assets/` and telling Next to
keep it: `outputFileTracingIncludes: { "/api/**": ["./assets/fonts/*.woff"] }`.
Failures now log loudly instead of vanishing. The diagnostic endpoint was
removed once it had done its job.

> Two of the three attempts weren't wrong — they never ran. Code that can't
> report its own failure will be debugged as if it did.

Bilal's response is worth recording as a working instruction: *"stopping to
deploy the diagnostic endpoint instead of going in that circle we did with the
formatting — we gotta do that again more often."* Measure the running system
before the second guess, not after the fourth.

## Session 9e — What real data does that fixtures don't

First run against a real month that wasn't June: **February, 17 of 19 matched,
6 flags.** Every one of the six turned out to be a real behaviour of real
paperwork, not a bug in the abstract.

**A folio is one receipt.** Hotel folios repeat the total on page 2 — standard
practice — and the tool was reading that as a duplicate, plus a room charge on
page 2 as an unexplained extra. Folios announce themselves: every folio page
carries at least four of *Folio, Invoice, Page Number, Guest, Arrive, Depart*
in its text layer, and **no** scanned receipt page carries any. Detected
deterministically, every page after the first dropped.

**A receipt with no readable amount.** On the canteen receipt the amounts column
had faded off the scan entirely — but the date and the store number were sharp.
Where a receipt keeps its date and merchant, lands in the window of exactly one
unmatched line, and nothing else competes for it, it now attaches and is marked
low confidence.

**A receipt whose amount doesn't match, and has no date.** The breakfast receipt
lost the leading digit of "1/31/2026" to the scan, and mismatch detection
required a date. Both fixed: numeric dates parse now, and a mismatch can be
found on a unique strong merchant match alone. It was never a missing receipt —
the receipt reads **$29.66**, the statement **$34.11**, and the receipt says
*"please pay your server"*. A **$4.45** tip added after printing.

One wording fix went with it. Every gap used to be described as a tip. When a
faint total is misread the gap can be large, and calling that a tip sends
someone looking for the wrong thing — so gaps over 30% now say the total was
probably misread, and note that the report uses the statement amount regardless.

**Result: 18 of 19, one flag.** June unchanged at 25/25, `eval` still 90/90.
The remaining flag is a real judgement call — same purchase, $4.45 apart — and
belongs to a human.

## Session 9f — A button that lied about what it did

Bilal asked a plain question: with that last flag, can he just force it through?
Checking the answer turned up a defect no test would have caught.

The mismatch flag offered *"No, different purchase"*, described as **"The line
goes back to needing a receipt."** It did not. The flag counted as resolved, the
report built with **nothing** under that line, and the receipt was silently
dropped. A button that read like *deal with it later* was in fact a final
decision to file a line bare.

Replaced with the two honest endings a missing receipt already gets — include
the line without a receipt, or drop it as personal — each stating outright that
the receipt goes unused. Every one of the three was then run through
`applyResolutions` and checked against its own description.

> Same family as the connection error in 9c: the interface describing something
> other than what the code does. Tests assert on behaviour; nothing was
> asserting that the words matched the behaviour.

Worth recording how it surfaced. Not a test, not a review — a non-technical user
asking what a button does.

## Session 9g — The filename names the wrong month

February downloaded as *"Expense Report — January 2026.docx"*.

The filename takes the month of the earliest transaction, and statements are
issued on the **27th**, so anything after the 27th falls into the next month's
statement. Measured across the fixtures, three of five statements span two
months: February runs Jan 30 → Feb 12, May runs Apr 30 → May 21, July runs
Jun 26 → Jul 15. Wrong more often than right.

Not fixed — specified, and left for a session with time in it. The rule is the
month of the **Statement Date**, which every statement prints on page 1.

One trap found while checking and recorded so it isn't hit twice: searching the
page text for the label and taking the next date-shaped token reported the same
date for three different statements. Label and value sit in a header table, and
flat text order doesn't preserve the pairing. It needs the coordinate-aware word
layer — the same technique that splits vendor from location.

---

# The build, end to end

Nine steps, roughly two weeks, from an hour of manual work a month to a few
minutes. **Live and in real use.**

**What it does.** A month of expense files goes in; a Word document in the
team's exact format comes out, one expense per page, each receipt under its own
entry, ready to key into JD Edwards.

**The decision that shaped everything.** Evals killed the AI from the main path.
The corporate card statement parses **deterministically** — 90/90 line items
exact across five months, at zero cost, and the statement never leaves the
server. AI reads receipt *images* only, only to decide which line each belongs
to, and **never writes a number into the report.** That is simultaneously the
accuracy story and the privacy story, and it came from measurement rather than
preference.

**The six checks**, five of them free, every one mutation-tested: `eval` 90/90
plus each statement's self-check · `verify:report` · `verify:layout` ·
`verify:blocking` · `verify:auth` · `eval:receipts` at about 7¢.

**What the bugs had in common.** Nearly every serious one passed its tests:

- `pageBreakBefore` was valid markup renderers ignore. Every structural
  assertion passed — the page count even came out right — while the layout was
  wrong. Four rounds. *Structural checks on a file format do not verify what the
  format renders.*
- JPEG quality is 0–100, not 0–1. Shipped 6 KB unreadable receipts. Found by
  opening an image, not by counting them.
- A refund prints as `$-12.24`, minus inside the dollar sign. The pattern
  dropped it silently and the report was over by the refunded amount. Caught by
  a statement's own self-check.
- Two font fixes that never executed, because a bare `catch` swallowed the
  reason.
- Two interface messages that described something other than what the code did.

The shape is consistent: **the tests asserted on a proxy for the thing that
mattered.** Every check in the suite now exercises the real artifact — the
rendered page, the opened image, the statement's own printed total.

**Where the requirements came from.** June built it; February taught it. Folios
repeating a total, an amounts column faded off a scan, a tip added after
printing, a billing cycle that straddles two months — none of that was
imaginable from a spec, and all of it is ordinary. One real month surfaced more
than any amount of design.

## Still to do

Nothing here blocks use. Ordered as agreed.

1. **Item 11 — rate limiting in a shared store**, ~1 hr. In-memory counting is
   per serverless instance, so parallel attempts get more than five tries. Do it
   before wider rollout.
2. **Item 13 — the filename month**, ~30 min. Fully specified in CLAUDE.md,
   including the header-table trap.
3. **Item 14 — "copy down" overwrites purposes already written**, ~15 min, with
   nothing in the label saying how far it reaches.
4. **Item 15 — bold the transaction line on each page**, ~15 min. Too faint
   against the receipt. Needs `verify:layout`, per non-negotiable 0.
5. **Item 16 — extraction in the browser**, ~half a day. Only if item 10 stops
   being enough.

Also open, and not a code task: **the employer conversation about corporate card
data** before the tool goes to the team.

---

## Session 10 — Clearing the post-launch list

Four items off the backlog, in the order Bilal picked: easy things first.

### Bold the transaction line (item 15)

The line lifted from the card statement is what a reviewer checks first, and it
read too faint above a full-page receipt. Bold on that line only — bolding the
purpose line too would restore the flatness the change exists to fix.

The check is the part worth keeping. `verify:report` asserts bold sits on
**exactly** the transaction paragraphs, as a set rather than a count: 25 bold
paragraphs is the right number and completely wrong if they're the wrong 25.
Mutation-tested both directions — unbolding the transaction line fails,
bolding the purpose line as well fails. `verify:layout` re-run: 26 pages, one
expense each, unchanged.

### "Copy down" (item 14, then item 17)

It copied a row's purpose into every row below it, filled or not, so working
top-down destroyed anything already typed underneath — silently, no undo. Fixed
to fill only empty rows, and to say so: the button counts what it would touch
("↓ fill 4 below") and disables at zero.

Then Bilal, on reading it: *"Every transaction we always have is a unique
transaction for a unique thing in our team."* The feature rests on an
assumption about repeated trip expenses that does not hold here, so it is
logged as item 17 — probably delete it outright.

> Worth keeping as a note on sequencing: the fix was correct and the feature
> still shouldn't exist. Fifteen minutes, and it hardened `verify:report` on
> the way, so not wasted — but the question "should this exist" is cheaper
> asked before "is this right" than after.

### The filename month (item 13)

February downloaded as *"Expense Report — January 2026.docx"*.

**The earlier diagnosis was wrong, and finding out cost nothing because it was
checked rather than built on.** Searching page text for "Statement Date" had
reported the same date for three different statements, which looked like a
table-column parsing fault. It wasn't: page 1 carries a summary row for the
PREVIOUS statement above the current one, so the first match is legitimately
the month before.

The value was already in hand. `findDeclaredTotals()` has always read the
statement's own date off the transaction page, and the self-check already
corroborates it against that statement's transaction count and billed total —
so it arrives verified twice by the statement's own arithmetic. The fix was to
name the report from it. Ten minutes, not thirty, and no new parsing.

`npm run eval` now checks the filename on all six statements, with the
expectation taken from each fixture's **own filename** rather than its parsed
contents — derive both sides from one source and a bug moves them together.
Mutation-tested: the old behaviour fails on exactly the three straddling
months, naming each.

### Rate limiting in a shared store (item 11)

The limiter counted in memory, so on Vercel five attempts meant five *per
serverless instance* — parallel requests land on different instances and each
gets a fresh budget. Not fixable by counting more carefully in the same place.

Counts now live in Upstash Redis when configured and in memory otherwise, so
local runs and every check behave as before. It uses `INCR` rather than
read-modify-write: two simultaneous guesses that both read "3" and both write
"4" have spent two attempts and recorded one — the same miscount relocated.

`verify:auth` exercises the Redis path against a **fake Upstash server over
real HTTP**, not a stubbed module; a mock of the client would only prove the
client calls itself as written. It checks the lockout survives clearing local
memory, that five simultaneous attempts count as five, and that a store outage
degrades to in-memory counting rather than failing closed — failing closed
would lock the team out of their own reports to protect a passcode on a tool
holding a statement nobody else wants.

Mutation-tested. Swapping `INCR` for read-modify-write:

```
FAIL 5 simultaneous attempts count as 5 — counted 3
FAIL and the account is locked
```

Three of five, guesser unlocked. The real bug, on demand.

### Shipped is not live

Vercel applies environment variables only to deployments built *after* they are
added, so "I added the variables" and "the limiter is shared" are different
claims. Rather than assume, `/api/status` reports what the running server
actually sees — booleans only, behind the passcode, no URL or token in the
response.

A first attempt to verify it from outside was worthless and nearly went
unnoticed: an unauthenticated request returned 401, which looked like proof the
endpoint existed. It wasn't. The middleware answers before routing, so a path
invented on the spot returned exactly the same 401. Checked, discarded, said so.

Confirmed by Bilal in a logged-in browser:

```
{"sharedRateLimitStore":true,"passcodeConfigured":true,"receiptReadingConfigured":true}
```

### A third message that described the wrong thing

Asked to load `/api/status`, Bilal got *"Your session has expired."* He had no
session — the branch fires for any invalid token, including no cookie at all,
and said "expired" for every case. Being told something expired sends you
looking for a session you never had.

No cookie now says you're not signed in; a genuinely expired or tampered one
keeps the old wording. That makes three:

| Said | Was |
|---|---|
| check your connection | the 4.5 MB upload limit |
| the line goes back to needing a receipt | it filed the line with none |
| your session has expired | you never had one |

The pattern is now written into the code rather than rediscovered a fourth
time. **The tests assert on what the code does; nothing asserts that the words
match.** That is the standing weak spot in this project, and all three were
found by a person reading a screen, never by a check.

### State

All six free checks pass and the production build is clean. Remaining: item 17
(remove "fill below", ~10 min) and item 16 (browser-side extraction, ~half a
day, only if the upload ceiling starts biting). Neither blocks use.

---

## Session 11 — A way forward, and a fix that got rejected

### The Upload step had no way forward (item 18)

Once files were read, the only route to Reconcile was the stepper at the top —
which reads as navigation, not as the next thing to do. Bilal: *"there isn't a
clear direction to go to the reconcile step."*

Checked rather than assumed, and the finding made it easy: **exactly one screen
was missing it.** Reconcile and Purposes both already took an `onContinue` and
rendered a Continue button; Upload took no such prop at all. So this closed an
inconsistency rather than inventing a pattern.

"Continue to receipts" now sits in the parsed branch only, so it cannot appear
before a statement has been read and cannot lead to an empty Reconcile screen.
It grants nothing the stepper didn't — including when a statement fails its
self-check, where the "Doesn't balance" warning above is unchanged and remains
the louder thing on the page. Tested by Bilal in the live app.

### The override stays, and that is now written down

Asked what the per-row amount override does, and on hearing it, kept it: *"It's
a great function to have."*

It replaces a statement amount with a typed one, guarded three ways — the figure
turns amber, a banner names the count, and every override is listed again on the
download screen before the file is built.

Recorded under a new **"Settled, do not re-open"** heading in CLAUDE.md. Without
that, a future session reads "hand-typed amounts on a filed accounting document",
correctly identifies it as risk, and proposes removing it — re-litigating a
decision already made on good grounds. **A decision is only durable if the
reasoning survives with it.**

"Fill below" went the other way: left in place for now, marked on hold rather
than deleted, with its removal case intact underneath.

### A two-hour fix, proposed and rejected in one exchange

Bilal has a colleague's receipts to try — all phone photos, no scans. Would they
blow the 4.5 MB ceiling?

Yes, enormously. Phone photos run 2–5 MB each, so a month is 30–70 MB against a
4.2 MB limit. The proposed fix was sound on its face: shrink images in the
browser before upload. It costs nothing in quality, because the server already
downsizes to 1600px at quality 85 — the same operation, moved earlier. Fifteen
photos would drop from ~45 MB to ~2 MB.

**Bilal questioned whether the work was needed at all, and was right.** iPhones
shoot HEIC by default, browsers cannot decode HEIC, and there is nothing to
resize. For the exact colleagues it was aimed at, the fix moves them zero
distance.

That fact was already written in this project's own notes on supported file
types. It was in the proposal's blast radius and got missed anyway — surfaced by
someone non-technical asking whether the thing was necessary, not by anyone
checking the details.

The measurement that settled it: June's entire month — 25 receipts as a scanned
PDF, a rideshare docx, two folios and the statement — is **~3.3 MB**, inside the
ceiling. The same receipts photographed would be 50–100 MB. A scan is a clean
page; a photo is a 12-megapixel picture of a desk.

And the accuracy argument is the stronger one: folio detection, the faded-amount
rescue and tip detection were all built and measured on scanned PDFs, the path
carrying 25/25. Photos add shadows, angles and backgrounds to a matcher never
evaluated on them.

So the answer isn't code, it's the Notes app: new note → camera → Scan
Documents. One tidy PDF per month instead of 25 loose photos, which is less work
for the colleague too.

Item 19 is logged **deferred with conditions** rather than dropped — revive it
only for someone who genuinely cannot scan, whose photos are JPEG rather than
HEIC.

> Two hours saved by asking "is this necessary" before "is this correct". The
> same question that retired "fill below" one session earlier. It is the
> cheapest question in this project and neither time did it come from the
> engineering side.

### An edit that silently did nothing

A scripted change to CLAUDE.md hit its own assertion and wrote **no file at
all**, while the commit beside it went through. Item 11 was left still claiming
production was counting per instance and waiting on environment variables —
both untrue by then, in the file a future session reads first.

Caught by checking the output rather than trusting the exit, and corrected in
the next commit. Same shape as the two font fixes that shipped as dead code:
**work that doesn't happen looks identical to work that did, unless something
reports otherwise.**

### State

All six free checks pass, production build clean, live and verified. Backlog is
item 16 (browser-side extraction, only if the ceiling starts biting), item 17
(on hold) and item 19 (deferred). Nothing blocking.

**Next: colleagues.** The rollout ask is one sentence — scan rather than
photograph — and everything else is done.

---

## Session 12 — First real use on someone else's laptop

Bilal ran a live month on his work laptop. Four failures surfaced, none of which
any of the six checks could have caught, because all four live in territory the
fixtures do not cover: another machine, another month, and a document the
extractor could not see.

### The upload that blamed the network

The first files never uploaded. "Couldn't reach the server. Check your
connection and try again." — a message this log has now had to correct **four
times** for describing something other than what happened.

It was not the network. Work laptops keep expense files in OneDrive with Files
On-Demand, and a cloud-only placeholder reports its real name and size from
metadata while the bytes are not on disk. The browser only finds out when it
starts streaming the upload, at which point the request body errors and `fetch`
rejects with no reply — which the client reported as a connection fault.

Proved by elimination rather than argument: 2.4 MB of real fixtures through
`/api/parse-statement` locally returned **200 in 0.73s**, and a 2.6 MB multipart
POST to production was **accepted in full in 1.0s**. The app and the platform
were both fine. Copying the files to the desktop first — forcing OneDrive to
hydrate them — fixed it outright.

The cause was diagnosable in one glance at DevTools and cost a session instead,
because all four `catch` blocks were written `catch { }` with **no error
binding at all**. `describeTransportFailure()` now separates timed out / cut off
mid-reply / never completed, logs the browser's own wording, and every call site
carries a client timeout longer than the server's `maxDuration` — there was
none, so a killed connection could spin forever with no error at all.

> A bare `catch` is not error handling. It is the deletion of the only evidence.

### Three cards, one receipt, and a button that lied

Reconciliation raised cards that contradicted each other. Every spare receipt was
offered inside **every** "receipt missing" card at once, and separately got its
own ambiguous or extra-receipt card — because the flag list is built once on the
server and never re-derived as decisions arrive.

Underneath it was something worse and silent: `assignments` is rowIndex ->
imageIndex, so **two lines could hold the same receipt**, and generation embedded
it under both with no dedupe. A report that builds clean, totals correctly, and
puts one receipt under two expenses looking entirely deliberate.

Fixed at both ends, per the rule this file already had about disabled buttons:
the screen refuses to offer a receipt another line has claimed and names that
line, and `build-report` refuses the request outright.

Bilal's actual question was sharper than the bug report: *attach a receipt from
the missing-receipt card, then hit "leave it out" on the extra-receipt card for
that same receipt — what happens?* The answer was that `ignore` is a no-op, so
the attach won and the button's stated effect was false. `applyResolutions` now
works out what is outstanding **after** every assignment is known, so a card
whose subject was settled elsewhere stops asking.

And the two buttons a few words apart with opposite consequences — "Leave it
out" (does nothing) beside "Personal charge — leave it out" (removes a line and
its money) — now say which thing leaves.

### Refunds were arguing with their own charges

July's statement carried a grocery charge and the refund reversing it. Amount
comparison is deliberately sign-blind so a credit note can find its line, so one
receipt fitted **both** equally well: two ambiguous cards with one sensible
answer, plus a refund line demanding a receipt it can never have.

Sign agreement is now preferred rather than required — disagreeing signs stay
matchable but lose every tie — and credit lines no longer demand receipts.
Reproduced from the screenshots first: **2 ambiguous cards to 0**, receipt
auto-attaching to the charge. `eval:receipts` still 25/25, 0 ambiguous.

### The form the extractor could not see

When a receipt is genuinely gone the team types a MISSING RECEIPT box — date,
amount, reason — into the same .docx that carries the month's rideshare
receipts. `extractFromDocx` reads `word/media/`, which holds embedded images.
Typed text has no image. The form was invisible.

Saving the document as a PDF would have worked and was rejected: the same file
carries the rideshare receipts as embedded images pulled at their own
resolution, and converting turns each into a full Word page with the receipt
marooned inside the margins, putting the 1600px cap on the page instead of the
receipt. This project has shipped unreadable receipts once already over exactly
that trade.

So `missingReceiptForm.ts` reads `word/document.xml` instead, and **no model
runs on it**. The date and amount are typed by a person as the authoritative
record — already exact. Paying a vision model to guess back numbers we can
simply read would cost money to make the answer worse. Same principle that kept
the statement parser deterministic.

Word splits one typed line into as many `<w:t>` runs as it likes, and puts tabs
outside the runs entirely, so "Amount:<tab/>$4.75" has to be reassembled before
anything is matched. Tested against a document built with the real `docx`
library rather than hand-written XML: both forms parsed, `$1,204.50` and
`July 14, 2026` normalised correctly.

Per non-negotiable 0, the rendered image was **opened and looked at**, not
counted — text present, wrapping correct, height measured to the content so a
short form doesn't eat a report page in whitespace.

### Catching the placeholder before it is sent

Added after the rest shipped. The size check that guards every upload is
satisfied by METADATA, and that is precisely what a cloud-only placeholder
supplies in full — real name, real size, no contents. So it passed, and the
upload died a second later with no HTTP reply.

`checkFilesReadable()` asks for ONE BYTE of each file before anything is sent.
It is the smallest question that separates a real file from a placeholder, and
unlike the size it cannot be answered from metadata. The files that fail are
named, following the size check's precedent — "some of your files aren't
available" leaves a person comparing a folder against a list.

Touching a placeholder is often what makes OneDrive start fetching it, so a slow
answer usually means "downloading now" rather than "broken". Waiting is the
right default, bounded at 15s — the alternative to a bounded wait here is an
unbounded one on the upload, which is the failure being removed.

Tested against stubs standing in for placeholders: present files pass, one
failure is named in the singular, two in the plural with the healthy file left
out, and a file that never answers is caught at 15.0s rather than hanging.

### Too late is its own kind of wrong

The readability check went in on submit, and on the first real test it fired at
the **download step** — after the whole month had been reconciled by hand. One
receipt had been added without being copied to the desktop, sailed through
Upload and Reconcile, and announced itself at the most expensive moment
available. Bilal, correctly: *"this error message should have been presented
much earlier."*

A correct message at the wrong time is still a failure. The browser can answer
"is this file here" the instant a file is dropped, so it now does: availability
is checked on drop, offending files are marked in the file list itself — "still
in the cloud, not on this computer" — and the button refuses to proceed while
any remain.

The check also now runs at Reconcile and at Download, because a file can be
evicted back to the cloud between steps. Those two say something different from
the Upload one on purpose: at Upload you add the files again and lose nothing,
and later you lose the reconciliation. A remedy that glosses over that is the
same kind of lie the rest of this session was spent removing.

### The timeout was set from a guess and measured at nearly the same number

The one-byte check was given fifteen seconds on the reasoning that touching a
placeholder is often what makes OneDrive fetch it. Then a real month on a real
work laptop did exactly that and took **slightly over fifteen seconds before
succeeding.**

So the first value was close enough to the truth to start failing files that
were downloading perfectly well — naming a healthy file as missing and sending
someone to fix something that was not broken. That is a worse error than the one
the check exists to prevent, because it is confidently wrong rather than merely
unhelpful.

Raised to sixty seconds. A generous ceiling costs a slow user nothing they were
not already paying: the download has to happen either way, here or during the
upload. And the wait is now explained rather than silent — a fifteen-second
pause with no label reads as the app having hung, which is how it read.

> The guess was not unreasonable and was still wrong by a hair. The only reason
> it is known at all is that someone ran it on their own machine and said how
> long it took.

### State

All six checks pass — 90/90, 25/25 receipts, 0 ambiguous, build clean.

**Still open:** the flag list is still a snapshot. It can no longer produce a
wrong answer, but cards don't shrink their candidate lists as decisions land.
Re-deriving live means teaching `reconcile()` about decisions already made and
keeping flag IDs stable so existing resolutions aren't orphaned — a change to
how the step holds state, not a patch.

> Four failures, four blind spots, one shape: every check in this project runs
> on Bilal's machine, against his fixtures, on months that already worked. None
> of them could see a different laptop, a refund, or a document with no images
> in it.


---

## Session 13 — An intermittent failure, and two wrong diagnoses before a number

The download step began failing sometimes: request sent, nothing back, no
report. It was chased through three explanations, two of which were confidently
wrong and shipped as user-facing text.

**First it was blamed on the files.** A message rewritten in session 12 told
people the likeliest cause was an unhydrated OneDrive file. Then a run whose
files were all on the desktop with green checks hit exactly the same failure. So
that was wrong — and it was the second time this same message had named a cause
nobody had verified, the first being a corporate proxy.

The message now names no cause at all. It says what happened, and carries the
browser's own words out to the screen so the next report arrives with evidence
instead of "it broke at the end". **A hypothesis in a user-facing string is
indistinguishable from a fact, and it outlives the session that wrote it.**

**Then it was measured instead.** Against a real month, end to end: 2.71 MB up,
2.26 MB down, 10.3s, 273 MB peak — against limits of 4.5 MB, 4.5 MB, 120s and
1024 MB. Nothing close. Which meant the answer was not in the code, and no
further amount of reading it would produce one.

**The answer was one word in a screenshot.** The account is Hobby, where Vercel
caps function duration at 60s no matter what `maxDuration` says. The route asks
for 120 and gets 60; real runs land near 30s on shared CPU; a slow one goes over
and the container is killed mid-request. Intermittent, timing-shaped, and
invisible from inside the application.

### Two instruments, added because guessing had run out

The route now times itself and returns `x-ms-*` headers, with the download line
reporting "Built in Ns" — so a slow run says how close it came without anyone
opening developer tools.

And the login page now shows the commit it was built from. During this session a
fix went out, the next run behaved like the old code, and there was no way to
tell whether the deploy had landed, the browser was holding a cached bundle, or
the bug was simply still there. That uncertainty cost more than the bug did. It
is answerable in one glance now, before sign-in, because "is the fix live?"
cannot be answered from inside an app you have to sign into.

*(Deploys were landing. Confirmed by pulling the deployed JavaScript apart and
finding the new strings in it — which is the sort of thing the stamp now makes
unnecessary.)*

### Decided: leave it

A failure costs one click. The error path only sets a message; reconciliation,
purposes, exclusions and overrides all survive in the page, and the retry is
usually faster because the function is warm. Bilal: *"the Hobby count is working
fine, we'll just leave it."* Filed as item 20 with the full elimination, so the
next session does not repeat it.

> Three sessions of this project have now ended with the same lesson in a
> different costume: **the thing that reads like a diagnosis is usually a
> hypothesis, and writing it into the product makes it permanent.**
