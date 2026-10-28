import { read, utils } from 'xlsx';

import { bulkInviteLimit, invitationValues } from './bulk-invite-model';

export function parseInvitationCsv(buffer: ArrayBuffer, filename: string) {
  if (!/\.csv$/i.test(filename) || buffer.byteLength > 200_000)
    throw Error('Choose a CSV file smaller than 200 KB.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  const workbook = read(text, {
    type: 'string',
    raw: true,
    sheetRows: bulkInviteLimit + 2,
    cellFormula: true,
  });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet || !sheet['!ref']) throw Error('The CSV file is empty.');
  const range = utils.decode_range(sheet['!fullref'] ?? sheet['!ref']);
  if (range.e.r > bulkInviteLimit || range.e.c > 2)
    throw Error('Use up to 100 people and only the Email, Name and optional Role columns.');
  const grid = utils.sheet_to_json<string[]>(sheet, { header: 1, raw: true, defval: '' });
  const headings = grid[0].map((value) => String(value).trim().toLowerCase());
  if (
    !headings.includes('email') ||
    !headings.includes('name') ||
    new Set(headings).size !== headings.length ||
    headings.some((h) => !['email', 'name', 'role'].includes(h))
  )
    throw Error('Use Email and Name headers, with an optional Role column.');
  const roles: Record<string, string> = {
    employee: 'end_user',
    end_user: 'end_user',
    technician: 'technician',
    administrator: 'administrator',
  };
  const seen = new Set<string>();
  const rows = grid.slice(1).flatMap((row, index) => {
    if (row.every((value) => !String(value).trim())) return [];
    const roleText = String(row[headings.indexOf('role')] ?? '')
      .trim()
      .toLowerCase();
    const values = invitationValues({
      email: String(row[headings.indexOf('email')] ?? ''),
      displayName: String(row[headings.indexOf('name')] ?? ''),
      role: roleText ? roles[roleText] : 'end_user',
    });
    if (!values)
      throw Error(
        `Row ${index + 2}: enter a valid email, a name up to 120 characters, and Employee, Technician or Administrator.`,
      );
    if (seen.has(values.email))
      throw Error(
        `Row ${index + 2}: ${values.email} appears more than once. Remove the duplicate.`,
      );
    seen.add(values.email);
    return [values];
  });
  if (!rows.length) throw Error('Add at least one person below the header.');
  return rows;
}
