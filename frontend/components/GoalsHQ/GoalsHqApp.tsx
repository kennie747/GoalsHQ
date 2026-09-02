import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useGoalsHqStore } from '../../store/useGoalsHqStore';
import GoalsHqDashboard from './GoalsHqDashboard';
import GoalHqDetail from './GoalHqDetail';
import StrategyDetail from './StrategyDetail';

const GoalsHqApp: React.FC = () => {
    const { t } = useTranslation();
    const loadConfig = useGoalsHqStore((s) => s.loadConfig);
    const enabled = useGoalsHqStore((s) => s.enabled);
    const [checked, setChecked] = useState(false);

    useEffect(() => {
        loadConfig().finally(() => setChecked(true));
    }, [loadConfig]);

    if (!checked) {
        return (
            <div className="p-6 text-gray-500 dark:text-gray-400">
                {t('common.loading', 'Loading...')}
            </div>
        );
    }

    if (enabled === false) {
        return <Navigate to="/today" replace />;
    }

    return (
        <Routes>
            <Route index element={<GoalsHqDashboard />} />
            <Route path="goal/:uidSlug" element={<GoalHqDetail />} />
            <Route path="strategy/:uidSlug" element={<StrategyDetail />} />
            <Route path="*" element={<Navigate to="/goalshq" replace />} />
        </Routes>
    );
};

export default GoalsHqApp;
