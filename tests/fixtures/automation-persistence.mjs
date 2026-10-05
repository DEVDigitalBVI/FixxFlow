import { action, condition, definition, group, uuid } from './automation.mjs';

export function persistenceDefinitions() {
  const valid = [definition(), definition({ conditions: group() }), definition({ name: '😀'.repeat(60) }),
    definition({ actions: [action('set_status', { status: 'open' }, 1), action()] })];
  for (const type of ['ticket.created', 'ticket.updated', 'ticket.assigned', 'ticket.status_changed', 'ticket.priority_changed', 'ticket.resolved']) valid.push(definition({ trigger: { type, configuration: {} } }));
  for (const [field, operators, value] of [
    ['priority', ['equals', 'not_equals', 'greater_than', 'less_than', 'in', 'not_in'], 'high'],
    ['status', ['equals', 'not_equals', 'in', 'not_in'], 'resolved'],
    ['title', ['equals', 'not_equals', 'contains', 'not_contains', 'in', 'not_in', 'is_empty', 'is_not_empty'], 'network'],
    ...['category_id', 'subcategory_id', 'assigned_technician_id', 'team_id', 'requester_department_id', 'location_id'].map(field => [field, ['equals', 'not_equals', 'in', 'not_in', 'is_empty', 'is_not_empty'], uuid(5)]),
    ['requester_id', ['equals', 'not_equals', 'in', 'not_in'], uuid(5)],
  ]) for (const op of operators) valid.push(definition({ conditions: group(condition(field, op, ['in', 'not_in'].includes(op) ? [value] : value)) }));
  valid.push(definition({ conditions: group(condition('title', 'contains', 'x')) }));
  valid.push(definition({ conditions: group(condition(), condition('status', 'not_equals', 'closed', 'second')) }));
  for (const [type, config] of [['assign_technician', { technicianId: uuid(5) }], ['assign_team', { teamId: uuid(5) }], ['set_category', { categoryId: uuid(5) }], ['add_internal_note', { body: 'Literal SQL/JS text is inert: SELECT 1; eval()' }], ['send_notification', { recipient: 'requester', template: 'ticket_update' }]]) valid.push(definition({ actions: [action(type, config)] }));

  const invalid = [null, [], {}, definition({ schemaVersion: 2 }), definition({ name: ' ' }), definition({ name: '\ufeff\u00a0' }), definition({ name: '😀'.repeat(61) }), definition({ description: 'x'.repeat(2001) }),
    definition({ trigger: { type: 'chat.created', configuration: {} } }), definition({ trigger: { type: 'ticket.created', configuration: { sql: 'SELECT 1' } } }),
    definition({ conditions: { ...group(), operator: 'or' } }), definition({ conditions: group({ ...group(), id: 'nested' }) }),
    definition({ conditions: group(condition(), condition()) }), definition({ conditions: group(condition('priority', 'equals', 'high', 'root')) }),
    definition({ conditions: group(condition('priority', 'contains', 'high')) }), definition({ conditions: group(condition('status', 'greater_than', 'new')) }),
    definition({ conditions: group(condition('requester_id', 'is_empty')) }), definition({ conditions: group(condition('category_id', 'equals', 'bad-id')) }),
    definition({ conditions: group(condition('title', 'equals', 'x')) }), definition({ conditions: group(condition('title', 'contains', ' ')) }),
    definition({ conditions: group({ ...condition('title', 'is_empty'), value: null }) }),
    definition({ conditions: group(condition('priority', 'in', [])) }), definition({ conditions: group(condition('priority', 'in', ['urgent'])) }),
    definition({ conditions: group(condition('priority', 'equals', ['high'])) }), definition({ conditions: group(condition('priority', 'equals', null)) }),
    definition({ conditions: group(condition('priority', 'in', Array(101).fill('high'))) }),
    definition({ conditions: group(...Array.from({ length: 51 }, (_, i) => condition('priority', 'equals', 'high', `c${i}`))) }),
    definition({ actions: [] }), definition({ actions: Array.from({ length: 21 }, (_, i) => action('set_priority', { priority: 'high' }, i)) }),
    definition({ actions: [action(), action('set_priority', { priority: 'high' }, 1, 'action-0')] }),
    definition({ actions: [action(), action('set_priority', { priority: 'high' }, 0, 'different')] }),
    ...[-1, 1, 0.5, '0'].map(position => definition({ actions: [action('set_priority', { priority: 'high' }, position)] })),
    ...['add_tag', 'remove_tag', 'apply_sla', 'call_webhook'].map(type => definition({ actions: [action(type, {})] })),
    definition({ actions: [action('set_priority', { priority: 'urgent' })] }), definition({ actions: [action('add_internal_note', { body: 'x'.repeat(20001) })] }),
    definition({ actions: [action('add_internal_note', { body: '\u2000' })] }),
    definition({ actions: [action('send_notification', { recipient: 'outside@example.test', template: 'ticket_update' })] }),
    definition({ actions: [action('set_priority', { priority: 'high', javascript: 'return true' })] }),
    { ...definition(), ...JSON.parse('{"__proto__":{}}') },
  ];
  // All required properties and unexpected types, including SQL NULL traps.
  for (const path of [[], ['trigger'], ['conditions'], ['conditions', 'children', 0], ['actions', 0], ['actions', 0, 'configuration']]) {
    const base = definition(); const node = path.reduce((value, key) => value[key], base);
    for (const key of Object.keys(node)) {
      const missing = structuredClone(base); const target = path.reduce((value, part) => value[part], missing); delete target[key]; invalid.push(missing);
      for (const replacement of [null, false, 13, [], {}]) {
        const candidate = structuredClone(base); path.reduce((value, part) => value[part], candidate)[key] = replacement;
        // 'description: null' and empty children/configuration are intentionally valid.
        if (key === 'description' && replacement === null || key === 'children' && Array.isArray(replacement) || key === 'configuration' && path.length === 1 && !Array.isArray(replacement) && replacement && typeof replacement === 'object') continue;
        invalid.push(candidate);
      }
    }
    const extra = structuredClone(base); path.reduce((value, part) => value[part], extra).expression = 'SELECT * FROM secrets'; invalid.push(extra);
  }
  return { valid, invalid };
}
