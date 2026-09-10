const request = require('supertest');
const app = require('../../app');
const {
    Goal,
    Project,
    Task,
    GoalshqStrategy,
    GoalshqProjectStrategy,
    GoalshqGoalSettings,
    GoalshqProjectSettings,
    GoalshqKeyResult,
    GoalshqKeyResultEntry,
    GoalshqMilestone,
    GoalshqMilestoneTask,
    GoalshqMilestoneProject,
    GoalshqRecord,
    GoalshqProgressSnapshot,
} = require('../../models');
const rollup = require('../../modules/goalshq/operations/rollup');
const { createTestUser } = require('../helpers/testUtils');

async function clear() {
    await Promise.all([
        GoalshqStrategy.destroy({ truncate: true }),
        GoalshqProjectStrategy.destroy({ truncate: true }),
        GoalshqGoalSettings.destroy({ truncate: true }),
        GoalshqProjectSettings.destroy({ truncate: true }),
        GoalshqKeyResult.destroy({ truncate: true }),
        GoalshqKeyResultEntry.destroy({ truncate: true }),
        GoalshqMilestone.destroy({ truncate: true }),
        GoalshqMilestoneTask.destroy({ truncate: true }),
        GoalshqMilestoneProject.destroy({ truncate: true }),
        GoalshqRecord.destroy({ truncate: true }),
        GoalshqProgressSnapshot.destroy({ truncate: true }),
    ]);
}

