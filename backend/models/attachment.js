const { DataTypes } = require('sequelize');
const { uid } = require('../utils/uid');

/**
 * Polymorphic file attachment. `parent_type` ∈ 'task' | 'goalshq_record'
 * (extensible). Files are served back to browsers, so uploads go through the
 * MIME whitelist + inline-safe rules in backend/utils/attachment-utils.js and
 * the per-resource access check in backend/middleware/uploadsAccess.js.
 *
 * `task_id` is retained (nullable) for backward compatibility with the old
 * task-only routes; new code writes parent_type/parent_id.
 */
module.exports = (sequelize) => {
    const Attachment = sequelize.define(
        'Attachment',
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            uid: {
                type: DataTypes.STRING,
                allowNull: false,
                unique: true,
                defaultValue: uid,
            },
            parent_type: {
                type: DataTypes.STRING(30),
                allowNull: false,
                defaultValue: 'task',
            },
            parent_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
            },
            task_id: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: 'tasks', key: 'id' },
            },
            user_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: { model: 'users', key: 'id' },
            },
            original_filename: { type: DataTypes.STRING, allowNull: false },
            stored_filename: { type: DataTypes.STRING, allowNull: false },
            file_size: { type: DataTypes.INTEGER, allowNull: false },
            mime_type: { type: DataTypes.STRING, allowNull: false },
            file_path: { type: DataTypes.STRING, allowNull: false },
        },
        {
            tableName: 'attachments',
            indexes: [
                { fields: ['task_id'] },
                { fields: ['user_id'] },
                { fields: ['uid'], unique: true },
                { fields: ['parent_type', 'parent_id'] },
            ],
        }
    );

    Attachment.associate = function (models) {
        Attachment.belongsTo(models.Task, {
            foreignKey: 'task_id',
            as: 'Task',
        });
        Attachment.belongsTo(models.User, {
            foreignKey: 'user_id',
            as: 'User',
        });
    };

    return Attachment;
};
