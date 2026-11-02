import { Table } from '@/components/ui/table';

import { policyTargets, scheduleDescription } from './organization-sla';
import { ticketPriorities } from './presentation';
import { formatMinutes } from './sla-policy';

export function SlaPolicy({ targets, schedule }: { targets?: unknown; schedule?: unknown }) {
  return (
    <Table className="table-policy">
      <caption>Support-time targets from ticket creation · {scheduleDescription(schedule)}</caption>
      <thead>
        <tr>
          <th scope="col">Priority</th>
          <th scope="col">Response</th>
          <th scope="col">Resolution</th>
        </tr>
      </thead>
      <tbody>
        {policyTargets(targets).map((target) => (
          <tr key={target.priority}>
            <th scope="row">{ticketPriorities[target.priority].label}</th>
            <td>{formatMinutes(target.response)}</td>
            <td>{formatMinutes(target.resolution)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
