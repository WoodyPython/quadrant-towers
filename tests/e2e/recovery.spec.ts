import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { createDatabase } from '../../apps/server/src/db/database.js';
import { startMatch, activePage, chooseCard } from './helpers.js';

test('four browsers restore their seats and private offers after graceful and abrupt restarts', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const admin = createDatabase(process.env.DATABASE_URL!);
  const name = `quadrant_browser_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${name}`;
  let child: ChildProcess | undefined;
  let port = 0;
  const start = async () => {
    child = fork(
      fileURLToPath(new URL('./server-worker.mjs', import.meta.url)),
      {
        env: { ...process.env, DATABASE_URL: url.href, PORT: String(port) },
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      },
    );
    const running = child;
    const ready = await new Promise<{ address: string }>((resolve, reject) => {
      const exited = () =>
        reject(new Error('Browser test server exited before readiness'));
      running.once('exit', exited);
      running.once('error', reject);
      running.once('message', (message: { address: string }) => {
        running.off('exit', exited);
        resolve(message);
      });
    });
    port = Number(new URL(ready.address).port);
    return ready.address as string;
  };
  const stop = async (crash = false) => {
    if (!child || child.exitCode !== null) return;
    const exit = once(child, 'exit');
    if (crash) child.kill('SIGKILL');
    else child.send('close');
    await exit;
  };
  let contexts: Awaited<ReturnType<typeof startMatch>>['contexts'] = [];
  let database: ReturnType<typeof createDatabase> | undefined;
  try {
    await admin.pool.query(`CREATE DATABASE "${name}"`);
    database = createDatabase(url.href);
    await database.migrate();
    const origin = await start();
    const match = await startMatch(browser, 'Small', false, origin);
    contexts = match.contexts;
    const { pages, views, packetErrors } = match;
    const active = await activePage(pages);
    await expect(
      active
        .getByRole('button')
        .filter({ hasText: /Consumable|Passive/ })
        .first(),
    ).toBeEnabled();
    const offer = await active
      .getByRole('button')
      .filter({ hasText: /Consumable|Passive/ })
      .allTextContents();
    const seats = await Promise.all(
      pages.map((page) =>
        page.evaluate(() => localStorage.getItem('quadrant-towers:seat')),
      ),
    );
    for (const crash of [false, true]) {
      await stop(crash);
      await start();
      const restored = await activePage(pages);
      expect(restored).toBe(active);
      await expect
        .poll(() =>
          restored
            .getByRole('button')
            .filter({ hasText: /Consumable|Passive/ })
            .first()
            .isEnabled(),
        )
        .toBe(true);
      expect(
        await restored
          .getByRole('button')
          .filter({ hasText: /Consumable|Passive/ })
          .allTextContents(),
      ).toEqual(offer);
      expect(
        await Promise.all(
          pages.map((page) =>
            page.evaluate(() => localStorage.getItem('quadrant-towers:seat')),
          ),
        ),
      ).toEqual(seats);
    }
    await chooseCard(active);
    const advanced = once(child!, 'message');
    child!.send('timeout');
    await advanced;
    await active.reload(); // rejoin observes and commits the overdue turn once
    await expect
      .poll(async () => (await activePage(pages)) !== active)
      .toBe(true);
    expect(packetErrors).toEqual([]);
    for (let index = 0; index < pages.length; index++) {
      const seat = JSON.parse(seats[index]!) as { playerId: string };
      expect(views[index]!.length).toBeGreaterThan(0);
      for (const view of views[index]!) {
        expect(view.cells.some((cell) => cell.visibility === 'hidden')).toBe(
          true,
        );
        if (view.turn.playerId !== seat.playerId)
          expect(view.turn.cardOffer).toBeUndefined();
      }
    }
    const snapshot = await database.pool.query(
      'SELECT state FROM match_snapshots',
    );
    expect(
      snapshot.rows[0].state.players.reduce(
        (n: number, p: { timedOutTurns: number }) => n + p.timedOutTurns,
        0,
      ),
    ).toBe(1);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await stop();
    await database?.close();
    await admin.pool.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.close();
  }
});
