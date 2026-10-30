import fs from 'node:fs';

import postcss from 'postcss';

/** Read shared and feature styles as selectors used by rendered components. */
export function productStyles() {
  const modules = fs
    .readdirSync('src/features', { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) =>
      fs
        .readdirSync(`src/features/${entry.name}`)
        .filter((name) => name.endsWith('.module.css'))
        .map((name) => `src/features/${entry.name}/${name}`),
    );
  return ['src/app/globals.css', ...modules]
    .map((file) => {
      const root = postcss.parse(fs.readFileSync(file, 'utf8'));
      root.walkRules((rule) => {
        rule.selector = rule.selectors
          .map((selector) =>
            selector.replace(/^:where\(\.scope\)\s+:global\(([\s\S]*)\)(.*)$/, '$1$2'),
          )
          .join(', ');
      });
      return root.toString();
    })
    .join('\n');
}

/** Product styles with the UI kit's Tailwind utilities compiled, as the Next.js build serves them. */
export async function compiledProductStyles() {
  const { default: tailwind } = await import('@tailwindcss/postcss');
  const result = await postcss([tailwind({ base: process.cwd() })]).process(productStyles(), {
    from: 'src/app/globals.css',
  });
  return result.css;
}
