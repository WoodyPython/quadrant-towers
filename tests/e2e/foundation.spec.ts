import { expect, test } from '@playwright/test';

test('production shell connects and is keyboard accessible', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Quadrant Towers' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Service connected');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Check connection' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toHaveText('Service connected');
  await page.setViewportSize({ width: 375, height: 667 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('SPA navigation works while missing API and assets return errors', async ({
  page,
  request,
}) => {
  await page.goto('/help');
  await expect(
    page.getByRole('heading', { name: 'Quadrant Towers' }),
  ).toBeVisible();
  for (const path of [
    '/api/missing',
    '/health/missing',
    '/assets/missing.js',
  ]) {
    const response = await request.get(path, {
      headers: { accept: 'text/html' },
    });
    expect(response.status()).toBe(404);
    expect((await response.json()).code).toBe('NOT_FOUND');
  }
});

test('connection failure offers a working retry', async ({ page }) => {
  await page.route('**/health/ready', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"status":"unavailable"}',
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText(
    'Service unavailable. Please try again.',
  );
  await page.unroute('**/health/ready');
  await page.getByRole('button', { name: 'Check connection' }).click();
  await expect(page.getByRole('status')).toHaveText('Service connected');
});
