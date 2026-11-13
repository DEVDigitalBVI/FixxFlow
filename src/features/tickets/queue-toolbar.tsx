import Link from 'next/link';

import { NavigationIcon } from '@/components/navigation/navigation-icon';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, NativeSelect } from '@/components/ui/input';
import { LiveSearchForm } from '@/components/ui/live-search-form';
import { LookupSelect } from '@/features/lookups/lookup-select';
import { ticketPriorities, ticketStatuses } from '@/features/tickets/presentation';
import { SEARCH_HINT, SEARCH_LIMIT } from '@/lib/search';

import { sortOptions, type StaffQueueViewProps } from './queue-view-props';

export function QueueToolbar({
  view,
  search,
  searchSummary,
  appliedFilters,
  sort,
  clearHref,
  activeFilterCount,
  filters,
  tag,
  tagOptions,
  withoutFilter,
  relatedArticles,
}: StaffQueueViewProps) {
  return (
    <div className="ticket-queue-toolbar">
      <LiveSearchForm
        action="/app/tickets"
        className="queue-filters"
        label="Search tickets"
        resultSummary={searchSummary}
        idleMessage=""
      >
        <input type="hidden" name="view" value={view} />
        <label className="ticket-queue-search">
          Search tickets
          <Input
            name="q"
            defaultValue={search}
            type="search"
            maxLength={SEARCH_LIMIT}
            aria-describedby="ticket-search-hint"
            placeholder="Search by subject, person or #ticket number…"
          />
        </label>
        <Button variant="secondary" type="submit">
          Search
        </Button>
        {(appliedFilters.length > 0 || sort !== 'updated') && (
          <Link
            href={clearHref}
            className={buttonVariants({ variant: 'quiet', className: 'queue-clear' })}
          >
            Clear filters
          </Link>
        )}
        <details
          className="queue-filter-options"
          open={activeFilterCount > 0 || sort !== 'updated'}
        >
          <summary>
            Filters and sort{activeFilterCount > 0 ? ` · ${activeFilterCount} active` : ''}
          </summary>
          <div className="queue-filter-fields">
            <label>
              Request type
              <NativeSelect name="kind" defaultValue={filters.kind ?? ''}>
                <option value="">All requests</option>
                <option value="inventory">Equipment requests</option>
              </NativeSelect>
            </label>
            <label>
              Status
              <NativeSelect name="status" defaultValue={filters.status ?? ''}>
                <option value="">Any status</option>
                {Object.entries(ticketStatuses).map(([value, p]) => (
                  <option key={value} value={value}>
                    {p.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label>
              Ticket type
              <NativeSelect name="type" defaultValue={filters.type ?? ''}>
                <option value="">All ticket types</option>
                <option value="support">Non-incident tickets</option>
                <option value="incident">Incidents</option>
              </NativeSelect>
            </label>
            <label>
              Priority
              <NativeSelect name="priority" defaultValue={filters.priority ?? ''}>
                <option value="">Any priority</option>
                {Object.entries(ticketPriorities).map(([value, p]) => (
                  <option key={value} value={value}>
                    {p.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label>
              Sort by
              <NativeSelect name="sort" defaultValue={sort}>
                {Object.entries(sortOptions).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <LookupSelect
              key={filters.team ?? ''}
              resource="teams"
              name="team"
              label="Team"
              defaultValue={filters.team ?? ''}
              emptyLabel="All teams"
              activeOnly={false}
              guardSave={false}
              compact
            />
            <label>
              Tag
              <NativeSelect name="tag" defaultValue={tag ?? ''}>
                <option value="">Any tag</option>
                {tag && !tagOptions.includes(tag) && <option value={tag}>{tag}</option>}
                {tagOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label>
              <Checkbox name="hold" value="review" defaultChecked={filters.hold === 'review'} />{' '}
              Hold follow-up overdue
            </label>
            <label className="queue-check">
              <Checkbox name="overdue" value="1" defaultChecked={filters.overdue === '1'} /> Manual
              date overdue
            </label>
            <label className="queue-check">
              <Checkbox name="sla" value="breached" defaultChecked={filters.sla === 'breached'} />{' '}
              SLA breached
            </label>
          </div>
          <Button variant="secondary" className="ticket-queue-apply" type="submit">
            Apply filters
          </Button>
        </details>
      </LiveSearchForm>
      <p id="ticket-search-hint" className="sr-only">
        {SEARCH_HINT} Search ticket titles, descriptions, messages, people, and categories. Use #
        for an exact ticket number. Filters also apply to search results.
      </p>
      {!!appliedFilters.length && (
        <ul className="ticket-queue-filter-chips" aria-label="Applied ticket filters">
          {appliedFilters.map((item) => (
            <li key={item.key}>
              <Link
                href={withoutFilter(item.key)}
                aria-label={`Remove ${item.key === 'q' ? 'search' : item.key} filter: ${item.label}`}
              >
                <span>{item.label}</span>
                <span aria-hidden="true">
                  <NavigationIcon name="close" className="inline-icon" size={16} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {relatedArticles}
    </div>
  );
}
