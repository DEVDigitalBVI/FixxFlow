/** Isolated browser acceptance checks. Start interface-audit-preview.mjs first.
 * Start both fixtures before running:
 *   node tests/helpers/interface-audit-preview.mjs 4183
 *   node tests/helpers/inventory-ui-preview.mjs
 * Supply PLAYWRIGHT_MODULE when Playwright is installed outside this repository.
 * PILOT_PHASE=admin reruns only admin checks after an employee pass.
 * PILOT_EVIDENCE_DIR selects the JSON and screenshot output directory.
 * No production records, email, credentials, or hosted configuration are changed.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.PILOT_PREVIEW_URL || 'http://127.0.0.1:4183';
assert.ok(
  ['localhost', '127.0.0.1'].includes(new URL(base).hostname),
  'Only isolated local fixtures are supported',
);
const onlyAdmin = process.env.PILOT_PHASE === 'admin';
const output = process.env.PILOT_EVIDENCE_DIR || '/private/tmp/fixxflow-pilot-feature-tests';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
page.setDefaultTimeout(8000);
const evidence = {
  checkedAt: new Date().toISOString(),
  mode: 'synthetic service adapters; actual React page/components',
  employee: [],
  admin: [],
};
let phase = 'employee';
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const go = async (route) => {
  await page.goto(base + route);
  await page.locator('h1').first().waitFor();
};
const text = () => page.locator('body').innerText();
const check = async (name, run) => {
  errors.length = 0;
  try {
    await run();
    assert.deepEqual(errors, []);
    evidence[phase].push({ name, status: 'pass' });
    console.log('PASS', phase, name);
  } catch (error) {
    evidence[phase].push({ name, status: 'fail', error: error.message });
    console.log('FAIL', phase, name, error.message.slice(0, 220));
    await page.screenshot({
      path: path.join(output, `${phase}-${evidence[phase].length}-failure.png`),
      fullPage: true,
    });
  }
};
const noOverflow = async () =>
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    'Page must not scroll horizontally',
  );
try {
  if (!onlyAdmin) {
    await check('Home exposes employee tasks and excludes privileged destinations', async () => {
      await go('/app?role=employee');
      assert.equal(await page.getByRole('heading', { name: 'How can IT help today?' }).count(), 1);
      for (const name of [
        'Chat with IT',
        'Submit a request',
        'Browse help articles',
        'View all requests',
      ])
        assert.equal(await page.getByRole('link', { name, exact: false }).count(), 1);
      const nav = page.getByRole('navigation', { name: 'Employee navigation' });
      assert.equal(await nav.getByRole('link', { name: 'My requests', exact: true }).count(), 1);
      assert.equal(await nav.getByRole('link', { name: /People|Reports|Settings/ }).count(), 0);
      await noOverflow();
      await page.screenshot({
        path: path.join(output, 'employee-home-desktop.png'),
        fullPage: true,
      });
    });
    await check('Home search submits a native GET query to help', async () => {
      await go('/app?role=employee');
      await page.getByLabel('Search help articles', { exact: true }).fill('Wi-Fi');
      await page
        .getByRole('search', { name: 'Help articles', exact: true })
        .getByRole('button', { name: 'Search', exact: true })
        .click();
      await page.waitForURL('**/app/help?q=Wi-Fi');
      assert.equal(new URL(page.url()).searchParams.get('q'), 'Wi-Fi');
      await page.getByRole('heading', { name: 'Knowledge base', exact: true }).waitFor();
      assert.equal(
        await page.getByRole('link', { name: 'Connect to Wi-Fi', exact: true }).count(),
        1,
      );
    });
    await check(
      'Ticket creation requires subject and description with optional sections closed',
      async () => {
        await go('/app/tickets/new?role=employee');
        await page.getByLabel('What do you need help with?', { exact: false }).waitFor();
        assert.equal(
          await page.locator('input[required],textarea[required],select[required]').count(),
          2,
        );
        assert.equal(await page.locator('.ticket-create-optional[open]').count(), 0);
        await page.getByRole('button', { name: 'Open ticket', exact: true }).click();
        assert.equal(await page.locator('#title').evaluate((el) => el.validity.valueMissing), true);
        assert.equal(await page.evaluate(() => window.fixtureSubmitted), undefined);
        await page.screenshot({
          path: path.join(output, 'employee-request-desktop.png'),
          fullPage: true,
        });
      },
    );
    await check(
      'Request failure focuses feedback and preserves draft and idempotency key; retry navigates',
      async () => {
        await go('/app/tickets/new?role=employee');
        await page.locator('#title').fill('Pilot test — Wi-Fi access');
        await page
          .locator('#description')
          .fill('Wi-Fi disconnects during a call. I tried reconnecting.');
        const key = await page.locator('[name="submissionKey"]').inputValue();
        await page.getByRole('button', { name: 'Open ticket', exact: true }).click();
        await page.getByRole('alert').waitFor();
        assert.ok(await page.getByRole('alert').evaluate((el) => el === document.activeElement));
        assert.equal(await page.locator('#title').inputValue(), 'Pilot test — Wi-Fi access');
        assert.equal(await page.locator('[name="submissionKey"]').inputValue(), key);
        assert.ok(!(await page.evaluate(() => window.fixtureSubmitted.lookupLoadError)));
        await page.getByRole('button', { name: 'Open ticket', exact: true }).click();
        await page.waitForURL('**/app/tickets/fixture-created');
      },
    );
    await check('Cancel retains a draft when discard is declined', async () => {
      await go('/app/tickets/new?role=employee');
      await page.locator('#title').fill('Keep my draft');
      page.once('dialog', (dialog) => dialog.dismiss());
      await page.getByRole('link', { name: 'Cancel', exact: true }).click();
      assert.equal(new URL(page.url()).pathname, '/app/tickets/new');
      assert.equal(await page.locator('#title').inputValue(), 'Keep my draft');
    });
    await check('Optional category/location and guides expand using keyboard', async () => {
      await go('/app/tickets/new?role=employee');
      const summary = page.locator('summary').filter({ hasText: 'Add category or location' });
      await summary.focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.ticket-create-optional[open]').count(), 1);
      assert.ok(await page.getByLabel('Category (optional)', { exact: true }).isVisible());
      await page.locator('summary').filter({ hasText: 'Browse helpful guides' }).click();
      assert.ok(await page.getByRole('heading', { name: 'Guides that may help' }).isVisible());
    });
    await check(
      'Assigned equipment retains tag and serial without inventory administration',
      async () => {
        await go('/app/assets?role=employee');
        await page.getByRole('heading', { name: 'My equipment', exact: true }).waitFor();
        assert.match(await text(), /LT-0042/);
        assert.match(await text(), /PILOT-SN-42/);
        assert.equal(
          await page
            .getByRole('link', { name: /View equipment\s*:\s*Work laptop/, exact: false })
            .count(),
          1,
        );
        assert.equal(
          await page.getByRole('link', { name: /Add asset|Import spreadsheet/ }).count(),
          0,
        );
      },
    );
    await check('Appearance switches immediately and persists after reload', async () => {
      await go('/app?role=employee');
      await page.getByRole('button', { name: 'Dark', exact: true }).click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      await page.reload();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      await page.getByRole('button', { name: 'Light', exact: true }).click();
    });
    await check(
      'Mobile navigation contains focus, closes on Escape, and restores focus',
      async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        await go('/app?role=employee');
        await noOverflow();
        const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
        await toggle.click();
        const dialog = page.getByRole('dialog', { name: 'Workspace navigation' });
        await dialog.waitFor();
        assert.equal(await page.locator('#main-content').evaluate((el) => el.inert), true);
        for (let i = 0; i < 20; i++) {
          await page.keyboard.press('Tab');
          assert.ok(await dialog.evaluate((el) => el.contains(document.activeElement)));
        }
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#main-content').evaluate((el) => el.inert), false);
        assert.ok(await toggle.evaluate((el) => el === document.activeElement));
        await page.screenshot({
          path: path.join(output, 'employee-home-mobile.png'),
          fullPage: true,
        });
      },
    );
    await check('Complete request page reflows at mobile and compact desktop widths', async () => {
      await go('/app/tickets/new?role=employee');
      await page.locator('#title').waitFor();
      await noOverflow();
      await page.setViewportSize({ width: 720, height: 900 });
      await noOverflow();
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await page.getByRole('button', { name: 'Open ticket', exact: true }).isVisible());
      await page.screenshot({
        path: path.join(output, 'employee-request-mobile.png'),
        fullPage: true,
      });
    });
    await check(
      'Employee request list exposes status, search recovery, and no staff mutations',
      async () => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await go('/app/tickets?role=employee');
        await page.getByRole('heading', { name: 'My requests', exact: true }).waitFor();
        assert.match(await text(), /Pilot Wi-Fi request/);
        assert.equal(await page.getByRole('checkbox').count(), 0);
        const search = page.getByRole('search', { name: 'Search requests' });
        await search.getByRole('searchbox').fill('missing');
        await page.getByRole('heading', { name: 'No matching requests' }).waitFor();
        assert.equal(new URL(page.url()).searchParams.get('q'), 'missing');
        await page.getByRole('link', { name: 'Clear search', exact: true }).click();
        await page.getByText('Pilot Wi-Fi request', { exact: true }).waitFor();
      },
    );
    await check(
      'Notification read failure stays visible and preserves the selected notification',
      async () => {
        await go('/app/notifications?role=employee');
        await page.getByRole('heading', { name: 'Notifications', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Mark as read', exact: true }).click();
        await page.getByRole('alert').waitFor();
        assert.equal(
          await page.evaluate(() => window.fixtureReadCommand.notificationId),
          'notification-fixture',
        );
        assert.match(await text(), /IT replied to your request/);
        assert.equal(
          await page.getByRole('button', { name: 'Mark as read', exact: true }).isEnabled(),
          true,
        );
      },
    );
    await check(
      'Profile retains edits after save failure and discloses workplace details',
      async () => {
        await go('/app/profile?role=employee');
        await page.getByRole('heading', { name: 'Your profile' }).waitFor();
        assert.equal(await page.locator('details.progressive-section[open]').count(), 0);
        await page.getByLabel('Display name', { exact: true }).fill('Jordan Pilot');
        await page.getByRole('button', { name: 'Save profile', exact: true }).click();
        await page.getByRole('alert').waitFor();
        assert.equal(
          await page.getByLabel('Display name', { exact: true }).inputValue(),
          'Jordan Pilot',
        );
        assert.ok(await page.getByRole('alert').evaluate((el) => el === document.activeElement));
        await page.getByText('Workplace details', { exact: true }).click();
        assert.ok(await page.getByLabel('Department', { exact: true }).isVisible());
      },
    );
    await check(
      'Chat intake validates fields and retains the first message after failure',
      async () => {
        await go('/app/chat?role=employee&surface=chat-intake');
        await page.getByRole('button', { name: 'Start a chat', exact: true }).click();
        assert.equal(
          await page.locator('#chat-topic').evaluate((el) => el.validity.valueMissing),
          true,
        );
        await page.locator('#chat-topic').fill('Pilot VPN help');
        await page.locator('#chat-first-message').fill('I cannot connect to the VPN.');
        await page.getByRole('button', { name: 'Start a chat', exact: true }).click();
        await page.getByRole('alert').waitFor();
        assert.equal(
          await page.locator('#chat-first-message').inputValue(),
          'I cannot connect to the VPN.',
        );
        assert.ok(await page.getByRole('alert').evaluate((el) => el === document.activeElement));
        assert.equal(await page.locator('#main-content').getAttribute('data-page-flow'), null);
      },
    );
    await check(
      'Employee chat exposes public messaging without internal-note controls',
      async () => {
        await go('/app/chat/fixture-chat?role=employee&surface=chat-fixes');
        await page.getByRole('log', { name: 'Conversation messages' }).waitFor();
        assert.equal(await page.getByRole('radio', { name: /Internal note/ }).count(), 0);
        assert.match(await text(), /Shared with IT support/);
        await page.setViewportSize({ width: 390, height: 844 });
        await noOverflow();
      },
    );
    await check(
      'Command search handles failure, retry, keyboard selection and Escape',
      async () => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await go('/app?role=employee');
        await page.keyboard.press('Control+k');
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        await dialog.getByRole('combobox').fill('fail');
        await dialog.getByRole('alert').waitFor();
        await dialog.getByRole('button', { name: /Retry/ }).click();
        await dialog.getByRole('alert').waitFor({ state: 'hidden' });
        await dialog.getByRole('combobox').fill('vpn');
        await dialog.getByRole('option').filter({ hasText: 'VPN disconnects' }).waitFor();
        await page.keyboard.press('ArrowDown');
        assert.ok(await dialog.getByRole('combobox').getAttribute('aria-activedescendant'));
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
      },
    );
    await check(
      'Inventory request validates destination, preserves failed draft, and retries',
      async () => {
        await page.goto('http://127.0.0.1:4182/preview');
        const form = page.locator('form').filter({
          has: page.getByRole('button', { name: 'Submit inventory request', exact: true }),
        });
        await form.getByRole('button', { name: 'Submit inventory request', exact: true }).click();
        assert.equal(
          await form.locator('[name="destination"]').evaluate((el) => el.validity.valueMissing),
          true,
        );
        await form.locator('[name="destination"]').fill('Pilot employee office');
        await form.locator('[name="quantity"]').fill('2');
        await form.getByRole('button', { name: 'Submit inventory request', exact: true }).click();
        await form.getByRole('alert').waitFor();
        assert.equal(
          await form.locator('[name="destination"]').inputValue(),
          'Pilot employee office',
        );
        assert.equal(await form.locator('[name="quantity"]').inputValue(), '2');
        await form.getByRole('button', { name: 'Submit inventory request', exact: true }).click();
        await form.getByText('Inventory fixture saved.', { exact: true }).waitFor();
      },
    );
  }
  if (evidence.employee.some((item) => item.status === 'fail'))
    throw new Error('Resolve employee failures before testing admin/IT.');
  phase = 'admin';
  console.log(
    onlyAdmin ? 'Starting admin/IT phase.' : 'Employee phase complete; starting admin/IT.',
  );
  await check('Admin navigation exposes work and management destinations', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await go('/app?role=administrator');
    const nav = page.getByRole('navigation', { name: 'Primary navigation' });
    for (const name of ['Tickets', 'Live chat', 'Assets', 'Reports', 'People', 'Settings'])
      assert.equal(await nav.getByRole('link', { name, exact: true }).count(), 1);
    await noOverflow();
  });
  await check('Queue bulk selection shows actions only for selected tickets', async () => {
    await go('/app/tickets?role=administrator');
    await page.getByRole('heading', { name: 'Ticket queue' }).waitFor();
    const all = page.getByRole('checkbox', { name: 'Select all displayed tickets', exact: true });
    await all.check();
    await page.getByText('1 ticket selected', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
    assert.equal(await all.isChecked(), false);
  });
  await check('Desktop ticket drawer opens from queue and Escape restores the queue', async () => {
    await go('/app?role=administrator');
    await page
      .getByRole('link', { name: /VPN disconnects during video calls/ })
      .first()
      .click();
    const drawer = page.getByRole('dialog', { name: /Ticket details/ });
    await drawer.waitFor();
    assert.equal(new URL(page.url()).searchParams.get('ticket'), 'ticket-0');
    assert.equal(await drawer.getAttribute('aria-modal'), 'false');
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'hidden' });
  });
  await check(
    'IT message composer separates private and public drafts and retains failed sends',
    async () => {
      await go('/app?role=administrator&ticket=ticket-0');
      const drawer = page.getByRole('dialog');
      await drawer.waitFor();
      const composer = drawer.locator('.message-composer');
      await composer.getByRole('radio', { name: 'Internal note', exact: true }).check();
      await composer.getByRole('textbox').fill('Private diagnostic draft');
      await composer.getByRole('radio', { name: 'Public reply', exact: true }).check();
      await composer.getByRole('textbox').fill('Public response draft');
      await composer.getByRole('button', { name: 'Send public reply', exact: true }).click();
      await composer.getByRole('alert').waitFor();
      assert.equal(await composer.getByRole('textbox').inputValue(), 'Public response draft');
      await composer.getByRole('radio', { name: 'Internal note', exact: true }).check();
      assert.equal(await composer.getByRole('textbox').inputValue(), 'Private diagnostic draft');
    },
  );
  await check('Staff ticket intake retains requester, priority and automatic routing', async () => {
    await go('/app/tickets/new?role=administrator');
    await page.getByRole('heading', { name: 'New ticket', exact: true }).waitFor();
    assert.ok(await page.getByLabel('Requester', { exact: false }).first().isVisible());
    assert.equal(await page.getByLabel('Priority', { exact: true }).inputValue(), 'normal');
    await page.locator('summary').filter({ hasText: 'Assignment & timing' }).click();
    assert.equal(await page.locator('select[name="teamId"]').inputValue(), 'automatic');
    await page.locator('#title').fill('Pilot staff-created ticket');
    await page.locator('#description').fill('A request created by IT for the selected employee.');
    await page.waitForFunction(() => !document.querySelector('input[name="lookupLoadError"]'));
    await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
    await page.getByRole('alert').waitFor();
    const submitted = await page.evaluate(() => window.fixtureSubmitted);
    assert.equal(submitted.requesterId, 'fixture');
    assert.equal(submitted.priority, 'normal');
    assert.equal(submitted.teamId, 'automatic');
    await noOverflow();
    await page.screenshot({ path: path.join(output, 'admin-ticket-intake.png'), fullPage: true });
  });
  await check('Administration groups settings links without horizontal overflow', async () => {
    await go('/app?role=administrator&surface=administration');
    await page.getByRole('heading', { name: 'Administration', exact: true }).waitFor();
    for (const name of ['Workspace', 'Support workflows', 'Policies & oversight'])
      assert.ok(await page.getByRole('heading', { name, exact: true }).isVisible());
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow();
    await page.screenshot({
      path: path.join(output, 'admin-administration-mobile.png'),
      fullPage: true,
    });
  });
  await check(
    'People management protects own account and preserves permission drafts',
    async () => {
      await page.goto('http://127.0.0.1:4182/people');
      await page.getByText('Manage Pat Rivers', { exact: false }).click();
      assert.match(await text(), /can’t deactivate your own account/);
      assert.equal(await page.getByRole('button', { name: 'Confirm deactivation' }).count(), 0);
      await page.getByText('Edit inventory access for Pat Rivers', { exact: false }).click();
      const form = page.locator('.inventory-permissions-form');
      await form.getByLabel('Finance', { exact: true }).check();
      await form.getByRole('button', { name: /Save inventory permissions/ }).click();
      await form.getByRole('alert').waitFor();
      assert.equal(await form.getByLabel('Finance', { exact: true }).isChecked(), true);
      await noOverflow();
    },
  );
  await check('Equipment handover requires explicit unit confirmation', async () => {
    await page.goto('http://127.0.0.1:4182/preview');
    const form = page
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Mark as issued', exact: true }) });
    await form.getByRole('button', { name: 'Mark as issued', exact: true }).click();
    assert.equal(
      await form
        .getByRole('checkbox')
        .first()
        .evaluate((el) => el.validity.valueMissing),
      true,
    );
    for (const checkbox of await form.getByRole('checkbox').all()) await checkbox.check();
    await form.getByRole('button', { name: 'Mark as issued', exact: true }).click();
    await form.getByRole('alert').waitFor();
    assert.equal(await form.getByRole('checkbox').first().isChecked(), true);
    await form.getByRole('button', { name: 'Mark as issued', exact: true }).click();
    await form.getByText('Inventory fixture saved.', { exact: true }).waitFor();
  });
  await check(
    'Asset editor preserves identity and optional warranty dates after failed save',
    async () => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await go('/app?role=administrator&surface=asset-editor');
      await page.getByLabel('Asset tag *', { exact: true }).fill('PILOT-42');
      await page.getByLabel('Name *', { exact: true }).fill('Pilot laptop');
      const summary = page.locator('summary').filter({ hasText: 'Purchase & warranty' });
      assert.equal(await summary.locator('..').getAttribute('open'), null);
      await summary.click();
      await page.getByLabel('Purchase date', { exact: true }).fill('2026-10-19');
      await page.getByRole('button', { name: 'Add asset', exact: true }).click();
      await page.getByRole('alert').waitFor();
      assert.equal(await page.getByLabel('Asset tag *', { exact: true }).inputValue(), 'PILOT-42');
      assert.equal(
        await page.getByLabel('Purchase date', { exact: true }).inputValue(),
        '2026-10-19',
      );
      assert.ok(await page.getByRole('alert').evaluate((el) => el === document.activeElement));
    },
  );
  await check(
    'Article editor retains selected related guides and content on save failure',
    async () => {
      await go('/app?role=administrator&surface=article-editor');
      assert.equal(await page.locator('details[open]').count(), 0);
      await page.getByText('Related articles Optional', { exact: true }).click();
      assert.equal(await page.getByLabel('Related help guide', { exact: true }).isChecked(), true);
      await page.getByLabel('Title', { exact: true }).fill('Pilot updated guide');
      await page.getByRole('button', { name: 'Create article', exact: true }).click();
      await page.getByRole('alert').waitFor();
      assert.equal(
        await page.getByLabel('Title', { exact: true }).inputValue(),
        'Pilot updated guide',
      );
      assert.equal(await page.getByLabel('Related help guide', { exact: true }).isChecked(), true);
      await page.getByText('Content preview', { exact: true }).click();
      assert.match(await text(), /Pilot content/);
    },
  );
  await check(
    'Report builder prevents empty measures and submits chosen report definition',
    async () => {
      await go('/app?role=administrator&surface=report-builder');
      const form = page.getByRole('form', { name: 'Custom report builder' });
      for (const checkbox of await form.locator('input[name="metrics"]').all())
        await checkbox.uncheck();
      assert.equal(await form.getByRole('button', { name: 'Run report' }).isDisabled(), true);
      await form.getByLabel('Created', { exact: true }).check();
      assert.equal(await form.getByRole('button', { name: 'Run report' }).isEnabled(), true);
      await form.getByRole('button', { name: 'Run report' }).click();
      await page.waitForURL('**/app/reports/custom?**');
      assert.equal(new URL(page.url()).searchParams.get('metrics'), 'created');
    },
  );
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify(evidence, null, 2) + '\n');
  await browser.close();
}
if ([...evidence.employee, ...evidence.admin].some((item) => item.status === 'fail'))
  process.exitCode = 1;
