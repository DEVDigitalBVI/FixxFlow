import assert from "node:assert/strict";
import test from "node:test";
import { availableCategories, availableSubcategories, changeCategory } from "./category-options.ts";

const categories = [
  { id: "email", name: "Email", is_active: true },
  { id: "old", name: "Archived category", is_active: false },
];
const subcategories = [
  { id: "mailbox", category_id: "email", name: "Mailbox", is_active: true },
  { id: "legacy", category_id: "email", name: "Legacy mail", is_active: false },
  { id: "wifi", category_id: "network", name: "Wi-Fi", is_active: true },
];
test("new tickets only offer active categories; historical selections remain available", () => {
  assert.deepEqual(availableCategories(categories).map(item => item.id), ["email"]);
  assert.deepEqual(availableCategories(categories, "old").map(item => item.id), ["email", "old"]);
});
test("subcategories must belong to the selected category", () => {
  assert.deepEqual(availableSubcategories(subcategories, "email").map(item => item.id), ["mailbox"]);
  assert.deepEqual(availableSubcategories(subcategories, "").map(item => item.id), []);
  assert.deepEqual(availableSubcategories(subcategories, "network", "legacy").map(item => item.id), ["wifi"]);
});
test("an inactive subcategory already assigned to a ticket can be preserved", () => {
  assert.deepEqual(availableSubcategories(subcategories, "email", "legacy").map(item => item.id), ["mailbox", "legacy"]);
});
test("changing or clearing category clears the previous subcategory", () => {
  assert.deepEqual(changeCategory("network"), { categoryId: "network", subcategoryId: "" });
  assert.deepEqual(changeCategory(""), { categoryId: "", subcategoryId: "" });
});
