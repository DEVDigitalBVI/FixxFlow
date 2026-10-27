import Link from 'next/link';

import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { PageHeader } from '@/components/ui/page-header';

import { administrationSections } from './sections';

type Section = (typeof administrationSections)[number]['slug'];
type HubCard = {
  title: string;
  description: string;
  icon: keyof typeof iconNames;
  destinations: readonly Section[];
  note?: string;
};
const iconNames = {
  organization: 'organization',
  people: 'people',
  assets: 'assets',
  automation: 'automation',
  routing: 'routing',
  knowledge: 'knowledge',
  reply: 'chat',
  clock: 'clock',
  notifications: 'notifications',
  security: 'security',
} as const;
const groups: readonly {
  id: string;
  title: string;
  description: string;
  cards: readonly HubCard[];
}[] = [
  {
    id: 'workspace',
    title: 'Workspace',
    description: 'The people, places and equipment behind your support.',
    cards: [
      {
        title: 'Organization',
        description: 'Keep workspace details, departments and service locations in one place.',
        icon: 'organization',
        destinations: ['organization', 'departments', 'locations'],
      },
      {
        title: 'People & access',
        description: 'Invite your colleagues and give each person the right access.',
        icon: 'people',
        destinations: ['users', 'technicians'],
      },
      {
        title: 'Assets',
        description: 'Manage equipment, employee assignments and service history.',
        icon: 'assets',
        destinations: ['assets'],
      },
    ],
  },
  {
    id: 'support',
    title: 'Support workflows',
    description: 'Shape how requests reach the right people and get resolved.',
    cards: [
      {
        title: 'Automations',
        description:
          'Take repetitive work off your team’s plate. Build rules and test them safely.',
        icon: 'automation',
        destinations: ['automations'],
      },
      {
        title: 'Workflow templates',
        description: 'Create reusable checklists staff can add to tickets.',
        icon: 'routing',
        destinations: ['workflows'],
      },
      {
        title: 'Saved replies',
        description: 'Keep answers your team sends often ready to insert and edit.',
        icon: 'reply',
        destinations: ['saved-replies'],
      },
      {
        title: 'Email to ticket',
        description: 'Let members create and reply to tickets by email.',
        icon: 'notifications',
        destinations: ['email-to-ticket'],
      },
      {
        title: 'Teams & routing',
        description: 'Organize support teams and route requests by category.',
        icon: 'routing',
        destinations: ['teams', 'categories'],
      },
      {
        title: 'Knowledge base',
        description: 'Publish helpful answers and keep employee guidance up to date.',
        icon: 'knowledge',
        destinations: ['knowledge'],
      },
    ],
  },
  {
    id: 'governance',
    title: 'Policies & oversight',
    description: 'Understand service expectations, communication and accountability.',
    cards: [
      {
        title: 'Priorities & SLAs',
        description: 'Review response and resolution targets for each ticket priority.',
        icon: 'clock',
        destinations: ['slas'],
        note: 'Fixed targets',
      },
      {
        title: 'Notifications',
        description: 'Review delivery channels and the updates your team receives.',
        icon: 'notifications',
        destinations: ['notifications'],
        note: 'Current configuration',
      },
      {
        title: 'Security & audit',
        description: 'Review access protections and see who changed what in your workspace.',
        icon: 'security',
        destinations: ['security', 'audit-log'],
      },
    ],
  },
];
const actionLabels: Partial<Record<Section, string>> = {
  organization: 'Organization details',
  users: 'Users & invitations',
  assets: 'Manage assets',
  automations: 'Manage automations',
  knowledge: 'Manage articles',
  slas: 'View SLA targets',
  notifications: 'View notification setup',
  security: 'Security settings',
  'audit-log': 'Audit log',
};
function DestinationLink({ section }: { section: Section }) {
  const item = administrationSections.find((item) => item.slug === section)!;
  return (
    <Link
      className="administration-action-link"
      href={'href' in item ? item.href : `/app/administration/${item.slug}`}
    >
      <span>{actionLabels[section] ?? item.title}</span>
      <span aria-hidden="true">
        <NavigationIcon name="arrowRight" className="inline-icon" size={16} />
      </span>
    </Link>
  );
}
export function AdministrationHub({ organizationName }: { organizationName: string }) {
  return (
    <div className="page administration-hub">
      <PageHeader
        className="administration-hub-header"
        title="Settings"
        description="Manage your workspace and how support gets done."
        actions={<span className="badge administration-workspace-name">{organizationName}</span>}
      />
      <nav className="administration-jump-nav" aria-label="Settings sections">
        {groups.map((group) => (
          <a key={group.id} className="button button-quiet" href={`#admin-${group.id}`}>
            {group.title}
          </a>
        ))}
      </nav>
      {groups.map((group) => (
        <section
          className="administration-hub-group"
          id={`admin-${group.id}`}
          key={group.id}
          aria-labelledby={`admin-${group.id}-heading`}
        >
          <header className="administration-section-heading">
            <h2 id={`admin-${group.id}-heading`}>{group.title}</h2>
            <p>{group.description}</p>
          </header>
          <div className="administration-panel">
            {group.cards.map((card) => (
              <article className="administration-setting-row" key={card.title}>
                <span className="administration-card-icon">
                  <NavigationIcon name={iconNames[card.icon]} />
                </span>
                <div className="administration-setting-copy">
                  <div className="administration-setting-title">
                    <h3>{card.title}</h3>
                    {card.note && <span className="administration-card-note">{card.note}</span>}
                  </div>
                  <p>{card.description}</p>
                </div>
                <div className="administration-card-actions">
                  {card.destinations.map((section) => (
                    <DestinationLink key={section} section={section} />
                  ))}
                  {card.icon === 'knowledge' && (
                    <Link className="administration-action-link" href="/app/help/new">
                      <span>Write an article</span>
                      <span aria-hidden="true">
                        <NavigationIcon name="arrowRight" className="inline-icon" size={16} />
                      </span>
                    </Link>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
