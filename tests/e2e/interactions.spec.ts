import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  startMatch,
  activePage,
  chooseCard,
  checkAccessibility,
} from './helpers.js';

async function enter(locator: Locator) {
  await expect(locator).toBeEnabled();
  await locator.focus();
  await locator.press('Enter');
}
async function keyboardCard(page: Page) {
  await enter(
    page
      .getByRole('button')
      .filter({ hasText: /Consumable|Passive/ })
      .first(),
  );
  const play = page.getByRole('button', { name: /^Play / });
  if (!(await play.isEnabled()))
    await enter(page.locator('[data-cell][data-legal="true"]').first());
  await enter(play);
  await expect(
    page.getByRole('heading', { name: 'Your actions' }),
  ).toBeVisible();
}

test('keyboard-only card selection and all four action types', async ({
  browser,
}) => {
  const { pages, contexts } = await startMatch(browser);
  try {
    let active = await activePage(pages);
    await keyboardCard(active);
    await checkAccessibility(active);
    await enter(active.getByRole('button', { name: 'Build', exact: true }));
    await enter(active.locator('[data-cell][data-legal="true"]').first());
    await expect(active.getByLabel('1 actions remaining')).toBeVisible();
    await enter(active.getByRole('button', { name: 'Upgrade', exact: true }));
    await enter(active.locator('[data-cell][data-legal="true"]').first());
    // The second action ends the turn automatically.
    active = await activePage(pages);
    await keyboardCard(active);
    await enter(active.getByRole('button', { name: 'Expand', exact: true }));
    await enter(active.locator('[data-cell][data-legal="true"]').first());
    await enter(active.locator('[data-cell][data-legal="true"]').first());
    await expect(active.getByLabel('1 actions remaining')).toBeVisible();
    await enter(active.getByRole('button', { name: 'Attack', exact: true }));
    await enter(active.locator('[data-cell][data-legal="true"]').first());
    await enter(active.getByRole('button', { name: /^Attack [A-Z]+\d+$/ }));
    // The second action ends the turn automatically.
    await expect(
      active.getByRole('heading', { name: 'Waiting for your turn' }),
    ).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('players can be eliminated, reconnect, and finish by last survivor', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { pages, contexts, views, packetErrors } = await startMatch(browser);
  try {
    // Players share their own visible tower coordinates for this cooperative test.
    const halls = await Promise.all(
      pages.map((page) =>
        page
          .locator('[data-cell]')
          .filter({ has: page.locator('[class*="piece"]') })
          .first()
          .getAttribute('data-cell'),
      ),
    );
    let rejoined = false;
    for (let turn = 0; turn < 30; turn++) {
      if (await pages[0]!.getByRole('heading', { name: /wins$/ }).count())
        break;
      const active = await activePage(pages);
      const neutral = active
        .getByRole('button')
        .filter({ hasText: /Neutral .*Consumable/ })
        .first();
      if (await neutral.count()) {
        await neutral.click();
        await active.getByRole('button', { name: /^Play / }).click();
      } else await chooseCard(active);
      await expect(
        active.getByRole('heading', { name: 'Your actions' }),
      ).toBeVisible();
      for (let action = 0; action < 2; action++) {
        if (await active.getByRole('heading', { name: /wins$/ }).count()) break;
        // Find a surviving target using its own visible board, not opponent payloads.
        let victim = -1;
        for (let i = 0; i < pages.length; i++) {
          if (pages[i] === active || !halls[i]) continue;
          if (
            await pages[i]!.locator(`[data-cell="${halls[i]}"]`)
              .getAttribute('aria-label')
              .then((label) => label?.includes('Town Hall'))
          ) {
            victim = i;
            break;
          }
        }
        expect(victim, 'surviving opponent').toBeGreaterThanOrEqual(0);
        await active
          .getByRole('button', { name: 'Attack', exact: true })
          .click();
        await active.locator(`[data-cell="${halls[victim]}"]`).click();
        await active
          .getByRole('button', { name: /^Attack [A-Z]+\d+$/ })
          .click();
        // The second action ends the turn automatically, so watch for the
        // turn passing on (or the match ending) rather than the transient
        // "0 actions remaining" state.
        await expect
          .poll(async () => {
            if (
              (await active.getByRole('heading', { name: /wins$/ }).count()) > 0
            )
              return true;
            return action === 0
              ? (await active.getByLabel('1 actions remaining').count()) > 0
              : (await active
                  .getByRole('heading', { name: 'Waiting for your turn' })
                  .count()) > 0;
          })
          .toBe(true);
        const eliminated = pages[victim]!.getByRole('heading', {
          name: /eliminated/,
        });
        if (!rejoined && (await eliminated.count())) {
          await pages[victim]!.reload();
          await expect(eliminated).toBeVisible();
          rejoined = true;
        }
      }
      if (await active.getByRole('heading', { name: /wins$/ }).count()) break;
    }
    for (const page of pages)
      await expect(page.getByRole('heading', { name: /wins$/ })).toBeVisible();
    expect(rejoined).toBe(true);
    expect(views[0]!.at(-1)?.result?.reason).toBe('last_survivor');
    expect(packetErrors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
