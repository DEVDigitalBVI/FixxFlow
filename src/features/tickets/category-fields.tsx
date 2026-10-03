"use client";
import { useState } from "react";
import { LookupSelect } from "@/features/lookups/lookup-select";

export function CategoryFields({ categoryId = "", subcategoryId = "", simple = false }: {
  categoryId?: string; subcategoryId?: string; simple?: boolean;
}) {
  const [selection, setSelection] = useState({ categoryId, subcategoryId });
  return <>
    <LookupSelect resource="categories" name="categoryId" label={simple ? "Category (optional)" : "Category"} value={selection.categoryId} emptyLabel={simple ? "Not sure? IT can help" : "Not selected"} onChange={value => setSelection({ categoryId: value, subcategoryId: "" })}/>
    {!simple && selection.categoryId ? <LookupSelect key={selection.categoryId} resource="subcategories" parentId={selection.categoryId} name="subcategoryId" label="Subcategory" value={selection.subcategoryId} onChange={value => setSelection(current => ({ ...current, subcategoryId: value }))}/> : <input type="hidden" name="subcategoryId" value=""/>}
  </>;
}
