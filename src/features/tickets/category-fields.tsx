"use client";

import { useId, useState } from "react";
import { availableCategories, availableSubcategories, changeCategory, type CategoryOption, type SubcategoryOption } from "./category-options";

export function CategoryFields({ categories, subcategories = [], categoryId = "", subcategoryId = "", simple = false, error = false }: {
  categories: CategoryOption[];
  subcategories?: SubcategoryOption[];
  categoryId?: string;
  subcategoryId?: string;
  simple?: boolean;
  error?: boolean;
}) {
  const id = useId();
  const [selection, setSelection] = useState({ categoryId, subcategoryId });
  const choices = availableCategories(categories, categoryId);
  const children = availableSubcategories(subcategories, selection.categoryId, subcategoryId);

  return <>
    <div className="field">
      <label htmlFor={`${id}-category`}>Category{simple ? " (optional)" : ""}</label>
      <select className="input" id={`${id}-category`} name="categoryId" value={selection.categoryId} disabled={error} aria-describedby={`${id}-hint`} onChange={event => setSelection(changeCategory(event.target.value))}>
        <option value="">{simple ? "Not sure? IT can help" : "Not selected"}</option>
        {choices.map(category => <option key={category.id} value={category.id}>{category.name}{!category.is_active ? " (inactive)" : ""}</option>)}
      </select>
      <small className="muted" id={`${id}-hint`}>{error ? "Categories could not be loaded. Refresh to try again." : !choices.length ? "No categories are available. IT can categorize this request later." : simple ? "Choose the closest match to help IT route your request." : "Choose the area this ticket relates to."}</small>
      {error && <input type="hidden" name="categoryLoadError" value="true"/>}
    </div>
    {!simple && children.length > 0 ? <div className="field">
      <label htmlFor={`${id}-subcategory`}>Subcategory</label>
      <select className="input" id={`${id}-subcategory`} name="subcategoryId" value={selection.subcategoryId} disabled={error} onChange={event => setSelection(current => ({ ...current, subcategoryId: event.target.value }))}>
        <option value="">Not selected</option>
        {children.map(subcategory => <option key={subcategory.id} value={subcategory.id}>{subcategory.name}{!subcategory.is_active ? " (inactive)" : ""}</option>)}
      </select>
    </div> : <input type="hidden" name="subcategoryId" value=""/>}
  </>;
}
