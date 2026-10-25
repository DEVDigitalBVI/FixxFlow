'use client';

import { useState } from 'react';

import { ticketPriorities, ticketStatuses } from '@/features/tickets/presentation';

import {
  definitionToQuery,
  groupLabels,
  intervalLabels,
  reportMetrics,
  reportTypes,
  type CustomReportDefinition,
  type CustomReportMetric,
  type CustomReportType,
  type ReportGroup,
  type ReportReferences,
} from './custom-model';

const metricsFor = (type: CustomReportType) =>
  Object.entries(reportMetrics)
    .filter(([, item]) => item.type === type)
    .map(([key]) => key as CustomReportMetric);
const entityFilters: {
  key: keyof Pick<
    CustomReportDefinition['filters'],
    'categoryIds' | 'subcategoryIds' | 'teamIds' | 'technicianIds' | 'departmentIds' | 'locationIds'
  >;
  label: string;
  source: keyof ReportReferences;
}[] = [
  { key: 'categoryIds', label: 'Categories', source: 'categories' },
  { key: 'subcategoryIds', label: 'Subcategories', source: 'subcategories' },
  { key: 'teamIds', label: 'Teams', source: 'teams' },
  { key: 'technicianIds', label: 'Technicians', source: 'technicians' },
  { key: 'departmentIds', label: 'Requester departments', source: 'departments' },
  { key: 'locationIds', label: 'Ticket locations', source: 'locations' },
];
type CustomReportBuilderProps = {
  definition: CustomReportDefinition;
  references: ReportReferences;
  savedId?: string;
  hasResults?: boolean;
};

export function CustomReportBuilder(props: CustomReportBuilderProps) {
  return (
    <CustomReportBuilderForm key={definitionToQuery(props.definition).toString()} {...props} />
  );
}

function CustomReportBuilderForm({
  definition,
  references,
  savedId,
  hasResults = false,
}: CustomReportBuilderProps) {
  const [filterCount, setFilterCount] = useState(
    Object.values(definition.filters).reduce((count, values) => count + values.length, 0),
  );
  const [changed, setChanged] = useState(false);
  const [type, setType] = useState(definition.reportType);
  const [metrics, setMetrics] = useState<CustomReportMetric[]>(definition.metrics);
  const [group, setGroup] = useState<ReportGroup>(definition.groupBy);
  const toggleMetric = (metric: CustomReportMetric, checked: boolean) =>
    setMetrics((current) =>
      checked ? [...current, metric].slice(0, 3) : current.filter((item) => item !== metric),
    );
  return (
    <form
      id="report-builder"
      action="/app/reports/custom"
      method="get"
      className="settings-card custom-report-builder"
      aria-label="Custom report builder"
      onChange={(event) => {
        setChanged(true);
        const values = new FormData(event.currentTarget);
        setFilterCount(
          Object.keys(definition.filters).reduce(
            (count, key) => count + values.getAll(key).length,
            0,
          ),
        );
      }}
    >
      {savedId && <input type="hidden" name="saved" value={savedId} />}
      <fieldset>
        <legend>1. What do you want to understand?</legend>
        <div className="report-type-options">
          {Object.entries(reportTypes).map(([key, item]) => (
            <label key={key} className="choice-card">
              <input
                type="radio"
                name="reportType"
                value={key}
                checked={type === key}
                onChange={() => {
                  const next = key as CustomReportType;
                  setType(next);
                  setMetrics(metricsFor(next));
                  if (next === 'backlog' && group === 'time') setGroup('technician');
                }}
              />
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="custom-report-fields">
        <fieldset>
          <legend>2. Choose the period</legend>
          <div className="report-field-grid">
            <label className="field">
              Start date
              <input
                className="input"
                type="date"
                name="startDate"
                defaultValue={definition.startDate}
                required
              />
            </label>
            <label className="field">
              End date
              <input
                className="input"
                type="date"
                name="endDate"
                defaultValue={definition.endDate}
                required
              />
            </label>
            <label className="field">
              Group dates by
              <select className="input" name="interval" defaultValue={definition.interval}>
                {Object.entries(intervalLabels).map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted">Up to 366 days. Dates follow the workspace timezone.</p>
        </fieldset>
        <fieldset>
          <legend>3. Choose measures and grouping</legend>
          <div className="report-measure-options">
            {metricsFor(type).map((key) => (
              <label className="check-field" key={key}>
                <input
                  type="checkbox"
                  name="metrics"
                  value={key}
                  checked={metrics.includes(key)}
                  onChange={(event) => toggleMetric(key, event.currentTarget.checked)}
                />
                {reportMetrics[key].label}
              </label>
            ))}
          </div>
          <label className="field">
            Group results by
            <select
              className="input"
              name="groupBy"
              value={group}
              onChange={(event) => setGroup(event.currentTarget.value as ReportGroup)}
            >
              {Object.entries(groupLabels)
                .filter(([key]) => type !== 'backlog' || key !== 'time')
                .map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
        </fieldset>
      </div>
      <details className="report-filter-panel">
        <summary>
          Filters{' '}
          <span className="muted">{filterCount ? `${filterCount} selected` : 'Optional'}</span>
        </summary>
        <div className="custom-report-filters">
          <fieldset>
            <legend>Status</legend>
            <div className="report-check-grid">
              {Object.entries(ticketStatuses).map(([key, item]) => (
                <label className="check-field" key={key}>
                  <input
                    type="checkbox"
                    name="statuses"
                    value={key}
                    defaultChecked={definition.filters.statuses.includes(key as never)}
                  />
                  {item.label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Priority</legend>
            <div className="report-check-grid">
              {Object.entries(ticketPriorities).map(([key, item]) => (
                <label className="check-field" key={key}>
                  <input
                    type="checkbox"
                    name="priorities"
                    value={key}
                    defaultChecked={definition.filters.priorities.includes(key as never)}
                  />
                  {item.label}
                </label>
              ))}
            </div>
          </fieldset>
          {entityFilters.map((filter) => (
            <fieldset key={filter.key} className="report-entity-filter">
              <legend>{filter.label}</legend>
              <p className="muted">Select none to include all.</p>
              <div className="report-choice-list">
                {references[filter.source].length ? (
                  references[filter.source].map((item) => (
                    <label className="check-field" key={item.id}>
                      <input
                        type="checkbox"
                        name={filter.key}
                        value={item.id}
                        defaultChecked={definition.filters[filter.key].includes(item.id)}
                      />
                      {item.name}
                    </label>
                  ))
                ) : (
                  <p className="muted">No choices available.</p>
                )}
              </div>
            </fieldset>
          ))}
        </div>
      </details>
      {!metrics.length && (
        <p className="alert alert-error" role="alert">
          Choose at least one measure.
        </p>
      )}
      <p className="muted" role="status">
        {changed
          ? 'Options changed. Run report to update the results below.'
          : hasResults
            ? 'Results use the last options you ran.'
            : 'Run report to see results.'}
      </p>
      <div className="custom-report-actions">
        <button className="button button-primary" type="submit" disabled={!metrics.length}>
          Run report
        </button>
        <a className="button button-quiet" href="/app/reports/custom">
          Reset
        </a>
      </div>
    </form>
  );
}
