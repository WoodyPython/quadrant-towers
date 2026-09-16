import { expect, test, type Browser, type Page } from '@playwright/test';

async function startMatch(browser: Browser, preset = 'Small', mobile = false) {
  const contexts = await Promise.all(
    Array.from({ length: 4 }, () =>
      browser.newContext(
        mobile
          ? {
              viewport: { width: 390, height: 844 },
              isMobile: true,
              hasTouch: true,
            }
          : {},
      ),
    ),
  );
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  await pages[0]!.goto('/');
  await pages[0]!.getByLabel('Your name').fill('Ada');
  await pages[0]!.getByRole('radio', { name: new RegExp(preset) }).check();
  await pages[0]!
    .getByRole('button', { name: 'Create room', exact: true })
    .last()
    .click();
  await expect(pages[0]!.getByRole('heading', { level: 1 })).toHaveText(
    /^[A-Z]{6}$/,
  );
  const code = await pages[0]!.getByRole('heading', { level: 1 }).textContent();
  for (let i = 1; i < 4; i++) {
    const page = pages[i]!;
    await page.goto('/');
    await page
      .getByRole('button', { name: 'Join room', exact: true })
      .first()
      .click();
    await page.getByLabel('Your name').fill(['Ada', 'Ben', 'Cleo', 'Dara'][i]!);
    await page.getByLabel('Room code').fill(code!);
    await page
      .getByRole('button', { name: 'Join room', exact: true })
      .last()
      .click();
    await expect(page.getByRole('heading', { name: code! })).toBeVisible();
  }
  await pages[0]!.getByRole('button', { name: 'Start game' }).click();
  for (const page of pages)
    await expect(
      page.getByRole('region', { name: 'Game board' }),
    ).toBeVisible();
  return { pages, contexts };
}
async function activePage(pages: Page[]) {
  let active: Page | undefined;
  await expect
    .poll(async () => {
      for (const page of pages)
        if (
          await page
            .getByRole('heading', { name: 'Choose a card', exact: true })
            .count()
        ) {
          active = page;
          return true;
        }
      return false;
    })
    .toBe(true);
  return active!;
}
async function chooseCard(page: Page) {
  const cards = page
    .getByRole('button')
    .filter({ hasText: /Consumable|Passive/ });
  await cards.first().click();
  const play = page.getByRole('button', { name: /^Play / });
  if (!(await play.isEnabled()))
    await page.locator('[data-cell][data-legal="true"]').first().click();
  await play.click();
  await expect(
    page.getByRole('heading', { name: 'Your actions' }),
  ).toBeVisible();
}

test('home, help, keyboard access and installable assets', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Quadrant Towers.' }),
  ).toBeVisible();
  await expect(page.getByRole('radio', { name: /Medium/ })).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to game' })).toBeFocused();
  await page.getByRole('button', { name: 'How to play' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'How to play' })).toBeFocused();
  await page.goto('/help');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 850 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  for (const path of [
    '/manifest.webmanifest',
    '/icon-192.png',
    '/icon-512.png',
    '/sw.js',
    '/offline.html',
  ])
    expect((await request.get(path)).status()).toBe(200);
  for (const path of ['/api/missing', '/health/missing', '/assets/missing.js'])
    expect(
      (await request.get(path, { headers: { accept: 'text/html' } })).status(),
    ).toBe(404);
  expect(errors).toEqual([]);
});

