"use client";

/**
 * The parsed statement, as a table.
 *
 * Every amount uses tabular numerals so the digits sit in fixed-width columns
 * and the decimal points line up down the page — the point of DESIGN.md's note
 * that this is critical. Amounts are right-aligned for the same reason.
 *
 * The purpose column is rendered but not editable yet; that's build step 7.
 */
import type { StatementRow } from "@/lib/statement/parseStatement";
import { formatMoney } from "@/lib/statement/format";

export function LineItemsTable({
  rows,
  showPurpose = true,
}: {
  rows: StatementRow[];
  showPurpose?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[14px]">
        <thead>
          <tr className="bg-canvas text-left text-[12px] font-semibold uppercase tracking-wide text-body">
            <th className="px-6 py-2.5 font-semibold">Date</th>
            <th className="px-3 py-2.5 text-right font-semibold">Expensed</th>
            <th className="px-3 py-2.5 text-right font-semibold">Billed</th>
            <th className="px-3 py-2.5 font-semibold">Currency</th>
            <th className="px-3 py-2.5 font-semibold">Vendor</th>
            {showPurpose && (
              <th className="px-6 py-2.5 font-semibold">Purpose</th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const converted = row.expensedCurrency !== row.billedCurrency;
            return (
              <tr
                key={`${row.date}-${row.vendor}-${row.billedAmount}-${i}`}
                className="border-t border-line"
              >
                <td className="px-6 py-3 whitespace-nowrap tabular-nums">
                  {row.date}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {formatMoney(row.expenseAmount)}
                </td>
                <td className="px-3 py-3 text-right font-semibold text-ink tabular-nums">
                  {formatMoney(row.billedAmount)}
                </td>
                <td
                  className={`px-3 py-3 whitespace-nowrap ${
                    converted ? "font-semibold text-ink" : ""
                  }`}
                >
                  {row.expensedCurrency} → {row.billedCurrency}
                </td>
                <td className="px-3 py-3 font-semibold text-ink">
                  {row.vendor}
                </td>
                {showPurpose && (
                  <td className="px-6 py-3">
                    <input
                      disabled
                      placeholder="[ADD PURPOSE HERE]"
                      className="w-full min-w-[200px] rounded-[4px] border border-line bg-canvas px-3 py-2 text-[14px] placeholder:text-body"
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
