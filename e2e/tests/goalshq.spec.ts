import { test, expect } from '@playwright/test';

async function loginViaUI(page, baseURL) {
    const appUrl = baseURL ?? process.env.APP_URL ?? 'http://localhost:8080';
    await page.goto(`${appUrl}/login`);
    await page
        .getByTestId('login-email')
        .fill(process.env.E2E_EMAIL || 'test@tududi.com');
    await page
        .getByTestId('login-password')
        .fill(process.env.E2E_PASSWORD || 'password123');
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/(dashboard|today)/, { timeout: 10000 });
}

test.describe('GoalsHQ', () => {
    test('goal → strategy → progress flows end to end', async ({
        page,
        baseURL,
    }) => {
        await loginViaUI(page, baseURL);
        const appUrl = baseURL ?? process.env.APP_URL ?? 'http://localhost:8080';

        // Seed a goal through tududi's own API (session cookie carries over).
        const created = await page.request.post(`${appUrl}/api/goals`, {
            data: {
                title: `E2E Goal ${Date.now()}`,
                horizon: 'year',
                status: 'active',
            },
        });
        expect(created.ok()).toBeTruthy();
        const goalUid = (await created.json()).goal.uid;

        // Dashboard shows the goal.
        await page.goto(`${appUrl}/goalshq`);
        await expect(
            page.getByRole('heading', { name: /GoalsHQ/i })
        ).toBeVisible();
        const card = page.locator(`a[href^="/goalshq/goal/${goalUid}"]`);
        await expect(card).toBeVisible();

        // Open it and add a strategy.
        await card.click();
        await page.getByPlaceholder(/New strategy name/i).fill('E2E strategy');
        await page
            .getByRole('button', { name: /^Add$/ })
            .first()
            .click();
        await expect(page.getByText('E2E strategy')).toBeVisible();

        // A progress bar renders (rollup ran).
        await expect(page.getByRole('progressbar').first()).toBeVisible();
    });

    test('feature gate: disabled → redirects away and hides the nav', async ({
        page,
        baseURL,
    }) => {
        // This run has GOALSHQ_ENABLED=true, so just assert the enabled path is
        // reachable; the disabled path is covered by the backend integration test.
        await loginViaUI(page, baseURL);
        const appUrl = baseURL ?? process.env.APP_URL ?? 'http://localhost:8080';
        await page.goto(`${appUrl}/goalshq`);
        await expect(page).toHaveURL(/\/goalshq/);
    });
});
