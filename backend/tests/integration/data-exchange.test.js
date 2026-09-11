process.env.FF_ENABLE_DATA_EXCHANGE = 'true';

const ExcelJS = require('exceljs');
const request = require('supertest');
const app = require('../../app');
const service = require('../../modules/data-exchange/service');
const {
    Area,
    Goal,
    Project,
    Task,
    Tag,
    Note,
    InboxItem,
    GoalshqStrategy,
    GoalshqKeyResult,
    GoalshqMilestone,
    GoalshqRecord,
} = require('../../models');
const { createTestUser } = require('../helpers/testUtils');

async function loadWb(buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    return wb;
}

function sheet(wb, name) {
    return wb.getWorksheet(name);
}

function headerMap(ws) {
    const map = {};
    ws.getRow(1).eachCell((cell, col) => {
        map[String(cell.value).trim()] = col;
    });
    return map;
}

async function toBuffer(wb) {
    return Buffer.from(await wb.xlsx.writeBuffer());
}

function fakeFile(buffer, name = 'import.xlsx') {
    return { buffer, originalname: name };
}

describe('Data Exchange', () => {
    let user, area, project, task;

    beforeEach(async () => {
        user = await createTestUser({ email: 'dx@example.com' });
        area = await Area.create({ name: 'Work', user_id: user.id });
        project = await Project.create({
            name: 'Site',
            user_id: user.id,
            area_id: area.id,
        });
        task = await Task.create({
            name: 'Design',
            user_id: user.id,
            project_id: project.id,
            status: 0,
        });
    });

    it('round-trips: export -> commit -> nothing changes', async () => {
        const exported = await service.exportData({
            userId: user.id,
            format: 'xlsx',
            scopes: 'all',
        });

        const result = await service.commit({
            userId: user.id,
            file: fakeFile(exported.body),
            format: 'xlsx',
            scopes: 'all',
        });

        expect(result.totals.created).toBe(0);
        expect(result.totals.updated).toBe(0);
        expect(result.totals.errors).toBe(0);
        expect(result.totals.unchanged).toBeGreaterThanOrEqual(3);
    });

    it('creates a new task from a populated template row', async () => {
        const exported = await service.exportData({
            userId: user.id,
            format: 'xlsx',
            scopes: 'all',
        });
        const wb = await loadWb(exported.body);
        const ws = sheet(wb, 'Tasks');
        const h = headerMap(ws);
        const row = ws.addRow([]);
        row.getCell(h.name).value = 'Write copy';
        row.getCell(h.project).value = 'Site';
        row.getCell(h.status).value = 'in_progress';
        row.getCell(h.tags).value = 'marketing, urgent';

        const result = await service.commit({
            userId: user.id,
            file: fakeFile(await toBuffer(wb)),
            format: 'xlsx',
            scopes: 'all',
        });

        expect(result.resources.tasks.created).toBe(1);
        const created = await Task.findOne({
            where: { name: 'Write copy', user_id: user.id },
            include: [Tag],
        });
        expect(created).toBeTruthy();
        expect(created.project_id).toBe(project.id);
        expect(created.status).toBe(1);
        expect(created.Tags.map((t) => t.name).sort()).toEqual([
            'marketing',
            'urgent',
        ]);
    });

    it('updates an existing row by uid', async () => {
        const exported = await service.exportData({
            userId: user.id,
            format: 'xlsx',
            scopes: 'tasks',
            // csv single-scope also fine; use xlsx
        });
        const wb = await loadWb(exported.body);
        const ws = sheet(wb, 'Tasks');
        const h = headerMap(ws);
        // row 2 is the Design task
        ws.getRow(2).getCell(h.status).value = 'done';
        ws.getRow(2).getCell(h.priority).value = 'high';

        const result = await service.commit({
            userId: user.id,
            file: fakeFile(await toBuffer(wb)),
            format: 'xlsx',
            scopes: 'tasks',
        });

        expect(result.resources.tasks.updated).toBe(1);
        await task.reload();
        expect(task.status).toBe(2);
        expect(task.priority).toBe(2);
    });

    it('preview never writes', async () => {
        const exported = await service.exportData({
            userId: user.id,
            format: 'xlsx',
            scopes: 'all',
        });
        const wb = await loadWb(exported.body);
        const ws = sheet(wb, 'Areas');
        const h = headerMap(ws);
        const row = ws.addRow([]);
        row.getCell(h.name).value = 'Health';

        const before = await Area.count({ where: { user_id: user.id } });
        const preview = await service.preview({
            userId: user.id,
            file: fakeFile(await toBuffer(wb)),
            format: 'xlsx',
            scopes: 'all',
        });
        const after = await Area.count({ where: { user_id: user.id } });

        expect(preview.committed).toBe(false);
        expect(preview.resources.areas.created).toBe(1);
        expect(after).toBe(before);
    });

    it('reports an error for an unresolvable reference', async () => {
        const exported = await service.exportData({
            userId: user.id,
            format: 'xlsx',
            scopes: 'all',
        });
        const wb = await loadWb(exported.body);
        const ws = sheet(wb, 'Tasks');
        const h = headerMap(ws);
        const row = ws.addRow([]);
        row.getCell(h.name).value = 'Orphan';
        row.getCell(h.project).value = 'Does Not Exist';

        const preview = await service.preview({
            userId: user.id,
            file: fakeFile(await toBuffer(wb)),
            format: 'xlsx',
            scopes: 'all',
        });
        expect(preview.resources.tasks.errors.length).toBeGreaterThanOrEqual(1);
        expect(preview.resources.tasks.errors[0].column).toBe('project');
    });

    it('sync mode archives a task missing from the sheet (with confirm)', async () => {
        const other = await Task.create({
            name: 'Keep me',
            user_id: user.id,
            project_id: project.id,
            status: 0,
        });
        const exported = await service.exportData({
            userId: user.id,
            format: 'xlsx',
            scopes: 'tasks',
        });
        const wb = await loadWb(exported.body);
        const ws = sheet(wb, 'Tasks');
        const h = headerMap(ws);
        // Delete the "Design" row, keep "Keep me"
        ws.eachRow((r, n) => {
            if (n > 1 && r.getCell(h.name).value === 'Design')
                ws.spliceRows(n, 1);
        });

        const preview = await service.preview({
            userId: user.id,
            file: fakeFile(await toBuffer(wb)),
            format: 'xlsx',
            scopes: 'tasks',
            options: { mode: 'sync', syncScopes: 'tasks' },
        });
        expect(preview.totals.pendingDeletes).toBe(1);

        await service.commit({
            userId: user.id,
            file: fakeFile(await toBuffer(wb)),
            format: 'xlsx',
            scopes: 'tasks',
            options: { mode: 'sync', syncScopes: 'tasks', confirmDeletes: 1 },
        });

        await task.reload();
        await other.reload();
        expect(task.status).toBe(3); // archived
        expect(other.status).toBe(0);
    });

    it('rejects a stale delete confirmation', async () => {
        const exported = await service.exportData({
            userId: user.id,
            format: 'xlsx',
            scopes: 'tasks',
        });
        const wb = await loadWb(exported.body);
        const ws = sheet(wb, 'Tasks');
        const h = headerMap(ws);
        ws.eachRow((r, n) => {
            if (n > 1 && r.getCell(h.name).value === 'Design')
                ws.spliceRows(n, 1);
        });

        await expect(
            service.commit({
                userId: user.id,
                file: fakeFile(await toBuffer(wb)),
                format: 'xlsx',
                scopes: 'tasks',
                options: {
                    mode: 'sync',
                    syncScopes: 'tasks',
                    confirmDeletes: 5,
                },
            })
        ).rejects.toThrow(/Delete count/);
    });

    it('does not touch another user rows', async () => {
        const stranger = await createTestUser({
            email: 'stranger@example.com',
        });
        const strangerArea = await Area.create({
            name: 'Work',
            user_id: stranger.id,
        });

        const exported = await service.exportData({
            userId: user.id,
            format: 'xlsx',
            scopes: 'areas',
        });
        const wb = await loadWb(exported.body);
        const ws = sheet(wb, 'Areas');
        const h = headerMap(ws);
        // Try to hijack the stranger's area by uid
        const row = ws.addRow([]);
        row.getCell(h.uid).value = strangerArea.uid;
        row.getCell(h.name).value = 'HIJACKED';

        const result = await service.commit({
            userId: user.id,
            file: fakeFile(await toBuffer(wb)),
            format: 'xlsx',
            scopes: 'areas',
        });

        await strangerArea.reload();
        expect(strangerArea.name).toBe('Work');
        // It was created as a NEW area owned by `user`, with a fresh uid
        expect(result.resources.areas.created).toBe(1);
        const mine = await Area.findOne({
            where: { name: 'HIJACKED', user_id: user.id },
        });
        expect(mine).toBeTruthy();
        expect(mine.uid).not.toBe(strangerArea.uid);
    });

    it('requires authentication on the HTTP routes', async () => {
        const res = await request(app).get('/api/data-exchange/template');
        expect(res.status).toBe(401);
    });

    describe('job history', () => {
        it('logs an export and a successful import commit, but never a preview', async () => {
            await service.exportData({
                userId: user.id,
                format: 'xlsx',
                scopes: 'tasks',
            });

            const exported = await service.exportData({
                userId: user.id,
                format: 'xlsx',
                scopes: 'tasks',
            });
            const wb = await loadWb(exported.body);
            const ws = sheet(wb, 'Tasks');
            const h = headerMap(ws);
            ws.getRow(2).getCell(h.status).value = 'done';
            const file = fakeFile(await toBuffer(wb));

            await service.preview({
                userId: user.id,
                file,
                format: 'xlsx',
                scopes: 'tasks',
            });
            await service.commit({
                userId: user.id,
                file,
                format: 'xlsx',
                scopes: 'tasks',
            });

            const history = await service.listJobs(user.id);
            expect(history).toHaveLength(3); // 2 exports + 1 import commit
            expect(
                history.filter((j) => j.direction === 'export')
            ).toHaveLength(2);
            const importJob = history.find((j) => j.direction === 'import');
            expect(importJob.status).toBe('success');
            expect(importJob.stats.updated).toBe(1);
        });

        it('logs a failed commit with an error message, not a partial success', async () => {
            const exported = await service.exportData({
                userId: user.id,
                format: 'xlsx',
                scopes: 'tasks',
            });
            const wb = await loadWb(exported.body);
            const ws = sheet(wb, 'Tasks');
            const h = headerMap(ws);
            ws.eachRow((r, n) => {
                if (n > 1 && r.getCell(h.name).value === 'Design')
                    ws.spliceRows(n, 1);
            });
            const file = fakeFile(await toBuffer(wb));

            await expect(
                service.commit({
                    userId: user.id,
                    file,
                    format: 'xlsx',
                    scopes: 'tasks',
                    options: {
                        mode: 'sync',
                        syncScopes: 'tasks',
                        confirmDeletes: 99,
                    },
                })
            ).rejects.toThrow(/Delete count/);

            const history = await service.listJobs(user.id);
            expect(history).toHaveLength(2); // 1 export + 1 failed import
            const failed = history.find((j) => j.direction === 'import');
            expect(failed.status).toBe('error');
            expect(failed.error_message).toMatch(/Delete count/);
        });

        it('is exposed over HTTP', async () => {
            await service.exportData({
                userId: user.id,
                format: 'xlsx',
                scopes: 'tasks',
            });

            const agent = request.agent(app);
            await agent
                .post('/api/login')
                .send({ email: 'dx@example.com', password: 'password123' });
            const res = await agent.get('/api/data-exchange/jobs');
            expect(res.status).toBe(200);
            expect(res.body.jobs).toHaveLength(1);
            expect(res.body.jobs[0].direction).toBe('export');
        });
    });

    describe('notes and inbox', () => {
        it('round-trips notes: create, tag, update, unchanged', async () => {
            await Note.create({
                title: 'Grocery list',
                content: 'milk, eggs',
                user_id: user.id,
                project_id: project.id,
            });

            const exported = await service.exportData({
                userId: user.id,
                format: 'xlsx',
                scopes: 'notes',
            });
            const wb = await loadWb(exported.body);
            const ws = sheet(wb, 'Notes');
            const h = headerMap(ws);

            // New note via a blank-uid row.
            const row = ws.addRow([]);
            row.getCell(h.title).value = 'Trip ideas';
            row.getCell(h.content).value = 'Lisbon, Porto';
            row.getCell(h.project).value = 'Site';
            row.getCell(h.tags).value = 'travel';

            // Update the existing note.
            ws.getRow(2).getCell(h.content).value = 'milk, eggs, bread';

            const first = await service.commit({
                userId: user.id,
                file: fakeFile(await toBuffer(wb)),
                format: 'xlsx',
                scopes: 'notes',
            });
            expect(first.resources.notes.created).toBe(1);
            expect(first.resources.notes.updated).toBe(1);

            const created = await Note.findOne({
                where: { title: 'Trip ideas', user_id: user.id },
                include: [Tag],
            });
            expect(created.project_id).toBe(project.id);
            expect(created.Tags.map((t) => t.name)).toEqual(['travel']);

            // Re-importing the same export (now stale) still lands on the
            // same rows and is a no-op the second time round.
            const reExported = await service.exportData({
                userId: user.id,
                format: 'xlsx',
                scopes: 'notes',
            });
            const second = await service.commit({
                userId: user.id,
                file: fakeFile(reExported.body),
                format: 'xlsx',
                scopes: 'notes',
            });
            expect(second.totals.created).toBe(0);
            expect(second.totals.updated).toBe(0);
            expect(second.totals.unchanged).toBe(2);
        });

        it('flags ambiguous untitled notes instead of merging them', async () => {
            await Note.create({ user_id: user.id, project_id: project.id }); // no title
            await Note.create({ user_id: user.id, project_id: project.id }); // no title

            const exported = await service.exportData({
                userId: user.id,
                format: 'xlsx',
                scopes: 'notes',
            });
            const wb = await loadWb(exported.body);
            const ws = sheet(wb, 'Notes');
            const h = headerMap(ws);
            // Blank out both uids so the importer has to fall back to the
            // (identical, blank) natural key.
            ws.getRow(2).getCell(h.uid).value = null;
            ws.getRow(3).getCell(h.uid).value = null;
            ws.getRow(2).getCell(h.content).value = 'edited';

            const preview = await service.preview({
                userId: user.id,
                file: fakeFile(await toBuffer(wb)),
                format: 'xlsx',
                scopes: 'notes',
            });
            expect(
                preview.resources.notes.errors.length
            ).toBeGreaterThanOrEqual(1);
        });

        it('imports inbox items and rejects a row with no content', async () => {
            const exported = await service.exportData({
                userId: user.id,
                format: 'xlsx',
                scopes: 'inbox_items',
            });
            const wb = await loadWb(exported.body);
            const ws = sheet(wb, 'Inbox');
            const h = headerMap(ws);

            const good = ws.addRow([]);
            good.getCell(h.content).value = 'Call the dentist';
            good.getCell(h.status).value = 'added';

            const bad = ws.addRow([]);
            bad.getCell(h.title).value = 'Missing content';

            const preview = await service.preview({
                userId: user.id,
                file: fakeFile(await toBuffer(wb)),
                format: 'xlsx',
                scopes: 'inbox_items',
            });
            expect(preview.resources.inbox_items.created).toBe(1);
            expect(
                preview.resources.inbox_items.errors.some((e) =>
                    e.message.includes('required')
                )
            ).toBe(true);

            // Fix the bad row and commit.
            bad.getCell(h.content).value = 'Missing content, now present';
            const result = await service.commit({
                userId: user.id,
                file: fakeFile(await toBuffer(wb)),
                format: 'xlsx',
                scopes: 'inbox_items',
            });
            expect(result.resources.inbox_items.created).toBe(2);
            const stored = await InboxItem.findAll({
                where: { user_id: user.id },
            });
            expect(stored.map((i) => i.content).sort()).toEqual(
                ['Call the dentist', 'Missing content, now present'].sort()
            );
        });
    });

    describe('goalshq', () => {
        let goal;

        beforeEach(async () => {
            goal = await Goal.create({
                title: 'Grow the business',
                user_id: user.id,
            });
        });

        it('imports a strategy linked to a goal by name', async () => {
            const exported = await service.exportData({
                userId: user.id,
                format: 'xlsx',
                scopes: 'goalshq_strategies',
            });
            const wb = await loadWb(exported.body);
            const ws = sheet(wb, 'Strategies');
            const h = headerMap(ws);
            const row = ws.addRow([]);
            row.getCell(h.name).value = 'Real Estate';
            row.getCell(h.goal).value = 'Grow the business';
            row.getCell(h.status).value = 'active';

            const result = await service.commit({
                userId: user.id,
                file: fakeFile(await toBuffer(wb)),
                format: 'xlsx',
                scopes: 'goalshq_strategies',
            });
            expect(result.resources.goalshq_strategies.created).toBe(1);

            const created = await GoalshqStrategy.findOne({
                where: { name: 'Real Estate', user_id: user.id },
            });
            expect(created.goal_id).toBe(goal.id);
        });

        it('resolves a polymorphic key result parent (project) and rejects a bad parent_type', async () => {
            const exported = await service.exportData({
                userId: user.id,
                format: 'xlsx',
                scopes: 'goalshq_key_results',
            });
            const wb = await loadWb(exported.body);
            const ws = sheet(wb, 'Key Results');
            const h = headerMap(ws);

            const good = ws.addRow([]);
            good.getCell(h.name).value = 'Ship 3 releases';
            good.getCell(h.parent_type).value = 'project';
            good.getCell(h.parent).value = 'Site';
            good.getCell(h.target_value).value = 3;

            const bad = ws.addRow([]);
            bad.getCell(h.name).value = 'Broken';
            bad.getCell(h.parent_type).value = 'sprocket';
            bad.getCell(h.parent).value = 'Site';
            bad.getCell(h.target_value).value = 1;

            const preview = await service.preview({
                userId: user.id,
                file: fakeFile(await toBuffer(wb)),
                format: 'xlsx',
                scopes: 'goalshq_key_results',
            });
            expect(preview.resources.goalshq_key_results.created).toBe(1);
            expect(
                preview.resources.goalshq_key_results.errors.some(
                    (e) => e.column === 'parent_type'
                )
            ).toBe(true);

            // A file with errors is refused outright — remove the bad row
            // before committing (mirrors how the UI would ask the user to
            // fix it and re-preview).
            ws.spliceRows(bad.number, 1);

            const result = await service.commit({
                userId: user.id,
                file: fakeFile(await toBuffer(wb)),
                format: 'xlsx',
                scopes: 'goalshq_key_results',
            });
            expect(result.resources.goalshq_key_results.created).toBe(1);
            const kr = await GoalshqKeyResult.findOne({
                where: { name: 'Ship 3 releases', user_id: user.id },
            });
            expect(kr.parent_type).toBe('project');
            expect(kr.parent_id).toBe(project.id);
            expect(kr.target_value).toBe(3);
        });

        it('wires a child key result to its parent via the self-referencing column', async () => {
            const parentKr = await GoalshqKeyResult.create({
                name: 'Parent KR',
                parent_type: 'goal',
                parent_id: goal.id,
                user_id: user.id,
                target_value: 10,
            });

            const exported = await service.exportData({
                userId: user.id,
                format: 'xlsx',
                scopes: 'goalshq_key_results',
            });
            const wb = await loadWb(exported.body);
            const ws = sheet(wb, 'Key Results');
            const h = headerMap(ws);
            const row = ws.addRow([]);
            row.getCell(h.name).value = 'Child KR';
            row.getCell(h.parent_type).value = 'goal';
            row.getCell(h.parent).value = 'Grow the business';
            row.getCell(h.parent_key_result).value = 'Parent KR';
            row.getCell(h.target_value).value = 5;

            await service.commit({
                userId: user.id,
                file: fakeFile(await toBuffer(wb)),
                format: 'xlsx',
                scopes: 'goalshq_key_results',
            });

            const child = await GoalshqKeyResult.findOne({
                where: { name: 'Child KR', user_id: user.id },
            });
            expect(child.parent_kr_id).toBe(parentKr.id);
        });

        it('imports a milestone parented to a strategy', async () => {
            const strategy = await GoalshqStrategy.create({
                name: 'Real Estate',
                user_id: user.id,
            });

            const exported = await service.exportData({
                userId: user.id,
                format: 'xlsx',
                scopes: 'goalshq_milestones',
            });
            const wb = await loadWb(exported.body);
            const ws = sheet(wb, 'Milestones');
            const h = headerMap(ws);
            const row = ws.addRow([]);
            row.getCell(h.title).value = 'Close first deal';
            row.getCell(h.parent_type).value = 'strategy';
            row.getCell(h.parent).value = 'Real Estate';
            row.getCell(h.status).value = 'achieved';

            await service.commit({
                userId: user.id,
                file: fakeFile(await toBuffer(wb)),
                format: 'xlsx',
                scopes: 'goalshq_milestones',
            });

            const milestone = await GoalshqMilestone.findOne({
                where: { title: 'Close first deal', user_id: user.id },
            });
            expect(milestone.parent_type).toBe('strategy');
            expect(milestone.parent_id).toBe(strategy.id);
            expect(milestone.status).toBe('achieved');
        });

        it('round-trips records with a link to a key result, end to end', async () => {
            const exported = await service.exportData({
                userId: user.id,
                format: 'xlsx',
                scopes: 'all',
            });
            const wb = await loadWb(exported.body);

            const krSheet = sheet(wb, 'Key Results');
            const krH = headerMap(krSheet);
            const krRow = krSheet.addRow([]);
            krRow.getCell(krH.name).value = 'Revenue';
            krRow.getCell(krH.parent_type).value = 'project';
            krRow.getCell(krH.parent).value = 'Site';
            krRow.getCell(krH.target_value).value = 10000;

            const recSheet = sheet(wb, 'Records');
            const recH = headerMap(recSheet);
            const recRow = recSheet.addRow([]);
            recRow.getCell(recH.title).value = 'First sale';
            recRow.getCell(recH.parent_type).value = 'project';
            recRow.getCell(recH.parent).value = 'Site';
            recRow.getCell(recH.record_date).value = '2026-01-15';
            recRow.getCell(recH.amount).value = 500;
            recRow.getCell(recH.counts_toward_kr).value = 'Revenue';

            const result = await service.commit({
                userId: user.id,
                file: fakeFile(await toBuffer(wb)),
                format: 'xlsx',
                scopes: 'all',
            });
            expect(result.resources.goalshq_key_results.created).toBe(1);
            expect(result.resources.goalshq_records.created).toBe(1);

            const kr = await GoalshqKeyResult.findOne({
                where: { name: 'Revenue', user_id: user.id },
            });

            // Re-export the whole workbook and diff it back in: everything,
            // including the cross-sheet KR link, must be a no-op.
            const reExported = await service.exportData({
                userId: user.id,
                format: 'xlsx',
                scopes: 'all',
            });
            const again = await service.commit({
                userId: user.id,
                file: fakeFile(reExported.body),
                format: 'xlsx',
                scopes: 'all',
            });
            expect(again.totals.created).toBe(0);
            expect(again.totals.updated).toBe(0);
            expect(
                again.resources.goalshq_records.unchanged
            ).toBeGreaterThanOrEqual(1);

            const record = await GoalshqRecord.findOne({
                where: { title: 'First sale', user_id: user.id },
            });
            expect(record.counts_toward_kr_id).toBe(kr.id);
            expect(record.amount).toBe(500);
        });
    });
});
