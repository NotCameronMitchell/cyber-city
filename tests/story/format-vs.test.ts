import { describe, expect, it } from 'vitest';
import { formatMetric, formatMetricVs } from '../../src/game/story/conditions';

describe('formatMetricVs: rounding never makes an unmet claim look met', () => {
  it('rounds a just-short share down for a >= claim', () => {
    expect(formatMetric(24.7, 'share')).toBe('25%');
    expect(formatMetricVs(24.7, 25, 'share')).toBe('24%');
    expect(formatMetricVs(24.999, 25, 'share')).toBe('24%');
  });
  it('leaves met and clearly-unmet values alone', () => {
    expect(formatMetricVs(25, 25, 'share')).toBe('25%');
    expect(formatMetricVs(25.4, 25, 'share')).toBe('25%');
    expect(formatMetricVs(17.2, 25, 'share')).toBe('17%');
  });
  it('handles pct, int and at-most comparisons', () => {
    expect(formatMetricVs(0.648, 0.65, 'pct')).toBe('64%');
    expect(formatMetricVs(11999.6, 12000, 'int')).toBe('11,999');
    expect(formatMetricVs(0.304, 0.3, 'pct', true)).toBe('31%');
    expect(formatMetricVs(0.29, 0.3, 'pct', true)).toBe('29%');
  });
});
