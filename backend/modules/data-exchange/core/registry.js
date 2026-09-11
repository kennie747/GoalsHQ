'use strict';

/**
 * The resource registry is the single source of truth for the Data Exchange
 * feature. Each descriptor declares how one entity is turned into spreadsheet
 * rows and back. Adding a new entity to import/export = adding one descriptor
 * here; the engine (export.js / plan.js / apply.js) is entity-agnostic.
 */

const {
    Area,
    Goal,
    Project,
    Task,
    Tag,
    Note,
    InboxItem,
    GoalshqStrategy,
    GoalshqKeyResult,
    GoalshqKeyResultEntry,
    GoalshqMilestone,
    GoalshqRecord,
} = require('../../../models');
const C = require('./columns');

// GoalsHQ ships enabled by default and can be turned off entirely
// (GOALSHQ_ENABLED=false); when it is, its sheets simply aren't offered.
const GOALSHQ_ENABLED = process.env.GOALSHQ_ENABLED !== 'false';

const PRIORITY_VALUES = ['low', 'medium', 'high'];
const TASK_STATUS_VALUES = [
    'not_started',
    'in_progress',
    'done',
    'archived',
    'waiting',
    'cancelled',
    'planned',
];
const PROJECT_STATUS_VALUES = [
    'not_started',
    'in_progress',
    'done',
    'waiting',
    'cancelled',
    'planned',
];
const GOAL_STATUS_VALUES = ['active', 'achieved', 'paused', 'dropped'];
const GOAL_HORIZON_VALUES = ['season', 'year'];
const INBOX_STATUS_VALUES = ['added', 'processed', 'trashed', 'deleted'];

const STRATEGY_STATUS_VALUES = ['active', 'paused', 'achieved', 'dropped'];
const KR_DIRECTION_VALUES = ['increase', 'decrease', 'maintain'];
const KR_AUTO_SOURCE_VALUES = [
    'manual',
    'tasks_done_count',
    'record_sum',
    'record_count',
    'child_kr_sum',
];
const MILESTONE_STATUS_VALUES = ['pending', 'achieved', 'missed'];
const MILESTONE_COMPLETION_MODE_VALUES = ['all', 'any'];

// Polymorphic parent_type -> resource key, per GoalsHQ table. A KeyResult may
// also be task-parented (informational only, never rolled up); Milestones and
// Records are deliberately not extended to Task (see the model docstrings).
const KR_PARENT_RESOURCES = {
    goal: 'goals',
    strategy: 'goalshq_strategies',
    project: 'projects',
    task: 'tasks',
};
const GOAL_STRATEGY_PROJECT_RESOURCES = {
    goal: 'goals',
    strategy: 'goalshq_strategies',
    project: 'projects',
};
const polyResource = (map) => (cells) =>
    map[
        String(cells.parent_type || '')
            .trim()
            .toLowerCase()
    ];

/* ------------------------------------------------------------------ *
 * Column builders                                                     *
 * ------------------------------------------------------------------ */

