import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

/** Load an isolated TS/TSX module graph with explicit dependency replacements. */
export function load(file, mocks = {}) {
  const modules = new Map();

  function visit(filename) {
    const absolute = path.resolve(filename);
    if (modules.has(absolute)) return modules.get(absolute).exports;
    const loaded = { exports: {} };
    modules.set(absolute, loaded);
    const require = createRequire(absolute);
    const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      fileName: absolute,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    const localRequire = name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith('.') || name.startsWith('@/')) {
        const base = name.startsWith('@/')
          ? path.resolve('src', name.slice(2))
          : path.resolve(path.dirname(absolute), name);
        const source = [base, `${base}.ts`, `${base}.tsx`]
          .find(candidate => /\.tsx?$/.test(candidate) && fs.existsSync(candidate));
        if (source) return visit(source);
      }
      return require(name);
    };
    new Function('require', 'module', 'exports', code)(localRequire, loaded, loaded.exports);
    return loaded.exports;
  }

  return visit(file);
}
