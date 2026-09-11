const { DataTypes } = require('sequelize');
const { uid } = require('../utils/uid');

/**
 * A record of one Data Exchange export or (successful) import commit — see
 * docs/16-data-exchange.md. Previews are not logged; they are read-only and
 * disposable by design. Kept for the user's own history (last N shown in the
 * UI) and for support/debugging, not as an audit/compliance log.
 */
module.exports = (sequelize) => {
    const DataExchangeJob = sequelize.define(
        'DataExchangeJob',
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
            user_id: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'users',
                    key: 'id',
                },
            },
            direction: {
                type: DataTypes.ENUM('export', 'import'),
                allowNull: false,
            },
            format: {
                type: DataTypes.ENUM('xlsx', 'csv'),
                allowNull: false,
            },
            scopes: {
                type: DataTypes.JSON,
                allowNull: false,
                comment: 'Resource keys involved, e.g. ["tasks","projects"]',
            },
            mode: {
                type: DataTypes.STRING,
                allowNull: true,
                comment: '"merge" or "sync" — imports only',
            },
            filename: {
                type: DataTypes.STRING,
                allowNull: true,
            },
            status: {
                type: DataTypes.ENUM('success', 'error'),
                allowNull: false,
                defaultValue: 'success',
            },
            stats: {
                type: DataTypes.JSON,
                allowNull: true,
                comment:
                    'Per-resource created/updated/unchanged/deleted counts',
            },
            error_message: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
        },
        {
            tableName: 'data_exchange_jobs',
            updatedAt: false,
            indexes: [{ fields: ['user_id', 'created_at'] }],
        }
    );

    return DataExchangeJob;
};