test('four browsers complete a match, refresh, and rematch through the UI', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const { pages, contexts } = await startMatch(browser);
  const errors: string[] = [];
  pages.forEach((page) =>
    page.on('pageerror', (error) => errors.push(error.message)),
  );
  try {
    let refreshed = false;
    for (let turn = 0; turn < 40; turn++) {
      const page = await activePage(pages);
      if (!refreshed) {
        await expect(
          page
            .getByRole('button')
            .filter({ hasText: /Consumable|Passive/ })
            .first(),
        ).toBeEnabled();
        const offer = await page
          .getByRole('button')
          .filter({ hasText: /Consumable|Passive/ })
          .allTextContents();
        await page.reload();
        await expect(
          page.getByRole('heading', { name: 'Choose a card' }),
        ).toBeVisible();
        await expect(
          page
            .getByRole('button')
            .filter({ hasText: /Consumable|Passive/ })
            .first(),
        ).toBeEnabled();
        expect(
          await page
            .getByRole('button')
            .filter({ hasText: /Consumable|Passive/ })
            .allTextContents(),
        ).toEqual(offer);
        refreshed = true;
      }
      await chooseCard(page);
      for (let action = 0; action < 2; action++) {
        await page
          .getByRole('button', {
            name: turn === 0 && action === 0 ? 'Expand' : 'Build',
            exact: true,
          })
          .click();
        if (turn === 0 && action === 0)
          await page.locator('[data-cell][data-legal="true"]').first().click();
        await page.locator('[data-cell][data-legal="true"]').first().click();
        await expect(
          page.getByLabel(`${1 - action} actions remaining`),
        ).toBeVisible();
      }
      await page.getByRole('button', { name: 'End turn' }).click();
    }
    for (const page of pages) {
      await expect(page.getByRole('heading', { name: /wins$/ })).toBeVisible();
      await expect(page.locator('[data-cell][data-fog="true"]')).toHaveCount(0);
      await page.getByRole('button', { name: 'Play again' }).click();
    }
    await activePage(pages);
    for (const page of pages) {
      await expect(page.locator('[data-cell]')).toHaveCount(144);
      await expect(page.getByRole('heading', { name: /wins$/ })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

for (const [preset, cells] of [
  ['Medium', 256],
  ['Large', 400],
  ['Massive', 784],
] as const) {
  test(`${preset} mobile board, targeting, reconnect and keyboard navigation`, async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const { pages, contexts } = await startMatch(browser, preset, true);
    try {
      const page = await activePage(pages);
      await expect(page.locator('[data-cell]')).toHaveCount(cells);
      await chooseCard(page);
      await page.getByRole('button', { name: 'Upgrade', exact: true }).tap();
      await page.locator('[data-cell][data-legal="true"]').first().tap();
      await expect(page.getByLabel('1 actions remaining')).toBeVisible();
      await page.getByRole('button', { name: 'Attack', exact: true }).tap();
      await page.locator('[data-cell][data-legal="true"]').first().tap();
      await expect(
        page.getByRole('button', { name: /^Attack [A-Z]+\d+$/ }),
      ).toBeVisible();
      await expect(page.getByLabel('1 actions remaining')).toBeVisible();
      await page.getByRole('button', { name: /^Attack [A-Z]+\d+$/ }).tap();
      await expect(page.getByLabel('0 actions remaining')).toBeVisible();
      await page.getByRole('button', { name: 'Fit board' }).click();
      const first = page.locator('[data-cell="0,0"]');
      await first.focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.locator('[data-cell="1,0"]')).toBeFocused();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/${preset.toLowerCase()}-mobile.png`,
        fullPage: true,
      });
      await page.setViewportSize({ width: 844, height: 390 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.context().setOffline(true);
      await expect(
        page.getByText('Connection lost.', { exact: false }),
      ).toBeVisible({ timeout: 35000 });
      await page.context().setOffline(false);
      await page
        .getByRole('button', { name: 'Reconnect', exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: 'End turn' }),
      ).toBeEnabled();
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
}

test('a second tab takes control without reconnect loops', async ({
  browser,
}) => {
  const { pages, contexts } = await startMatch(browser);
  try {
    const first = pages[0]!;
    const second = await contexts[0]!.newPage();
    await second.goto('/');
    await expect(
      second.getByRole('region', { name: 'Game board' }),
    ).toBeVisible();
    await expect(
      first.getByText('This seat is open in another tab.'),
    ).toBeVisible();
    await second.close();
    await first.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await expect(
      first.getByText('This seat is open in another tab.'),
    ).toHaveCount(0);
    await expect(
      first.getByRole('region', { name: 'Game board' }),
    ).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('installed offline fallback caches only its static page', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(async () => {
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          () => resolve(),
          { once: true },
        ),
      );
  });
  const cached = await page.evaluate(async () => {
    const cache = await caches.open('quadrant-offline-v1');
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  });
  expect(cached).toEqual(['/offline.html']);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'You’re offline' }),
  ).toBeVisible();
  await context.setOffline(false);
  await page.getByRole('link', { name: 'Try again' }).click();
  await expect(
    page.getByRole('heading', { name: 'Quadrant Towers.' }),
  ).toBeVisible();
});
