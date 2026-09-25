export type CategoryOption = { id: string; name: string; is_active: boolean };
export type SubcategoryOption = CategoryOption & { category_id: string };

export function availableCategories(categories: CategoryOption[], currentId = "") {
  return categories.filter(category => category.is_active || category.id === currentId);
}

export function availableSubcategories(subcategories: SubcategoryOption[], categoryId: string, currentId = "") {
  return subcategories.filter(subcategory => subcategory.category_id === categoryId && (subcategory.is_active || subcategory.id === currentId));
}

export function changeCategory(categoryId: string) {
  return { categoryId, subcategoryId: "" };
}
