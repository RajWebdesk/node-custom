// Reusable table for mock-data prototype pages. Headers use scope="col" (WCAG table semantics).

export interface Column {
  key: string;
  label: string;
  numeric?: boolean;
}

export function MockTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: Column[];
  rows: Record<string, string | number>[];
}) {
  return (
    <div className="card table-wrap">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col" className={col.numeric ? "num" : undefined}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td key={col.key} className={col.numeric ? "num" : undefined}>
                  {row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
