# Expense Runway

Turns a month of corporate card expenses into the finished Word report, in about
five minutes instead of an hour.

Upload the card statement plus whatever receipts you have → the tool matches
receipts to statement lines and makes you resolve anything it can't account for
→ add a purpose per line → download the report with every receipt embedded.

---

## The interesting part: the evals deleted the AI

The original plan sent every uploaded file to a vision model. Before building
anything, a ground-truth eval set was assembled from five months of real,
already-filed reports — 90 line items, every field verified.

A **deterministic parser with no AI at all** reproduced **90/90 exactly**:
dates, amounts, currency codes, USD→CAD conversions, and 22-character truncated
vendor names.

| | Original plan | After the evals |
|---|---|---|
| Report numbers from | vision model | plain code |
| Accuracy on amounts | "probably fine" | **100%, verified on 90 rows** |
| Cost per report | cents | **$0** for every number |
| Card statement leaves the machine | yes | **no** |

AI is now used in exactly one place: reading a date, amount and merchant off a
receipt **image**, purely to decide which statement line it belongs to. Those
values are never written into the report. Every number in the finished document
comes from the parser.

Cost of a full month with 25 receipts: **about 7 cents.**

## What it guards against

The failure that matters isn't a crash — it's a report that looks finished and
isn't. Several defences exist only for that:

- **The statement checks the parser's work.** Every statement prints its own
  transaction count and billed total on page 1. The parsed rows must match both.
  This needs no ground truth, so it works on months nobody has ever verified —
  and it caught a refund line the parser was silently dropping.
- **Nothing is ever discarded quietly.** A line the parser can't read is shown
  to the user, never skipped.
- **Ambiguity is refused, not guessed.** A receipt that fits two statement lines
  equally well is assigned to neither, because guessing would be wrong half the
  time.
- **Every match shows its evidence** — the receipt's own date, amount and
  merchant beside the line's — so a person can check any row in seconds.
- **Generation is blocked** until every flag is resolved, enforced on the server
  and not just by a disabled button.

## Privacy

- **Nothing is stored.** Files are held in memory for one request and dropped.
  Refreshing the page is a genuine clean slate.
- **The card statement never reaches any AI provider.** It's parsed locally.
  Only receipt images are sent, and only for matching.
- One shared passcode, in an environment variable, with rate-limited attempts.

## The checks

| Command | Asks | Cost |
|---|---|---|
| `npm run eval` | Does the statement parse exactly? | free |
| `npm run verify:report` | Is the document structurally right? | free |
| `npm run verify:layout` | Does it render one expense per page? | free |
| `npm run verify:blocking` | Are all five flag types raised and enforced? | free |
| `npm run verify:auth` | Can a session be forged? Does lockout hold? | free |
| `npm run eval:receipts` | Does each receipt reach the right line? | ~7¢ |

`verify:layout` exists because of the most instructive bug in the project: a
page-break property that was valid markup the renderer ignored. Every structural
assertion passed — counts, positions, dimensions — while the layout was wrong,
and the page count even came out correct. **Checking a file's structure does not
verify what it renders.**

## Running it

```bash
npm install
npm run dev
```

Needs a `.env.local` with:

```
ANTHROPIC_API_KEY=...
APP_PASSCODE=...
```

The eval suite reads real statements and filed reports that are **not** in this
repository and never will be. `evals/fixtures/` and `evals/ground-truth/` are
gitignored. The scores are published; the data isn't.

## Stack

Next.js (App Router) · TypeScript · Tailwind · `unpdf` for PDF text and page
rendering · `docx` for output · Claude Haiku 4.5 for receipt images only.

Built with Claude Code. `BUILD_LOG.md` is the session-by-session record,
including the bugs and what they taught.
