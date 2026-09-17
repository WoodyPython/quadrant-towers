import { expect, test, type Locator } from '@playwright/test';
import { startMatch, activePage, chooseCard } from './helpers.js';

async function anchor(viewport: Locator, offset: { x: number; y: number }) {
  return viewport.evaluate((el, offset) => {
    const cell = el.querySelector<HTMLElement>('[data-cell]')!;
    const size = cell.getBoundingClientRect().width;
    return {
      size,
      x: (el.scrollLeft + offset.x - 24) / size,
      y: (el.scrollTop + offset.y - 24) / size,
    };
  }, offset);
}

test('wheel zoom preserves the cell under the cursor from a fitted board', async ({
  browser,
}) => {
  const { pages, contexts } = await startMatch(browser);
  try {
    const active = await activePage(pages);
    await chooseCard(active);
    await expect(
      active.getByRole('button', { name: 'Build', exact: true }),
    ).toBeEnabled();
    const page = pages[0]!;
    await expect(page.getByRole('button', { name: 'Zoom in' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Zoom out' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'End turn' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Fit board' }).click();
    const viewport = page.locator('[class*="boardViewport"]');
    const bounds = (await viewport.boundingBox())!;
    const offset = { x: bounds.width / 2, y: bounds.height / 2 };
    const before = await anchor(viewport, offset);
    await page.mouse.move(bounds.x + offset.x, bounds.y + offset.y);
    await page.mouse.wheel(0, -300);
    await expect
      .poll(async () => (await anchor(viewport, offset)).size)
      .toBeGreaterThan(before.size);
    const after = await anchor(viewport, offset);
    expect(after.x).toBeCloseTo(before.x, 1);
    expect(after.y).toBeCloseTo(before.y, 1);
    await page.mouse.wheel(0, 150);
    await expect
      .poll(async () => (await anchor(viewport, offset)).size)
      .toBeLessThan(after.size);
    const smaller = await anchor(viewport, offset);
    expect(smaller.x).toBeCloseTo(before.x, 1);
    expect(smaller.y).toBeCloseTo(before.y, 1);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('touch pinch preserves the cell beneath the gesture midpoint', async ({
  browser,
}) => {
  const { pages, contexts } = await startMatch(browser, 'Small', true);
  try {
    const active = await activePage(pages);
    await chooseCard(active);
    await expect(
      active.getByRole('button', { name: 'Build', exact: true }),
    ).toBeEnabled();
    const page = pages[0]!;
    const viewport = page.locator('[class*="boardViewport"]');
    const bounds = (await viewport.boundingBox())!;
    const offset = { x: bounds.width / 2, y: bounds.height / 2 };
    const before = await anchor(viewport, offset);
    const session = await page.context().newCDPSession(page);
    const x = bounds.x + offset.x;
    const y = bounds.y + offset.y;
    const points = (distance: number) => [
      { x: x - distance, y, id: 1 },
      { x: x + distance, y, id: 2 },
    ];
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: points(30),
    });
    for (let distance = 35; distance <= 90; distance += 5)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: points(distance),
      });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await expect
      .poll(async () => (await anchor(viewport, offset)).size)
      .toBeGreaterThan(before.size);
    const after = await anchor(viewport, offset);
    expect(after.x).toBeCloseTo(before.x, 1);
    expect(after.y).toBeCloseTo(before.y, 1);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
