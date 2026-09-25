export const administrationSections = [
  { slug: 'organization', title: 'Organization', group: 'Workspace', status: 'Available', description: 'Workspace identity, departments, and service locations.', href: '/app/organization' },
  { slug: 'users', title: 'Users', group: 'Workspace', status: 'Available', description: 'Invite members and manage roles and workspace access.', href: '/app/people' },
  { slug: 'technicians', title: 'Technicians', group: 'Workspace', status: 'Available', description: 'View technicians and manage their access.', href: '/app/people?view=technicians' },
  { slug: 'teams', title: 'Teams', group: 'Workspace', status: 'Read only', description: 'Review the teams available for ticket assignment.' },
  { slug: 'departments', title: 'Departments', group: 'Workspace', status: 'Available', description: 'Add departments and manage their availability.', href: '/app/organization#departments' },
  { slug: 'locations', title: 'Locations', group: 'Workspace', status: 'Available', description: 'Manage service locations and their timezones.', href: '/app/organization#locations' },
  { slug: 'categories', title: 'Categories', group: 'Service delivery', status: 'Read only', description: 'Review ticket categories. Hierarchy editing is planned.' },
  { slug: 'priorities', title: 'Priorities', group: 'Service delivery', status: 'Fixed', description: 'Four shared priority levels used across the workspace.' },
  { slug: 'slas', title: 'SLAs', group: 'Service delivery', status: 'Fixed', description: 'First response and resolution targets by priority.' },
  { slug: 'assets', title: 'Assets', group: 'Service delivery', status: 'Available', description: 'Manage equipment, employee assignments, lifecycle and linked tickets.', href: '/app/assets' },
  { slug: 'knowledge', title: 'Knowledge Base', group: 'Service delivery', status: 'Available', description: 'Publish guides, manage drafts, and review article feedback.', href: '/app/help?view=all' },
  { slug: 'notifications', title: 'Notifications', group: 'Governance', status: 'Fixed', description: 'Delivery channels and current notification behavior.' },
  { slug: 'security', title: 'Security', group: 'Governance', status: 'Fixed', description: 'Review access protections and personal two-factor settings.' },
  { slug: 'audit-log', title: 'Audit Log', group: 'Governance', status: 'Available', description: 'Review who changed tickets, member access, and organization settings.' },
] as const;

// Mirrors private.ticket_sla_deadline; the regression test checks the SQL policy.
export const fixedSlaTargets = [
  { priority: 'critical', response: 15, resolution: 240 },
  { priority: 'high', response: 60, resolution: 480 },
  { priority: 'normal', response: 240, resolution: 1440 },
  { priority: 'low', response: 480, resolution: 2880 },
] as const;
export function formatMinutes(minutes: number) { return minutes < 60 ? `${minutes} min` : `${minutes / 60} ${minutes === 60 ? "hr" : "hrs"}`; }
