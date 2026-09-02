const math = require('../../../modules/goalshq/operations/progress-math');

describe('goalshq/progress-math', () => {
    describe('keyResultPercent', () => {
        it('increase: fraction of the baseline→target gap closed', () => {
            expect(
                math.keyResultPercent({
                    direction: 'increase',
                    baseline_value: 0,
                    target_value: 100,
                    current_value: 40,
                })
            ).toBe(40);
        });

        it('increase: clamps to 0..100', () => {
            expect(
                math.keyResultPercent({
                    direction: 'increase',
                    baseline_value: 0,
                    target_value: 100,
                    current_value: 150,
                })
            ).toBe(100);
            expect(
                math.keyResultPercent({
                    direction: 'increase',
                    baseline_value: 0,
                    target_value: 100,
                    current_value: -10,
                })
            ).toBe(0);
        });

        it('decrease: progress as the value drops toward target', () => {
            expect(
                math.keyResultPercent({
                    direction: 'decrease',
                    baseline_value: 100,
                    target_value: 0,
                    current_value: 25,
                })
            ).toBe(75);
        });

        it('maintain: 100 at/above target', () => {
            expect(
                math.keyResultPercent({
                    direction: 'maintain',
                    target_value: 8,
                    current_value: 9,
                })
            ).toBe(100);
            expect(
                math.keyResultPercent({
                    direction: 'maintain',
                    target_value: 8,
                    current_value: 4,
                })
            ).toBe(50);
        });

        it('baseline === target: binary', () => {
            expect(
                math.keyResultPercent({
                    direction: 'increase',
                    baseline_value: 10,
                    target_value: 10,
                    current_value: 10,
                })
            ).toBe(100);
            expect(
                math.keyResultPercent({
                    direction: 'increase',
                    baseline_value: 10,
                    target_value: 10,
                    current_value: 9,
                })
            ).toBe(0);
        });

        it('missing target → null', () => {
            expect(
                math.keyResultPercent({
                    direction: 'increase',
                    baseline_value: 0,
                    current_value: 5,
                })
            ).toBeNull();
        });
    });

    describe('aggregateKeyResults', () => {
        it('averages per-KR percentages', () => {
            expect(
                math.aggregateKeyResults([
                    {
                        direction: 'increase',
                        baseline_value: 0,
                        target_value: 100,
                        current_value: 100,
                    },
                    {
                        direction: 'increase',
                        baseline_value: 0,
                        target_value: 100,
                        current_value: 0,
                    },
                ])
            ).toBe(50);
        });
        it('empty → null', () => {
            expect(math.aggregateKeyResults([])).toBeNull();
        });
    });

    describe('milestonePercent', () => {
        it('achieved / total', () => {
            expect(
                math.milestonePercent([
                    { status: 'achieved' },
                    { status: 'achieved' },
                    { status: 'pending' },
                    { status: 'missed' },
                ])
            ).toBe(50);
        });
        it('none → null', () => {
            expect(math.milestonePercent([])).toBeNull();
        });
    });

    describe('taskBucketPercent', () => {
        it('done / total', () => {
            expect(
                math.taskBucketPercent({ doneWeight: 3, totalWeight: 4 })
            ).toBe(75);
        });
        it('empty bucket → null', () => {
            expect(
                math.taskBucketPercent({ doneWeight: 0, totalWeight: 0 })
            ).toBeNull();
        });
    });

    describe('weightedAverage', () => {
        it('weights values', () => {
            expect(
                math.weightedAverage([
                    { value: 100, weight: 3 },
                    { value: 0, weight: 1 },
                ])
            ).toBe(75);
        });
        it('skips null values', () => {
            expect(
                math.weightedAverage([
                    { value: null, weight: 5 },
                    { value: 50, weight: 1 },
                ])
            ).toBe(50);
        });
        it('no weight → null', () => {
            expect(
                math.weightedAverage([{ value: null, weight: 1 }])
            ).toBeNull();
            expect(math.weightedAverage([])).toBeNull();
        });
    });

    describe('expectedPercent', () => {
        it('fraction of the window elapsed', () => {
            expect(
                math.expectedPercent('2026-01-01', '2026-01-11', '2026-01-06')
            ).toBe(50);
        });
        it('degenerate (inverted) window → treat as time-up', () => {
            expect(
                math.expectedPercent('2026-01-10', '2026-01-01', '2026-01-05')
            ).toBe(100);
            expect(
                math.expectedPercent('2026-01-10', '2026-01-01', '2025-12-01')
            ).toBe(0);
        });
        it('missing dates → null', () => {
            expect(
                math.expectedPercent(null, '2026-01-11', '2026-01-06')
            ).toBeNull();
        });
    });

    describe('health', () => {
        const start = '2026-01-01';
        const target = '2026-01-11';
        const mid = '2026-01-06'; // expected 50%

        it('on_track when within slack of expected', () => {
            expect(math.health(45, start, target, mid)).toBe('on_track');
        });
        it('at_risk when moderately behind', () => {
            expect(math.health(30, start, target, mid)).toBe('at_risk');
        });
        it('off_track when far behind', () => {
            expect(math.health(10, start, target, mid)).toBe('off_track');
        });
        it('no_data without a target date', () => {
            expect(math.health(50, start, null, mid)).toBe('no_data');
        });
        it('no_data with null percent', () => {
            expect(math.health(null, start, target, mid)).toBe('no_data');
        });
    });
});
