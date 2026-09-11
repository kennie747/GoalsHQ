'use strict';

const service = require('./service');
const { logError } = require('../../services/logService');
const { getAuthenticatedUserId } = require('../../utils/request-utils');

function requireUser(req, res) {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
        res.status(401).json({ error: 'Authentication required' });
        return null;
    }
    return userId;
}

function sendFile(res, result) {
    res.setHeader('Content-Type', result.contentType);
    res.setHeader(
        'Content-Disposition',
        `attachment; filename="${result.filename}"`
    );
    res.setHeader('Content-Length', result.body.length);
    res.send(result.body);
}

function handleError(res, error, action) {
    const status = error.statusCode || 500;
    if (status >= 500) logError(`Data exchange: ${action}`, error);
    res.status(status).json({ error: error.message });
}

const controller = {
    describe(req, res) {
        res.json(service.describe());
    },

    async template(req, res) {
        const userId = requireUser(req, res);
        if (!userId) return;
        try {
            const result = await service.generateTemplate({
                userId,
                format: req.query.format || 'xlsx',
                scopes: req.query.scopes,
                populate: req.query.populate === 'true',
            });
            sendFile(res, result);
        } catch (error) {
            handleError(res, error, 'template');
        }
    },

    async export(req, res) {
        const userId = requireUser(req, res);
        if (!userId) return;
        try {
            const result = await service.exportData({
                userId,
                format: req.query.format || 'xlsx',
                scopes: req.query.scopes,
            });
            sendFile(res, result);
        } catch (error) {
            handleError(res, error, 'export');
        }
    },

    async preview(req, res) {
        const userId = requireUser(req, res);
        if (!userId) return;
        try {
            const result = await service.preview({
                userId,
                file: req.file,
                format: req.body.format || 'xlsx',
                scopes: req.body.scopes,
                options: req.body,
            });
            res.json(result);
        } catch (error) {
            handleError(res, error, 'preview');
        }
    },

    async commit(req, res) {
        const userId = requireUser(req, res);
        if (!userId) return;
        try {
            const result = await service.commit({
                userId,
                file: req.file,
                format: req.body.format || 'xlsx',
                scopes: req.body.scopes,
                options: req.body,
            });
            res.json(result);
        } catch (error) {
            handleError(res, error, 'commit');
        }
    },

    async jobs(req, res) {
        const userId = requireUser(req, res);
        if (!userId) return;
        try {
            const limit = req.query.limit ? Number(req.query.limit) : 20;
            const rows = await service.listJobs(userId, limit);
            res.json({ jobs: rows });
        } catch (error) {
            handleError(res, error, 'jobs');
        }
    },
};

module.exports = controller;
