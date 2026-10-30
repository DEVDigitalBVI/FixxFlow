import { Table } from '@/components/ui/table';

import { ticketPriorities } from './presentation';
import { fixedSlaTargets, formatMinutes } from './sla-policy';

export function SlaPolicy() {
  return (
    <Table className="table-policy">
      <caption>Support-time targets from ticket creation · 7 AM–10 PM every day</caption>
      <thead>
        <tr>
          <th scope="col">Priority</th>
          <th scope="col">Response</th>
          <th scope="col">Resolution</th>
        </tr>
      </thead>
      <tbody>
        {fixedSlaTargets.map((target) => (
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
