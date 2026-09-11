'use strict';

const service = require('./service');
const { serializeCarryoverEvent } = require('./serializers');

const controller = {
    async listPending(req, res, next) {
        try {
            const events = await service.listPending(req.currentUser.id);
            res.json({ events: events.map(serializeCarryoverEvent) });
        } catch (err) {
            next(err);
        }
    },

    async listHistory(req, res, next) {
        try {
            const events = await service.listHistory(req.currentUser.id);
            res.json({ events: events.map(serializeCarryoverEvent) });
        } catch (err) {
            next(err);
        }
    },

    async accept(req, res, next) {
        try {
            const event = await service.accept(
                req.currentUser.id,
                req.params.id
            );
            res.json({ event: serializeCarryoverEvent(event) });
        } catch (err) {
            next(err);
        }
    },

    async override(req, res, next) {
        try {
            const event = await service.override(
                req.currentUser.id,
                req.params.id,
                req.body || {}
            );
            res.json({ event: serializeCarryoverEvent(event) });
        } catch (err) {
            next(err);
        }
    },
};

module.exports = controller;
