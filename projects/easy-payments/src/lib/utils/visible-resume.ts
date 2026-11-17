/**
 * DOM-centric resume hook for hung provider sheets / confirms.
 * Fires when the document becomes visible again (Custom Tab / sheet dismiss on
 * Capacitor Android). Hosts may also call the returned handler from
 * `App.addListener('appStateChange')` when `isActive` becomes true.
 *
 * Never infers cancellation — callers must reconcile or unlock for retry.
 */
export function listenForVisibleResume(
  onVisible: () => void,
  doc: Document | null = typeof document !== 'undefined' ? document : null,
): () => void {
  if (!doc) {
    return () => undefined;
  }

  const handler = (): void => {
    if (doc.visibilityState === 'visible') {
      onVisible();
    }
  };

  doc.addEventListener('visibilitychange', handler);
  return () => {
    doc.removeEventListener('visibilitychange', handler);
  };
}
