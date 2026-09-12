const {
    sequelize,
    User,
    Area,
    Goal,
    Project,
    Task,
    Tag,
    Note,
    InboxItem,
    TaskEvent,
    View,
    RecurringCompletion,
    TaskAttachment,
    Backup,
    GoalshqStrategy,
    GoalshqProjectStrategy,
    GoalshqGoalSettings,
    GoalshqProjectSettings,
    GoalshqKeyResult,
    GoalshqKeyResultEntry,
    GoalshqMilestone,
    GoalshqMilestoneProject,
    GoalshqMilestoneTask,
    GoalshqProgressSnapshot,
    GoalshqRecord,
} = require('../models');
const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { getConfig } = require('../config/config');
const config = getConfig();
const packageJson = require('../../package.json');

// Promisify zlib functions
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Compare two semantic versions
 * @param {string} version1 - First version (e.g., "v0.88.0-dev.1")
 * @param {string} version2 - Second version
 * @returns {number} - Returns -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2
 */
function compareVersions(version1, version2) {
    // Remove 'v' prefix if present
    const v1 = version1.replace(/^v/, '');
    const v2 = version2.replace(/^v/, '');

    // Split into parts (major.minor.patch-prerelease)
    const parseVersion = (v) => {
        const [mainVersion, prerelease] = v.split('-');
        const [major, minor, patch] = mainVersion.split('.').map(Number);
        return { major, minor, patch, prerelease };
    };

    const parsed1 = parseVersion(v1);
    const parsed2 = parseVersion(v2);

    // Compare major, minor, patch
    if (parsed1.major !== parsed2.major) return parsed1.major - parsed2.major;
    if (parsed1.minor !== parsed2.minor) return parsed1.minor - parsed2.minor;
    if (parsed1.patch !== parsed2.patch) return parsed1.patch - parsed2.patch;

    // If versions are equal so far, check prerelease
    // No prerelease is considered greater than prerelease
    if (!parsed1.prerelease && parsed2.prerelease) return 1;
    if (parsed1.prerelease && !parsed2.prerelease) return -1;
    if (parsed1.prerelease && parsed2.prerelease) {
        return parsed1.prerelease.localeCompare(parsed2.prerelease);
    }

    return 0;
}

/**
 * Check if backup version is compatible with current app version
 * @param {string} backupVersion - Version from backup file
 * @returns {object} - { compatible: boolean, message?: string }
 */
function checkVersionCompatibility(backupVersion) {
    const currentVersion = packageJson.version;

    // If backup version is newer than current version, it's not compatible
    const comparison = compareVersions(backupVersion, currentVersion);

    if (comparison > 0) {
        return {
            compatible: false,
            message: `Cannot restore backup from newer version ${backupVersion} to current version ${currentVersion}. Please upgrade your application first.`,
        };
    }

    return { compatible: true };
}

/**
 * Export all data for a specific user
 * @param {number} userId - The user ID to export data for
 * @returns {Promise<object>} - The backup data as JSON
 */
