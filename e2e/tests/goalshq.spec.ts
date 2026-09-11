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
        const appUrl =
            baseURL ?? process.env.APP_URL ?? 'http://localhost:8080';
        const goalTitle = `E2E Goal ${Date.now()}`;

        // Seed a goal through tududi's own API (session cookie carries over).
        const created = await page.request.post(`${appUrl}/api/goals`, {
            data: {
                title: goalTitle,
                horizon: 'year',
                status: 'active',
            },
        });
        expect(created.ok()).toBeTruthy();
        const goalUid = (await created.json()).goal.uid;

        // The goals list shows it, and its card links to /goal/<uid>-<slug>
        // (frontend/utils/slugUtils.ts createGoalUrl — there is no standalone
        // "/goalshq" dashboard; GoalsHQ surfaces on the regular Goal detail
        // page's "Metrics" tab, per the tabbed-Goal-detail-page redesign).
        await page.goto(`${appUrl}/goals`);
        const card = page.locator(`a[href^="/goal/${goalUid}"]`);
        await expect(card).toBeVisible();

        // Open it and switch to the Metrics tab.
        await card.click();
        await expect(
            page.getByRole('heading', { name: goalTitle })
        ).toBeVisible();
        await page.getByRole('button', { name: 'Metrics' }).click();

        // Progress > Strategies sub-tab: add a strategy for this goal. Scope
        // to the panel's own section — the sidebar has its own "+ New
        // strategy" quick-add button with the same accessible name.
        await page.getByRole('button', { name: 'Strategies' }).click();
        const strategiesSection = page
            .locator('section')
            .filter({ has: page.getByRole('heading', { name: 'Strategies' }) });
        await strategiesSection
            .getByRole('button', { name: /New strategy/i })
            .click();
        await page.getByPlaceholder(/Strategy name/i).fill('E2E strategy');
        await page.getByRole('button', { name: 'Create', exact: true }).click();
        await expect(page.getByText('E2E strategy')).toBeVisible();

        // Back on Progress > Execution, a progress bar renders (rollup ran).
        await page.getByRole('button', { name: 'Execution' }).click();
        await expect(page.getByRole('progressbar').first()).toBeVisible();
    });

    test('feature gate: enabled path is reachable', async ({
        page,
        baseURL,
    }) => {
        // This run has GOALSHQ_ENABLED=true, so just assert the enabled path
        // (the Strategy overview page) is reachable; the disabled path is
        // covered by the backend integration test.
        await loginViaUI(page, baseURL);
        const appUrl =
            baseURL ?? process.env.APP_URL ?? 'http://localhost:8080';
        await page.goto(`${appUrl}/strategy`);
        await expect(
            page.getByRole('heading', { name: 'Strategy' })
        ).toBeVisible();
    });
});
