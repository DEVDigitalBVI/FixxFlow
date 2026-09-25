import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function load(relative) {
  const filename = path.resolve(relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loaded = { exports: {} };
  const localRequire = name => name.startsWith(".") ? load(path.resolve(path.dirname(filename), name + ".ts")) : require(name);
  new Function("require", "module", "exports", compiled)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}
const { CategoryFields } = load("src/features/tickets/category-fields.tsx");
const categories = [{ id: "email", name: "Email", is_active: true }];
const subcategories = [{ id: "mailbox", name: "Mailbox", category_id: "email", is_active: true }];
const render = props => renderToStaticMarkup(React.createElement(CategoryFields, { categories, subcategories, ...props }));

test("starter form only exposes a labeled native category select", () => {
  const html = render({});
  assert.equal((html.match(/<select/g) ?? []).length, 1);
  const id = html.match(/<select[^>]*id="([^"]+)"/)[1];
  assert.ok(html.includes(`for="${id}"`));
  assert.match(html, /aria-describedby=/);
  assert.match(html, /type="hidden" name="subcategoryId" value=""/);
});
test("configured children appear only for their selected parent", () => {
  assert.match(render({ categoryId: "email" }), /<option value="mailbox">Mailbox/);
  assert.doesNotMatch(render({}), /<option value="mailbox">/);
});
test("employee form remains category-only even when children exist", () => {
  const html = render({ simple: true, categoryId: "email" });
  assert.match(html, /Category \(optional\)/);
  assert.match(html, /Not sure\? IT can help/);
  assert.equal((html.match(/<select/g) ?? []).length, 1);
});
test("load failures explain recovery and mark the form to prevent clearing saved data", () => {
  const html = render({ error: true });
  assert.match(html, /disabled=""/);
  assert.match(html, /Refresh to try again/);
  assert.match(html, /name="categoryLoadError" value="true"/);
});