const col = {
    identity() {
        return {
            header: 'uid',
            field: 'uid',
            kind: 'string',
            identity: true,
            note: 'Leave blank to create a new row. Do not edit an existing value.',
            toCell: (row) => C.toStringCell(row.uid),
            fromCell: (v) => C.fromStringCell(v),
        };
    },
    string(header, field, { required = false, defaultValue = null } = {}) {
        return {
            header,
            field,
            kind: 'string',
            required,
            toCell: (row) => C.toStringCell(row[field]),
            fromCell: (v) => C.fromStringCell(v) ?? defaultValue,
        };
    },
    text(header, field, { required = false } = {}) {
        return {
            header,
            field,
            kind: 'text',
            required,
            toCell: (row) => C.toStringCell(row[field]),
            fromCell: (v) => C.fromTextCell(v),
        };
    },
    bool(header, field) {
        return {
            header,
            field,
            kind: 'boolean',
            enumValues: ['yes', 'no'],
            toCell: (row) => C.toBoolCell(row[field]),
            fromCell: (v) => C.fromBoolCell(v),
        };
    },
    dateOnly(header, field, { required = false } = {}) {
        return {
            header,
            field,
            kind: 'dateonly',
            required,
            toCell: (row) => C.toDateOnlyCell(row[field]),
            fromCell: (v) => C.fromDateOnlyCell(v),
        };
    },
    dateTime(header, field) {
        return {
            header,
            field,
            kind: 'datetime',
            toCell: (row) => C.toDateTimeCell(row[field]),
            fromCell: (v) => C.fromDateTimeCell(v),
        };
    },
    /** value stored in DB, label shown in sheet are identical strings */
    enumStr(
        header,
        field,
        values,
        { required = false, defaultValue = null } = {}
    ) {
        return {
            header,
            field,
            kind: 'enum',
            required,
            enumValues: values,
            toCell: (row) => C.toStringCell(row[field]),
            fromCell: (v) => {
                const s = C.fromStringCell(v);
                if (s === null) return defaultValue;
                if (!values.includes(s)) {
                    throw new Error(
                        `expected one of ${values.join(' / ')}, got "${v}"`
                    );
                }
                return s;
            },
        };
    },
    float(header, field, { required = false } = {}) {
        return {
            header,
            field,
            kind: 'number',
            required,
            toCell: (row) => C.toFloatCell(row[field]),
            fromCell: (v) => C.fromFloatCell(v),
        };
    },
    /** DB stores an integer, sheet shows a label from `names` (index = value) */
    enumInt(header, field, names, { nullable = true } = {}) {
        return {
            header,
            field,
            kind: 'enum',
            enumValues: names,
            toCell: (row) => {
                const val = row[field];
                if (val === null || val === undefined) return '';
                return names[val] ?? '';
            },
            fromCell: (v) => {
                const s = C.fromStringCell(v);
                if (s === null) return nullable ? null : 0;
                const idx = names.indexOf(s);
                if (idx === -1) {
                    throw new Error(
                        `expected one of ${names.join(' / ')}, got "${v}"`
                    );
                }
                return idx;
            },
        };
    },
    /**
     * Foreign key: cell holds the parent's name or `uid:<uid>`.
     * `resource` is usually a resource key, but may be a function of the raw
     * sheet cells (e.g. `(cells) => POLY[cells.parent_type]`) for a
     * polymorphic reference whose target depends on a sibling column.
     */
    ref(
        header,
        field,
        resource,
        { self = false, deferred = false, required = false } = {}
    ) {
        const resolveResource = (cells) =>
            typeof resource === 'function' ? resource(cells) : resource;
        return {
            header,
            field,
            kind: 'ref',
            ref: { resource, self },
            deferred,
            required,
            // filled in by export.js (needs the loaded association row)
            toCell: (row) => C.toStringCell(row.__refs && row.__refs[field]),
            fromCell: (v, ctx) => {
                const token = C.fromStringCell(v);
                if (token === null) return null;
                const target = resolveResource(ctx.row ? ctx.row.cells : {});
                if (!target) {
                    throw new Error(
                        'set parent_type to a valid value before parent'
                    );
                }
                return ctx.resolveRef(target, token, header);
            },
        };
    },
    tags() {
        return {
            header: 'tags',
            field: '@tags',
            kind: 'tags',
            note: 'Comma-separated. Unknown tags are created automatically.',
            toCell: (row) => C.toListCell((row.Tags || []).map((t) => t.name)),
            fromCell: (v) => C.fromListCell(v),
        };
    },
};

/* ------------------------------------------------------------------ *
 * GoalsHQ descriptors (only spliced in when the module is enabled)    *
 * ------------------------------------------------------------------ */

