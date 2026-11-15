import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cn";

export type SortDirection = "asc" | "desc";
export type TableSort = { key: string; direction: SortDirection };

export type TableColumn<Row> = {
  key: string;
  /** Plain text: it is reused as the cell's label when rows stack on phones. */
  header: string;
  cell: (row: Row) => ReactNode;
  /** Renders the header as a button that calls `onSort`. */
  sortable?: boolean;
  align?: "start" | "end";
  /** The cell that names the row. Rendered as a row header (`<th scope="row">`). */
  rowHeader?: boolean;
  className?: string;
};

export type TableProps<Row> = {
  /** Describes the table. Always read to screen readers; shown above the table unless `hideCaption`. */
  caption: string;
  hideCaption?: boolean;
  columns: TableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  sort?: TableSort;
  /** Called with the column key and the direction to sort by next. */
  onSort?: (next: TableSort) => void;
  /** Shown instead of rows when there are none, for example an EmptyState. */
  empty?: ReactNode;
  className?: string;
};

/**
 * A data table that turns into stacked cards on phones (each cell shows its own
 * column name). Table roles are set explicitly so screen readers still get rows
 * and headers when the layout changes. Sortable headers are real buttons.
 */
export function Table<Row>({
  caption,
  hideCaption = false,
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  empty,
  className,
}: TableProps<Row>) {
  if (rows.length === 0 && empty) {
    return (
      <div className={className}>
        {!hideCaption && <p className="text-ink mb-2 font-bold">{caption}</p>}
        {empty}
      </div>
    );
  }

  return (
    <div
      className={cx(
        "sm:rounded-card sm:border-ink sm:bg-surface w-full sm:overflow-x-auto sm:border-2",
        className,
      )}
    >
      <table role="table" className="table-stack text-ink w-full border-collapse text-start">
        <caption className={cx("px-4 py-3 text-start font-bold", hideCaption && "sr-only")}>
          {caption}
        </caption>
        <thead role="rowgroup">
          <tr role="row" className="border-ink bg-tint border-b-2">
            {columns.map((column) => {
              const active = sort?.key === column.key ? sort.direction : undefined;
              const next: SortDirection = active === "asc" ? "desc" : "asc";
              return (
                <th
                  key={column.key}
                  role="columnheader"
                  scope="col"
                  aria-sort={
                    column.sortable
                      ? active === "asc"
                        ? "ascending"
                        : active === "desc"
                          ? "descending"
                          : "none"
                      : undefined
                  }
                  className={cx(
                    "px-4 py-2 text-sm font-bold whitespace-nowrap",
                    column.align === "end" ? "text-end" : "text-start",
                  )}
                >
                  {column.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort({ key: column.key, direction: next })}
                      className="hover:bg-surface -mx-2 inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 font-bold hover:underline hover:underline-offset-4"
                    >
                      {column.header}
                      {active === "asc" ? (
                        <ArrowUp aria-hidden="true" className="size-4" strokeWidth={2.5} />
                      ) : active === "desc" ? (
                        <ArrowDown aria-hidden="true" className="size-4" strokeWidth={2.5} />
                      ) : (
                        <ArrowUpDown aria-hidden="true" className="text-ink-muted size-4" strokeWidth={2.5} />
                      )}
                      <span className="sr-only">
                        ({active ? `sorted ${active === "asc" ? "ascending" : "descending"}, ` : ""}sort{" "}
                        {next === "asc" ? "ascending" : "descending"})
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row) => (
            <tr key={rowKey(row)} role="row" className="sm:border-line sm:border-b sm:last:border-b-0">
              {columns.map((column) => {
                const content = (
                  <>
                    <span aria-hidden="true" className="text-ink-muted text-sm font-bold sm:hidden">
                      {column.header}
                    </span>
                    <span className="min-w-0">{column.cell(row)}</span>
                  </>
                );
                const cellStyles = cx(
                  "align-top sm:px-4 sm:py-3",
                  column.align === "end" && "sm:text-end",
                  column.className,
                );
                return column.rowHeader ? (
                  <th
                    key={column.key}
                    role="rowheader"
                    scope="row"
                    className={cx(cellStyles, "text-start font-bold")}
                  >
                    {content}
                  </th>
                ) : (
                  <td key={column.key} role="cell" className={cellStyles}>
                    {content}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