async function exportUserData(userId) {
    try {
        // Fetch user with all preferences (exclude sensitive data)
        const user = await User.findByPk(userId, {
            attributes: {
                exclude: [
                    'id',
                    'password_digest',
                    'email_verification_token',
                    'email_verification_token_expires_at',
                ],
            },
        });

        if (!user) {
            throw new Error('User not found');
        }

        // Fetch all user-owned entities
        const [
            areas,
            projects,
            tasks,
            tags,
            notes,
            inboxItems,
            taskEvents,
            views,
            goals,
            goalshqStrategies,
            goalshqProjectStrategies,
            goalshqGoalSettings,
            goalshqProjectSettings,
            goalshqKeyResults,
            goalshqKeyResultEntries,
            goalshqMilestones,
            goalshqRecords,
            goalshqMilestoneProjects,
            goalshqMilestoneTasks,
            goalshqProgressSnapshots,
        ] = await Promise.all([
            Area.findAll({ where: { user_id: userId } }),
            Project.findAll({
                where: { user_id: userId },
                include: [
                    {
                        model: Tag,
                        through: { attributes: [] },
                        attributes: ['uid', 'name'],
                    },
                ],
            }),
            Task.findAll({
                where: { user_id: userId },
                include: [
                    {
                        model: Tag,
                        through: { attributes: [] },
                        attributes: ['uid', 'name'],
                    },
                    {
                        model: RecurringCompletion,
                        as: 'Completions',
                    },
                    {
                        model: TaskAttachment,
                        as: 'Attachments',
                    },
                ],
            }),
            Tag.findAll({ where: { user_id: userId } }),
            Note.findAll({
                where: { user_id: userId },
                include: [
                    {
                        model: Tag,
                        through: { attributes: [] },
                        attributes: ['uid', 'name'],
                    },
                ],
            }),
            InboxItem.findAll({ where: { user_id: userId } }),
            TaskEvent.findAll({ where: { user_id: userId } }),
            View.findAll({ where: { user_id: userId } }),
            Goal.findAll({ where: { user_id: userId } }),
            GoalshqStrategy.findAll({ where: { user_id: userId } }),
            GoalshqProjectStrategy.findAll({ where: { user_id: userId } }),
            GoalshqGoalSettings.findAll({ where: { user_id: userId } }),
            GoalshqProjectSettings.findAll({ where: { user_id: userId } }),
            GoalshqKeyResult.findAll({ where: { user_id: userId } }),
            GoalshqKeyResultEntry.findAll({ where: { user_id: userId } }),
            GoalshqMilestone.findAll({ where: { user_id: userId } }),
            GoalshqRecord.findAll({ where: { user_id: userId } }),
            GoalshqMilestoneProject.findAll({ where: { user_id: userId } }),
            GoalshqMilestoneTask.findAll({ where: { user_id: userId } }),
            GoalshqProgressSnapshot.findAll({ where: { user_id: userId } }),
        ]);

        // Build the backup object
        const backup = {
            version: packageJson.version,
            exported_at: new Date().toISOString(),
            user: {
                uid: user.uid,
                email: user.email,
                name: user.name,
                surname: user.surname,
                appearance: user.appearance,
                language: user.language,
                timezone: user.timezone,
                first_day_of_week: user.first_day_of_week,
                avatar_image: user.avatar_image,
                telegram_bot_token: user.telegram_bot_token,
                telegram_chat_id: user.telegram_chat_id,
                telegram_allowed_users: user.telegram_allowed_users,
                task_summary_enabled: user.task_summary_enabled,
                task_summary_frequency: user.task_summary_frequency,
                features: user.features,
                today_settings: user.today_settings,
                sidebar_settings: user.sidebar_settings,
                ui_settings: user.ui_settings,
                notification_preferences: user.notification_preferences,
            },
            data: {
                areas: areas.map((area) => area.toJSON()),
                projects: projects.map((project) => {
                    const projectData = project.toJSON();
                    // Extract tag UIDs for relationship mapping
                    projectData.tag_uids = (project.Tags || []).map(
                        (tag) => tag.uid
                    );
                    delete projectData.Tags;
                    return projectData;
                }),
                tasks: tasks.map((task) => {
                    const taskData = task.toJSON();
                    // Extract tag UIDs and related data
                    taskData.tag_uids = (task.Tags || []).map((tag) => tag.uid);
                    taskData.completions = taskData.Completions || [];
                    taskData.attachments = taskData.Attachments || [];
                    delete taskData.Tags;
                    delete taskData.Completions;
                    delete taskData.Attachments;
                    return taskData;
                }),
                tags: tags.map((tag) => tag.toJSON()),
                notes: notes.map((note) => {
                    const noteData = note.toJSON();
                    noteData.tag_uids = (note.Tags || []).map((tag) => tag.uid);
                    delete noteData.Tags;
                    return noteData;
                }),
                inbox_items: inboxItems.map((item) => item.toJSON()),
                task_events: taskEvents.map((event) => event.toJSON()),
                views: views.map((view) => view.toJSON()),
                goals: goals.map((goal) => goal.toJSON()),
                goalshq_strategies: goalshqStrategies.map((s) => s.toJSON()),
                goalshq_project_strategies: goalshqProjectStrategies.map((ps) =>
                    ps.toJSON()
                ),
                // Only the user-set configuration is backed up — cached_*
                // computed fields are rollup output, not source data, and are
                // recomputed automatically after restore.
                goalshq_goal_settings: goalshqGoalSettings.map((s) => ({
                    goal_id: s.goal_id,
                    start_date: s.start_date,
                    manual_percent: s.manual_percent,
                    metrics_enabled: s.metrics_enabled,
                })),
                goalshq_project_settings: goalshqProjectSettings.map((s) => ({
                    project_id: s.project_id,
                    manual_percent: s.manual_percent,
                    metrics_enabled: s.metrics_enabled,
                })),
                goalshq_key_results: goalshqKeyResults.map((kr) => kr.toJSON()),
                goalshq_key_result_entries: goalshqKeyResultEntries.map((e) =>
                    e.toJSON()
                ),
                goalshq_milestones: goalshqMilestones.map((m) => m.toJSON()),
                goalshq_records: goalshqRecords.map((r) => r.toJSON()),
                goalshq_milestone_projects: goalshqMilestoneProjects.map((mp) =>
                    mp.toJSON()
                ),
                goalshq_milestone_tasks: goalshqMilestoneTasks.map((mt) =>
                    mt.toJSON()
                ),
                // Cached computed history — restored for continuity of trend
                // lines, but never a source of truth (the rollup job
                // regenerates today's snapshot regardless).
                goalshq_progress_snapshots: goalshqProgressSnapshots.map((s) =>
                    s.toJSON()
                ),
            },
        };

        return backup;
    } catch (error) {
        console.error('Error exporting user data:', error);
        throw error;
    }
}

/**
 * Import and restore user data from a backup
 * @param {number} userId - The user ID to import data for
 * @param {object} backupData - The backup data to import
 * @param {object} options - Import options
 * @param {boolean} options.merge - If true, merge with existing data (default: true)
 * @returns {Promise<object>} - Import statistics
 */
