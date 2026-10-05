export const report = {
  asOf: '2026-09-27T15:42:00Z', timezone: 'America/Tortola', today: '2026-09-27',
  summary: { created: 12, resolved: 8, open: 31, overdue: 2, response: 0, resolution: null },
  daily: Array.from({ length: 30 }, (_, i) => ({ day: new Date(Date.UTC(2026, 7, 29 + i)).toISOString().slice(0, 10), created: i % 13, resolved: i % 9, reopened: i % 3, response: i === 0 ? null : i === 1 ? 0 : 12.345, resolution: i === 0 ? null : i === 1 ? 0 : 128.57 })),
  breakdowns: [
    ...Array.from({ length: 14 }, (_, i) => ({ kind: 'categories', label: i === 13 ? 'Café, "office"\nnetwork support' : `Category ${i + 1}`, value: i })),
    { kind: 'workload', label: 'Zoë García', value: 21 }, { kind: 'workload', label: 'Unassigned', value: 10 },
    { kind: 'backlog', label: '0–7 days', value: 31 }, { kind: 'departments', label: 'Customer services and guest relations', value: 17 },
    { kind: 'locations', label: 'Tortola · Central office and warehouse', value: 22 },
  ],
  sla: [{ label: 'Response', total: 21, met: 20 }, { label: 'Resolution', total: 0, met: 0 }],
};
export const organization = 'Café & Coastal Services';
