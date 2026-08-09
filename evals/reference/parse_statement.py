"""
Reference implementation — Corporate credit card statement parser.

PROVEN: reproduces 90/90 line items (100%) across five months of real statements
(Feb, Mar, Apr, May, Jun 2026), matching the human-made expense reports exactly on
every field: date, expense amount, billed amount, expensed currency, billed
currency, vendor name.

No AI is involved. The statement PDF has a real text layer; this is pure text
extraction plus column-position logic.

The production app is TypeScript. Port this algorithm to TS using `unpdf` or
`pdfjs-dist` (both expose per-word x/y coordinates, which is all this needs).
Do not "improve" the algorithm before it passes the eval at 100%.

ALGORITHM
---------
1. Extract words with coordinates from every page.
2. Group words into visual lines by rounding the `top` coordinate.
3. On each page, find the x-position of the "Location" column header.
4. A line is a transaction if its first three words form a date (MMM DD YYYY).
5. Fields 1-7 are fixed: date(3 words), $expenseAmount, $billedAmount,
   expensedCurrency, billedCurrency.
6. Vendor = remaining words LEFT of the Location column x-position.
   Location = words at or right of it. Location is DISCARDED (it does not
   appear in the expense report).

WHY THE COLUMN POSITION MATTERS
-------------------------------
Vendor names are truncated to 22 characters and frequently contain spaces
("DELTA HOTELS BY MARRIO", "NOODLE HOUSE AND CO"). Locations also contain
spaces ("Toronto ON", "MEMPHIS TN"). There is no reliable way to split vendor
from location with a regex on the flattened text string. The x-coordinate is
unambiguous. A regex-only approach was tried first and mangled every
multi-word vendor.
"""

import re

DATE_RE = re.compile(r"^[A-Z][a-z]{2} \d{2} \d{4}$")
# Refunds print the minus sign INSIDE the dollar sign: "$-12.24", not "-$12.24".
# Added July 30, 2026 — the July statement had a purchase plus an immediate
# refund, and the refund line failed the original pattern and was dropped, which
# overstates the report. None of the five months below contain a refund.
ROW_RE = re.compile(
    r"^([A-Z][a-z]{2} \d{2} \d{4})\s+"      # expense date
    r"\$(-?[\d,]+\.\d{2})\s+"                # expense amount (original currency)
    r"\$(-?[\d,]+\.\d{2})\s+"                # billed amount (CAD)
    r"([A-Z]{3})\s+"                         # expensed currency
    r"([A-Z]{3})\s+"                         # billed currency
    r"(.+?)\s*$"                             # vendor + location
)


def parse_statement(pdf_path):
    """Return a list of dicts, one per transaction, in statement order."""
    import pdfplumber

    rows = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            words = page.extract_words()

            lines = {}
            for w in words:
                lines.setdefault(round(w["top"] / 3), []).append(w)

            location_x = None
            for group in lines.values():
                for w in group:
                    if w["text"] == "Location":
                        location_x = w["x0"]
            if location_x is None:
                continue  # summary page, no transaction table

            for key in sorted(lines):
                group = sorted(lines[key], key=lambda w: w["x0"])
                if not DATE_RE.match(" ".join(w["text"] for w in group[:3])):
                    continue
                m = ROW_RE.match(" ".join(w["text"] for w in group))
                if not m:
                    continue
                # Drop the 7 fixed leading tokens (date is 3 words, then the two
                # amounts and the two currency codes), then keep only what sits
                # LEFT of the Location column.
                vendor = " ".join(
                    w["text"] for w in group[7:] if w["x0"] < location_x - 2
                )
                rows.append(
                    {
                        "date": m.group(1),
                        "expenseAmount": m.group(2),
                        "billedAmount": m.group(3),
                        "expensedCurrency": m.group(4),
                        "billedCurrency": m.group(5),
                        "vendor": vendor.strip(),
                    }
                )
    return rows


if __name__ == "__main__":
    import sys, json

    print(json.dumps(parse_statement(sys.argv[1]), indent=2))
