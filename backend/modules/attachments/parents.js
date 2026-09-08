'use strict';

const {
    Task,
    GoalshqRecord,
    GoalshqStrategy,
    Project,
} = require('../../models');
const permissionsService = require('../../services/permissionsService');

const LEVELS = { none: 0, ro: 1, rw: 2, admin: 3 };

async function taskAccess(userId, taskUid, need) {
    const access = await permissionsService.getAccess(userId, 'task', taskUid);
    return LEVELS[access] >= LEVELS[need];
}

/**
 * Resolve a polymorphic attachment parent + its access check.
 * @returns {{ id:number, type:string, canRead:Function, canWrite:Function }|null}
 */
async function resolveParent(parentType, parentUid, userId) {
    if (parentType === 'task') {
        const task = await Task.findOne({ where: { uid: parentUid } });
        if (!task) return null;
        return {
            id: task.id,
            type: 'task',
            canRead: () => taskAccess(userId, parentUid, 'ro'),
            canWrite: () => taskAccess(userId, parentUid, 'rw'),
        };
    }

    if (parentType === 'goalshq_record') {
        const record = await GoalshqRecord.findOne({
            where: { uid: parentUid },
        });
        if (!record) return null;
        // A record inherits access from its own parent entity.
        const check = async (need) => {
            if (record.user_id === userId) return true;
            if (record.parent_type === 'project') {
                const project = await Project.findByPk(record.parent_id);
                if (!project) return false;
                const access = await permissionsService.getAccess(
                    userId,
                    'project',
                    project.uid
                );
                return LEVELS[access] >= LEVELS[need];
            }
            if (record.parent_type === 'strategy') {
                const strat = await GoalshqStrategy.findByPk(record.parent_id);
                return !!strat && strat.user_id === userId;
            }
            // goal
            return false;
        };
        return {
            id: record.id,
            type: 'goalshq_record',
            canRead: () => check('ro'),
            canWrite: () => check('rw'),
        };
    }

    return null;
}

/** Map a stored file back to its parent, for uploadsAccess middleware. */
async function resolveByStoredFilename(storedFilename) {
    const { Attachment } = require('../../models');
    return Attachment.findOne({ where: { stored_filename: storedFilename } });
}

module.exports = { resolveParent, resolveByStoredFilename, LEVELS };
