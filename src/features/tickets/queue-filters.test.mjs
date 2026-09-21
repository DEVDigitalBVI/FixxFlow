import assert from "node:assert/strict";
import test from "node:test";
import { normalizeQueueFilters } from "./queue-filters.ts";

test("valid queue views and sort options are preserved", () => {
  assert.deepEqual(normalizeQueueFilters({ view: "unassigned", sort: "due" }), { view: "unassigned", sort: "due", search: "", ticketNumber: null });
});

test("unknown queue options fall back to all tickets and recent updates", () => {
  assert.deepEqual(normalizeQueueFilters({ view: "other", sort: "random" }), { view: "all", sort: "updated", search: "", ticketNumber: null });
});

test("search recognizes a ticket number and removes filter punctuation", () => {
  assert.equal(normalizeQueueFilters({ q: " #1052 " }).ticketNumber, 1052);
  assert.equal(normalizeQueueFilters({ q: "VPN%_" }).search, "VPN");
});
