// Download rows as a CSV file (opens in Excel / Sheets).
// columns: [{ label, value: (row) => any }]
function cell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  // A cell starting with = + - @ would run as a formula in a spreadsheet, and
  // names and file names come from users: neutralise it.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadCsv(filename, columns, rows) {
  const lines = [columns.map((c) => cell(c.label)).join(',')];
  rows.forEach((row) => lines.push(columns.map((c) => cell(c.value(row))).join(',')));
  const blob = new Blob(['﻿', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// "2026-11-21T14:05:00Z" from a ms epoch, for spreadsheets.
export const isoTime = (ms) => (ms ? new Date(Number(ms)).toISOString() : '');
