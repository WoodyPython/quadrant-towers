import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { createDatabase } from '../../apps/server/src/db/database.js';
import { startMatch, activePage, checkAccessibility } from './helpers.js';

test('atomic connected and sequential targets, Legendary actions, private offers and refresh continuity', async ({
  browser,
}) => {
  test.setTimeout(90000);
  const admin = createDatabase(process.env.DATABASE_URL!),
    name = `quadrant_abilities_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${name}`;
  let database: ReturnType<typeof createDatabase> | undefined,
    child: ChildProcess | undefined;
  let contexts: Awaited<ReturnType<typeof startMatch>>['contexts'] = [];
  try {
    await admin.pool.query(`CREATE DATABASE "${name}"`);
    database = createDatabase(url.href);
    await database.migrate();
    child = fork(
      fileURLToPath(new URL('./server-worker.mjs', import.meta.url)),
      {
        env: { ...process.env, DATABASE_URL: url.href, PORT: '0' },
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      },
    );
    const [ready] = (await once(child, 'message')) as [{ address: string }];
    const { pages, packetErrors } = await startMatch(
      browser,
      'Small',
      false,
      ready.address,
    );
    contexts = pages.map((p) => p.context());
    const page = await activePage(pages),
      seat = JSON.parse(
        (await page.evaluate(() =>
          localStorage.getItem('quadrant-towers:seat'),
        ))!,
      );
    const fixture = async (cardIds: string[], round = 10) => {
      const response = once(child!, 'message');
      child!.send({ type: 'ability_fixture', code: seat.code, cardIds, round });
      await response;
      await page.reload();
      await expect(
        page.getByRole('heading', { name: 'Choose a card', exact: true }),
      ).toBeVisible();
    };
    const cards = () =>
      page.getByRole('button').filter({ hasText: /Consumable|Passive/ });
    await fixture(['surveyor', 'ascension', 'time_warp']);
    await expect(cards()).toHaveCount(3);
    await expect(cards().filter({ hasText: 'Legendary' })).toHaveCount(2);
    const offer = await cards().allTextContents();
    await page.reload();
    await expect(cards()).toHaveCount(3);
    expect(await cards().allTextContents()).toEqual(offer);
    await cards().filter({ hasText: 'Surveyor' }).click();
    const play = page.getByRole('button', { name: 'Play Surveyor' });
    for (let i = 0; i < 3; i++) {
      await expect(play).toBeDisabled();
      await page.locator('[data-cell][data-legal="true"]').first().click();
      if (i < 2)
        await expect(
          page.getByText(new RegExp(`${i + 1}/3 selected`)),
        ).toBeVisible();
    }
    await expect(page.locator('[data-cell][data-selected="true"]')).toHaveCount(
      3,
    );
    await play.click();
    await expect(page.getByLabel('2 actions remaining')).toBeVisible();
    const selected = await database.pool.query(
      'SELECT state FROM match_snapshots',
    );
    expect(selected.rows[0].state.turn.selectedCardId).toBe('surveyor');
    expect(
      selected.rows[0].state.players.find(
        (p: { id: string }) => p.id === seat.playerId,
      ).revealed,
    ).toHaveLength(3);
    await page.getByRole('button', { name: 'Build', exact: true }).click();
    await page.locator('[data-cell][data-legal="true"]').first().click();
    await expect(page.getByLabel('1 actions remaining')).toBeVisible();
    await fixture(['ascension', 'time_warp', 'impenetrable']);
    await cards().filter({ hasText: 'Ascension' }).click();
    await page.locator('[data-cell][data-legal="true"]').first().click();
    for (let i = 0; i < 3; i++)
      await page.locator('[data-cell][data-legal="true"]').first().click();
    await page.getByRole('button', { name: 'Play Ascension' }).click();
    await expect(page.getByLabel('2 actions remaining')).toBeVisible();
    await fixture(['time_warp', 'all_seeing_eye', 'phoenix_protocol']);
    await cards().filter({ hasText: 'Time Warp' }).click();
    await page.getByRole('button', { name: 'Play Time Warp' }).click();
    await expect(page.getByLabel('4 actions remaining')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('4 actions remaining')).toBeVisible();
    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: 'Build', exact: true }).click();
      await page.locator('[data-cell][data-legal="true"]').first().click();
      if (i < 3)
        await expect(
          page.getByLabel(`${3 - i} actions remaining`),
        ).toBeVisible();
    }
    await expect(
      page.getByRole('heading', { name: 'Waiting for your turn' }),
    ).toBeVisible();
    const newActive = await activePage(pages);
    await checkAccessibility(newActive);
    expect(packetErrors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    if (child && child.exitCode === null) {
      const exit = once(child, 'exit');
      child.send('close');
      await exit;
    }
    await database?.close();
    await admin.pool.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.close();
  }
});