const GOALSHQ_RESOURCES = [
    {
        key: 'goalshq_strategies',
        model: GoalshqStrategy,
        sheet: 'Strategies',
        displayKey: 'name',
        dependsOn: ['goals'],
        exportOrder: [['name', 'ASC']],
        naturalKey: (row) => (row.name || '').trim().toLowerCase(),
        columns: [
            col.identity(),
            col.string('name', 'name', { required: true }),
            col.text('description', 'description'),
            col.enumStr('status', 'status', STRATEGY_STATUS_VALUES, {
                defaultValue: 'active',
            }),
            col.ref('goal', 'goal_id', 'goals'),
            col.bool('metrics_editable', 'metrics_editable'),
            col.string('color', 'color'),
        ],
    },
    {
        key: 'goalshq_key_results',
        model: GoalshqKeyResult,
        sheet: 'Key Results',
        displayKey: 'name',
        // Every resource a KR could be parented to, plus itself for the KR
        // tree (parent_key_result).
        dependsOn: ['goals', 'goalshq_strategies', 'projects', 'tasks'],
        exportOrder: [['name', 'ASC']],
        naturalKey: (row) =>
            [
                row.parent_type || '',
                row.parent_id || 0,
                (row.name || '').trim().toLowerCase(),
            ].join('|'),
        columns: [
            col.identity(),
            col.string('name', 'name', { required: true }),
            col.enumStr(
                'parent_type',
                'parent_type',
                Object.keys(KR_PARENT_RESOURCES),
                {
                    required: true,
                }
            ),
            col.ref('parent', 'parent_id', polyResource(KR_PARENT_RESOURCES), {
                required: true,
            }),
            col.string('unit', 'unit'),
            col.enumStr('direction', 'direction', KR_DIRECTION_VALUES, {
                defaultValue: 'increase',
            }),
            col.enumStr('auto_source', 'auto_source', KR_AUTO_SOURCE_VALUES, {
                defaultValue: 'manual',
            }),
            col.ref(
                'parent_key_result',
                'parent_kr_id',
                'goalshq_key_results',
                {
                    self: true,
                    deferred: true,
                }
            ),
            col.float('baseline_value', 'baseline_value'),
            col.float('target_value', 'target_value', { required: true }),
            col.float('current_value', 'current_value'),
        ],
    },
    {
        key: 'goalshq_key_result_entries',
        model: GoalshqKeyResultEntry,
        sheet: 'KR Entries',
        displayKey: 'note',
        dependsOn: ['goalshq_key_results'],
        exportOrder: [['entry_date', 'ASC']],
        naturalKey: (row) =>
            `${row.key_result_id || 0}|${row.entry_date || ''}`,
        columns: [
            col.identity(),
            col.ref('key_result', 'key_result_id', 'goalshq_key_results', {
                required: true,
            }),
            col.dateOnly('entry_date', 'entry_date', { required: true }),
            col.float('value', 'value', { required: true }),
            col.text('note', 'note'),
        ],
    },
    {
        key: 'goalshq_milestones',
        model: GoalshqMilestone,
        sheet: 'Milestones',
        displayKey: 'title',
        dependsOn: ['goals', 'goalshq_strategies', 'projects'],
        exportOrder: [['title', 'ASC']],
        naturalKey: (row) =>
            [
                row.parent_type || '',
                row.parent_id || 0,
                (row.title || '').trim().toLowerCase(),
            ].join('|'),
        columns: [
            col.identity(),
            col.string('title', 'title', { required: true }),
            col.enumStr(
                'parent_type',
                'parent_type',
                Object.keys(GOAL_STRATEGY_PROJECT_RESOURCES),
                { required: true }
            ),
            col.ref(
                'parent',
                'parent_id',
                polyResource(GOAL_STRATEGY_PROJECT_RESOURCES),
                { required: true }
            ),
            col.dateOnly('target_date', 'target_date'),
            col.float('target_value', 'target_value'),
            col.enumStr('status', 'status', MILESTONE_STATUS_VALUES, {
                defaultValue: 'pending',
            }),
            col.enumStr(
                'completion_mode',
                'completion_mode',
                MILESTONE_COMPLETION_MODE_VALUES,
                { defaultValue: 'all' }
            ),
        ],
    },
    {
        key: 'goalshq_records',
        model: GoalshqRecord,
        sheet: 'Records',
        displayKey: 'title',
        dependsOn: [
            'goals',
            'goalshq_strategies',
            'projects',
            'goalshq_key_results',
        ],
        exportOrder: [['record_date', 'ASC']],
        naturalKey: (row) =>
            [
                row.parent_type || '',
                row.parent_id || 0,
                row.record_date || '',
                (row.title || '').trim().toLowerCase(),
            ].join('|'),
        columns: [
            col.identity(),
            col.string('title', 'title', { required: true }),
            col.enumStr(
                'parent_type',
                'parent_type',
                Object.keys(GOAL_STRATEGY_PROJECT_RESOURCES),
                { required: true }
            ),
            col.ref(
                'parent',
                'parent_id',
                polyResource(GOAL_STRATEGY_PROJECT_RESOURCES),
                { required: true }
            ),
            col.dateOnly('record_date', 'record_date', { required: true }),
            col.string('category', 'category'),
            col.float('amount', 'amount'),
            col.string('unit', 'unit'),
            col.string('status', 'status'),
            col.ref(
                'counts_toward_kr',
                'counts_toward_kr_id',
                'goalshq_key_results'
            ),
            col.string('evidence_url', 'evidence_url'),
            col.text('body', 'body'),
        ],
    },
];

