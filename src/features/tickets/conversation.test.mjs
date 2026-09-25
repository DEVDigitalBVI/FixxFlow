import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function load(relative, mocks = {}) {
  const filename = path.resolve(relative);
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loaded = { exports: {} };
  const localRequire = name => {
    if (name in mocks) return mocks[name];
    if (name === "next/navigation") return { useRouter: () => ({ refresh() {} }) };
    if (name.startsWith(".")) return load(path.resolve(path.dirname(filename), name + ".ts"));
    return require(name);
  };
  new Function("require", "module", "exports", compiled)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}
const { ConversationTimeline } = load("src/features/tickets/conversation-timeline.tsx");
const { MessageComposer } = load("src/features/tickets/message-composer.tsx");
const messages = [
  { id: "public", author_id: "worker", kind: "reply", body: "Public answer", created_at: "2026-09-24T10:00:00Z" },
  { id: "private", author_id: "worker", kind: "internal_note", body: "Private diagnosis", created_at: "2026-09-24T10:01:00Z" },
];
const renderTimeline = staff => renderToStaticMarkup(React.createElement(ConversationTimeline, { messages, names: new Map([["worker", "Support"]]), viewerId: "requester", requesterId: "requester", staff, error: false }));

test("employee conversation excludes private content and private message labels", () => {
  const html = renderTimeline(false);
  assert.match(html, /Public answer/);
  assert.doesNotMatch(html, /Private diagnosis|Internal note|IT staff only/);
});
test("staff history labels both audiences and preserves timestamps for notes", () => {
  const html = renderTimeline(true);
  assert.match(html, /Public reply/);
  assert.match(html, /Internal note/);
  assert.match(html, /IT staff only/);
  assert.match(html, /dateTime="2026-09-24T10:01:00Z"/);
});
test("staff composer starts private with native radio controls and explicit send label", () => {
  const html = renderToStaticMarkup(React.createElement(MessageComposer, { ticketId: "ticket", action: async () => ({}) }));
  assert.match(html, /name="kind" value="internal_note"/);
  assert.match(html, /type="radio"/);
  assert.match(html, /Add internal note/);
  assert.match(html, /Hidden from the requester/);
  assert.match(html, /aria-describedby="message-audience message-hint"/);
  assert.match(html, /Enter adds a new line/);
});
test("employee composer exposes only public replies", () => {
  const html = renderToStaticMarkup(React.createElement(MessageComposer, { ticketId: "ticket", staff: false, action: async () => ({}) }));
  assert.match(html, /name="kind" value="reply"/);
  assert.doesNotMatch(html, /type="radio"|Internal note/);
});
test("message text is escaped instead of rendered as HTML", () => {
  const html = renderToStaticMarkup(React.createElement(ConversationTimeline, { messages: [{ ...messages[0], body: "<script>alert(1)</script>" }], names: new Map(), viewerId: "requester", requesterId: "requester", staff: true, error: false }));
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

const id = "11111111-1111-4111-8111-111111111111";
function messageForm(kind, body = "Hello") {
  const data = new FormData();
  for (const [key, value] of Object.entries({ ticketId: id, messageId: id, kind, body })) data.set(key, value);
  return data;
}
function actionFor(role, database) {
  return load("src/app/app/tickets/actions.ts", {
    "next/cache": { revalidatePath() {} },
    "@/lib/auth/viewer": { requireViewer: async () => ({ id: "viewer", role, organizationId: "org" }) },
    "@/lib/supabase/server": { createClient: async () => database },
  }).addTicketMessage;
}
test("server rejects employee internal notes before touching the database", async () => {
  const result = await actionFor("end_user", { from() { throw new Error("Must not write"); } })(messageForm("internal_note"));
  assert.ok(result.error);
});
test("server rejects blank and oversized messages", async () => {
  const send = actionFor("technician", { from() { throw new Error("Must not write"); } });
  assert.ok((await send(messageForm("reply", "   "))).error);
  assert.ok((await send(messageForm("reply", "a".repeat(20001)))).error);
});
test("server persists the explicit audience and stable retry ID", async () => {
  let inserted;
  const send = actionFor("technician", { from: () => ({ insert: async row => { inserted = row; return { error: null }; } }) });
  assert.ok((await send(messageForm("internal_note"))).success);
  assert.equal(inserted.kind, "internal_note");
  assert.equal(inserted.id, id);
});
test("lost-response retries succeed only for an identical existing message", async () => {
  let existing = { id, body: "Hello", kind: "internal_note", author_id: "viewer", ticket_id: id };
  const query = { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: existing }), insert: async () => ({ error: { code: "23505" } }) };
  const send = actionFor("technician", { from: () => query });
  assert.ok((await send(messageForm("internal_note"))).success);
  existing = { ...existing, kind: "reply" };
  assert.ok((await send(messageForm("internal_note"))).error);
});
