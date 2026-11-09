/**
 * Karma shares one Chromium page across all specs. Chromium silently drops
 * history.replaceState after ~200 rapid updates unless the test launcher
 * disables IPC flooding protection. These helpers:
 * - skip no-op writes (current URL already matches)
 * - fail loudly when the browser rejects a write
 */

function currentPathSearchHash(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/** Normalize to a same-origin path+search+hash (leading slash required). */
function normalizeTestUrl(pathWithSearchAndHash: string): string {
  if (!pathWithSearchAndHash) {
    return '/';
  }
  if (
    pathWithSearchAndHash.startsWith('http:') ||
    pathWithSearchAndHash.startsWith('https:')
  ) {
    const url = new URL(pathWithSearchAndHash);
    return `${url.pathname}${url.search}${url.hash}`;
  }
  return pathWithSearchAndHash.startsWith('/')
    ? pathWithSearchAndHash
    : `/${pathWithSearchAndHash}`;
}

/**
 * Set the Karma page location via history.replaceState.
 * No-ops when the page is already at the target. Throws when Chromium drops the write.
 */
export function setTestLocation(pathWithSearchAndHash: string): void {
  const target = normalizeTestUrl(pathWithSearchAndHash);
  if (currentPathSearchHash() === target) {
    return;
  }
  history.replaceState({}, '', target);
  const actual = currentPathSearchHash();
  if (actual !== target) {
    throw new Error(
      `history.replaceState did not apply (Chromium history throttle?). attempted=${target} actual=${actual}`,
    );
  }
}

/** Restore a clean root path when the page is not already there. */
export function resetTestLocation(): void {
  setTestLocation('/');
}
