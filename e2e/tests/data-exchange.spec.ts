import { test, expect, Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

async function loginViaUI(page: Page, baseURL: string | undefined) {
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
    return appUrl;
}

function tmpFile(name: string) {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dx-e2e-')), name);
}

test.describe('Data Exchange', () => {
    test('download an empty template, fill it in, preview + apply, see it in history', async ({
        page,
        baseURL,
    }) => {
        const stamp = Date.now();
        const areaName = `E2E Area ${stamp}`;
        const projectName = `E2E Project ${stamp}`;
        const taskName = `E2E Task ${stamp}`;

        const appUrl = await loginViaUI(page, baseURL);
        await page.goto(`${appUrl}/data-exchange`);
        await expect(
            page.getByRole('heading', { name: /Spreadsheet Import/i })
        ).toBeVisible();

        // Scope down to just the sheets this test needs (all are selected by
        // default, including any enabled GoalsHQ sheets).
        const OTHER_KEYS = [
            'tags',
            'goals',
            'notes',
            'inbox_items',
            'goalshq_strategies',
            'goalshq_key_results',
            'goalshq_key_result_entries',
            'goalshq_milestones',
            'goalshq_records',
        ];
        for (const key of OTHER_KEYS) {
            const chip = page.getByTestId(`scope-${key}`);
            if (await chip.isVisible().catch(() => false)) {
                await chip.click();
            }
        }

        // --- Download an empty template ---
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.getByTestId('download-template').click(),
        ]);
        const templatePath = tmpFile('template.xlsx');
        await download.saveAs(templatePath);

        // --- Fill in Areas / Projects / Tasks rows ---
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(templatePath);

        const areaSheet = wb.getWorksheet('Areas')!;
        const areaHeader: Record<string, number> = {};
        areaSheet
            .getRow(1)
            .eachCell((cell, col) => (areaHeader[String(cell.value)] = col));
        areaSheet.addRow([]).getCell(areaHeader.name).value = areaName;

        const projectSheet = wb.getWorksheet('Projects')!;
        const projectHeader: Record<string, number> = {};
        projectSheet
            .getRow(1)
            .eachCell((cell, col) => (projectHeader[String(cell.value)] = col));
        const projectRow = projectSheet.addRow([]);
        projectRow.getCell(projectHeader.name).value = projectName;
        projectRow.getCell(projectHeader.area).value = areaName;

        const taskSheet = wb.getWorksheet('Tasks')!;
        const taskHeader: Record<string, number> = {};
        taskSheet
            .getRow(1)
            .eachCell((cell, col) => (taskHeader[String(cell.value)] = col));
        const taskRow = taskSheet.addRow([]);
        taskRow.getCell(taskHeader.name).value = taskName;
        taskRow.getCell(taskHeader.project).value = projectName;

        const editedPath = tmpFile('edited.xlsx');
        await wb.xlsx.writeFile(editedPath);

        // --- Import: preview, then apply ---
        await page.getByTestId('tab-import').click();
        await page.getByTestId('import-file-input').setInputFiles(editedPath);
        await page.getByTestId('preview-btn').click();

        await expect(page.getByTestId('plan-table')).toBeVisible();
        await expect(
            page.getByTestId('plan-row-areas').getByTestId('plan-created')
        ).toHaveText('1');
        await expect(
            page.getByTestId('plan-row-projects').getByTestId('plan-created')
        ).toHaveText('1');
        await expect(
            page.getByTestId('plan-row-tasks').getByTestId('plan-created')
        ).toHaveText('1');

        await page.getByTestId('apply-btn').click();
        await expect(page.getByText(/Import complete/i)).toBeVisible();

        // --- History panel reflects the import ---
        await expect(page.getByTestId('history-panel')).toBeVisible();
        await expect(page.getByTestId('history-row').first()).toContainText(
            /import/i
        );

        // --- The data is really there (via the app's own APIs) ---
        const areasRes = await page.request.get(`${appUrl}/api/areas`);
        expect(areasRes.ok()).toBeTruthy();
        const areas = await areasRes.json();
        expect(
            (Array.isArray(areas) ? areas : areas.areas).some(
                (a: { name: string }) => a.name === areaName
            )
        ).toBeTruthy();
    });

    test('re-importing an unmodified export is a no-op', async ({
        page,
        baseURL,
    }) => {
        const appUrl = await loginViaUI(page, baseURL);
        await page.goto(`${appUrl}/data-exchange`);

        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.getByTestId('export-data').click(),
        ]);
        const exportPath = tmpFile('export.xlsx');
        await download.saveAs(exportPath);

        await page.getByTestId('tab-import').click();
        await page.getByTestId('import-file-input').setInputFiles(exportPath);
        await page.getByTestId('preview-btn').click();

        await expect(page.getByTestId('plan-table')).toBeVisible();
        for (const key of ['tags', 'areas', 'goals', 'projects', 'tasks']) {
            const row = page.getByTestId(`plan-row-${key}`);
            if (await row.isVisible().catch(() => false)) {
                await expect(row.getByTestId('plan-created')).toHaveText('0');
            }
        }
    });

    test('the page is reachable once logged in', async ({ page, baseURL }) => {
        // This run has FF_ENABLE_DATA_EXCHANGE=true, so assert the enabled
        // path is reachable; the disabled (403) path is covered by the
        // backend integration test.
        await loginViaUI(page, baseURL);
        const appUrl =
            baseURL ?? process.env.APP_URL ?? 'http://localhost:8080';
        await page.goto(`${appUrl}/data-exchange`);
        await expect(page).toHaveURL(/\/data-exchange/);
    });
});
