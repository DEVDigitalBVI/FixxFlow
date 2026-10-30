import { Table } from '@/components/ui/table';

import { impactExpectations, SUPPORT_HOURS } from './expectations';

/** Response-time guidance beside the employee impact choice. Static and JS-free. */
export function ImpactExpectations() {
  const rows = impactExpectations();
  return (
    <details className="impact-expectations">
      <summary>How quickly will IT respond?</summary>
      <Table className="table-policy">
        <caption>
          Target times for each impact. Targets count support hours, {SUPPORT_HOURS}.
        </caption>
        <thead>
          <tr>
            <th scope="col">Impact</th>
            <th scope="col">First reply within</th>
            <th scope="col">Resolved within</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.value}>
              <th scope="row">{row.label}</th>
              <td>{row.response}</td>
              <td>{row.resolution}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="muted">
        These are targets, not guarantees. If a service is down for many people, check announcements
        first — IT may already be working on it.
      </p>
    </details>
  );
}