async function importUserData(userId, backupData, options = { merge: true }) {
    const transaction = await sequelize.transaction();

    try {
        // Validate backup data structure
        if (!backupData.version || !backupData.data) {
            throw new Error('Invalid backup data format');
        }

        // Verify user exists
        const user = await User.findByPk(userId);
        if (!user) {
            throw new Error('User not found');
        }

        const stats = {
            areas: { created: 0, skipped: 0 },
            projects: { created: 0, skipped: 0 },
            tasks: { created: 0, skipped: 0 },
            tags: { created: 0, skipped: 0 },
            notes: { created: 0, skipped: 0 },
            inbox_items: { created: 0, skipped: 0 },
            views: { created: 0, skipped: 0 },
            goals: { created: 0, skipped: 0 },
            goalshq_strategies: { created: 0, skipped: 0 },
            goalshq_project_strategies: { created: 0, skipped: 0 },
            goalshq_goal_settings: { created: 0, updated: 0 },
            goalshq_project_settings: { created: 0, updated: 0 },
            goalshq_key_results: { created: 0, skipped: 0 },
            goalshq_key_result_entries: { created: 0, skipped: 0 },
            goalshq_milestones: { created: 0, skipped: 0 },
            goalshq_records: { created: 0, skipped: 0 },
            goalshq_milestone_projects: { created: 0, skipped: 0 },
            goalshq_milestone_tasks: { created: 0, skipped: 0 },
            goalshq_progress_snapshots: { created: 0, skipped: 0 },
        };

        // Map to track old UIDs to new IDs for foreign key relationships
        const uidToIdMap = {
            areas: {},
            projects: {},
            tasks: {},
            tags: {},
            notes: {},
            goals: {},
            goalshq_strategies: {},
            goalshq_key_results: {},
        };
        // Old numeric ID -> new numeric ID, for FK columns that store a raw
        // id rather than a uid (area_id, project_id, goal_id, parent_id, ...).
        // Restoring into a fresh/different database means old and new ids
        // rarely match, so every such FK must go through this map rather
        // than being looked up by its old id value directly.
        const oldIdToNewId = {
            areas: {},
            projects: {},
            tasks: {},
            goals: {},
            goalshq_strategies: {},
            goalshq_key_results: {},
            goalshq_milestones: {},
        };
        // Polymorphic parent_type -> the oldIdToNewId bucket to resolve a
        // KR/Milestone/Record's parent_id against.
        const POLY_PARENT_MAP = {
            goal: 'goals',
            strategy: 'goalshq_strategies',
            project: 'projects',
            task: 'tasks',
        };
        const resolveParentId = (parentType, oldParentId) => {
            if (!parentType || !oldParentId) return null;
            const bucket = POLY_PARENT_MAP[parentType];
            if (!bucket) return null;
            return oldIdToNewId[bucket]?.[oldParentId] ?? null;
        };

        // Import tags first (no dependencies)
        if (backupData.data.tags) {
            for (const tagData of backupData.data.tags) {
                const existingTag = await Tag.findOne({
                    where: { uid: tagData.uid, user_id: userId },
                    transaction,
                });

                if (existingTag && options.merge) {
                    stats.tags.skipped++;
                    uidToIdMap.tags[tagData.uid] = existingTag.id;
                } else if (!existingTag) {
                    const newTag = await Tag.create(
                        {
                            uid: tagData.uid,
                            name: tagData.name,
                            user_id: userId,
                        },
                        { transaction }
                    );
                    stats.tags.created++;
                    uidToIdMap.tags[tagData.uid] = newTag.id;
                }
            }
        }

        // Import areas (no dependencies except user)
        if (backupData.data.areas) {
            for (const areaData of backupData.data.areas) {
                const existingArea = await Area.findOne({
                    where: { uid: areaData.uid, user_id: userId },
                    transaction,
                });

                if (existingArea && options.merge) {
                    stats.areas.skipped++;
                    uidToIdMap.areas[areaData.uid] = existingArea.id;
                    if (areaData.id)
                        oldIdToNewId.areas[areaData.id] = existingArea.id;
                } else if (!existingArea) {
                    const newArea = await Area.create(
                        {
                            uid: areaData.uid,
                            name: areaData.name,
                            description: areaData.description,
                            user_id: userId,
                        },
                        { transaction }
                    );
                    stats.areas.created++;
                    uidToIdMap.areas[areaData.uid] = newArea.id;
                    if (areaData.id)
                        oldIdToNewId.areas[areaData.id] = newArea.id;
                }
            }
        }

        // Import goals (depends on areas)
        if (backupData.data.goals) {
            for (const goalData of backupData.data.goals) {
                const existingGoal = await Goal.findOne({
                    where: { uid: goalData.uid, user_id: userId },
                    transaction,
                });

                if (existingGoal && options.merge) {
                    stats.goals.skipped++;
                    uidToIdMap.goals[goalData.uid] = existingGoal.id;
                    if (goalData.id)
                        oldIdToNewId.goals[goalData.id] = existingGoal.id;
                } else if (!existingGoal) {
                    const newGoal = await Goal.create(
                        {
                            uid: goalData.uid,
                            title: goalData.title,
                            why: goalData.why,
                            horizon: goalData.horizon,
                            status: goalData.status,
                            target_date: goalData.target_date,
                            color: goalData.color,
                            user_id: userId,
                            area_id: goalData.area_id
                                ? oldIdToNewId.areas[goalData.area_id] || null
                                : null,
                        },
                        { transaction }
                    );
                    stats.goals.created++;
                    uidToIdMap.goals[goalData.uid] = newGoal.id;
                    if (goalData.id)
                        oldIdToNewId.goals[goalData.id] = newGoal.id;
                }
            }
        }

        // Import projects (depends on areas, goals)
        if (backupData.data.projects) {
            for (const projectData of backupData.data.projects) {
                const existingProject = await Project.findOne({
                    where: { uid: projectData.uid, user_id: userId },
                    transaction,
                });

                if (existingProject && options.merge) {
                    stats.projects.skipped++;
                    uidToIdMap.projects[projectData.uid] = existingProject.id;
                    if (projectData.id)
                        oldIdToNewId.projects[projectData.id] =
                            existingProject.id;
                } else if (!existingProject) {
                    const newProject = await Project.create(
                        {
                            uid: projectData.uid,
                            name: projectData.name,
                            description: projectData.description,
                            pin_to_sidebar: projectData.pin_to_sidebar,
                            priority: projectData.priority,
                            due_date_at: projectData.due_date_at,
                            image_url: projectData.image_url,
                            task_show_completed:
                                projectData.task_show_completed,
                            task_sort_order: projectData.task_sort_order,
                            status: projectData.status || projectData.state,
                            user_id: userId,
                            area_id: projectData.area_id
                                ? oldIdToNewId.areas[projectData.area_id] ||
                                  null
                                : null,
                            goal_id: projectData.goal_id
                                ? oldIdToNewId.goals[projectData.goal_id] ||
                                  null
                                : null,
                        },
                        { transaction }
                    );
                    stats.projects.created++;
                    uidToIdMap.projects[projectData.uid] = newProject.id;
                    if (projectData.id)
                        oldIdToNewId.projects[projectData.id] = newProject.id;

                    // Create project-tag relationships
                    if (
                        projectData.tag_uids &&
                        projectData.tag_uids.length > 0
                    ) {
                        const tagIds = projectData.tag_uids
                            .map((uid) => uidToIdMap.tags[uid])
                            .filter(Boolean);
                        if (tagIds.length > 0) {
                            await newProject.setTags(tagIds, { transaction });
                        }
                    }
                }
            }
        }

        // Import tasks (depends on projects, and self-referential)
        // First pass: create all tasks without parent/recurring relationships
        if (backupData.data.tasks) {
            for (const taskData of backupData.data.tasks) {
                const existingTask = await Task.findOne({
                    where: { uid: taskData.uid, user_id: userId },
                    transaction,
                });

                if (existingTask && options.merge) {
                    stats.tasks.skipped++;
                    uidToIdMap.tasks[taskData.uid] = existingTask.id;
                    if (taskData.id)
                        oldIdToNewId.tasks[taskData.id] = existingTask.id;
                } else if (!existingTask) {
                    const newTask = await Task.create(
                        {
                            uid: taskData.uid,
                            name: taskData.name,
                            due_date: taskData.due_date,
                            defer_until: taskData.defer_until,
                            priority: taskData.priority,
                            status: taskData.status,
                            note: taskData.note,
                            recurrence_type: taskData.recurrence_type,
                            recurrence_interval: taskData.recurrence_interval,
                            recurrence_end_date: taskData.recurrence_end_date,
                            recurrence_weekday: taskData.recurrence_weekday,
                            recurrence_weekdays: taskData.recurrence_weekdays,
                            recurrence_month_day: taskData.recurrence_month_day,
                            recurrence_week_of_month:
                                taskData.recurrence_week_of_month,
                            completion_based: taskData.completion_based,
                            order: taskData.order,
                            completed_at: taskData.completed_at,
                            user_id: userId,
                            project_id: taskData.project_id
                                ? oldIdToNewId.projects[taskData.project_id] ||
                                  null
                                : null,
                            area_id: taskData.area_id
                                ? oldIdToNewId.areas[taskData.area_id] || null
                                : null,
                            goal_id: taskData.goal_id
                                ? oldIdToNewId.goals[taskData.goal_id] || null
                                : null,
                        },
                        { transaction }
                    );
                    stats.tasks.created++;
                    uidToIdMap.tasks[taskData.uid] = newTask.id;
                    if (taskData.id)
                        oldIdToNewId.tasks[taskData.id] = newTask.id;

                    // Create task-tag relationships
                    if (taskData.tag_uids && taskData.tag_uids.length > 0) {
                        const tagIds = taskData.tag_uids
                            .map((uid) => uidToIdMap.tags[uid])
                            .filter(Boolean);
                        if (tagIds.length > 0) {
                            await newTask.setTags(tagIds, { transaction });
                        }
                    }

                    // Create recurring completions
                    if (
                        taskData.completions &&
                        taskData.completions.length > 0
                    ) {
                        for (const completion of taskData.completions) {
                            await RecurringCompletion.create(
                                {
                                    task_id: newTask.id,
                                    completion_date: completion.completion_date,
                                },
                                { transaction }
                            );
                        }
                    }

                    // Create task attachments
                    if (
                        taskData.attachments &&
                        taskData.attachments.length > 0
                    ) {
                        for (const attachment of taskData.attachments) {
                            await TaskAttachment.create(
                                {
                                    task_id: newTask.id,
                                    user_id: userId,
                                    file_name: attachment.file_name,
                                    file_url: attachment.file_url,
                                    file_size: attachment.file_size,
                                    file_type: attachment.file_type,
                                },
                                { transaction }
                            );
                        }
                    }
                }
            }

            // Second pass: update parent_task_id and recurring_parent_id
            for (const taskData of backupData.data.tasks) {
                if (taskData.parent_task_id || taskData.recurring_parent_id) {
                    const task = await Task.findOne({
                        where: { uid: taskData.uid, user_id: userId },
                        transaction,
                    });

                    if (task) {
                        const updates = {};

                        if (taskData.parent_task_id) {
                            const newParentId =
                                oldIdToNewId.tasks[taskData.parent_task_id];
                            if (newParentId) {
                                updates.parent_task_id = newParentId;
                            }
                        }

                        if (taskData.recurring_parent_id) {
                            const newRecurringParentId =
                                oldIdToNewId.tasks[
                                    taskData.recurring_parent_id
                                ];
                            if (newRecurringParentId) {
                                updates.recurring_parent_id =
                                    newRecurringParentId;
                            }
                        }

                        if (Object.keys(updates).length > 0) {
                            await task.update(updates, { transaction });
                        }
                    }
                }
            }
        }

        // Import GoalsHQ strategies (depends on goals)
        if (backupData.data.goalshq_strategies) {
            for (const sData of backupData.data.goalshq_strategies) {
                const existing = await GoalshqStrategy.findOne({
                    where: { uid: sData.uid, user_id: userId },
                    transaction,
                });
                if (existing && options.merge) {
                    stats.goalshq_strategies.skipped++;
                    uidToIdMap.goalshq_strategies[sData.uid] = existing.id;
                    if (sData.id)
                        oldIdToNewId.goalshq_strategies[sData.id] = existing.id;
                } else if (!existing) {
                    const created = await GoalshqStrategy.create(
                        {
                            uid: sData.uid,
                            name: sData.name,
                            description: sData.description,
                            status: sData.status,
                            metrics_editable: sData.metrics_editable,
                            color: sData.color,
                            user_id: userId,
                            goal_id: sData.goal_id
                                ? oldIdToNewId.goals[sData.goal_id] || null
                                : null,
                        },
                        { transaction }
                    );
                    stats.goalshq_strategies.created++;
                    uidToIdMap.goalshq_strategies[sData.uid] = created.id;
                    if (sData.id)
                        oldIdToNewId.goalshq_strategies[sData.id] = created.id;
                }
            }
        }

        // Import GoalsHQ project<->strategy links (depends on projects, strategies)
        if (backupData.data.goalshq_project_strategies) {
            for (const psData of backupData.data.goalshq_project_strategies) {
                const newStrategyId =
                    oldIdToNewId.goalshq_strategies[psData.strategy_id];
                const newProjectId = oldIdToNewId.projects[psData.project_id];
                if (!newStrategyId || !newProjectId) continue;
                const existing = await GoalshqProjectStrategy.findOne({
                    where: {
                        strategy_id: newStrategyId,
                        project_id: newProjectId,
                        user_id: userId,
                    },
                    transaction,
                });
                if (existing) {
                    stats.goalshq_project_strategies.skipped++;
                } else {
                    await GoalshqProjectStrategy.create(
                        {
                            strategy_id: newStrategyId,
                            project_id: newProjectId,
                            weight: psData.weight,
                            user_id: userId,
                        },
                        { transaction }
                    );
                    stats.goalshq_project_strategies.created++;
                }
            }
        }

        // Import GoalsHQ goal settings (1:1 with goal; upsert, not uid-based)
        if (backupData.data.goalshq_goal_settings) {
            for (const settings of backupData.data.goalshq_goal_settings) {
                const newGoalId = oldIdToNewId.goals[settings.goal_id];
                if (!newGoalId) continue;
                const [, created] = await GoalshqGoalSettings.upsert(
                    {
                        goal_id: newGoalId,
                        user_id: userId,
                        start_date: settings.start_date,
                        manual_percent: settings.manual_percent,
                        metrics_enabled: settings.metrics_enabled,
                    },
                    { transaction }
                );
                if (created) stats.goalshq_goal_settings.created++;
                else stats.goalshq_goal_settings.updated++;
            }
        }

        // Import GoalsHQ project settings (1:1 with project; upsert)
        if (backupData.data.goalshq_project_settings) {
            for (const settings of backupData.data.goalshq_project_settings) {
                const newProjectId = oldIdToNewId.projects[settings.project_id];
                if (!newProjectId) continue;
                const [, created] = await GoalshqProjectSettings.upsert(
                    {
                        project_id: newProjectId,
                        user_id: userId,
                        manual_percent: settings.manual_percent,
                        metrics_enabled: settings.metrics_enabled,
                    },
                    { transaction }
                );
                if (created) stats.goalshq_project_settings.created++;
                else stats.goalshq_project_settings.updated++;
            }
        }

        // Import GoalsHQ key results (polymorphic parent + self-referential
        // parent_kr_id — two passes, same pattern as tasks above)
        if (backupData.data.goalshq_key_results) {
            for (const krData of backupData.data.goalshq_key_results) {
                const existing = await GoalshqKeyResult.findOne({
                    where: { uid: krData.uid, user_id: userId },
                    transaction,
                });
                const parentId = resolveParentId(
                    krData.parent_type,
                    krData.parent_id
                );
                if (existing && options.merge) {
                    stats.goalshq_key_results.skipped++;
                    uidToIdMap.goalshq_key_results[krData.uid] = existing.id;
                    if (krData.id)
                        oldIdToNewId.goalshq_key_results[krData.id] =
                            existing.id;
                } else if (!existing && parentId) {
                    const created = await GoalshqKeyResult.create(
                        {
                            uid: krData.uid,
                            name: krData.name,
                            parent_type: krData.parent_type,
                            parent_id: parentId,
                            unit: krData.unit,
                            direction: krData.direction,
                            auto_source: krData.auto_source,
                            baseline_value: krData.baseline_value,
                            target_value: krData.target_value,
                            current_value: krData.current_value,
                            sort_order: krData.sort_order,
                            user_id: userId,
                        },
                        { transaction }
                    );
                    stats.goalshq_key_results.created++;
                    uidToIdMap.goalshq_key_results[krData.uid] = created.id;
                    if (krData.id)
                        oldIdToNewId.goalshq_key_results[krData.id] =
                            created.id;
                }
            }
            // Second pass: self-referential parent_kr_id (KR tree)
            for (const krData of backupData.data.goalshq_key_results) {
                if (!krData.parent_kr_id) continue;
                const newParentKrId =
                    oldIdToNewId.goalshq_key_results[krData.parent_kr_id];
                if (!newParentKrId) continue;
                const kr = await GoalshqKeyResult.findOne({
                    where: { uid: krData.uid, user_id: userId },
                    transaction,
                });
                if (kr) {
                    await kr.update(
                        { parent_kr_id: newParentKrId },
                        { transaction }
                    );
                }
            }
        }

        // Import GoalsHQ KR entries (depends on key results)
        if (backupData.data.goalshq_key_result_entries) {
            for (const entryData of backupData.data
                .goalshq_key_result_entries) {
                const newKrId =
                    oldIdToNewId.goalshq_key_results[entryData.key_result_id];
                if (!newKrId) continue;
                const existing = await GoalshqKeyResultEntry.findOne({
                    where: { uid: entryData.uid, user_id: userId },
                    transaction,
                });
                if (existing && options.merge) {
                    stats.goalshq_key_result_entries.skipped++;
                } else if (!existing) {
                    await GoalshqKeyResultEntry.create(
                        {
                            uid: entryData.uid,
                            key_result_id: newKrId,
                            entry_date: entryData.entry_date,
                            value: entryData.value,
                            note: entryData.note,
                            user_id: userId,
                        },
                        { transaction }
                    );
                    stats.goalshq_key_result_entries.created++;
                }
            }
        }

        // Import GoalsHQ milestones (polymorphic parent: goal/strategy/project)
        if (backupData.data.goalshq_milestones) {
            for (const mData of backupData.data.goalshq_milestones) {
                const parentId = resolveParentId(
                    mData.parent_type,
                    mData.parent_id
                );
                const existing = await GoalshqMilestone.findOne({
                    where: { uid: mData.uid, user_id: userId },
                    transaction,
                });
                if (existing && options.merge) {
                    stats.goalshq_milestones.skipped++;
                    if (mData.id)
                        oldIdToNewId.goalshq_milestones[mData.id] = existing.id;
                } else if (!existing && parentId) {
                    const created = await GoalshqMilestone.create(
                        {
                            uid: mData.uid,
                            title: mData.title,
                            parent_type: mData.parent_type,
                            parent_id: parentId,
                            target_date: mData.target_date,
                            target_value: mData.target_value,
                            status: mData.status,
                            achieved_at: mData.achieved_at,
                            completion_mode: mData.completion_mode,
                            user_id: userId,
                        },
                        { transaction }
                    );
                    stats.goalshq_milestones.created++;
                    if (mData.id)
                        oldIdToNewId.goalshq_milestones[mData.id] = created.id;
                }
            }
        }

        // Import GoalsHQ records (polymorphic parent + optional KR link)
        if (backupData.data.goalshq_records) {
            for (const rData of backupData.data.goalshq_records) {
                const parentId = resolveParentId(
                    rData.parent_type,
                    rData.parent_id
                );
                const existing = await GoalshqRecord.findOne({
                    where: { uid: rData.uid, user_id: userId },
                    transaction,
                });
                if (existing && options.merge) {
                    stats.goalshq_records.skipped++;
                } else if (!existing && parentId) {
                    await GoalshqRecord.create(
                        {
                            uid: rData.uid,
                            title: rData.title,
                            parent_type: rData.parent_type,
                            parent_id: parentId,
                            record_date: rData.record_date,
                            category: rData.category,
                            amount: rData.amount,
                            unit: rData.unit,
                            status: rData.status,
                            counts_toward_kr_id: rData.counts_toward_kr_id
                                ? oldIdToNewId.goalshq_key_results[
                                      rData.counts_toward_kr_id
                                  ] || null
                                : null,
                            evidence_url: rData.evidence_url,
                            body: rData.body,
                            user_id: userId,
                        },
                        { transaction }
                    );
                    stats.goalshq_records.created++;
                }
            }
        }

        // Import GoalsHQ milestone<->project links (depends on milestones, projects)
        if (backupData.data.goalshq_milestone_projects) {
            for (const mpData of backupData.data.goalshq_milestone_projects) {
                const newMilestoneId =
                    oldIdToNewId.goalshq_milestones[mpData.milestone_id];
                const newProjectId = oldIdToNewId.projects[mpData.project_id];
                if (!newMilestoneId || !newProjectId) continue;
                const existing = await GoalshqMilestoneProject.findOne({
                    where: {
                        milestone_id: newMilestoneId,
                        project_id: newProjectId,
                        user_id: userId,
                    },
                    transaction,
                });
                if (existing) {
                    stats.goalshq_milestone_projects.skipped++;
                } else {
                    await GoalshqMilestoneProject.create(
                        {
                            milestone_id: newMilestoneId,
                            project_id: newProjectId,
                            user_id: userId,
                        },
                        { transaction }
                    );
                    stats.goalshq_milestone_projects.created++;
                }
            }
        }

        // Import GoalsHQ milestone<->task links (depends on milestones, tasks)
        if (backupData.data.goalshq_milestone_tasks) {
            for (const mtData of backupData.data.goalshq_milestone_tasks) {
                const newMilestoneId =
                    oldIdToNewId.goalshq_milestones[mtData.milestone_id];
                const newTaskId = oldIdToNewId.tasks[mtData.task_id];
                if (!newMilestoneId || !newTaskId) continue;
                const existing = await GoalshqMilestoneTask.findOne({
                    where: {
                        milestone_id: newMilestoneId,
                        task_id: newTaskId,
                        user_id: userId,
                    },
                    transaction,
                });
                if (existing) {
                    stats.goalshq_milestone_tasks.skipped++;
                } else {
                    await GoalshqMilestoneTask.create(
                        {
                            milestone_id: newMilestoneId,
                            task_id: newTaskId,
                            user_id: userId,
                        },
                        { transaction }
                    );
                    stats.goalshq_milestone_tasks.created++;
                }
            }
        }

        // Import GoalsHQ progress snapshots (polymorphic parent: goal/strategy/
        // project only — cached trend history, not a source of truth, but
        // restored so trend lines don't show a gap after a restore).
        if (backupData.data.goalshq_progress_snapshots) {
            for (const snap of backupData.data.goalshq_progress_snapshots) {
                const parentId = resolveParentId(
                    snap.parent_type,
                    snap.parent_id
                );
                if (!parentId) continue;
                const existing = await GoalshqProgressSnapshot.findOne({
                    where: {
                        parent_type: snap.parent_type,
                        parent_id: parentId,
                        kind: snap.kind,
                        snapshot_date: snap.snapshot_date,
                        user_id: userId,
                    },
                    transaction,
                });
                if (existing) {
                    stats.goalshq_progress_snapshots.skipped++;
                } else {
                    await GoalshqProgressSnapshot.create(
                        {
                            parent_type: snap.parent_type,
                            parent_id: parentId,
                            kind: snap.kind,
                            snapshot_date: snap.snapshot_date,
                            percent: snap.percent,
                            health: snap.health,
                            source: snap.source,
                            user_id: userId,
                        },
                        { transaction }
                    );
                    stats.goalshq_progress_snapshots.created++;
                }
            }
        }

        // Import notes (depends on projects)
        if (backupData.data.notes) {
            for (const noteData of backupData.data.notes) {
                const existingNote = await Note.findOne({
                    where: { uid: noteData.uid, user_id: userId },
                    transaction,
                });

                if (existingNote && options.merge) {
                    stats.notes.skipped++;
                } else if (!existingNote) {
                    const projectId = noteData.project_id
                        ? oldIdToNewId.projects[noteData.project_id] || null
                        : null;

                    const newNote = await Note.create(
                        {
                            uid: noteData.uid,
                            title: noteData.title,
                            content: noteData.content,
                            color: noteData.color,
                            user_id: userId,
                            project_id: projectId,
                        },
                        { transaction }
                    );
                    stats.notes.created++;

                    // Create note-tag relationships
                    if (noteData.tag_uids && noteData.tag_uids.length > 0) {
                        const tagIds = noteData.tag_uids
                            .map((uid) => uidToIdMap.tags[uid])
                            .filter(Boolean);
                        if (tagIds.length > 0) {
                            await newNote.setTags(tagIds, { transaction });
                        }
                    }
                }
            }
        }

        // Import inbox items
        if (backupData.data.inbox_items) {
            for (const inboxData of backupData.data.inbox_items) {
                const existingInbox = await InboxItem.findOne({
                    where: { uid: inboxData.uid, user_id: userId },
                    transaction,
                });

                if (existingInbox && options.merge) {
                    stats.inbox_items.skipped++;
                } else if (!existingInbox) {
                    await InboxItem.create(
                        {
                            uid: inboxData.uid,
                            name: inboxData.name,
                            content: inboxData.content,
                            status: inboxData.status,
                            user_id: userId,
                        },
                        { transaction }
                    );
                    stats.inbox_items.created++;
                }
            }
        }

        // Import views
        if (backupData.data.views) {
            for (const viewData of backupData.data.views) {
                const existingView = await View.findOne({
                    where: { uid: viewData.uid, user_id: userId },
                    transaction,
                });

                if (existingView && options.merge) {
                    stats.views.skipped++;
                } else if (!existingView) {
                    await View.create(
                        {
                            uid: viewData.uid,
                            name: viewData.name,
                            search_query: viewData.search_query,
                            filters: viewData.filters,
                            priority: viewData.priority,
                            due: viewData.due,
                            defer: viewData.defer,
                            tags: viewData.tags,
                            extras: viewData.extras,
                            recurring: viewData.recurring,
                            is_pinned: viewData.is_pinned,
                            user_id: userId,
                        },
                        { transaction }
                    );
                    stats.views.created++;
                }
            }
        }

        await transaction.commit();
        return stats;
    } catch (error) {
        await transaction.rollback();
        console.error('Error importing user data:', error);
        throw error;
    }
}

