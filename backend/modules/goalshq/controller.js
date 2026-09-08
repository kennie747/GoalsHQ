'use strict';

const service = require('./service');
const { getAuthenticatedUserId } = require('../../utils/request-utils');
const errors = require('../../shared/errors');

const { UnauthorizedError, NotFoundError } = errors;

function requireUserId(req) {
    const userId = getAuthenticatedUserId(req);
    if (!userId) throw new UnauthorizedError('Authentication required');
    return userId;
}

function ensureEnabled() {
    if (!service.isEnabled()) {
        throw new NotFoundError('GoalsHQ is disabled');
    }
}

const controller = {
    async listGoals(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const goals = await service.listGoals(userId);
            res.json({ goals });
        } catch (err) {
            next(err);
        }
    },

    async getGoal(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const goal = await service.getGoalDetail(userId, req.params.uid);
            res.json({ goal });
        } catch (err) {
            next(err);
        }
    },

    async updateGoalSettings(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const settings = await service.updateGoalSettings(
                userId,
                req.params.uid,
                req.body || {}
            );
            res.json({ settings });
        } catch (err) {
            next(err);
        }
    },

    async getProject(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const project = await service.getProjectDetail(
                userId,
                req.params.uid
            );
            res.json({ project });
        } catch (err) {
            next(err);
        }
    },

    async updateProjectSettings(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const settings = await service.updateProjectSettings(
                userId,
                req.params.uid,
                req.body || {}
            );
            res.json({ settings });
        } catch (err) {
            next(err);
        }
    },

    async listStrategies(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const strategies = await service.listStrategies(
                userId,
                req.params.uid
            );
            res.json({ strategies });
        } catch (err) {
            next(err);
        }
    },

    async listAllStrategies(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const strategies = await service.listAllStrategies(userId);
            res.json({ strategies });
        } catch (err) {
            next(err);
        }
    },

    async createStrategy(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const strategy = await service.createStrategy(
                userId,
                req.body || {}
            );
            res.status(201).json({ strategy });
        } catch (err) {
            next(err);
        }
    },

    // POST /goalshq/goals/:uid/strategies — alias that pins the goal.
    async createStrategyForGoal(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const strategy = await service.createStrategy(userId, {
                ...(req.body || {}),
                goal_uid: req.params.uid,
            });
            res.status(201).json({ strategy });
        } catch (err) {
            next(err);
        }
    },

    async setStrategyProjects(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const strategy = await service.setStrategyProjects(
                userId,
                req.params.uid,
                req.body || {}
            );
            res.json({ strategy });
        } catch (err) {
            next(err);
        }
    },

    async setProjectStrategies(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const result = await service.setProjectStrategies(
                userId,
                req.params.uid,
                req.body || {}
            );
            res.json(result);
        } catch (err) {
            next(err);
        }
    },

    async getStrategy(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const strategy = await service.getStrategy(userId, req.params.uid);
            res.json({ strategy });
        } catch (err) {
            next(err);
        }
    },

    async updateStrategy(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const strategy = await service.updateStrategy(
                userId,
                req.params.uid,
                req.body || {}
            );
            res.json({ strategy });
        } catch (err) {
            next(err);
        }
    },

    async deleteStrategy(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            await service.deleteStrategy(userId, req.params.uid);
            res.status(204).send();
        } catch (err) {
            next(err);
        }
    },

    async linkProject(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const strategy = await service.linkProject(
                userId,
                req.params.uid,
                req.body || {}
            );
            res.json({ strategy });
        } catch (err) {
            next(err);
        }
    },

    async unlinkProject(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const projectUid = req.params.projectUid || req.body.project_uid;
            const strategy = await service.unlinkProject(
                userId,
                req.params.uid,
                projectUid
            );
            res.json({ strategy });
        } catch (err) {
            next(err);
        }
    },

    async listKeyResults(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const key_results = await service.listKeyResults(
                userId,
                req.params.parentType,
                req.params.uid
            );
            res.json({ key_results });
        } catch (err) {
            next(err);
        }
    },

    async createKeyResult(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const key_result = await service.createKeyResult(
                userId,
                req.params.parentType,
                req.params.uid,
                req.body || {}
            );
            res.status(201).json({ key_result });
        } catch (err) {
            next(err);
        }
    },

    async updateKeyResult(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const key_result = await service.updateKeyResult(
                userId,
                req.params.uid,
                req.body || {}
            );
            res.json({ key_result });
        } catch (err) {
            next(err);
        }
    },

    async deleteKeyResult(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            await service.deleteKeyResult(userId, req.params.uid);
            res.status(204).send();
        } catch (err) {
            next(err);
        }
    },

    async listMilestones(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const milestones = await service.listMilestones(
                userId,
                req.params.parentType,
                req.params.uid
            );
            res.json({ milestones });
        } catch (err) {
            next(err);
        }
    },

    async createMilestone(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const milestone = await service.createMilestone(
                userId,
                req.params.parentType,
                req.params.uid,
                req.body || {}
            );
            res.status(201).json({ milestone });
        } catch (err) {
            next(err);
        }
    },

    async updateMilestone(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const milestone = await service.updateMilestone(
                userId,
                req.params.uid,
                req.body || {}
            );
            res.json({ milestone });
        } catch (err) {
            next(err);
        }
    },

    async deleteMilestone(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            await service.deleteMilestone(userId, req.params.uid);
            res.status(204).send();
        } catch (err) {
            next(err);
        }
    },

    async expandMilestone(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const task = await service.expandMilestone(userId, req.params.uid);
            res.status(201).json({ task });
        } catch (err) {
            next(err);
        }
    },

    async recomputeGoal(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const goal = await service.recomputeGoal(userId, req.params.uid);
            res.json({ goal });
        } catch (err) {
            next(err);
        }
    },

    async recomputeStrategy(req, res, next) {
        try {
            ensureEnabled();
            const userId = requireUserId(req);
            const strategy = await service.recomputeStrategy(
                userId,
                req.params.uid
            );
            res.json({ strategy });
        } catch (err) {
            next(err);
        }
    },
};

module.exports = controller;
