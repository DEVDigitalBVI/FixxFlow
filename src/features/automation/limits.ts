/** Safety ceilings, not subscription entitlements. SQL mirrors are parity-tested. */
export const automationSafetyLimits = {
  structural: { conditions: 50, actions: 20, conditionGroupDepth: 1, listValues: 100, name: 120, description: 2000, internalNote: 20000, definitionBytes: 262144, durationMinutes: 525600 },
  json: { depth: 12, nodes: 10000, characters: 100000, arrayItems: 1000 },
  interchange: { bytes: 524288, references: 200, rules: 1, depth: 12 },
  runtime: { chainDepthExclusive: 8, executionsPerChain: 32, actionAttemptsPerChain: 100, deliveryAttempts: 8 },
  throughput: { activeRules: 100, windowSeconds: 60, executions: 120, notifications: 120, recipientNotifications: 20, claims: 20, retryClaims: 5 },
  claiming: { tenantVisits: 20, candidatesPerVisit: 100, eligibilityChecksPerRequestedDelivery: 100 },
  discovery: { rules: 5, ticketsPerRule: 100, events: 500, budgetSeconds: 20 },
  storage: { destructiveRetention: false },
} as const;
export type AutomationCapacityCode = 'execution_deferred_capacity' | 'notification_deferred_capacity' | 'worker_deferred_capacity';