/* ------------------------------------------------------------------ *
 * Descriptors                                                         *
 * ------------------------------------------------------------------ */

const RESOURCES = [
    {
        key: 'tags',
        model: Tag,
        sheet: 'Tags',
        displayKey: 'name',
        dependsOn: [],
        naturalKey: (row) => (row.name || '').trim().toLowerCase(),
        exportOrder: [['name', 'ASC']],
        // System tags (someday/today) are managed by the app, never by import.
        exportWhere: { tag_type: 'user' },
        skipRow: (row) => row.tag_type === 'system',
        columns: [
            col.identity(),
            col.string('name', 'name', { required: true }),
            col.string('color', 'color'),
            col.bool('pinned', 'pinned'),
        ],
    },
    {
        key: 'areas',
        model: Area,
        sheet: 'Areas',
        displayKey: 'name',
        dependsOn: [],
        naturalKey: (row) => (row.name || '').trim().toLowerCase(),
        exportOrder: [['name', 'ASC']],
        columns: [
            col.identity(),
            col.string('name', 'name', { required: true }),
            col.text('description', 'description'),
            col.string('color', 'color'),
        ],
    },
    {
        key: 'goals',
        model: Goal,
        sheet: 'Goals',
        displayKey: 'title',
        dependsOn: ['areas'],
        naturalKey: (row) => (row.title || '').trim().toLowerCase(),
        exportOrder: [['title', 'ASC']],
        associations: [{ model: Area, as: 'Area', refField: 'area_id' }],
        columns: [
            col.identity(),
            col.string('title', 'title', { required: true }),
            col.text('why', 'why'),
            col.enumStr('horizon', 'horizon', GOAL_HORIZON_VALUES),
            col.enumStr('status', 'status', GOAL_STATUS_VALUES),
            col.dateOnly('target_date', 'target_date'),
            col.ref('area', 'area_id', 'areas'),
            col.string('color', 'color'),
        ],
    },
    {
        key: 'projects',
        model: Project,
        sheet: 'Projects',
        displayKey: 'name',
        dependsOn: ['areas', 'goals', 'tags'],
        naturalKey: (row) => (row.name || '').trim().toLowerCase(),
        exportOrder: [['name', 'ASC']],
        tagField: 'Tags',
        associations: [
            { model: Area, as: 'Area', refField: 'area_id' },
            { model: Goal, as: 'Goal', refField: 'goal_id' },
        ],
        columns: [
            col.identity(),
            col.string('name', 'name', { required: true }),
            col.text('description', 'description'),
            col.enumStr('status', 'status', PROJECT_STATUS_VALUES),
            col.enumInt('priority', 'priority', PRIORITY_VALUES),
            col.dateTime('due_date', 'due_date_at'),
            col.bool('pin_to_sidebar', 'pin_to_sidebar'),
            col.bool('is_maintenance', 'is_maintenance'),
            col.ref('area', 'area_id', 'areas'),
            col.ref('goal', 'goal_id', 'goals'),
            col.string('color', 'color'),
            col.tags(),
        ],
    },
    {
        key: 'tasks',
        model: Task,
        sheet: 'Tasks',
        displayKey: 'name',
        dependsOn: ['areas', 'goals', 'projects', 'tags'],
        // Only real, top-level tasks — not generated recurring instances.
        exportWhere: { recurring_parent_id: null },
        exportOrder: [
            ['project_id', 'ASC'],
            ['name', 'ASC'],
        ],
        tagField: 'Tags',
        associations: [
            { model: Project, as: 'Project', refField: 'project_id' },
            { model: Area, as: 'Area', refField: 'area_id' },
            { model: Goal, as: 'Goal', refField: 'goal_id' },
            {
                model: Task,
                as: 'ParentTask',
                refField: 'parent_task_id',
                displayKey: 'name',
            },
        ],
        // Post-ref-resolution natural key: parent scope + name.
        naturalKey: (row) =>
            [
                row.project_id || 0,
                row.parent_task_id || 0,
                (row.name || '').trim().toLowerCase(),
            ].join(''),
        columns: [
            col.identity(),
            col.string('name', 'name', { required: true }),
            col.text('note', 'note'),
            col.enumInt('status', 'status', TASK_STATUS_VALUES, {
                nullable: false,
            }),
            col.enumInt('priority', 'priority', PRIORITY_VALUES),
            col.dateTime('due_date', 'due_date'),
            col.dateTime('defer_until', 'defer_until'),
            col.ref('project', 'project_id', 'projects'),
            col.ref('area', 'area_id', 'areas'),
            col.ref('goal', 'goal_id', 'goals'),
            col.ref('parent_task', 'parent_task_id', 'tasks', {
                self: true,
                deferred: true,
            }),
            col.tags(),
        ],
    },
    {
        key: 'notes',
        model: Note,
        sheet: 'Notes',
        displayKey: 'title',
        dependsOn: ['projects', 'tags'],
        exportOrder: [['created_at', 'ASC']],
        tagField: 'Tags',
        // Titles are optional and not unique, so two blank/duplicate titles in
        // the same project are only distinguishable by uid — expected, and
        // surfaced as an "ambiguous, add its uid" error rather than silently
        // merged.
        naturalKey: (row) =>
            [row.project_id || 0, (row.title || '').trim().toLowerCase()].join(
                '|'
            ),
        columns: [
            col.identity(),
            col.string('title', 'title'),
            col.text('content', 'content'),
            col.ref('project', 'project_id', 'projects'),
            col.string('color', 'color'),
            col.bool('pin_to_sidebar', 'pin_to_sidebar'),
            col.tags(),
        ],
    },
    {
        key: 'inbox_items',
        model: InboxItem,
        sheet: 'Inbox',
        displayKey: 'title',
        dependsOn: [],
        exportOrder: [['created_at', 'ASC']],
        // AI-suggested / parsed columns (suggested_type, parsed_tags, ...) are
        // derived by the app and intentionally not part of the sheet.
        naturalKey: (row) =>
            (row.content || '').trim().toLowerCase().slice(0, 200),
        columns: [
            col.identity(),
            col.text('content', 'content', { required: true }),
            col.string('title', 'title'),
            col.enumStr('status', 'status', INBOX_STATUS_VALUES),
            col.string('source', 'source', { defaultValue: 'manual' }),
        ],
    },
    ...(GOALSHQ_ENABLED ? GOALSHQ_RESOURCES : []),
];

