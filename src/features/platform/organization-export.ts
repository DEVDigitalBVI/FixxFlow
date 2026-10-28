import 'server-only';

import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont } from 'pdf-lib';
import * as XLSX from 'xlsx';

import { safeCsv } from '@/features/reporting/custom-export';
import { PdfCharacterError } from '@/features/reporting/export-pdf';

import {
  exportScope,
  organizationColumns,
  type OrganizationExport,
} from './organization-export-model';

const NOTE =
  'Account metadata and aggregate counts only. Customer tickets, messages, people and assets are not included.';
const rows = (data: OrganizationExport) =>
  data.organizations.map((row) => organizationColumns.map((column) => column.value(row)));

export function createOrganizationCsv(data: OrganizationExport) {
  const lines = [
    ['FixxFlow organization export'],
    ['Generated at (UTC)', data.generatedAt],
    ['Scope', exportScope(data)],
    ['Note', NOTE],
    [],
    organizationColumns.map((column) => column.heading),
    ...rows(data),
  ];
  return '﻿' + lines.map((line) => line.map(safeCsv).join(',')).join('\r\n') + '\r\n';
}

export function createOrganizationWorkbook(data: OrganizationExport): Uint8Array {
  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: 'FixxFlow organization export',
    Author: 'FixxFlow',
    CreatedDate: new Date(data.generatedAt),
  };
  const overview = XLSX.utils.aoa_to_sheet([
    ['FixxFlow organization export'],
    ['Generated at (UTC)', data.generatedAt],
    ['Scope', exportScope(data)],
    ['Note', NOTE],
  ]);
  overview['!cols'] = [{ wch: 22 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(workbook, overview, 'Overview');
  const headings = organizationColumns.map((column) => column.heading);
  const sheet = XLSX.utils.aoa_to_sheet([headings, ...rows(data)]);
  sheet['!cols'] = headings.map((_, index) => ({ wch: index === 0 ? 36 : 18 }));
  if (data.organizations.length)
    sheet['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: data.organizations.length, c: headings.length - 1 },
      }),
    };
  XLSX.utils.book_append_sheet(workbook, sheet, 'Organizations');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer', compression: true });
}

/** Landscape A4 table with repeated headings and page numbers. */
export async function createOrganizationPdf(data: OrganizationExport): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const base = path.join(process.cwd(), 'src/features/reporting/fonts');
  const [regularBytes, boldBytes, logoBytes] = await Promise.all([
    readFile(path.join(base, 'NotoSans-Regular.ttf')),
    readFile(path.join(base, 'NotoSans-Bold.ttf')),
    readFile(path.join(process.cwd(), 'public/brand/fixxflow/logo/fixxflow-logo-horizontal.png')),
  ]);
  const regular = await doc.embedFont(regularBytes, { subset: true }),
    bold = await doc.embedFont(boldBytes, { subset: true }),
    logo = await doc.embedPng(logoBytes),
    supported = new Set(regular.getCharacterSet());
  const clean = (value: string) => {
    const result = value.replace(/[\u0000-\u001f\u007f]/g, ' ');
    if ([...result].some((char) => !supported.has(char.codePointAt(0)!)))
      throw new PdfCharacterError();
    return result;
  };
  doc.setTitle('FixxFlow organization export');
  doc.setAuthor('FixxFlow');
  doc.setCreationDate(new Date(data.generatedAt));
  doc.setLanguage('en');
  const width = 841.89,
    height = 595.28,
    margin = 32,
    content = width - margin * 2,
    ink = rgb(40 / 255, 45 / 255, 51 / 255),
    muted = rgb(110 / 255, 103 / 255, 111 / 255),
    border = rgb(229 / 255, 229 / 255, 229 / 255),
    surface = rgb(242 / 255, 242 / 255, 242 / 255);
  // Name and address get room to wrap; counts stay narrow.
  const weights = [3.2, 2.2, 2, 1.5, 1, 1, 1.2, 1.1, 1, 0.9, 1, 0.9, 0.9, 1.5];
  const unit = content / weights.reduce((sum, value) => sum + value, 0);
  const widths = weights.map((value) => value * unit);
  let page = doc.addPage([width, height]),
    y = 0;
  const draw = (
    value: string,
    x: number,
    top: number,
    size = 8,
    font: PDFFont = regular,
    color = ink,
  ) => page.drawText(clean(value), { x, y: top - size, size, font, color });
  const wrap = (value: string, max: number, size: number, font: PDFFont) => {
    const lines: string[] = [];
    let line = '';
    for (const char of clean(value)) {
      if (line && font.widthOfTextAtSize(line + char, size) > max) {
        const breakAt = line.lastIndexOf(' ');
        if (breakAt > 0) {
          lines.push(line.slice(0, breakAt));
          line = line.slice(breakAt + 1);
        } else {
          lines.push(line);
          line = '';
        }
      }
      line += char;
    }
    lines.push(line);
    return lines;
  };
  const header = () => {
    const logoWidth = 104;
    page.drawImage(logo, {
      x: margin,
      y: height - 28 - (logoWidth * logo.height) / logo.width,
      width: logoWidth,
      height: (logoWidth * logo.height) / logo.width,
    });
    const title = 'Organization export';
    draw(title, width - margin - bold.widthOfTextAtSize(title, 11), height - 30, 11, bold);
    page.drawLine({
      start: { x: margin, y: height - 62 },
      end: { x: width - margin, y: height - 62 },
      color: border,
      thickness: 1,
    });
    y = height - 76;
  };
  const drawRow = (cells: string[], heading = false) => {
    const font = heading ? bold : regular;
    const wrapped = cells.map((cell, index) => wrap(cell, widths[index] - 8, 7.5, font));
    const rowHeight = Math.max(...wrapped.map((lines) => lines.length)) * 10 + 8;
    if (y - rowHeight < 48) {
      page = doc.addPage([width, height]);
      header();
      if (!heading)
        drawRow(
          organizationColumns.map((column) => column.short),
          true,
        );
    }
    if (heading)
      page.drawRectangle({
        x: margin,
        y: y - rowHeight,
        width: content,
        height: rowHeight,
        color: surface,
      });
    let x = margin;
    wrapped.forEach((lines, index) => {
      lines.forEach((line, lineIndex) => draw(line, x + 4, y - 4 - lineIndex * 10, 7.5, font));
      x += widths[index];
    });
    y -= rowHeight;
    page.drawLine({
      start: { x: margin, y },
      end: { x: width - margin, y },
      color: border,
      thickness: 0.6,
    });
  };
  header();
  draw('Customer organizations', margin, y, 16, bold);
  y -= 24;
  for (const line of [
    `${exportScope(data)} · generated ${data.generatedAt.replace('T', ' ').slice(0, 16)} UTC`,
    NOTE,
  ]) {
    draw(line, margin, y, 9, regular, muted);
    y -= 14;
  }
  y -= 6;
  drawRow(
    organizationColumns.map((column) => column.short),
    true,
  );
  for (const row of data.organizations)
    drawRow(organizationColumns.map((column) => String(column.value(row))));
  if (!data.organizations.length)
    draw('No matching organizations.', margin, y - 8, 9, regular, muted);
  doc.getPages().forEach((item, index) => {
    const footer = `Page ${index + 1} of ${doc.getPageCount()}`;
    item.drawLine({
      start: { x: margin, y: 36 },
      end: { x: width - margin, y: 36 },
      color: border,
      thickness: 1,
    });
    item.drawText(footer, {
      x: width - margin - regular.widthOfTextAtSize(footer, 8),
      y: 22,
      size: 8,
      font: regular,
      color: muted,
    });
  });
  return doc.save();
}
