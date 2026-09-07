'use strict';

function serializeCarryoverEvent(event) {
    const task = event.Task;
    return {
        id: event.id,
        task_uid: task ? task.uid : null,
        task_name: task ? task.name : null,
        occurred_on: event.occurred_on,
        classification: event.classification,
        previous_due_date: event.previous_due_date,
        new_due_date: event.new_due_date,
        source: event.source,
        reviewed_at: event.reviewed_at,
    };
}

module.exports = { serializeCarryoverEvent };