const BY_KEY = RESOURCES.reduce((acc, r) => {
    acc[r.key] = r;
    return acc;
}, {});

/**
 * Topological order of resource keys, honouring `dependsOn`.
 */
function orderedKeys(keys = RESOURCES.map((r) => r.key)) {
    const wanted = new Set(keys);
    const result = [];
    const visiting = new Set();

    const visit = (key) => {
        if (result.includes(key) || !BY_KEY[key]) return;
        if (visiting.has(key)) {
            throw new Error(`Cyclic resource dependency at "${key}"`);
        }
        visiting.add(key);
        for (const dep of BY_KEY[key].dependsOn) {
            if (wanted.has(dep) || keys.length === RESOURCES.length) visit(dep);
        }
        visiting.delete(key);
        if (!result.includes(key)) result.push(key);
    };

    RESOURCES.forEach((r) => {
        if (wanted.has(r.key)) visit(r.key);
    });
    return result;
}

/**
 * Transitive dependency closure of `keys`, in topological order. Used to build
 * the reference index: a sheet that imports only Tasks still needs Projects,
 * Areas, Goals and Tags loaded (read-only) to resolve foreign keys.
 */
function withDependencies(keys) {
    const closure = new Set();
    const add = (key) => {
        if (closure.has(key) || !BY_KEY[key]) return;
        closure.add(key);
        BY_KEY[key].dependsOn.forEach(add);
    };
    keys.forEach(add);
    return orderedKeys([...closure]);
}

module.exports = {
    RESOURCES,
    BY_KEY,
    orderedKeys,
    withDependencies,
    ENUMS: {
        priority: PRIORITY_VALUES,
        task_status: TASK_STATUS_VALUES,
        project_status: PROJECT_STATUS_VALUES,
        goal_status: GOAL_STATUS_VALUES,
        goal_horizon: GOAL_HORIZON_VALUES,
        boolean: ['yes', 'no'],
    },
};
