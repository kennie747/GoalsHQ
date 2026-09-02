'use strict';

// Registering the models on tududi's shared Sequelize instance is a require-time
// side effect so `sequelize.sync()` (tests) and a running server both see the
// goalshq_* tables.
require('./models');

const routes = require('./routes');
const service = require('./service');
const repository = require('./repository');
const scheduler = require('./scheduler');

module.exports = { routes, service, repository, scheduler };
