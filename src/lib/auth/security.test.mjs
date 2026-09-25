import assert from "node:assert/strict";
import test from "node:test";
import { safeAuthRedirect } from "./safe-redirect.ts";
import { passwordValue } from "./form-values.ts";

const origin = "https://fixxflow.example";
test("callback rejects external and parser-normalized destinations", () => {
  for (const target of [null, "https://evil.example", "//evil.example", "/\\evil.example", "/\n/evil.example", "javascript:alert(1)"]) {
    assert.equal(safeAuthRedirect(target, origin).href, `${origin}/app`);
  }
  const callback = new URL(`${origin}/auth/callback?next=%2F%5Cevil.example`);
  assert.equal(safeAuthRedirect(callback.searchParams.get("next"), origin).href, `${origin}/app`);
});
test("callback preserves internal recovery and onboarding navigation", () => {
  for (const path of ["/auth/update-password", "/account/unassigned", "/app/tickets?page=2", "/app#overview"]) {
    assert.equal(safeAuthRedirect(path, origin).href, origin + path);
  }
});
test("passwords retain intentional leading and trailing whitespace", () => {
  const form = new FormData();
  form.set("password", " Strong password  ");
  assert.equal(passwordValue(form, "password"), " Strong password  ");
  assert.equal(passwordValue(form, "missing"), "");
});
