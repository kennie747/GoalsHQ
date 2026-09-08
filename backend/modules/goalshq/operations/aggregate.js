'use strict';

/**
 * Record → Key Result aggregation. One batched GROUP BY per goal — never a
 * per-KR query.
 */

const { Op, fn, col } = require('sequelize');
const { GoalshqRecord } = require('../../../models');

/**
 * For the given KR ids, return Map<krId, { sum:number, count:number }> over all
 * records whose `counts_toward_kr_id` points at them.
 */
async function recordTotalsByKr(krIds) {
    if (!krIds || krIds.length === 0) return new Map();
    const rows = await GoalshqRecord.findAll({
        where: { counts_toward_kr_id: { [Op.in]: krIds } },
        attributes: [
            'counts_toward_kr_id',
            [fn('COALESCE', fn('SUM', col('amount')), 0), 'sum'],
            [fn('COUNT', col('id')), 'count'],
        ],
        group: ['counts_toward_kr_id'],
        raw: true,
    });
    const map = new Map();
    for (const r of rows) {
        map.set(Number(r.counts_toward_kr_id), {
            sum: Number(r.sum) || 0,
            count: Number(r.count) || 0,
        });
    }
    return map;
}

/**
 * Cumulative amount + count for a set of records grouped by a column
 * ('category' | 'status'), for the report breakdowns.
 */
async function recordBreakdown(parentType, parentId, by) {
    const rows = await GoalshqRecord.findAll({
        where: { parent_type: parentType, parent_id: parentId },
        attributes: [
            by,
            [fn('COALESCE', fn('SUM', col('amount')), 0), 'sum'],
            [fn('COUNT', col('id')), 'count'],
        ],
        group: [by],
        raw: true,
    });
    return rows.map((r) => ({
        key: r[by] || '—',
        sum: Number(r.sum) || 0,
        count: Number(r.count) || 0,
    }));
}

module.exports = { recordTotalsByKr, recordBreakdown };
