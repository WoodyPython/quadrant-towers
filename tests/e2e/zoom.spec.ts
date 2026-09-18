import { expect, test, type Locator } from '@playwright/test';
import { startMatch, activePage, chooseCard } from './helpers.js';

async function anchor(viewport: Locator, offset: { x: number; y: number }) {
  return viewport.evaluate((el, offset) => {
    const cell = el.querySelector<HTMLElement>('[data-cell]')!;
    const viewportRect = el.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const size = cellRect.width;
    return {
      size,
      x: (offset.x - (cellRect.left - viewportRect.left)) / size,
      y: (offset.y - (cellRect.top - viewportRect.top)) / size,
    };
  }, offset);
}

async function boardGeometry(viewport: Locator) {
  return viewport.evaluate((el) => ({
    width: el.clientWidth,
    height: el.clientHeight,
    scrollWidth: el.scrollWidth,
    scrollHeight: el.scrollHeight,
  }));
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
    const zoomIn = page.getByRole('button', { name: 'Zoom in' });
    const zoomOut = page.getByRole('button', { name: 'Zoom out' });
    await expect(zoomIn).toBeVisible();
    await expect(zoomOut).toBeVisible();
    await expect(zoomOut).toBeDisabled();
    await expect(page.getByRole('button', { name: 'End turn' })).toHaveCount(0);
    const viewport = page.locator('[class*="boardViewport"]');
    const fitted = await boardGeometry(viewport);
    expect(Math.abs(fitted.width - fitted.height)).toBeLessThanOrEqual(1);
    expect(fitted.scrollWidth).toBeLessThanOrEqual(fitted.width + 1);
    expect(fitted.scrollHeight).toBeLessThanOrEqual(fitted.height + 1);
    const bounds = (await viewport.boundingBox())!;
    const center = { x: bounds.width / 2, y: bounds.height / 2 };
    const before = await anchor(viewport, center);

    await zoomIn.click();
    await expect
      .poll(async () => (await anchor(viewport, center)).size)
      .toBeGreaterThan(before.size);
    const buttonZoom = await anchor(viewport, center);
    expect(buttonZoom.x).toBeCloseTo(before.x, 1);
    expect(buttonZoom.y).toBeCloseTo(before.y, 1);
    await expect(zoomOut).toBeEnabled();

    await zoomOut.click();
    await expect
      .poll(async () => (await anchor(viewport, center)).size)
      .toBeCloseTo(before.size, 1);
    await expect(zoomOut).toBeDisabled();

    const windowHeight = await page.evaluate(() => innerHeight);
    const visibleTop = Math.max(0, bounds.y);
    const visibleBottom = Math.min(windowHeight, bounds.y + bounds.height);
    expect(visibleBottom - visibleTop).toBeGreaterThan(40);
    const wheelOffset = {
      x: bounds.width / 2,
      y: (visibleTop + visibleBottom) / 2 - bounds.y,
    };
    const beforeWheel = await anchor(viewport, wheelOffset);
    await page.mouse.move(bounds.x + wheelOffset.x, bounds.y + wheelOffset.y);
    await page.mouse.wheel(0, -300);
    await expect
      .poll(async () => (await anchor(viewport, wheelOffset)).size)
      .toBeGreaterThan(beforeWheel.size);
    const after = await anchor(viewport, wheelOffset);
    expect(after.x).toBeCloseTo(beforeWheel.x, 1);
    expect(after.y).toBeCloseTo(beforeWheel.y, 1);
    await page.mouse.wheel(0, 150);
    await expect
      .poll(async () => (await anchor(viewport, wheelOffset)).size)
      .toBeLessThan(after.size);
    const smaller = await anchor(viewport, wheelOffset);
    expect(smaller.x).toBeCloseTo(beforeWheel.x, 1);
    expect(smaller.y).toBeCloseTo(beforeWheel.y, 1);

    await page.getByRole('button', { name: 'Fit board' }).click();
    await expect
      .poll(async () => (await anchor(viewport, center)).size)
      .toBeCloseTo(before.size, 1);
    const reset = await boardGeometry(viewport);
    expect(reset.scrollWidth).toBeLessThanOrEqual(reset.width + 1);
    expect(reset.scrollHeight).toBeLessThanOrEqual(reset.height + 1);
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
    await page.evaluate(() => {
      (window as typeof window & { __boardClicks: number }).__boardClicks = 0;
      document.addEventListener('click', (event) => {
        if ((event.target as Element).closest('[data-cell]'))
          (window as typeof window & { __boardClicks: number }).__boardClicks +=
            1;
      });
    });
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
    const intermediateSizes: number[] = [];
    for (let distance = 35; distance <= 90; distance += 5) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: points(distance),
      });
      await page.waitForTimeout(20);
      intermediateSizes.push((await anchor(viewport, offset)).size);
    }
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
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __boardClicks: number }).__boardClicks,
      ),
    ).toBe(0);
    expect(
      new Set(intermediateSizes.map((value) => Math.round(value))).size,
    ).toBeGreaterThan(3);

    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: points(90),
    });
    for (let distance = 80; distance >= 10; distance -= 5)
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
      .toBeCloseTo(before.size, 1);
    const fitted = await boardGeometry(viewport);
    expect(fitted.scrollWidth).toBeLessThanOrEqual(fitted.width + 1);
    expect(fitted.scrollHeight).toBeLessThanOrEqual(fitted.height + 1);
    const settled = await viewport.evaluate(async (el) => {
      const samples: Array<{
        size: number;
        left: number;
        top: number;
        width: number;
        height: number;
      }> = [];
      for (let frame = 0; frame < 12; frame++) {
        await new Promise(requestAnimationFrame);
        samples.push({
          size: el
            .querySelector<HTMLElement>('[data-cell]')!
            .getBoundingClientRect().width,
          left: el.scrollLeft,
          top: el.scrollTop,
          width: el.scrollWidth,
          height: el.scrollHeight,
        });
      }
      return samples;
    });
    expect(
      Math.max(...settled.map((sample) => sample.size)) -
        Math.min(...settled.map((sample) => sample.size)),
    ).toBeLessThan(0.05);
    expect(
      new Set(settled.map((sample) => `${sample.left},${sample.top}`)).size,
    ).toBe(1);
    expect(
      new Set(settled.map((sample) => `${sample.width},${sample.height}`)).size,
    ).toBe(1);

    await page.locator('[data-cell]').first().tap();
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __boardClicks: number }).__boardClicks,
      ),
    ).toBe(1);

    await page.evaluate(() => {
      (window as typeof window & { __boardClicks: number }).__boardClicks = 0;
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 3 }],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + 35, y, id: 3 }],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __boardClicks: number }).__boardClicks,
      ),
    ).toBe(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
