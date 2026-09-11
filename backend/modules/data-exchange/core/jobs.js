'use strict';

const { DataExchangeJob } = require('../../../models');
const { logError } = require('../../../services/logService');

/**
 * Best-effort history logging for exports and (successful or failed) import
 * commits — see docs/16-data-exchange.md. Previews are never logged: they are
 * read-only and disposable by design. A logging failure must never break the
 * export/import it is describing.
 */
async function record({
    userId,
    direction,
    format,
    scopes,
    mode = null,
    filename = null,
    status = 'success',
    stats = null,
    errorMessage = null,
}) {
    try {
        await DataExchangeJob.create({
            user_id: userId,
            direction,
            format,
            scopes,
            mode,
            filename,
            status,
            stats,
            error_message: errorMessage,
        });
    } catch (err) {
        logError('Failed to record data-exchange job history:', err);
    }
}

async function list(userId, limit = 20) {
    return DataExchangeJob.findAll({
        where: { user_id: userId },
        order: [['created_at', 'DESC']],
        limit,
    });
}

module.exports = { record, list };
