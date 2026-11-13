import React from 'react';

import { hostify, kitHostMocks } from './kit-host-mocks.mjs';
import { load } from './load-module.mjs';

/** Deterministic component interaction harness. Exercises real handlers/state
 * and focus targets; does not claim browser layout or native keyboard emulation.
 */
export function componentHarness(file, name, props, mocks = {}) {
  const slots = [],
    focuses = [],
    scrolls = [],
    validities = [],
    elements = new Map();
  let cursor = 0,
    effects = [],
    tree;
  const slot = (init) => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = init();
    return index;
  };
  const effect = (fn, deps) => {
    const index = slot(() => ({ deps: null }));
    if (
      !deps ||
      !slots[index].deps ||
      deps.some((value, i) => !Object.is(value, slots[index].deps[i]))
    ) {
      slots[index].deps = deps;
      effects.push(() => {
        slots[index].cleanup?.();
        slots[index].cleanup = fn();
      });
    }
  };
  const hooks = {
    ...React,
    useState: (initial) => {
      const index = slot(() => (typeof initial === 'function' ? initial() : initial));
      return [
        slots[index],
        (value) => {
          slots[index] = typeof value === 'function' ? value(slots[index]) : value;
        },
      ];
    },
    useRef: (initial) => slots[slot(() => ({ current: initial }))],
    useCallback: (fn) => {
      slot(() => null);
      return fn;
    },
    useEffect: effect,
    useLayoutEffect: effect,
    useContext: () => null,
    useId: () => `fixture-${slot(() => null)}`,
    useTransition: () => [false, (fn) => fn()],
  };
  const component = load(file, { ...kitHostMocks(), ...mocks, react: hooks })[name];
  const walk = (node, visit) => {
    if (Array.isArray(node)) node.forEach((item) => walk(item, visit));
    else if (node && typeof node === 'object' && node.props) {
      visit(node);
      walk(node.props.children, visit);
    }
  };
  const oldDocument = globalThis.document,
    oldWindow = globalThis.window;
  globalThis.document = {
    getElementById: (id) => elements.get(id),
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    dispatchEvent() {},
    confirm: () => true,
  };
  const api = {
    focuses,
    scrolls,
    validities,
    render() {
      cursor = 0;
      effects = [];
      elements.clear();
      tree = hostify(component(props));
      walk(tree, (node) => {
        const target = {
          focus: () => focuses.push(node.props.id ?? node.props['aria-label'] ?? 'feedback'),
          setCustomValidity: (message) => validities.push({ id: node.props.id, message }),
          closest: () => null,
          scrollHeight: 1000,
          scrollTo: (options) => scrolls.push(options),
        };
        if (node.props.id) elements.set(node.props.id, target);
        if (node.props.ref && typeof node.props.ref === 'object') node.props.ref.current = target;
      });
      effects.forEach((fn) => fn());
      return tree;
    },
    find(predicate) {
      let found;
      walk(tree, (node) => {
        if (!found && predicate(node)) found = node;
      });
      assertFound(found);
      return found;
    },
    all(predicate) {
      const result = [];
      walk(tree, (node) => {
        if (predicate(node)) result.push(node);
      });
      return result;
    },
    submit(data) {
      // Node has no HTMLFormElement overload. Model only the synchronous FormData
      // snapshot; use real browser checks for native validation and form resets.
      const Original = globalThis.FormData;
      const form = {};
      globalThis.FormData = class {
        constructor(target) {
          if (target !== form) throw Error('Unexpected form snapshot');
          return data;
        }
      };
      try {
        return api
          .find((node) => node.type === 'form')
          .props.onSubmit({
            preventDefault() {},
            currentTarget: form,
            nativeEvent: { submitter: null },
          });
      } finally {
        globalThis.FormData = Original;
      }
    },
    close() {
      slots.forEach((item) => item?.cleanup?.());
      globalThis.document = oldDocument;
      globalThis.window = oldWindow;
    },
  };
  api.render();
  return api;
}
function assertFound(value) {
  if (!value) throw Error('Component control not found');
}
