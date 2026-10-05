import Link from 'next/link';
import { administrationSections } from './sections';

type Section = typeof administrationSections[number]['slug'];
type HubCard = { title: string; description: string; icon: keyof typeof iconPaths; destinations: readonly Section[]; note?: string };
const iconPaths = {
  organization: 'M4 21V5l8-3v19M12 8h8v13M2 21h20M7 7h2m-2 4h2m-2 4h2m6-3h2m-2 4h2',
  people: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20m6-8a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-1a3 3 0 0 0 0-6m3 15v-1.5a3.5 3.5 0 0 0-2.5-3.35',
  assets: 'M3 4h18v13H3V4Zm5 17h8m-4-4v4',
  automation: 'm13 2-9 12h7l-1 8 10-13h-7l1-7Z',
  routing: 'M5 3v12a3 3 0 0 0 3 3h11m-4-4 4 4-4 4M5 6h14m-4-4 4 4-4 4',
  knowledge: 'M12 5v15M12 5C8 2 4 3 3 4v15c3-2 6-1 9 1 3-2 6-3 9-1V4c-1-1-5-2-9 1Z',
  clock: 'M12 8v4l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  notifications: 'M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M9 20a3 3 0 0 0 6 0',
  security: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',
};
const groups: readonly { id: string; title: string; description: string; cards: readonly HubCard[] }[] = [
  { id: 'workspace', title: 'Workspace', description: 'The people, places and equipment behind your support.', cards: [
    { title: 'Organization', description: 'Keep workspace details, departments and service locations in one place.', icon: 'organization', destinations: ['organization','departments','locations'] },
    { title: 'People & access', description: 'Invite your colleagues and give each person the right access.', icon: 'people', destinations: ['users','technicians'] },
    { title: 'Assets', description: 'Manage equipment, employee assignments and service history.', icon: 'assets', destinations: ['assets'] },
  ] },
  { id: 'support', title: 'Support workflows', description: 'Shape how requests reach the right people and get resolved.', cards: [
    { title: 'Automations', description: 'Take repetitive work off your team’s plate. Build rules and test them safely.', icon: 'automation', destinations: ['automations'] },
    { title: 'Teams & routing', description: 'Organize support teams and route requests by category.', icon: 'routing', destinations: ['teams','categories'] },
    { title: 'Knowledge Base', description: 'Publish helpful answers and keep employee guidance up to date.', icon: 'knowledge', destinations: ['knowledge'] },
  ] },
  { id: 'governance', title: 'Policies & oversight', description: 'Understand service expectations, communication and accountability.', cards: [
    { title: 'Priorities & SLAs', description: 'Review response and resolution targets for each ticket priority.', icon: 'clock', destinations: ['slas'], note: 'Fixed targets' },
    { title: 'Notifications', description: 'Review delivery channels and the updates your team receives.', icon: 'notifications', destinations: ['notifications'], note: 'Current configuration' },
    { title: 'Security & audit', description: 'Review access protections and see who changed what in your workspace.', icon: 'security', destinations: ['security','audit-log'] },
  ] },
];
const actionLabels: Partial<Record<Section,string>> = {
  organization: 'Organization details', users: 'Users & invitations', assets: 'Manage assets',
  automations: 'Manage automations', knowledge: 'Manage articles', slas: 'View SLA targets',
  notifications: 'View notification setup', security: 'Security settings', 'audit-log': 'Audit log',
};
function DestinationButton({ section }: { section: Section }) {
  const item = administrationSections.find(item => item.slug === section)!;
  return <Link className="button button-secondary" href={'href' in item ? item.href : `/app/administration/${item.slug}`}>{actionLabels[section] ?? item.title}</Link>;
}
export function AdministrationHub({ organizationName }: { organizationName: string }) {
  return <div className="page administration-hub">
    <header className="page-header administration-hub-header"><div><span className="page-eyebrow">Workspace settings</span><h1>Administration</h1><p>Manage your workspace and how support gets done.</p></div><span className="badge administration-workspace-name">{organizationName}</span></header>
    <nav className="administration-jump-nav" aria-label="Administration sections">{groups.map(group => <a key={group.id} className="button button-quiet" href={`#admin-${group.id}`}>{group.title}</a>)}</nav>
    {groups.map(group => <section className="administration-hub-group" id={`admin-${group.id}`} key={group.id} aria-labelledby={`admin-${group.id}-heading`}>
      <header className="administration-section-heading"><h2 id={`admin-${group.id}-heading`}>{group.title}</h2><p>{group.description}</p></header>
      <div className="administration-card-grid">{group.cards.map(card => <article className="settings-card administration-hub-card" key={card.title}>
        <div className="administration-hub-card-heading"><span className="administration-card-icon"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={iconPaths[card.icon]}/></svg></span><h3>{card.title}</h3></div>
        <p className="administration-card-description">{card.description}</p>
        {card.note && <span className="administration-card-note">{card.note}</span>}
        <div className="administration-card-actions">{card.destinations.map(section => <DestinationButton key={section} section={section}/>)}{card.icon === 'knowledge' && <Link className="button button-secondary" href="/app/help/new">Write an article</Link>}</div>
      </article>)}</div>
    </section>)}
  </div>;
}
