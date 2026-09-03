/** Serializa filas a CSV con comillas seguras para Excel/Sheets. */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return '';
  const cols = columns ?? Object.keys(rows[0]!);

  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    // Prefijo defensivo contra fórmulas inyectadas al abrir en una hoja de cálculo.
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };

  const header = cols.map(escape).join(',');
  const body = rows.map((row) => cols.map((c) => escape(row[c])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}
