/** Reveal every enclosing disclosure before native validation or focus recovery. */
export function revealField(field: HTMLElement) {
  let ancestor = field.parentElement;
  while (ancestor) {
    if (ancestor.tagName === 'DETAILS') (ancestor as HTMLDetailsElement).open = true;
    ancestor = ancestor.parentElement;
  }
}
