import 'server-only';
import * as XLSX from 'xlsx';
import type { Report } from './model';
import { breakdownDefinitions, dailyDefinitions, reportPeriod, slaNote, summaryRows, timingNote } from './export-model';

type Cell = string | number | null;
function csvCell(value: Cell): string {
  let text = value === null ? '' : String(value);
  // Keep untrusted labels as text when opened in spreadsheet applications.
  if (typeof value === 'string' && (/^[\s\u0000-\u001f]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text))) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function createReportCsv(report: Report, organization: string) {
  const period = reportPeriod(report);
  const rows: Cell[][] = [['Organization', 'Generated at (UTC)', 'Timezone', 'Period start', 'Period end', 'Section', 'Date or scope', 'Metric', 'Group', 'Value', 'Unit', 'Notes']];
  const add = (section: string, scope: string, metric: string, group: string, value: Cell, unit: string, note: string) => {
    rows.push([organization, report.asOf, report.timezone, period.start, period.end, section, scope, metric, group, value, unit, `${value === null ? 'No data. ' : ''}${note}`]);
  };
  for (const row of summaryRows(report)) add('Summary', row.scope, row.label, '', row.value, row.unit, row.note);
  for (const day of report.daily) for (const metric of dailyDefinitions) add('Daily activity', day.day, metric.label, '', day[metric.key], metric.unit, metric.note);
  for (const row of report.breakdowns) {
    const definition = breakdownDefinitions[row.kind];
    add('Breakdowns', ['workload', 'backlog'].includes(row.kind) ? 'Current snapshot' : 'Reporting period', definition?.title ?? row.kind, row.label, row.value, 'tickets', definition?.note ?? '');
  }
  for (const row of report.sla) {
    add('SLA', 'Reporting period', 'Completed targets', row.label, row.total, 'targets', slaNote);
    add('SLA', 'Reporting period', 'Targets met', row.label, row.met, 'targets', slaNote);
    add('SLA', 'Reporting period', 'Compliance', row.label, row.total > 0 ? row.met / row.total * 100 : null, 'percent', slaNote);
  }
  add('Definitions', '', 'Timing', '', '', 'minutes', timingNote);
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function createReportWorkbook(report: Report, organization: string): Uint8Array {
  const workbook = XLSX.utils.book_new();
  workbook.Props = { Title: 'FixxFlow operational report', Author: 'FixxFlow', Company: organization, CreatedDate: new Date(report.asOf) };
  const sheet = (name: string, rows: Cell[][], widths: number[], filter = true) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = widths.map(wch => ({ wch }));
    if (filter && rows.length > 1) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: rows[0].length - 1 } }) };
    XLSX.utils.book_append_sheet(workbook, ws, name);
    return ws;
  };
  const period = reportPeriod(report);
  sheet('Overview', [
    ['FixxFlow operational report'], ['Organization', organization], ['Generated at (UTC)', report.asOf], ['Timezone', report.timezone],
    ['Period start', period.start], ['Period end', period.end], ['Timing', timingNote],
    ['Missing values', 'Blank timing cells mean no completed samples; a numeric zero is a measured value.'], [],
    ['Metric', 'Value', 'Unit', 'Date or scope', 'Definition'],
    ...summaryRows(report).map(row => [row.label, row.value, row.unit, row.scope, row.note]),
    [], ['Daily metric', 'Definition'], ...dailyDefinitions.map(row => [row.label, row.note]), [], ['SLA', slaNote],
  ], [27, 16, 14, 22, 90], false);
  const daily = sheet('Daily activity', [
    ['Date', 'Created', 'Resolved', 'Reopened', 'Average response (minutes)', 'Average resolution (minutes)'],
    ...report.daily.map(row => [row.day, row.created, row.resolved, row.reopened, row.response, row.resolution]),
  ], [16, 14, 14, 14, 30, 32]);
  for (let i = 1; i <= report.daily.length; i++) {
    // Excel dates are numeric, making the exported dates sortable and usable in formulas.
    daily[`A${i + 1}`] = { t: 'n', v: Date.parse(`${report.daily[i - 1].day}T00:00:00Z`) / 86400000 + 25569, z: 'yyyy-mm-dd' };
    for (const column of ['E', 'F']) if (daily[`${column}${i + 1}`]) daily[`${column}${i + 1}`].z = '0.00';
  }
  sheet('Breakdowns', [['Metric', 'Group', 'Tickets', 'Scope and definition'], ...report.breakdowns.map(row => [breakdownDefinitions[row.kind]?.title ?? row.kind, row.label, row.value, breakdownDefinitions[row.kind]?.note ?? ''])], [28, 60, 14, 100]);
  const sla = sheet('SLA', [['Target', 'Completed targets', 'Targets met', 'Compliance'], ...report.sla.map(row => [row.label, row.total, row.met, row.total > 0 ? row.met / row.total : null])], [40, 23, 18, 18]);
  for (let i = 2; i <= report.sla.length + 1; i++) if (sla[`D${i}`]) sla[`D${i}`].z = '0.0%';
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer', compression: true });
}
