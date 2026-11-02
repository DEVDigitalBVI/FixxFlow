/** Close the edited section while retaining its enclosing context. */
export function closeSavedDisclosure(form: HTMLFormElement) {
  const editor = form.closest('details');
  if (!editor) return;
  editor.open = false;
  editor.querySelector<HTMLElement>(':scope > summary')?.focus();
}
