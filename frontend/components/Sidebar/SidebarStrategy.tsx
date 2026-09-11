import React, { useEffect, useState } from 'react';
import { Location } from 'react-router-dom';
import {
    RocketLaunchIcon,
    ArchiveBoxIcon,
    ChevronRightIcon,
    PlusIcon,
} from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { createStrategyUrl } from '../../utils/slugUtils';
import { fetchStrategies } from '../../utils/goalsHqService';
import { Strategy } from '../../entities/Strategy';

interface Props {
    handleNavClick: (path: string, title: string, icon?: JSX.Element) => void;
    location: Location;
}

/**
 * Strategy sidebar entry — expand/collapse + "add" behave the same as
 * SidebarGoals.tsx (dropdown chevron listing items, a "+" that jumps to a
 * creation flow), rather than the previous single flat nav link. Archive
 * stays a plain link below it — it has no "add new" concept of its own.
 * Visibility of the whole block is gated by the parent (Sidebar.tsx reads
 * userSettingsStore.goalshqEnabled).
 */
const SidebarStrategy: React.FC<Props> = ({ handleNavClick, location }) => {
    const { t } = useTranslation();
    const [isExpanded, setIsExpanded] = useState(false);

    const goalSummaries = useStore(
        (state) => state.strategiesStore.goalSummaries
    );
    const hasLoaded = useStore((state) => state.strategiesStore.hasLoaded);
    const loadGoalSummaries = useStore(
        (state) => state.strategiesStore.loadGoalSummaries
    );

    const [allStrategies, setAllStrategies] = useState<Strategy[]>([]);

    useEffect(() => {
        if (!hasLoaded) loadGoalSummaries();
        fetchStrategies()
            .then(setAllStrategies)
            .catch(() => setAllStrategies([]));
    }, [hasLoaded, loadGoalSummaries]);

    const path = '/strategy';
    const title = t('goalshq.title', 'Strategy');
    const icon = <RocketLaunchIcon className="h-4 w-4 mr-2" />;
    const headerActive = location.pathname === path;

    const archivePath = '/archive';
    const archiveTitle = t('archive.title', 'Archive');
    const archiveIcon = <ArchiveBoxIcon className="h-4 w-4 flex-shrink-0" />;
    const archiveActive = location.pathname.startsWith('/archive');

    const strategies =
        allStrategies.length > 0
            ? allStrategies
                  .filter((s) => s.status === 'active')
                  .map((s) => ({ uid: s.uid, name: s.name }))
            : goalSummaries
                  .flatMap((g) => g.strategies || [])
                  .filter((s) => s.status === 'active')
                  .map((s) => ({ uid: s.uid, name: s.name }));

    const itemClass = (isActive: boolean) =>
        `group flex justify-between items-center rounded-[8px] pl-[30px] pr-[10px] py-[4px] text-[13.5px] cursor-pointer text-gray-500 dark:text-[oklch(82%_0.006_95)] hover:bg-gray-100 dark:hover:bg-[oklch(24%_0.015_250)] ${
            isActive ? 'bg-gray-100 dark:bg-[oklch(24%_0.015_250)]' : ''
        }`;

    const archiveClass = `mt-1 flex items-center gap-[4px] rounded-[8px] px-[10px] py-[4px] text-[13.5px] cursor-pointer hover:bg-gray-100 dark:hover:bg-[oklch(24%_0.015_250)] ${
        archiveActive
            ? 'bg-gray-100 dark:bg-[oklch(24%_0.015_250)] text-gray-700 dark:text-[oklch(82%_0.006_95)]'
            : 'text-gray-500 dark:text-[oklch(82%_0.006_95)]'
    }`;

    useEffect(() => {
        if (
            strategies.some(
                (s) =>
                    createStrategyUrl({ uid: s.uid, name: s.name }) ===
                    location.pathname
            )
        ) {
            setIsExpanded(true);
        }
    }, [location.pathname, strategies.length]);

    return (
        <>
            <div className="flex flex-col">
                <div
                    className={`group flex justify-between items-center px-[10px] py-[4px] rounded-md hover:bg-gray-100 dark:hover:bg-white/5 ${
                        headerActive ? 'bg-gray-100 dark:bg-white/5' : ''
                    }`}
                >
                    <span
                        className={`flex items-center gap-[6px] text-[10.5px] tracking-[0.01em] font-semibold uppercase cursor-pointer hover:text-black dark:hover:text-white ${
                            headerActive
                                ? 'text-black dark:text-white'
                                : 'text-gray-400 dark:text-[oklch(58%_0.006_95)]'
                        }`}
                        onClick={() => {
                            setIsExpanded(true);
                            handleNavClick(path, title, icon);
                        }}
                    >
                        <RocketLaunchIcon className="h-[14px] w-[14px]" />
                        {title}
                    </span>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                handleNavClick(
                                    '/strategy/new',
                                    t(
                                        'goalshq.newStrategyTitle',
                                        'New Strategy'
                                    ),
                                    icon
                                );
                            }}
                            className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity text-gray-400 dark:text-gray-500 hover:text-black dark:hover:text-white focus:outline-none"
                            aria-label={t(
                                'goalshq.addStrategy',
                                'Add Strategy'
                            )}
                            title={t('goalshq.addStrategy', 'Add Strategy')}
                        >
                            <PlusIcon className="h-3.5 w-3.5" />
                        </button>
                        {strategies.length > 0 && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsExpanded((v) => !v);
                                }}
                                className="text-gray-400 dark:text-gray-500 hover:text-black dark:hover:text-white focus:outline-none"
                            >
                                <ChevronRightIcon
                                    className="h-3 w-3 transition-transform duration-150"
                                    style={{
                                        transform: isExpanded
                                            ? 'rotate(90deg)'
                                            : 'none',
                                    }}
                                />
                            </button>
                        )}
                    </div>
                </div>

                {isExpanded && (
                    <div className="max-h-[168px] overflow-y-auto overscroll-y-contain flex flex-col gap-0.5 mb-1.5">
                        {strategies.map((s) => {
                            const stratPath = createStrategyUrl({
                                uid: s.uid,
                                name: s.name,
                            });
                            return (
                                <div
                                    key={s.uid}
                                    className={itemClass(
                                        stratPath === location.pathname
                                    )}
                                    onClick={() =>
                                        handleNavClick(stratPath, s.name, icon)
                                    }
                                >
                                    <span className="truncate min-w-0">
                                        {s.name}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div
                className={archiveClass}
                onClick={() =>
                    handleNavClick(archivePath, archiveTitle, archiveIcon)
                }
            >
                {archiveIcon}
                {archiveTitle}
            </div>
        </>
    );
};

export default SidebarStrategy;
