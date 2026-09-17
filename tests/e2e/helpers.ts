import { expect, type Browser, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
export async function checkAccessibility(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.map(({ id, nodes }) => ({
      id,
      nodes: nodes.map(({ target, failureSummary }) => ({
        target,
        failureSummary,
      })),
    })),
  ).toEqual([]);
}
import {
  matchViewSchema,
  type MatchView,
} from '../../packages/protocol/src/index.js';
export async function startMatch(
  browser: Browser,
  preset = 'Small',
  mobile = false,
  origin = 'http://127.0.0.1:3100',
) {
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
  const views: MatchView[][] = pages.map(() => []);
  const packetErrors: string[] = [];
  pages.forEach((page, index) =>
    page.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload }) => {
        const text = String(payload);
        if (!text.startsWith('42[')) return;
        const [event, data] = JSON.parse(text.slice(2));
        if (!['match:view', 'match:finished'].includes(event)) return;
        const parsed = matchViewSchema.safeParse(data);
        if (!parsed.success)
          packetErrors.push('Invalid or excessive match projection fields');
        else views[index]!.push(parsed.data);
      });
    }),
  );
  await pages[0]!.goto(origin);
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
    await page.goto(origin);
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
  if (preset === 'Small') await checkAccessibility(pages[0]!);
  await pages[0]!.getByRole('button', { name: 'Start game' }).click();
  for (const page of pages)
    await expect(
      page.getByRole('region', { name: 'Game board' }),
    ).toBeVisible();
  await placeTownHalls(pages);
  const active = await activePage(pages);
  const offers = active
    .getByRole('button')
    .filter({ hasText: /Consumable|Passive/ });
  await expect(offers).toHaveCount(3);
  await expect(offers.first()).toBeEnabled();
  return { pages, contexts, views, packetErrors };
}
export async function placeTownHalls(pages: Page[]) {
  for (let i = 0; i < pages.length; i++) {
    let active: Page | undefined;
    // Poll for an actual legal cell, not just the heading: right after a
    // click the placer's own page still shows the heading for a moment
    // while its legal-cell set has already gone empty (send() sets
    // pending synchronously), which would otherwise pick the same page
    // twice and hang waiting for a cell that will never appear.
    await expect
      .poll(async () => {
        for (const page of pages)
          if (await page.locator('[data-cell][data-legal="true"]').count()) {
            active = page;
            return true;
          }
        return false;
      })
      .toBe(true);
    await active!.locator('[data-cell][data-legal="true"]').first().click();
  }
}
export async function activePage(pages: Page[]) {
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
export async function chooseCard(page: Page, keyboard = false) {
  const cards = page
    .getByRole('button')
    .filter({ hasText: /Consumable|Passive/ });
  const steady = cards
    .filter({
      hasText:
        /Drone|Rangefinder|Surveyor|Recon|Satellite|Surveillance|All-Seeing|Intelligence|Repairs|Repair Crew|Fortress|Patch|Walls|Barricade|Impenetrable|Fortification|Reinforcement|Phoenix|Foundations|Momentum|Ambush|Weak Point|Focused Fire|Blitzkrieg|Counterintelligence|Forward Base|Rapid Construction|Infrastructure|Rapid Expansion|Engineering Crew|Double Expansion|Master Architect|Ascension|Precision|Artillery|Air Strike|Cataclysm|Neutral/,
    })
    .first();
  const pick = (await steady.count()) ? steady : cards.first();
  if (keyboard) {
    await pick.focus();
    await pick.press('Enter');
  } else await pick.click();
  const play = page.getByRole('button', { name: /^Play / });
  while (!(await play.isEnabled())) {
    const cell = page.locator('[data-cell][data-legal="true"]').first();
    if (keyboard) {
      await cell.focus();
      await cell.press('Enter');
    } else await cell.click({ timeout: 10000 });
  }
  if (keyboard) {
    await play.focus();
    await play.press('Enter');
  } else await play.click();
  await expect
    .poll(
      async () =>
        (await page
          .getByRole('heading', { name: 'Your actions', exact: true })
          .count()) > 0 ||
        (await page.getByRole('heading', { name: /wins$/ }).count()) > 0,
    )
    .toBe(true);
}
