import { strToU8, zipSync } from 'fflate';

export interface ExportSheet {
  name: string;
  columns: string[];
  rows: unknown[][];
}

const MAX_ROWS_PER_SHEET = 1_048_575;
const MAX_CELL_CHARS = 32_767;

/* ------------------------------------------------------------------ *
 * Text helpers
 * ------------------------------------------------------------------ */

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Uint8Array) {
    let hex = '0x';
    const step = Math.min(value.length, 64);
    for (let i = 0; i < step; i++) hex += value[i].toString(16).padStart(2, '0');
    if (value.length > step) hex += `…(${value.length} bytes)`;
    return hex;
  }
  if (value instanceof ArrayBuffer) return cellToText(new Uint8Array(value));
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return '"' + value.replace(/"/g, '""') + '"';
  return value;
}

/* ------------------------------------------------------------------ *
 * CSV
 * ------------------------------------------------------------------ */

export function toCsv(columns: string[], rows: unknown[][]): Uint8Array {
  const lines: string[] = [];
  lines.push(columns.map(csvEscape).join(','));
  for (const row of rows) {
    lines.push(row.map((v) => csvEscape(cellToText(v))).join(','));
  }
  // BOM keeps Excel happy with UTF-8 (Arabic text in particular).
  const text = '\uFEFF' + lines.join('\r\n') + '\r\n';
  return strToU8(text);
}

/* ------------------------------------------------------------------ *
 * JSON / NDJSON
 * ------------------------------------------------------------------ */

export function toJson(columns: string[], rows: unknown[][]): Uint8Array {
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    const obj: Record<string, unknown> = {};
    columns.forEach((c, i) => {
      obj[c] = row[i] ?? null;
    });
    out.push(obj);
  }
  return strToU8(JSON.stringify(out, null, 2));
}

export function toNdjson(columns: string[], rows: unknown[][]): Uint8Array {
  const parts: string[] = [];
  for (const row of rows) {
    const obj: Record<string, unknown> = {};
    columns.forEach((c, i) => {
      obj[c] = row[i] ?? null;
    });
    parts.push(JSON.stringify(obj));
  }
  return strToU8(parts.join('\n') + (parts.length ? '\n' : ''));
}

/* ------------------------------------------------------------------ *
 * SQL dump
 * ------------------------------------------------------------------ */

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function toSqlDump(table: string, columns: string[], rows: unknown[][]): Uint8Array {
  const quotedTable = `"${table.replace(/"/g, '""')}"`;
  const cols = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ');
  const out: string[] = [`-- Export of table ${table}`, `DELETE FROM ${quotedTable};`];
  for (const row of rows) {
    const values = row.map((v) => {
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
      if (typeof v === 'boolean') return v ? '1' : '0';
      if (v instanceof Uint8Array) return `X'${[...v].map((b) => b.toString(16).padStart(2, '0')).join('')}'`;
      return sqlString(cellToText(v));
    });
    out.push(`INSERT INTO ${quotedTable} (${cols}) VALUES (${values.join(', ')});`);
  }
  return strToU8(out.join('\n') + '\n');
}

/* ------------------------------------------------------------------ *
 * XLSX (hand rolled, no external dependency)
 * ------------------------------------------------------------------ */

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Removes characters that are illegal in XML 1.0. */
function stripIllegalXml(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
}

function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function safeSheetName(name: string, used: Set<string>): string {
  let base = stripIllegalXml(name).replace(/[\\/?*[\]:]/g, ' ').trim() || 'Sheet1';
  if (base.length > 31) base = base.slice(0, 31);
  let candidate = base;
  let counter = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${counter})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
    counter++;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function sheetXml(columns: string[], rows: unknown[][]): string {
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  parts.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
  const lastCol = columnLetter(Math.max(columns.length - 1, 0));
  const lastRow = rows.length + 1;
  parts.push(`<dimension ref="A1:${lastCol}${lastRow}"/>`);
  parts.push(
    '<sheetViews><sheetView tabSelected="1" workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
      '</sheetView></sheetViews>',
  );
  parts.push('<sheetData>');

  const headerCells = columns
    .map((c, i) => {
      const text = stripIllegalXml(cellToText(c)).slice(0, MAX_CELL_CHARS);
      return `<c r="${columnLetter(i)}1" t="inlineStr" s="1"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
    })
    .join('');
  parts.push(`<row r="1">${headerCells}</row>`);

  rows.forEach((row, r) => {
    const rowIndex = r + 2;
    const cells: string[] = [];
    for (let i = 0; i < columns.length; i++) {
      const value = row[i];
      if (value === null || value === undefined) continue;
      const ref = `${columnLetter(i)}${rowIndex}`;
      if (typeof value === 'number' && Number.isFinite(value)) {
        cells.push(`<c r="${ref}"><v>${value}</v></c>`);
      } else if (typeof value === 'boolean') {
        cells.push(`<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`);
      } else {
        const text = stripIllegalXml(cellToText(value)).slice(0, MAX_CELL_CHARS);
        if (!text) continue;
        cells.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`);
      }
    }
    parts.push(`<row r="${rowIndex}">${cells.join('')}</row>`);
  });

  parts.push('</sheetData></worksheet>');
  return parts.join('');
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

export function toXlsx(sheets: ExportSheet[]): Uint8Array {
  const used = new Set<string>();
  const prepared: { name: string; xml: string }[] = [];

  for (const sheet of sheets) {
    const name = safeSheetName(sheet.name, used);
    const chunks: unknown[][][] = [];
    const rowCount = sheet.rows.length;
    if (rowCount <= MAX_ROWS_PER_SHEET) {
      chunks.push(sheet.rows);
    } else {
      for (let i = 0; i < rowCount; i += MAX_ROWS_PER_SHEET) {
        chunks.push(sheet.rows.slice(i, i + MAX_ROWS_PER_SHEET));
      }
    }
    chunks.forEach((rows, i) => {
      const sheetName = chunks.length === 1 ? name : safeSheetName(`${name} ${i + 1}`, used);
      prepared.push({ name: sheetName, xml: sheetXml(sheet.columns, rows) });
    });
  }

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${prepared
  .map(
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join('\n')}
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${prepared
    .map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')}</sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${prepared
  .map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  )
  .join('\n')}
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
    'xl/styles.xml': strToU8(STYLES_XML),
  };
  prepared.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(s.xml);
  });

  return zipSync(files, { level: 6 });
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export interface ExportPayload {
  filename: string;
  mime: string;
  data: Uint8Array;
}

export function buildExport(
  format: 'csv' | 'json' | 'xlsx' | 'sql',
  table: string,
  columns: string[],
  rows: unknown[][],
): ExportPayload {
  const safe = table.replace(/[^\w.-]+/g, '_') || 'table';
  switch (format) {
    case 'csv':
      return { filename: `${safe}.csv`, mime: 'text/csv;charset=utf-8', data: toCsv(columns, rows) };
    case 'json':
      return { filename: `${safe}.json`, mime: 'application/json;charset=utf-8', data: toJson(columns, rows) };
    case 'sql':
      return { filename: `${safe}.sql`, mime: 'application/sql;charset=utf-8', data: toSqlDump(table, columns, rows) };
    case 'xlsx':
    default:
      return {
        filename: `${safe}.xlsx`,
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        data: toXlsx([{ name: safe, columns, rows }]),
      };
  }
}
