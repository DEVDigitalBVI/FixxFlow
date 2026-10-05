import 'server-only';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont } from 'pdf-lib';
import type { Report } from './model';
import { breakdownDefinitions, dailyDefinitions, reportPeriod, slaNote, summaryRows, timingNote } from './export-model';

export class PdfCharacterError extends Error {
  constructor() { super('Some names contain characters this PDF font cannot display. Choose Excel or CSV to download the complete report.'); }
}

// Print equivalents of the product text, muted, border, surface, and accent tokens.
const ink = rgb(15 / 255, 23 / 255, 42 / 255);
const muted = rgb(100 / 255, 116 / 255, 139 / 255);
const border = rgb(226 / 255, 232 / 255, 240 / 255);
const surface = rgb(248 / 255, 250 / 255, 252 / 255);

export async function createReportPdf(report: Report, organization: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const base = path.join(process.cwd(), 'src/features/reporting/fonts');
  const [regularBytes, boldBytes, logoBytes] = await Promise.all([
    readFile(path.join(base, 'NotoSans-Regular.ttf')),
    readFile(path.join(base, 'NotoSans-Bold.ttf')),
    readFile(path.join(process.cwd(), 'public/brand/fixxflow/logo/fixxflow-logo-horizontal.png')),
  ]);
  const regular = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });
  const logo = await doc.embedPng(logoBytes);
  const supported = new Set(regular.getCharacterSet());
  function clean(text: string) {
    // Normalize control characters before passing user labels to the PDF font encoder.
    const value = text.replace(/[\u0000-\u001f\u007f]/g, ' ');
    if ([...value].some(char => !supported.has(char.codePointAt(0)!))) throw new PdfCharacterError();
    return value;
  }
  doc.setTitle('FixxFlow operational report');
  doc.setAuthor('FixxFlow');
  doc.setSubject(clean(organization));
  doc.setCreationDate(new Date(report.asOf));
  doc.setLanguage('en');
  const width = 595.28, height = 841.89, margin = 40, contentWidth = width - margin * 2;
  let page = doc.addPage([width, height]);
  let y = height - 40;
  function text(value: string, x: number, top: number, size = 10, font = regular, color = ink) {
    page.drawText(clean(value), { x, y: top - size, size, font, color });
  }
  function wrap(value: string, maxWidth: number, size = 10, font: PDFFont = regular) {
    const lines: string[] = [];
    let line = '';
    // Character fallback also handles long identifiers without spaces.
    for (const word of clean(value).split(/\s+/)) {
      if (line && font.widthOfTextAtSize(`${line} ${word}`, size) <= maxWidth) { line += ` ${word}`; continue; }
      if (line) { lines.push(line); line = ''; }
      for (const char of word) {
        if (line && font.widthOfTextAtSize(line + char, size) > maxWidth) { lines.push(line); line = ''; }
        line += char;
      }
    }
    if (line || !lines.length) lines.push(line);
    return lines;
  }
  function header() {
    const logoWidth = 116;
    page.drawImage(logo, { x: margin, y: height - 40 - logoWidth * logo.height / logo.width, width: logoWidth, height: logoWidth * logo.height / logo.width });
    text('Operational report', width - margin - bold.widthOfTextAtSize('Operational report', 11), height - 43, 11, bold);
    page.drawLine({ start: { x: margin, y: height - 80 }, end: { x: width - margin, y: height - 80 }, color: border, thickness: 1 });
    y = height - 100;
  }
  function nextPage() { page = doc.addPage([width, height]); header(); }
  function paragraph(value: string, size = 10, font = regular, color = muted) {
    for (const line of wrap(value, contentWidth, size, font)) {
      if (y < 72) nextPage();
      text(line, margin, y, size, font, color); y -= size + 5;
    }
    y -= 6;
  }
  function section(title: string, note: string) {
    const needed = 72 + wrap(note, contentWidth).length * 15;
    if (y - needed < 62) nextPage();
    paragraph(title, 16, bold, ink);
    if (note) paragraph(note);
  }
  function table(title: string, headings: string[], rows: string[][], widths: number[], compact = false) {
    const lineHeight = compact ? 12 : 14, padding = compact ? 6 : 12, size = 9;
    const drawRow = (cells: string[][], start: number, count: number, heading = false) => {
      const rowHeight = count * lineHeight + padding;
      if (heading) page.drawRectangle({ x: margin, y: y - rowHeight, width: contentWidth, height: rowHeight, color: surface });
      let x = margin;
      cells.forEach((lines, i) => {
        lines.slice(start, start + count).forEach((line, index) => text(line, x + 8, y - padding / 2 - index * lineHeight, size, heading ? bold : regular));
        x += widths[i];
      });
      y -= rowHeight;
      page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, color: border, thickness: 0.6 });
    };
    const headerCells = headings.map((value, i) => wrap(value, widths[i] - 16, size, bold));
    const head = () => drawRow(headerCells, 0, Math.max(...headerCells.map(cell => cell.length)), true);
    const continued = () => { nextPage(); paragraph(`${title} (continued)`, 14, bold, ink); head(); };
    head();
    for (const row of rows) {
      const cells = row.map((value, i) => wrap(value, widths[i] - 16, size));
      const count = Math.max(...cells.map(cell => cell.length));
      if (y - Math.min(count, 4) * lineHeight - padding < 62) continued();
      let start = 0;
      while (start < count) {
        const capacity = Math.floor((y - 62 - padding) / lineHeight);
        if (capacity < 1) { continued(); continue; }
        const take = Math.min(count - start, capacity);
        drawRow(cells, start, take);
        start += take;
        if (start < count) continued();
      }
    }
    if (!rows.length) paragraph('No data in this reporting period.');
    y -= 22;
  }
  const value = (v: number | null) => v === null ? 'No data' : new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(v);
  const period = reportPeriod(report);
  header();
  paragraph(clean(organization), 21, bold, ink);
  paragraph(`${period.start} to ${period.end} · ${report.daily.length} days · ${report.timezone}`);
  paragraph(`Generated ${new Intl.DateTimeFormat('en-GB', { timeZone: report.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(report.asOf))} (${report.timezone}). Downloads use a fresh snapshot.`);
  section('Today and current position', `Today is ${report.today}. Open and overdue counts show the current position.`);
  table('Summary', ['Metric', 'Value', 'Unit', 'Date or scope'], summaryRows(report).map(row => [row.label, value(row.value), row.unit, row.scope]), [180, 80, 85, contentWidth - 345]);
  section('Reading this report', timingNote);
  for (const metric of dailyDefinitions) paragraph(`${metric.label}: ${metric.note}`, 9);
  paragraph(`SLA: ${slaNote}`, 9);

  nextPage();
  section('Daily activity', 'Exact counts and average elapsed minutes for every day. Zero means a measured value; No data means no completed timing samples.');
  table('Daily activity', ['Date', 'Created', 'Resolved', 'Reopened', 'Response (min)', 'Resolution (min)'], report.daily.map(row => [row.day, value(row.created), value(row.resolved), value(row.reopened), value(row.response), value(row.resolution)]), [92, 67, 70, 75, 100, contentWidth - 404], true);
  section('SLA compliance', slaNote);
  table('SLA compliance', ['Target', 'Completed', 'Met', 'Compliance'], report.sla.map(row => [row.label, value(row.total), value(row.met), row.total > 0 ? `${(row.met / row.total * 100).toFixed(1)}%` : 'No data']), [230, 90, 75, contentWidth - 395]);
  for (const kind of new Set([...Object.keys(breakdownDefinitions), ...report.breakdowns.map(row => row.kind)])) {
    const definition = breakdownDefinitions[kind];
    const title = definition?.title ?? kind;
    section(title, definition?.note ?? '');
    table(title, ['Group', 'Tickets'], report.breakdowns.filter(row => row.kind === kind).map(row => [row.label, value(row.value)]), [contentWidth - 90, 90]);
  }
  for (const [index, item] of doc.getPages().entries()) {
    const footer = `Page ${index + 1} of ${doc.getPageCount()}`;
    item.drawText(`${period.start} to ${period.end}`, { x: margin, y: 30, font: regular, size: 8, color: muted });
    item.drawText(footer, { x: width - margin - regular.widthOfTextAtSize(footer, 8), y: 30, font: regular, size: 8, color: muted });
    item.drawLine({ start: { x: margin, y: 48 }, end: { x: width - margin, y: 48 }, thickness: 1, color: border });
  }
  // Keep PDF text searchable; the same exact values are also available in Excel/CSV.
  return doc.save();
}