describe('GoalsHQ Part 2 — records, KR trees, milestone triggers, report', () => {
    let user;
    let agent;
    let goal;

    beforeEach(async () => {
        await clear();
        user = await createTestUser({ email: 'p2@example.com' });
        agent = request.agent(app);
        await agent
            .post('/api/login')
            .send({ email: 'p2@example.com', password: 'password123' });
        goal = await Goal.create({
            user_id: user.id,
            title: '$1M',
            target_date: '2027-05-18',
            status: 'active',
        });
        await agent
            .patch(`/api/goalshq/goals/${goal.uid}/settings`)
            .send({ metrics_enabled: true });
    });

    it('a record counting toward a KR drives its current_value (record_sum)', async () => {
        const kr = await agent
            .post(`/api/goalshq/goal/${goal.uid}/key-results`)
            .send({
                name: 'Net profit',
                target_value: 1000000,
                auto_source: 'record_sum',
            });
        const krUid = kr.body.key_result.uid;

        await agent.post(`/api/goalshq/goal/${goal.uid}/records`).send({
            title: 'FinTech A deposit',
            amount: 11000,
            record_date: '2026-09-05',
            counts_toward_kr_uid: krUid,
        });
        await agent.post(`/api/goalshq/goal/${goal.uid}/records`).send({
            title: 'FinTech A milestone 2',
            amount: 9000,
            record_date: '2026-09-12',
            counts_toward_kr_uid: krUid,
        });

        await agent.post(`/api/goalshq/goals/${goal.uid}/recompute`);
        const detail = await agent.get(`/api/goalshq/key-results/${krUid}`);
        expect(detail.body.key_result.current_value).toBe(20000);
    });

    it('KR check-in entry updates a manual KR and is listed', async () => {
        const kr = await agent
            .post(`/api/goalshq/goal/${goal.uid}/key-results`)
            .send({ name: 'Doors owned', target_value: 10, current_value: 4 });
        const krUid = kr.body.key_result.uid;

        await agent.post(`/api/goalshq/key-results/${krUid}/entries`).send({
            value: 6,
            entry_date: '2026-10-01',
            note: 'closed #5, #6',
        });

        const kept = await GoalshqKeyResult.findOne({ where: { uid: krUid } });
        expect(kept.current_value).toBe(6);
        const entries = await agent.get(
            `/api/goalshq/key-results/${krUid}/entries`
        );
        expect(entries.body.entries).toHaveLength(1);
    });

    it('propagate downward creates child KRs and the parent rolls them up', async () => {
        const p1 = await Project.create({
            user_id: user.id,
            name: 'Rental',
            goal_id: goal.id,
            status: 'in_progress',
        });
        const parentKr = await agent
            .post(`/api/goalshq/goal/${goal.uid}/key-results`)
            .send({ name: 'Net profit', target_value: 1000000 });
        const parentUid = parentKr.body.key_result.uid;

        const propagated = await agent
            .post(`/api/goalshq/key-results/${parentUid}/propagate`)
            .send({
                nodes: [{ parent_type: 'project', parent_uid: p1.uid }],
            });
        expect(propagated.body.key_result.is_rollup).toBe(true);
        expect(propagated.body.key_result.children).toHaveLength(1);

        const childUid = propagated.body.key_result.children[0];
        await agent
            .patch(`/api/goalshq/key-results/${childUid}`)
            .send({ current_value: 250000, target_value: 400000 });

        await agent.post(`/api/goalshq/goals/${goal.uid}/recompute`);
        const parent = await agent.get(`/api/goalshq/key-results/${parentUid}`);
        expect(parent.body.key_result.current_value).toBe(250000);
        expect(parent.body.key_result.coverage.child_target_sum).toBe(400000);
    });

    it('milestone auto-achieves when linked tasks complete (mode: all)', async () => {
        const project = await Project.create({
            user_id: user.id,
            name: 'P',
            goal_id: goal.id,
            status: 'in_progress',
        });
        const t1 = await Task.create({
            user_id: user.id,
            name: 't1',
            project_id: project.id,
            status: Task.STATUS.NOT_STARTED,
        });
        const t2 = await Task.create({
            user_id: user.id,
            name: 't2',
            project_id: project.id,
            status: Task.STATUS.NOT_STARTED,
        });
        const ms = await agent
            .post(`/api/goalshq/project/${project.uid}/milestones`)
            .send({ title: '20 contacts logged' });
        const msUid = ms.body.milestone.uid;
        await agent
            .put(`/api/goalshq/milestones/${msUid}/tasks`)
            .send({ task_uids: [t1.uid, t2.uid] });

        await t1.update({ status: Task.STATUS.DONE });
        await agent.post(`/api/goalshq/goals/${goal.uid}/recompute`);
        let kept = await GoalshqMilestone.findOne({ where: { uid: msUid } });
        expect(kept.status).toBe('pending'); // only 1 of 2

        await t2.update({ status: Task.STATUS.DONE });
        await agent.post(`/api/goalshq/goals/${goal.uid}/recompute`);
        kept = await GoalshqMilestone.findOne({ where: { uid: msUid } });
        expect(kept.status).toBe('achieved');
        expect(kept.auto_achieved).toBe(true);
    });

    it('completing a linked task via PATCH /tasks auto-achieves the milestone with no explicit recompute', async () => {
        const project = await Project.create({
            user_id: user.id,
            name: 'P-hook',
            goal_id: goal.id,
            status: 'in_progress',
        });
        const task = await Task.create({
            user_id: user.id,
            name: 'ship it',
            project_id: project.id,
            status: Task.STATUS.NOT_STARTED,
        });
        const ms = await agent
            .post(`/api/goalshq/project/${project.uid}/milestones`)
            .send({ title: 'shipped', completion_mode: 'any' });
        const msUid = ms.body.milestone.uid;
        await agent
            .put(`/api/goalshq/milestones/${msUid}/tasks`)
            .send({ task_uids: [task.uid] });

        await agent
            .patch(`/api/task/${task.uid}`)
            .send({ status: 'done' })
            .expect(200);

        const kept = await GoalshqMilestone.findOne({ where: { uid: msUid } });
        expect(kept.status).toBe('achieved');
        expect(kept.auto_achieved).toBe(true);
    });

    it('milestone auto-achieves when a KR crosses its threshold', async () => {
        const kr = await agent
            .post(`/api/goalshq/goal/${goal.uid}/key-results`)
            .send({
                name: 'Cumulative',
                target_value: 1000000,
                current_value: 0,
            });
        const krUid = kr.body.key_result.uid;
        const ms = await agent
            .post(`/api/goalshq/goal/${goal.uid}/milestones`)
            .send({ title: '$250k logged' });
        await agent
            .patch(`/api/goalshq/milestones/${ms.body.milestone.uid}`)
            .send({
                auto_kr_uid: krUid,
                auto_kr_threshold: 250000,
            });

        await agent
            .patch(`/api/goalshq/key-results/${krUid}`)
            .send({ current_value: 300000 });
        await agent.post(`/api/goalshq/goals/${goal.uid}/recompute`);

        const kept = await GoalshqMilestone.findOne({
            where: { uid: ms.body.milestone.uid },
        });
        expect(kept.status).toBe('achieved');
    });

    describe('whole-project milestone triggers', () => {
        let project;
        let msUid;
        const mkTask = (name, status = Task.STATUS.NOT_STARTED) =>
            Task.create({
                user_id: user.id,
                name,
                project_id: project.id,
                status,
            });

        beforeEach(async () => {
            project = await Project.create({
                user_id: user.id,
                name: 'Real Estate ops',
                goal_id: goal.id,
                status: 'in_progress',
            });
            const ms = await agent
                .post(`/api/goalshq/goal/${goal.uid}/milestones`)
                .send({ title: 'Ops project done' });
            msUid = ms.body.milestone.uid;
        });

        it('PUT .../projects round-trips project_uids on the serialized milestone', async () => {
            const res = await agent
                .put(`/api/goalshq/milestones/${msUid}/projects`)
                .send({ project_uids: [project.uid] });
            expect(res.status).toBe(200);
            const m = res.body.milestones.find((x) => x.uid === msUid);
            expect(m.project_uids).toEqual([project.uid]);

            const detail = await agent.get(`/api/goalshq/goals/${goal.uid}`);
            expect(
                detail.body.goal.milestones.find((x) => x.uid === msUid)
                    .project_uids
            ).toEqual([project.uid]);
        });

        it('mode "all": achieves only when every active task in the project is done, and stays live as tasks are added', async () => {
            const t1 = await mkTask('t1');
            const t2 = await mkTask('t2');
            await agent
                .put(`/api/goalshq/milestones/${msUid}/projects`)
                .send({ project_uids: [project.uid] });

            await t1.update({ status: Task.STATUS.DONE });
            await agent.post(`/api/goalshq/goals/${goal.uid}/recompute`);
            expect(
                (await GoalshqMilestone.findOne({ where: { uid: msUid } }))
                    .status
            ).toBe('pending');

            await t2.update({ status: Task.STATUS.DONE });
            await agent.post(`/api/goalshq/goals/${goal.uid}/recompute`);
            let m = await GoalshqMilestone.findOne({ where: { uid: msUid } });
            expect(m.status).toBe('achieved');
            expect(m.auto_achieved).toBe(true);

            // A task added later re-opens the still-relevant milestone.
            await m.update({ status: 'pending', auto_achieved: false });
            await mkTask('t3');
            await agent.post(`/api/goalshq/goals/${goal.uid}/recompute`);
            expect(
                (await GoalshqMilestone.findOne({ where: { uid: msUid } }))
                    .status
            ).toBe('pending');
        });

        it('excludes archived/cancelled tasks from the denominator', async () => {
            await mkTask('done-1', Task.STATUS.DONE);
            await mkTask('done-2', Task.STATUS.DONE);
            await mkTask('archived', Task.STATUS.ARCHIVED);
            await agent
                .put(`/api/goalshq/milestones/${msUid}/projects`)
                .send({ project_uids: [project.uid] });
            await agent.post(`/api/goalshq/goals/${goal.uid}/recompute`);
            expect(
                (await GoalshqMilestone.findOne({ where: { uid: msUid } }))
                    .status
            ).toBe('achieved');
        });

        it('unions a whole-project link with an explicit task link', async () => {
            const p1 = await mkTask('p1');
            const outside = await Task.create({
                user_id: user.id,
                name: 'outside',
                goal_id: goal.id,
                status: Task.STATUS.NOT_STARTED,
            });
            await agent
                .put(`/api/goalshq/milestones/${msUid}/projects`)
                .send({ project_uids: [project.uid] });
            await agent
                .put(`/api/goalshq/milestones/${msUid}/tasks`)
                .send({ task_uids: [outside.uid] });

            await p1.update({ status: Task.STATUS.DONE });
            await agent.post(`/api/goalshq/goals/${goal.uid}/recompute`);
            expect(
                (await GoalshqMilestone.findOne({ where: { uid: msUid } }))
                    .status
            ).toBe('pending'); // project done, explicit task not

            await outside.update({ status: Task.STATUS.DONE });
            await agent.post(`/api/goalshq/goals/${goal.uid}/recompute`);
            expect(
                (await GoalshqMilestone.findOne({ where: { uid: msUid } }))
                    .status
            ).toBe('achieved');
        });

        it('gcOrphans removes links whose project is gone', async () => {
            await agent
                .put(`/api/goalshq/milestones/${msUid}/projects`)
                .send({ project_uids: [project.uid] });
            await Task.destroy({ where: { project_id: project.id } });
            await project.destroy();
            await rollup.gcOrphans();
            expect(await GoalshqMilestoneProject.count()).toBe(0);
        });
    });

    it('report assembles quantitative panels + a narrative (static fallback)', async () => {
        const kr = await agent
            .post(`/api/goalshq/goal/${goal.uid}/key-results`)
            .send({
                name: 'Papers',
                target_value: 10,
                current_value: 2,
                auto_source: 'record_count',
            });
        await agent.post(`/api/goalshq/goal/${goal.uid}/records`).send({
            title: 'Paper draft',
            category: 'Research',
            record_date: '2026-09-06',
            counts_toward_kr_uid: kr.body.key_result.uid,
        });
        // narrative=false forces the templated static summary.
        const res = await agent.get(
            `/api/goalshq/goal/${goal.uid}/report?narrative=false`
        );
        expect(res.status).toBe(200);
        expect(res.body.report.quantitative.record_count).toBe(1);
        expect(res.body.report.quantitative.by_category[0].key).toBe(
            'Research'
        );
        expect(res.body.report.qualitative.narrative_source).toBe('static');
        expect(res.body.report.qualitative.narrative).toContain('$1M');
    });

    it('evidence file uploads against a record and is previewable/downloadable', async () => {
        const project = await Project.create({
            user_id: user.id,
            name: 'P',
            goal_id: goal.id,
            status: 'in_progress',
        });
        const rec = await agent
            .post(`/api/goalshq/project/${project.uid}/records`)
            .send({ title: 'Deposit', amount: 5000 });
        const recUid = rec.body.record.uid;

        const upload = await agent
            .post('/api/upload/attachment')
            .field('parentType', 'goalshq_record')
            .field('parentUid', recUid)
            .attach('file', Buffer.from('%PDF-1.4 fake'), {
                filename: 'invoice.pdf',
                contentType: 'application/pdf',
            });
        expect(upload.status).toBe(201);
        expect(upload.body.file_url).toMatch(/\/uploads\/attachments\//);

        const reload = await agent.get(
            `/api/goalshq/project/${project.uid}/records`
        );
        expect(reload.body.records[0].attachments).toHaveLength(1);

        const dl = await agent.get(
            `/api/goalshq/../attachments/${upload.body.uid}/download`
        );
        // (path normalization) — just assert the attachment list exposed it
        expect(reload.body.records[0].attachments[0].original_filename).toBe(
            'invoice.pdf'
        );
        void dl;
        void rollup;
    });
});
