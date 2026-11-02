/** Verify measured rendered layouts, not source declarations. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const directories = process.argv.slice(2);
assert.ok(directories.length, 'Provide screenshot directories captured with --audit.');
const summaries = [];
let failures = 0;
for (const directory of directories) {
  const names = fs.readdirSync(directory).filter((name) => name.endsWith('.png.json'));
  assert.ok(names.length, `No measured screenshots in ${directory}`);
  const problems = [];
  for (const name of names) {
    const report = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
    if (report.horizontalOverflow)
      problems.push({
        name,
        issue: 'horizontal-overflow',
        width: report.documentWidth,
        viewport: report.viewport,
      });
    for (const stack of report.stacks) {
      if (!(parseFloat(stack.gap) > 0)) continue;
      for (const child of stack.children) {
        if (parseFloat(child.marginTop) > 0 || parseFloat(child.marginBottom) > 0)
          problems.push({ name, issue: 'stacked-text-margin', parent: stack.className, ...child });
      }
    }
  }
  failures += problems.length;
  summaries.push({ directory, captures: names.length, problems });
}
console.log(JSON.stringify({ summaries, failures }, null, 2));
if (failures) process.exitCode = 1;
