import { fixedSlaTargets, formatMinutes } from './sla-policy';
import { ticketPriorities } from './presentation';

export function SlaPolicy() {
  return <table className="table table-policy"><caption>Targets from ticket creation</caption>
    <thead><tr><th scope="col">Priority</th><th scope="col">Response</th><th scope="col">Resolution</th></tr></thead>
    <tbody>{fixedSlaTargets.map(target => <tr key={target.priority}><th scope="row">{ticketPriorities[target.priority].label}</th><td>{formatMinutes(target.response)}</td><td>{formatMinutes(target.resolution)}</td></tr>)}</tbody>
  </table>;
}
