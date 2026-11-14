import { strToU8, zipSync } from 'fflate';
import { toCsv } from './export';
import { fetchRows, type QueryContext } from './queries';
import { bytesFromDataUrl, imageBaseName, isDataUriImage, sniffImage } from '../lib/images';
import type { FileInfo, TableMeta } from './protocol';

/**
 * Builds a portable ZIP package out of the open database:
 *
 *   README.md          short bilingual description
 *   manifest.json      metadata about the dump
 *   schema.sql         the DDL of every table and view
 *   data/<table>.csv   one CSV per table (UTF-8 with BOM)
 *   images/…           images found in BLOB / data-URI columns
 *
 * The CSV files reference the extracted images by their relative path so the
 * package stays readable without a database.
 */

const MAX_ROWS_PER_TABLE = 500_000;

export interface PackagePayload {
  filename: string;
  mime: string;
  data: Uint8Array;
}

function slug(value: string): string {
  const clean = value.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  return clean || 'table';
}

function hexPreview(bytes: Uint8Array, limit = 32): string {
  let hex = '0x';
  const step = Math.min(bytes.length, limit);
  for (let i = 0; i < step; i++) hex += bytes[i].toString(16).padStart(2, '0');
  if (bytes.length > step) hex += `…(${bytes.length} bytes)`;
  return hex;
}

function buildSchemaSql(tables: TableMeta[]): string {
  const parts: string[] = [];
  for (const table of tables) {
    const ddl = (table.ddl ?? '').trim();
    if (!ddl) continue;
    parts.push(ddl.endsWith(';') ? ddl : `${ddl};`);
  }
  return parts.join('\n\n') + '\n';
}

function buildReadme(file: FileInfo, tables: TableMeta[], rows: number): string {
  const list = tables
    .map((t) => `| ${t.name} | ${t.type} | ${t.rowCount} | ${t.columns.length} |`)
    .join('\n');

  return `# ${file.name}

Exported by **SQL Dump Studio** — everything in this archive was produced in the browser.

| table | kind | rows | columns |
| --- | --- | --- | --- |
${list}

## محتويات الحزمة

- \`schema.sql\` — تعريف الجداول (DDL)
- \`data/\` — بيانات كل جدول بصيغة CSV (UTF-8)
- \`images/\` — الصور المستخرجة من أعمدة BLOB أو data-URI
- \`manifest.json\` — بيانات الملف المصدر

Total rows: ${rows} · dialect: ${file.dialect} · exported: ${new Date().toISOString()}
`;
}

export function buildPackage(
  ctx: QueryContext,
  file: FileInfo,
  tables: TableMeta[],
): PackagePayload {
  const files: Record<string, Uint8Array> = {};
  let totalRows = 0;
  let imageCount = 0;

  for (const table of tables) {
    let columns: string[] = [];
    let rows: unknown[][] = [];
    try {
      const fetched = fetchRows(ctx, table.name, {}, MAX_ROWS_PER_TABLE);
      columns = fetched.columns;
      rows = fetched.rows;
    } catch (err) {
      console.warn(`Could not read the table ${table.name}`, err);
      continue;
    }

    totalRows += rows.length;
    const tableSlug = slug(table.name);

    const csvRows = rows.map((row, rowIndex) =>
      row.map((value, columnIndex) => {
        const columnName = columns[columnIndex] ?? `col_${columnIndex}`;

        if (value instanceof Uint8Array) {
          const info = sniffImage(value);
          if (info) {
            const path = `images/${tableSlug}_${imageBaseName(columnName)}_${rowIndex + 1}.${info.ext}`;
            files[path] = value;
            imageCount++;
            return path;
          }
          return hexPreview(value);
        }

        if (isDataUriImage(value)) {
          const bytes = bytesFromDataUrl(value as string);
          const info = bytes ? sniffImage(bytes) : null;
          if (bytes && info) {
            const path = `images/${tableSlug}_${imageBaseName(columnName)}_${rowIndex + 1}.${info.ext}`;
            files[path] = bytes;
            imageCount++;
            return path;
          }
        }

        return value;
      }),
    );

    files[`data/${tableSlug}.csv`] = toCsv(columns, csvRows);
  }

  files['schema.sql'] = strToU8(buildSchemaSql(tables));
  files['README.md'] = strToU8(buildReadme(file, tables, totalRows));
  files['manifest.json'] = strToU8(
    JSON.stringify(
      {
        source: file.name,
        size: file.size,
        dialect: file.dialect,
        encoding: file.encoding,
        importedAt: file.importedAt,
        exportedAt: Date.now(),
        tableCount: tables.length,
        rowCount: totalRows,
        imageCount,
        tables: tables.map((t) => ({
          name: t.name,
          type: t.type,
          rows: t.rowCount,
          columns: t.columns.map((c) => c.name),
        })),
      },
      null,
      2,
    ),
  );

  const zipped = zipSync(files, { level: 6 });
  const base = slug(file.name.replace(/\.[^.]+$/, '')) || 'sql-dump';

  return {
    filename: `${base}-package.zip`,
    mime: 'application/zip',
    data: zipped,
  };
}
