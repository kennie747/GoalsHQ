import React, { useEffect } from 'react';
import { Location } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RocketLaunchIcon } from '@heroicons/react/24/outline';
import { useGoalsHqStore } from '../../store/useGoalsHqStore';

interface Props {
    handleNavClick: (path: string, title: string, icon?: JSX.Element) => void;
    location: Location;
}

/**
 * GoalsHQ sidebar entry (add-on integration hook). Self-hides when the feature
 * is disabled via GOALSHQ_ENABLED.
 */
const SidebarGoalsHQ: React.FC<Props> = ({ handleNavClick, location }) => {
    const { t } = useTranslation();
    const enabled = useGoalsHqStore((s) => s.enabled);
    const loadConfig = useGoalsHqStore((s) => s.loadConfig);

    useEffect(() => {
        loadConfig().catch(() => undefined);
    }, [loadConfig]);

    if (enabled === false) return null;

    const path = '/goalshq';
    const title = t('goalshq.title', 'GoalsHQ');
    const icon = <RocketLaunchIcon className="h-4 w-4 flex-shrink-0" />;
    const active = location.pathname.startsWith('/goalshq');

    return (
        <ul className="flex flex-col">
            <li className="p-0 list-none">
                <div
                    className={`flex items-center gap-[4px] rounded-[8px] px-[10px] py-[4px] text-[13.5px] cursor-pointer hover:bg-gray-100 dark:hover:bg-[oklch(24%_0.015_250)] ${
                        active
                            ? 'bg-gray-100 dark:bg-[oklch(24%_0.015_250)] text-gray-700 dark:text-[oklch(82%_0.006_95)]'
                            : 'text-gray-500 dark:text-[oklch(82%_0.006_95)]'
                    }`}
                    onClick={() => handleNavClick(path, title, icon)}
                >
                    {icon}
                    {title}
                </div>
            </li>
        </ul>
    );
};

export default SidebarGoalsHQ;
