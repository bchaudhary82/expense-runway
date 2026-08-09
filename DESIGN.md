# Design Spec — airline-booking-flow inspired, clearly a tool

## The rule (read this first)

The interface should feel **instantly familiar to the team who use it** — same
palette, same typography, same card-and-step rhythm as the airline's own site — while
being **unmistakably not an official product of theirs**.

**Do:** use the colours, fonts, spacing, card shapes and the multi-step
"booking flow" pattern.

**Do not:** use the airline's logo, its marks, or its name in the
product name, or copy page layouts pixel-for-pixel. No official-looking
headers, no imitation of corporate system chrome.

Product name: **Expense Runway** (working title — change if Bilal prefers).
Tagline: *"File your month in five minutes."*
Logo: a simple wordmark in the primary teal. No aircraft imagery.

## Colour tokens

Sampled from live computed styles on the source site (July 2026), not guessed.

| Token | Hex | Where it comes from | Use for |
|---|---|---|---|
| `--brand-teal` | `#017F7C` | primary link/accent colour (171 elements) | Primary buttons, links, active step, focus rings |
| `--brand-teal-hover` | `#018380` | hover state | Button hover |
| `--brand-ink` | `#1C383C` | dark section background + headings | Headings, dark bars, footer |
| `--brand-ink-deep` | `#152D32` | nav bar background | Top navigation |
| `--brand-body` | `#666666` | default body text (1049 elements) | Paragraphs, table cells, helper text |
| `--brand-surface` | `#FFFFFF` | card background | Cards, review table |
| `--brand-canvas` | `#F7F7F7` | page/section background | Page background, icon circles, zebra rows |
| `--brand-line` | `#E3E6E6` | derived | Borders, table rules |

Status colours (not on the source site — chosen to sit alongside the palette):

| Token | Hex | Use for |
|---|---|---|
| `--status-ok` | `#0E7C4A` | Matched line, reconciled |
| `--status-warn` | `#B8730B` | Low-confidence extraction, amount mismatch |
| `--status-block` | `#B3261E` | Missing receipt, blocking error |

## Typography

The source site uses the Noto family. Both faces are on Google Fonts — free, no
licensing issue.

| Role | Font | Notes |
|---|---|---|
| Headings | **Noto Sans Display** | 600–700 weight, colour `--brand-ink` |
| Body / UI | **Noto Sans** | 400 body, 600 buttons and labels |
| Amounts | **Noto Sans**, `font-variant-numeric: tabular-nums` | Critical — amounts must align in a column |

Load with `next/font/google`. Fallback stack: `Arial, sans-serif`.

## Components

Matched to real measured values from the site:

- **Buttons** — `border-radius: 4px`, `font-weight: 600`, `font-size: 14px`,
  generous horizontal padding. Primary = teal fill, white text. Secondary =
  white fill, teal text, teal border.
- **Cards** — white, `border-radius: 8px`, no shadow, sitting on `#F7F7F7`.
  This is the site's `basic-card` pattern.
- **Icon circles** — `#F7F7F7` fill, `border-radius: 50%`.
- **Top bar** — `#152D32`, white 600-weight text, 14–16px.

## The booking-flow metaphor

the airline's booking flow is a horizontal stepper: *Search → Select → Extras →
Payment → Confirmation*. Mirror it exactly, because the team already reads it
without thinking:

```
①  Upload        ②  Reconcile      ③  Add purposes    ④  Download
   receipts +       match receipts     one line each      your report
   statement        to statement
```

- The stepper is persistent across the top, teal for done, ink for current,
  grey for upcoming — same treatment as the booking flow.
- The **Upload** step is the "search panel": a wide white card floating on the
  canvas, drag-and-drop zone where the origin/destination fields would be, with
  a single large teal action button on the right.
- The **Reconcile** step is the "select your flight" step: a list of rows, each
  either cleanly matched (quiet, green tick) or flagged (bordered card, clear
  problem statement, explicit choices). Flags read like the airline's own
  disruption messaging — plain, calm, tells you what to do next. Never a raw
  error code.
- The **Add purposes** step is the "guest details" step: the editable table,
  tabular numerals, one purpose field per row, with "copy purpose down."
- The **Download** step is the "confirmation" screen: a reconciliation summary
  (N expenses, total CAD, all statement lines matched) and a single primary
  button. Same shape as a booking confirmation.

## Blocking state

Report generation is blocked until every flag is resolved (see PRD). Present
this the way the site presents an incomplete booking: the primary button is
disabled with a plain-language reason beside it —
*"3 statement lines still need a receipt"* — and each unresolved row is
anchor-linked from that message. Never a modal, never a red wall.

## Responsive

Desktop-first — this is filed at a desk. Must not break on a phone, but no
mobile-specific work in v1.

## Accessibility

`#017F7C` on white is 4.6:1 — passes AA for normal text. `#666666` on white is
5.7:1 — passes. Do not lighten either. Never signal reconciliation status with
colour alone; always pair with an icon and a text label.
