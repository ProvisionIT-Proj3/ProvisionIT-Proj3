// text that starts with these can be run as a formula when the file is opened in Excel
const FORMULA_START = /^[=+\-@\t\r]/;
const NUMERIC = /^-?\d+(\.\d+)?$/;

function cell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (FORMULA_START.test(text) && !NUMERIC.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// one line per account, with the section it sits under; header rows only supply the section name
export function accountsToCsv(items) {
  const rows = [['Section', 'Code', 'Account', 'Type', 'Dr/Cr', 'Balance']];
  let section = '';
  for (const a of items) {
    if (a.isHeader) {
      section = a.name;
      continue;
    }
    const balance = a.value == null ? '' : Number(a.value).toFixed(2);
    rows.push([section, a.code, a.name, a.type, a.drCr, balance]);
  }
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function downloadCsv(filename, text) {
  // the BOM makes Excel read the file as UTF-8
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
