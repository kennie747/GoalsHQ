'use strict';

// GoalsHQ models are registered directly in backend/models/index.js alongside
// core models (see docs/goalshq/adr/0002-first-class-integration.md).

const routes = require('./routes');
const service = require('./service');
const repository = require('./repository');
const scheduler = require('./scheduler');

module.exports = { routes, service, repository, scheduler };
