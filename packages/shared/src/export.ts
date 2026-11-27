/** Giá trị một ô khi xuất bảng ra Excel (.xlsx) hoặc CSV. */
export type ExportCell = string | number | boolean | Date | null | undefined;

export interface ExportColumn<T> {
  header: string;
  value: (row: T, index: number) => ExportCell;
  /** Độ rộng cột gợi ý (ký tự); bỏ trống sẽ tự tính theo nội dung */
  width?: number;
}

function stripInvalidXml(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 0x09 || code === 0x0a || code === 0x0d || (code >= 0x20 && code !== 0x7f)) {
      out += s[i];
    }
  }
  return out;
}

function escXml(s: string): string {
  return stripInvalidXml(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatDateCell(d: Date): string {
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
}

function cellText(v: ExportCell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Có' : 'Không';
  if (v instanceof Date) return formatDateCell(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return String(v);
}

/** Chuyển chỉ số cột 0-based sang tên cột Excel (0 -> A, 25 -> Z, 26 -> AA). */
export function excelColName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Làm sạch tên sheet Excel (tối đa 31 ký tự, bỏ ký tự cấm \ / ? * [ ] :). */
export function safeSheetName(name: string): string {
  const cleaned = stripInvalidXml(name).replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim();
  return (cleaned || 'DuLieu').slice(0, 31);
}

/** Bảo vệ chống CSV formula injection (=, +, @, tab, cr, hoặc - không phải số). */
function safeCsvValue(v: ExportCell): string {
  const raw = cellText(v);
  if (!raw) return '""';
  const guarded =
    typeof v !== 'number' && (/^[=+@\t\r]/.test(raw) || (/^-/.test(raw) && !/^-\d+(\.\d+)?$/.test(raw)))
      ? `'${raw}`
      : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** Tạo nội dung CSV có UTF-8 BOM để mở trực tiếp trên Excel giữ nguyên tiếng Việt. */
export function buildCsv<T>(columns: readonly ExportColumn<T>[], rows: readonly T[]): string {
  const headerLine = columns.map((c) => safeCsvValue(c.header)).join(',');
  const dataLines = rows.map((row, idx) => columns.map((c) => safeCsvValue(c.value(row, idx))).join(','));
  return '\uFEFF' + [headerLine, ...dataLines].join('\r\n');
}

// ---------------- Pure TS OOXML (.xlsx) + ZIP Store ----------------

const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  nameBytes: Uint8Array;
  data: Uint8Array;
  crc: number;
  offset: number;
}

function buildZipStore(files: { name: string; content: string }[]): Uint8Array {
  const entries: ZipEntry[] = [];
  let localTotal = 0;

  for (const f of files) {
    const nameBytes = encoder.encode(f.name);
    const data = encoder.encode(f.content);
    const crc = crc32(data);
    entries.push({ nameBytes, data, crc, offset: localTotal });
    localTotal += 30 + nameBytes.length + data.length;
  }

  let cdTotal = 0;
  for (const e of entries) cdTotal += 46 + e.nameBytes.length;

  const out = new Uint8Array(localTotal + cdTotal + 22);
  const view = new DataView(out.buffer);
  let pos = 0;

  // Local file headers + data
  for (const e of entries) {
    view.setUint32(pos, 0x04034b50, true);
    view.setUint16(pos + 4, 20, true); // version needed
    view.setUint16(pos + 6, 0x0800, true); // UTF-8
    view.setUint16(pos + 8, 0, true); // Store (no compression)
    view.setUint16(pos + 10, 0, true); // mod time
    view.setUint16(pos + 12, 0x5421, true); // mod date
    view.setUint32(pos + 14, e.crc, true);
    view.setUint32(pos + 18, e.data.length, true);
    view.setUint32(pos + 22, e.data.length, true);
    view.setUint16(pos + 26, e.nameBytes.length, true);
    view.setUint16(pos + 28, 0, true);
    pos += 30;
    out.set(e.nameBytes, pos);
    pos += e.nameBytes.length;
    out.set(e.data, pos);
    pos += e.data.length;
  }

  // Central directory
  const cdStart = pos;
  for (const e of entries) {
    view.setUint32(pos, 0x02014b50, true);
    view.setUint16(pos + 4, 20, true); // version made by
    view.setUint16(pos + 6, 20, true); // version needed
    view.setUint16(pos + 8, 0x0800, true); // UTF-8
    view.setUint16(pos + 10, 0, true); // Store
    view.setUint16(pos + 12, 0, true);
    view.setUint16(pos + 14, 0x5421, true);
    view.setUint32(pos + 16, e.crc, true);
    view.setUint32(pos + 20, e.data.length, true);
    view.setUint32(pos + 24, e.data.length, true);
    view.setUint16(pos + 28, e.nameBytes.length, true);
    view.setUint16(pos + 30, 0, true);
    view.setUint16(pos + 32, 0, true);
    view.setUint16(pos + 34, 0, true);
    view.setUint16(pos + 36, 0, true);
    view.setUint32(pos + 38, 0, true);
    view.setUint32(pos + 42, e.offset, true);
    pos += 46;
    out.set(e.nameBytes, pos);
    pos += e.nameBytes.length;
  }

  // End of Central Directory
  view.setUint32(pos, 0x06054b50, true);
  view.setUint16(pos + 4, 0, true);
  view.setUint16(pos + 6, 0, true);
  view.setUint16(pos + 8, entries.length, true);
  view.setUint16(pos + 10, entries.length, true);
  view.setUint32(pos + 12, cdTotal, true);
  view.setUint32(pos + 16, cdStart, true);
  view.setUint16(pos + 20, 0, true);

  return out;
}

/** Tạo file Excel (.xlsx) hợp lệ theo chuẩn OOXML, không cần thư viện ngoài. */
export function buildXlsx<T>(sheetName: string, columns: readonly ExportColumn<T>[], rows: readonly T[]): Uint8Array {
  const safeName = safeSheetName(sheetName);
  const widths = columns.map((c) => c.width ?? Math.max(10, c.header.length + 4));

  const cellGrid: ExportCell[][] = rows.map((row, idx) =>
    columns.map((c, colIdx) => {
      const val = c.value(row, idx);
      if (c.width === undefined) {
        const len = cellText(val).length + 3;
        if (len > widths[colIdx]!) widths[colIdx] = Math.min(48, len);
      }
      return val;
    }),
  );

  const colsXml = columns.length
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';

  const headerCells = columns
    .map((c, i) => `<c r="${excelColName(i)}1" t="inlineStr" s="1"><is><t xml:space="preserve">${escXml(c.header)}</t></is></c>`)
    .join('');

  const dataRowsXml = cellGrid
    .map((vals, rowIdx) => {
      const rNum = rowIdx + 2;
      const cells = vals
        .map((v, colIdx) => {
          const ref = `${excelColName(colIdx)}${rNum}`;
          if (typeof v === 'number' && Number.isFinite(v)) {
            return `<c r="${ref}" t="n"><v>${v}</v></c>`;
          }
          const txt = cellText(v);
          if (!txt) return '';
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escXml(txt)}</t></is></c>`;
        })
        .filter(Boolean)
        .join('');
      return `<row r="${rNum}">${cells}</row>`;
    })
    .join('');

  const lastCol = excelColName(Math.max(0, columns.length - 1));
  const lastRow = rows.length + 1;
  const autoFilterXml = columns.length ? `<autoFilter ref="A1:${lastCol}${lastRow}"/>` : '';

  const worksheetXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    colsXml +
    '<sheetData>' +
    `<row r="1" ht="22" customHeight="1">${headerCells}</row>` +
    dataRowsXml +
    '</sheetData>' +
    autoFilterXml +
    '</worksheet>';

  const stylesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2">' +
    '<font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FF1E293B"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF2FF"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '</cellXfs>' +
    '</styleSheet>';

  const workbookXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${escXml(safeName)}" sheetId="1" r:id="rId1"/></sheets>` +
    '</workbook>';

  const workbookRelsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  const rootRelsXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const contentTypesXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';

  return buildZipStore([
    { name: '[Content_Types].xml', content: contentTypesXml },
    { name: '_rels/.rels', content: rootRelsXml },
    { name: 'xl/workbook.xml', content: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml },
    { name: 'xl/styles.xml', content: stylesXml },
    { name: 'xl/worksheets/sheet1.xml', content: worksheetXml },
  ]);
}
