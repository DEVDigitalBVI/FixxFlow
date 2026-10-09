import Link from 'next/link';
import type { InventoryItem } from '@/types/inventory-database';
export function InventoryTable({ items }: { items: InventoryItem[] }) {
 return <div className="table-region" role="region" aria-label="Department inventory" tabIndex={0}><table className="table responsive-table table-nowrap"><thead><tr>{['Item','Department allocation','Storage location','Type','In storage','Reserved','Available','Action'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{items.map(item => <tr key={item.id}>
  <td data-label="Item"><Link href={`/app/inventory/${item.id}`}><strong>{item.name}</strong></Link></td>
  <td data-label="Department allocation">{item.department_name}</td><td data-label="Storage location">{item.location_name}</td>
  <td data-label="Type">{item.kind === 'equipment' ? 'Equipment' : 'Consumable'}</td><td data-label="In storage">{item.stock}</td><td data-label="Reserved">{item.reserved}</td><td data-label="Available">{item.stock-item.reserved}</td>
  <td data-label="Action"><Link className="button button-secondary" href={`/app/inventory/${item.id}`}>View item<span className="sr-only"> {item.name}</span></Link></td>
 </tr>)}</tbody></table></div>;
}

/** Stored and reserved quantities remain distinct from department allocation. */
export function InventoryStockSummary({ item }: { item: InventoryItem }) {
 return <section className="asset-inventory" aria-labelledby="stock-heading">
  <div className="asset-inventory-heading"><div><h2 id="stock-heading">Stock and allocation</h2><p className="muted">{item.department_name} · Stored at {item.location_name}</p></div><span className="ticket-badge tone-slate">{item.kind === 'equipment' ? 'Individual equipment' : 'Consumable quantities'}</span></div>
  <dl className="inventory-stock-summary"><div><dt>Physically in storage</dt><dd>{item.stock}</dd></div><div><dt>Reserved for approved requests</dt><dd>{item.reserved}</dd></div><div><dt>Available to request</dt><dd>{item.stock - item.reserved}</dd></div></dl>
  <div className="asset-inventory-footer"><dl className="inventory-facts"><div><dt>Department allocation</dt><dd>{item.department_name}</dd></div><div><dt>Physical storage location</dt><dd>{item.location_name}</dd></div></dl></div>
 </section>;
}
