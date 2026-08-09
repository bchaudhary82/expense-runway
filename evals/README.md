# Evals — Expense Report Builder

## What this proves

Five months of real corporate credit card statements were parsed with
**zero AI** and compared field-by-field against the finished expense reports
that were actually filed.

```
OK  February 2026   19/19 rows   total $1061.99
OK  March 2026      15/15 rows   total $442.15
OK  April 2026      18/18 rows   total $1875.07
OK  May 2026        13/13 rows   total $522.35
OK  June 2026       25/25 rows   total $1720.32

RESULT: 90/90 rows exact (100.0%)
```

Every field — date, expense amount, billed amount, expensed currency, billed
currency, vendor name — matched exactly, including the USD-to-CAD rows and the
22-character truncated vendor names.

## Why this matters

The original plan sent every uploaded file to the Claude API for extraction.
The eval shows the statement PDF has a clean text layer and can be parsed
deterministically. That changes the architecture:

| | Original plan | After evals |
|---|---|---|
| Report numbers | Claude API vision | Deterministic parser |
| Accuracy on amounts | ~high, unverified | 100%, verified on 90 rows |
| Cost per report | cents | $0 for the numbers |
| Corporate CC data leaving the server | yes | **no** |
| Speed | seconds of API latency | instant |

The API is still needed — but only for receipt **images**, and only for
reconciliation, never for the numbers that land in the report.

## What this eval set does NOT cover (found July 30, 2026)

**These 90 rows are text only.** The filed reports also contain images — one
screenshot of the corporate card statement at the top, plus one receipt image
after each expense — and the ground truth never recorded that.

| Month | Expenses | Images in the filed report | Genuinely blank paragraphs |
|---|---|---|---|
| February 2026 | 19 | 20 | 0 |
| March 2026 | 15 | 16 | 0 |
| April 2026 | 18 | 19 | 0 |
| May 2026 | 13 | 14 | 0 |
| June 2026 | 25 | 26 | 0 |

The ground truth was built by reading the filed `.docx` files as text. An image
paragraph contains no text, so it read as an empty line — which is how the
output spec came to describe a "blank line" that has never existed in any of the
five reports.

The cost of the gap: the step-4 report verifier reported *"25/25 lines match
ground truth exactly"* for a June document that was missing 26 images and about
4.7 MB. Nothing about that was a false pass — every text line genuinely was
correct. It was a **true pass on an incomplete question**, which is harder to
notice.

Each `ground-truth/*.json` now carries an `expectedImages` count so a future
check can assert on it. Image *placement* — the right receipt under the right
expense — is verified in build step 5.

**An eval only defends what someone thought to write down.**

## Where AI is still required

| Input | Text layer? | Method |
|---|---|---|
| `Corporate_CC_*.pdf` (statement) | Yes | Deterministic parser — **no AI** |
| Hotel folios (`*folio*.pdf`) | Yes | Deterministic parser — no AI |
| `* paper receipts.pdf` | **No** — 12 pages of scans | Claude vision |
| `* rideshare receipts.docx` | **No** — embedded images | Claude vision |

## Running it

```bash
cd evals
python3 run_eval.py
```

Point it elsewhere with `EXPENSE_SOURCE_DIR=/path/to/Work Expense Reports`.

Requires `pdfplumber` and `python-docx`.

## Regression rule

The production parser is TypeScript. Port the algorithm from
`reference/parse_statement.py`, then re-run this eval against the TS output.
**90/90 or it does not ship.** Amount and date errors destroy trust in an
expense tool instantly, and there is no partial credit.

## Privacy

`ground-truth/*.json` contains real merchant names and amounts from Bilal's
corporate card. It is gitignored. Never commit it, never deploy it, never
include it in the portfolio write-up. Publish the *scores*, not the data.