/**
 * Validate backup data structure
 * @param {object} backupData - The backup data to validate
 * @returns {object} - Validation result with errors array
 */
function validateBackupData(backupData) {
    const errors = [];

    if (!backupData) {
        errors.push('Backup data is empty');
        return { valid: false, errors };
    }

    if (!backupData.version) {
        errors.push('Missing version field');
    }

    if (!backupData.data) {
        errors.push('Missing data field');
    }

    // Check data structure
    const requiredFields = ['areas', 'projects', 'tasks', 'tags', 'notes'];
    for (const field of requiredFields) {
        if (backupData.data && !Array.isArray(backupData.data[field])) {
            errors.push(`Invalid or missing data.${field} array`);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

/**
 * Get the backups directory path and ensure it exists
 * @returns {Promise<string>} - Path to backups directory
 */
async function getBackupsDirectory() {
    const backupsDir = path.join(__dirname, '../backups');
    try {
        await fs.access(backupsDir);
    } catch {
        await fs.mkdir(backupsDir, { recursive: true });
    }
    return backupsDir;
}

/**
 * Save backup to disk and create database record
 * @param {number} userId - The user ID
 * @param {object} backupData - The backup data
 * @returns {Promise<object>} - The created Backup record
 */
async function saveBackup(userId, backupData) {
    try {
        const backupsDir = await getBackupsDirectory();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `backup-user-${userId}-${timestamp}.json.gz`;
        const filePath = path.join(backupsDir, fileName);

        // Convert backup to JSON string
        const backupJson = JSON.stringify(backupData, null, 2);

        // Compress using gzip
        const compressed = await gzip(backupJson);

        // Write compressed backup to file
        await fs.writeFile(filePath, compressed);

        // Get file stats
        const stats = await fs.stat(filePath);

        // Count items in backup
        const itemCounts = {
            areas: backupData.data.areas?.length || 0,
            projects: backupData.data.projects?.length || 0,
            tasks: backupData.data.tasks?.length || 0,
            tags: backupData.data.tags?.length || 0,
            notes: backupData.data.notes?.length || 0,
            inbox_items: backupData.data.inbox_items?.length || 0,
            views: backupData.data.views?.length || 0,
        };

        // Create database record
        const backup = await Backup.create({
            user_id: userId,
            file_path: fileName, // Store relative path
            file_size: stats.size, // Compressed size
            item_counts: itemCounts,
            version: backupData.version,
        });

        // Keep only last 5 backups for this user
        await cleanOldBackups(userId);

        return backup;
    } catch (error) {
        console.error('Error saving backup:', error);
        throw error;
    }
}

/**
 * Clean old backups, keeping only the last 5 for a user
 * @param {number} userId - The user ID
 * @returns {Promise<void>}
 */
async function cleanOldBackups(userId) {
    try {
        // Get all backups for user, ordered by creation date
        const backups = await Backup.findAll({
            where: { user_id: userId },
            order: [['created_at', 'DESC']],
        });

        // If more than 5, delete the oldest ones
        if (backups.length > 5) {
            const backupsToDelete = backups.slice(5);
            const backupsDir = await getBackupsDirectory();

            for (const backup of backupsToDelete) {
                // Delete file from disk
                const filePath = path.join(backupsDir, backup.file_path);
                try {
                    await fs.unlink(filePath);
                } catch (err) {
                    console.error(
                        `Failed to delete backup file: ${filePath}`,
                        err
                    );
                }

                // Delete database record
                await backup.destroy();
            }
        }
    } catch (error) {
        console.error('Error cleaning old backups:', error);
    }
}

/**
 * List saved backups for a user
 * @param {number} userId - The user ID
 * @param {number} limit - Maximum number of backups to return (default: 5)
 * @returns {Promise<Array>} - Array of backup records
 */
async function listBackups(userId, limit = 5) {
    try {
        const backups = await Backup.findAll({
            where: { user_id: userId },
            order: [['created_at', 'DESC']],
            limit,
            attributes: [
                'id',
                'uid',
                'file_path',
                'file_size',
                'item_counts',
                'version',
                'created_at',
            ],
        });

        return backups;
    } catch (error) {
        console.error('Error listing backups:', error);
        throw error;
    }
}

/**
 * Get a specific backup by UID
 * @param {number} userId - The user ID
 * @param {string} backupUid - The backup UID
 * @returns {Promise<object>} - The backup data
 */
async function getBackup(userId, backupUid) {
    try {
        const backup = await Backup.findOne({
            where: { uid: backupUid, user_id: userId },
        });

        if (!backup) {
            throw new Error('Backup not found');
        }

        const backupsDir = await getBackupsDirectory();
        const filePath = path.join(backupsDir, backup.file_path);

        // Read backup file
        const fileBuffer = await fs.readFile(filePath);

        // Check if file is compressed (ends with .gz)
        let backupJson;
        if (backup.file_path.endsWith('.gz')) {
            // Decompress gzip
            const decompressed = await gunzip(fileBuffer);
            backupJson = decompressed.toString('utf8');
        } else {
            // Legacy uncompressed backup
            backupJson = fileBuffer.toString('utf8');
        }

        const backupData = JSON.parse(backupJson);

        return backupData;
    } catch (error) {
        console.error('Error getting backup:', error);
        throw error;
    }
}

/**
 * Delete a specific backup
 * @param {number} userId - The user ID
 * @param {string} backupUid - The backup UID
 * @returns {Promise<void>}
 */
async function deleteBackup(userId, backupUid) {
    try {
        const backup = await Backup.findOne({
            where: { uid: backupUid, user_id: userId },
        });

        if (!backup) {
            throw new Error('Backup not found');
        }

        const backupsDir = await getBackupsDirectory();
        const filePath = path.join(backupsDir, backup.file_path);

        // Delete file from disk
        try {
            await fs.unlink(filePath);
        } catch (err) {
            console.error(`Failed to delete backup file: ${filePath}`, err);
        }

        // Delete database record
        await backup.destroy();
    } catch (error) {
        console.error('Error deleting backup:', error);
        throw error;
    }
}

module.exports = {
    exportUserData,
    importUserData,
    validateBackupData,
    saveBackup,
    listBackups,
    getBackup,
    deleteBackup,
    getBackupsDirectory,
    checkVersionCompatibility,
};
