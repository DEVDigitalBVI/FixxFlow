import { load } from './load-module.mjs';

/**
 * Shallow tests walk one render level, so UI kit controls are presented as the native elements
 * they render. Variant and size props stay visible to assertions; kit styling has its own tests.
 */
export function kitHostMocks() {
  const button = { ...load('src/components/ui/button.tsx'), Button: 'button' };
  const input = {
    ...load('src/components/ui/input.tsx'),
    Input: 'input',
    Textarea: 'textarea',
    NativeSelect: 'select',
  };
  const choice = {
    ...load('src/components/ui/checkbox.tsx'),
    Checkbox: hostAs('input', { type: 'checkbox' }),
    Radio: hostAs('input', { type: 'radio' }),
  };
  const badge = { ...load('src/components/ui/badge.tsx'), Badge: hostAs((p) => p.as ?? 'span') };
  const alert = { ...load('src/components/ui/alert.tsx'), Alert: hostAs((p) => p.as ?? 'div') };
  return {
    '@/components/ui/badge': badge,
    '@/components/ui/alert': alert,
    '@/components/ui/checkbox': choice,
    '@/components/ui/button': button,
    './button': button,
    '@/components/ui/input': input,
    './input': input,
  };
}

/** Marks a kit component that should appear as a native element with fixed props. */
function hostAs(type, props = {}) {
  return Object.assign(() => null, { kitHost: { type, props } });
}

/** Replaces kit-marked elements with their native element throughout a shallow tree. */
export function hostify(node) {
  if (Array.isArray(node)) return node.map(hostify);
  if (!node || typeof node !== 'object' || !node.props) return node;
  const host = node.type?.kitHost;
  return {
    ...node,
    type: host ? (typeof host.type === 'function' ? host.type(node.props) : host.type) : node.type,
    props: {
      ...(host ? host.props : {}),
      ...node.props,
      ...('children' in node.props ? { children: hostify(node.props.children) } : {}),
    },
  };
}
