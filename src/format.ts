export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Deltas keep their sign in the text so a shrink cannot be misread as growth. */
export function formatSignedBytes(bytes: number): string {
  return `${bytes < 0 ? '-' : '+'}${formatBytes(Math.abs(bytes))}`;
}

export function formatMs(value: number | null): string | null {
  if (value === null) {
    return null;
  }

  return `${value.toFixed(2)}ms`;
}

export function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
