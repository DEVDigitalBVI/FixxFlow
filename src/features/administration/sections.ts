export const administrationSections = [
  { slug: 'automations', title: 'Automations', group: 'Service delivery', status: 'Available', description: 'Create, test and manage ordered rules for repeatable ticket work.', href: '/app/administration/automations' },
  { slug: 'organization', title: 'Organization', group: 'Workspace', status: 'Available', description: 'Workspace identity, departments, and service locations.', href: '/app/organization' },
  { slug: 'users', title: 'Users', group: 'Workspace', status: 'Available', description: 'Invite members and manage roles and workspace access.', href: '/app/people' },
  { slug: 'technicians', title: 'Technicians', group: 'Workspace', status: 'Available', description: 'View technicians and manage their access.', href: '/app/people?view=technicians' },
  { slug: 'teams', title: 'Teams', group: 'Workspace', status: 'Available', description: 'Add, rename, and manage teams available for ticket assignment.' },
  { slug: 'departments', title: 'Departments', group: 'Workspace', status: 'Available', description: 'Add departments and manage their availability.', href: '/app/organization#departments' },
  { slug: 'locations', title: 'Locations', group: 'Workspace', status: 'Available', description: 'Manage service locations and their timezones.', href: '/app/organization#locations' },
  { slug: 'categories', title: 'Categories', group: 'Service delivery', status: 'Available', description: 'Manage ticket categories, subcategories, and their availability.' },
  { slug: 'priorities', title: 'Priorities', group: 'Service delivery', status: 'Fixed', description: 'Four shared priority levels used across the workspace.' },
  { slug: 'slas', title: 'SLAs', group: 'Service delivery', status: 'Fixed', description: 'First response and resolution targets by priority.' },
  { slug: 'assets', title: 'Assets', group: 'Service delivery', status: 'Available', description: 'Manage equipment, employee assignments, lifecycle and linked tickets.', href: '/app/assets' },
  { slug: 'knowledge', title: 'Knowledge Base', group: 'Service delivery', status: 'Available', description: 'Publish guides, manage drafts, and review article feedback.', href: '/app/help?view=all' },
  { slug: 'notifications', title: 'Notifications', group: 'Governance', status: 'Fixed', description: 'Delivery channels and current notification behavior.' },
  { slug: 'security', title: 'Security', group: 'Governance', status: 'Fixed', description: 'Review access protections and personal two-factor settings.' },
  { slug: 'audit-log', title: 'Audit Log', group: 'Governance', status: 'Available', description: 'Review who changed tickets, member access, and organization settings.' },
] as const;

export { fixedSlaTargets, formatMinutes } from '@/features/tickets/sla-policy';
