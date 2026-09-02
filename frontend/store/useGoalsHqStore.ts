/**
 * Dedicated Zustand store for GoalsHQ. Kept separate from the app's main
 * `useStore` (rather than added as a slice) purely to keep the add-on's merge
 * surface at zero for that hot file — see
 * docs/goalshq/adr/0001-isolation-architecture.md. Same slice shape as the
 * house pattern.
 */

import { create } from 'zustand';
import { GoalSummary } from '../entities/GoalsHq';
import { fetchGoalshqConfig, fetchGoalshqGoals } from '../utils/goalsHqService';

interface GoalsHqState {
    enabled: boolean | null;
    goals: GoalSummary[];
    isLoading: boolean;
    isError: boolean;
    hasLoaded: boolean;
    loadConfig: () => Promise<boolean>;
    loadGoals: (force?: boolean) => Promise<void>;
    setGoals: (goals: GoalSummary[]) => void;
}

export const useGoalsHqStore = create<GoalsHqState>((set, get) => ({
    enabled: null,
    goals: [],
    isLoading: false,
    isError: false,
    hasLoaded: false,

    loadConfig: async () => {
        if (get().enabled !== null) return get().enabled as boolean;
        const { enabled } = await fetchGoalshqConfig();
        set({ enabled });
        return enabled;
    },

    loadGoals: async (force = false) => {
        const state = get();
        if (state.isLoading) return;
        if (state.hasLoaded && !force) return;
        set({ isLoading: true, isError: false });
        try {
            const goals = await fetchGoalshqGoals();
            set({ goals, isLoading: false, hasLoaded: true });
        } catch {
            set({ isLoading: false, isError: true });
        }
    },

    setGoals: (goals) => set({ goals }),
}));
