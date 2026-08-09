# Build prompts — Expense Runway

**No terminal needed.** Open Claude Code, point it at one folder, and paste these
prompts in order. Everything the build needs is already inside that folder.

## Setup (once)

1. Open **Claude Code**.
2. Open this folder:
   `Desktop / cowork homebase / 02 Projects / Expense Report Builder / claude-code-pack`
3. Start a new chat and paste **Prompt 1**.

That's it. The pack is self-contained — the plan, the design spec, the eval
suite, and real sample statements and receipts are all in there. Claude Code
never needs to look outside this folder.

## How to use these prompts

One prompt per session, in order. Don't run two at once — each step is
checkable on its own, and if something's wrong you want to catch it in the step
that caused it.

Claude Code will ask permission before creating files or running commands. Say
yes. When a step is done it'll tell you how to look at what it built.

If a step doesn't work, say so in plain words — *"the page is blank"*, *"it says
port already in use"* — and let it debug. You don't need to know the fix.

Steps 1–4 use **no AI and no API key**. You'll have a working tool that produces
your Word doc before you spend a cent.

---

## Prompt 1 — Scaffold

> Read CLAUDE.md, PRD.md and DESIGN.md in this folder before doing anything else.
>
> I'm non-technical and learning as I build. Explain each thing in plain English
> before you do it, and check in with me between steps rather than building
> everything at once.
>
> This is build step 1 of 9: the scaffold. Set up Next.js with the App Router,
> TypeScript and Tailwind in this folder. Wire in the colour tokens and the Noto
> Sans / Noto Sans Display fonts from DESIGN.md. Build the four-step stepper
> shell — Upload, Reconcile, Add purposes, Download — with no functionality
> behind it. I just want to look at it and recognise the booking-flow feel.
>
> Then create BUILD_LOG.md and record what you did this session and why.
>
> Don't start step 2 until I say go.

**How to check it:** Claude Code will tell you to run the dev server and open
`http://localhost:3000`. That's the app running on your own machine, visible
only to you. You should see the dark teal bar, the four steps, and the airline
palette.

---

## Prompt 2 — The statement parser (the important one)

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

**How to check it:** it must print 90/90. Not 89. If it can't get there, ask it
to show you which rows fail rather than loosening the test.

---

## Prompt 3 — Upload and parse

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

---

## Prompt 4 — The Word document

> Build step 4: generating the report. Turn the table into a downloadable Word
> doc using the `docx` npm package, in the exact format specified in CLAUDE.md —
> transaction line, purpose line, receipt image, four spaces between fields,
> chronological, `[ADD PURPOSE HERE]` when a purpose is empty. The receipt
> images arrive in step 5, so build the text skeleton now and leave room for
> them.
>
> Then verify it: generate the June report from the fixture statement and check
> it matches `evals/ground-truth/jun-2026.json` line for line. Report explicitly
> which properties you did NOT check.
>
> Update BUILD_LOG.md. After this the tool is already useful, so let's pause here
> and I'll try it on my own month.

> **Corrected July 30, 2026.** This prompt originally said "blank line,
> transaction line, purpose line." There is no blank line — that paragraph holds
> the receipt image. The original prompt, as it was actually run, is preserved in
> BUILD_LOG.md session 4; the correction is session 4b.

**Stop here and actually use it.** Run your July receipts through. It won't have
your receipts embedded yet — that's step 5 — but the whole text assembly is done,
which is the part that took the hour.

---

## Prompt 5 — Reading receipts (first step that needs an API key)

> Build step 5: receipts — extraction, matching and embedding. Three jobs, and
> only the middle one needs AI.
>
> **Extract, no AI:** pull the embedded images out of the rideshare `.docx` with
> `jszip`, render the scanned paper-receipt PDF pages to images, and render the
> statement PDF's transaction page for the screenshot that goes at the top of the
> report.
>
> **Match, Haiku 4.5 vision:** read date, amount and merchant off each receipt
> image purely to decide which statement line it belongs to. These values are
> only ever used for matching — they must never be written into the report.
>
> **Embed, no AI:** place each receipt image after its own entry and the
> statement screenshot at the top, per the corrected format in CLAUDE.md. Then
> set `IMAGES_IMPLEMENTED = true` in `scripts/verify-report.ts` so the image
> count becomes a hard failure, and get `npm run verify:report` fully green.
>
> Test against `evals/fixtures/receipts-june/` and tell me what percentage of
> the 25 June statement lines got matched to a receipt — and how you'd know if a
> receipt were attached to the wrong line. Update BUILD_LOG.md.

> **Re-scoped July 30, 2026.** This step originally covered matching only,
> because the spec didn't know the receipts go into the document. See BUILD_LOG.md
> session 4b.

**Before this prompt:** create a separate workspace in the Anthropic Console for
this tool and generate an API key inside it. Then go to **Settings → Workspaces
→ *your workspace* → Limits** and set a **$20/month spend limit** with email
notification thresholds.

> **Corrected July 30, 2026.** This originally said to load "about $20" onto the
> workspace. You can't — **Anthropic credits are organization-wide** and a
> workspace has no balance of its own. A monthly spend *limit* is the control
> that exists. It also means the tool draws on the same balance as your $100
> promotional credit; the cap is what bounds that, not a separate wallet.

Put the key in a file called `.env.local` in this folder, as one line:
`ANTHROPIC_API_KEY=...`. It's already gitignored. Claude Code should never be
handed the key directly — you create that file yourself.

---

## Prompt 6 — Reconciliation and blocking

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

---

## Prompt 7 — Purposes and review polish

> Build step 7: the Add purposes step. Editable purpose field on every row, a
> "copy purpose down" control, and the ability to delete personal charges.
> Statement amounts are read-only by default with an explicit override that gets
> noted in the final summary.
>
> Then build the Download step as a confirmation screen: number of expenses,
> total CAD, confirmation that every statement line is accounted for, and one
> primary button. Update BUILD_LOG.md.

---

## Prompt 8 — Passcode

> Build step 8: put a shared passcode in front of the whole app, read from an
> environment variable, with rate limiting on the attempts. No user accounts.
> Explain to me in plain English how environment variables keep the passcode out
> of the code. Update BUILD_LOG.md.

---

## Prompt 9 — Deploy

> Build step 9: get this on the internet. Walk me through putting the code on
> GitHub and deploying to Vercel, one step at a time — I've done neither before,
> so explain what each one is and why we need it before we do it.
>
> Double-check that `evals/ground-truth/` and `evals/fixtures/` are gitignored
> and are not in the repo before anything is pushed. Set the passcode and API key
> as environment variables in Vercel, never in the code.
>
> Then write the final BUILD_LOG.md entry summarising the whole build.

---

## After it's live

- Run your own month through it end to end before showing anyone.
- Have the employer conversation before colleagues use it. Your position is
  strong: the corporate card statement is parsed on the server and never sent to
  any AI provider — only photos of receipts are.
- The build log plus the eval story is your portfolio write-up. The line worth
  leading with: *I ran the evals and deleted the AI.*

## Two reminders about what's in this folder

`evals/ground-truth/` and `evals/fixtures/` contain real merchant names, real
amounts and real receipts from your corporate card. Both are gitignored. They
never go to GitHub, never get deployed, and never appear in the portfolio
write-up. Publish the scores, not the data.
