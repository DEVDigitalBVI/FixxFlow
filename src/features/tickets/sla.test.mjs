import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSla, ticketSla } from "./sla.ts";
const start = "2026-09-24T08:00:00Z";
const due = "2026-09-24T12:00:00Z";
const at = value => Date.parse(`2026-09-24T${value}Z`);

test("warnings start in the last 20% capped at 30 minutes and count minutes", () => {
  assert.equal(evaluateSla(start, due, null, at("11:29:00")).state, "on_track");
  assert.deepEqual(evaluateSla(start, due, null, at("11:37:00")), { state: "warning", label: "Due in 23 minutes", deadline: due, completedAt: null });
  assert.equal(evaluateSla(start, "2026-09-24T08:15:00Z", null, at("08:11:00")).state, "on_track");
  assert.equal(evaluateSla(start, "2026-09-24T08:15:00Z", null, at("08:12:00")).state, "warning");
});
test("exact deadline breaches unfinished work, but completion on time meets SLA", () => {
  assert.equal(evaluateSla(start, due, null, at("12:00:00")).state, "breached");
  assert.equal(evaluateSla(start, due, due, at("15:00:00")).state, "met");
  assert.equal(evaluateSla(start, due, "2026-09-24T12:10:00Z", at("15:00:00")).label, "Missed by 10 minutes");
});
test("a completed response and pending resolution are evaluated independently", () => {
  const results = ticketSla({ created_at: start, status: "on_hold", first_response_at: "2026-09-24T08:10:00Z", resolved_at: null, closed_at: null, response_sla_due_at: due, resolution_sla_due_at: due }, at("12:23:00"));
  assert.equal(results.response.state, "met");
  assert.equal(results.resolution.label, "Breached 23 minutes ago");
});
test("closed tickets use the resolution time, with a legacy close-time fallback", () => {
  const ticket = { created_at: start, status: "closed", first_response_at: null, resolved_at: "2026-09-24T11:00:00Z", closed_at: "2026-09-24T15:00:00Z", response_sla_due_at: due, resolution_sla_due_at: due };
  assert.equal(ticketSla(ticket, at("18:00:00")).resolution.state, "met");
  assert.equal(ticketSla(ticket, at("18:00:00")).response.state, "missing");
  assert.equal(ticketSla({ ...ticket, resolved_at: null }, at("18:00:00")).resolution.state, "missed");
});
test("reopened work resumes against the original deadline", () => {
  const ticket = { created_at: start, status: "open", first_response_at: start, resolved_at: null, closed_at: null, response_sla_due_at: due, resolution_sla_due_at: due };
  assert.equal(ticketSla(ticket, at("18:00:00")).resolution.state, "breached");
});
test("calendar time includes nights and weekends", () => {
  assert.equal(evaluateSla("2026-09-25T20:00:00Z", "2026-09-27T20:00:00Z", null, Date.parse("2026-09-27T19:37:00Z")).label, "Due in 23 minutes");
});
test("missing deadlines report unavailable instead of inventing a target", () => {
  assert.equal(evaluateSla(start, null, null, at("11:00:00")).state, "unavailable");
});
test("terminal legacy tickets without a completion timestamp do not keep counting", () => {
  const result = ticketSla({ created_at: start, status: "closed", first_response_at: null, resolved_at: null, closed_at: null, response_sla_due_at: due, resolution_sla_due_at: due }, at("18:00:00"));
  assert.equal(result.resolution.state, "unavailable");
});
