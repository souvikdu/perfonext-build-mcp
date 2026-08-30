import { describe, expect, it } from 'vitest';

import { formatBytes, formatSignedBytes } from '../src/format.js';

describe('formatSignedBytes', () => {
  it('keeps the sign so a shrink cannot be read as growth', () => {
    expect(formatSignedBytes(-2048)).toBe('-2.0 KB');
    expect(formatSignedBytes(2048)).toBe('+2.0 KB');
  });

  it('marks zero as non-negative rather than dropping the sign', () => {
    expect(formatSignedBytes(0)).toBe('+0 B');
  });

  it('uses the same magnitude formatting as formatBytes', () => {
    expect(formatSignedBytes(-5_242_880)).toBe(`-${formatBytes(5_242_880)}`);
  });
});
