"""
Eval runner — scores a statement parser against five months of ground truth.

Usage:
    python3 run_eval.py

Ground truth lives in evals/ground-truth/*.json and was extracted from the
finished, human-verified expense reports in `03 Areas/Work Expense Reports/`.
Those reports were filed and accepted, so they are real ground truth, not
a guess.

PASS BAR: 90/90 rows, every field exact. Dates and amounts are the fields that
destroy user trust when wrong, so there is no partial credit on them.
"""

import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GT_DIR = os.path.join(HERE, "ground-truth")
FIXTURES = os.path.join(HERE, "fixtures", "statements")

sys.path.insert(0, os.path.join(HERE, "reference"))
from parse_statement import parse_statement  # noqa: E402

FIELDS = [
    "date",
    "expenseAmount",
    "billedAmount",
    "expensedCurrency",
    "billedCurrency",
    "vendor",
]


def main():
    total = matched = 0
    failures = []

    for gt_path in sorted(glob.glob(os.path.join(GT_DIR, "*.json"))):
        gt = json.load(open(gt_path))
        stmt = os.path.join(FIXTURES, gt["sourceStatement"])
        if not os.path.exists(stmt):
            print(f"SKIP {gt['month']}: statement not found at {stmt}")
            continue

        got = parse_statement(stmt)
        expected = gt["rows"]
        total += len(expected)

        if len(got) != len(expected):
            failures.append(
                f"{gt['month']}: row count {len(got)} != expected {len(expected)}"
            )

        month_ok = 0
        for i, exp in enumerate(expected):
            if i >= len(got):
                failures.append(f"{gt['month']} row {i}: missing")
                continue
            diffs = [f for f in FIELDS if got[i].get(f) != exp[f]]
            if diffs:
                failures.append(
                    f"{gt['month']} row {i}: {diffs} got={got[i]} want={exp}"
                )
            else:
                month_ok += 1
        matched += month_ok

        got_total = round(
            sum(float(r["billedAmount"].replace(",", "")) for r in got), 2
        )
        flag = "OK " if month_ok == len(expected) else "FAIL"
        print(
            f"{flag} {gt['month']:<15} {month_ok}/{len(expected)} rows   "
            f"total ${got_total} (expected ${gt['billedTotalCAD']})"
        )

    print()
    pct = 100 * matched / total if total else 0
    print(f"RESULT: {matched}/{total} rows exact ({pct:.1f}%)")
    if failures:
        print("\nFailures:")
        for f in failures[:25]:
            print("  -", f)
    return 0 if matched == total and total > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
