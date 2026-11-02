import { inject, Injectable } from '@angular/core';
import { BrowserGuard } from '../utils/browser-guard';

export interface SdkLoadOptions {
  id: string;
  src: string;
  async?: boolean;
  defer?: boolean;
  attributes?: Record<string, string>;
  /** Optional load timeout in ms. On expiry the script tag is removed and the promise rejects. */
  timeoutMs?: number;
}

/** Redact common secret-bearing query params from SDK URLs used in Error messages. */
export function redactSdkUrl(src: string): string {
  return src
    .replace(/([?&]client-id=)[^&]*/gi, '$1REDACTED')
    .replace(/([?&]client_id=)[^&]*/gi, '$1REDACTED')
    .replace(/([?&]publishable[_-]?key=)[^&]*/gi, '$1REDACTED');
}

@Injectable({ providedIn: 'root' })
export class SdkLoaderService {
  private readonly browser = inject(BrowserGuard);
  private readonly loadedScripts = new Map<string, Promise<void>>();

  loadScript(options: SdkLoadOptions): Promise<void> {
    if (!this.browser.isBrowser) {
      return Promise.reject(new Error('SDK loading is only available in the browser.'));
    }

    const existing = this.loadedScripts.get(options.id);
    if (existing) {
      return existing;
    }

    const promise = this.loadScriptOnce(options).catch((error: unknown) => {
      // Allow a later retry after a network / script failure.
      this.loadedScripts.delete(options.id);
      throw error;
    });

    this.loadedScripts.set(options.id, promise);
    return promise;
  }

  isLoaded(id: string): boolean {
    return this.loadedScripts.has(id);
  }

  /** Removes a previously loaded script so a new `src` (e.g. locale) can load under a new id. */
  unloadScript(id: string): void {
    this.loadedScripts.delete(id);
    if (!this.browser.isBrowser) {
      return;
    }
    this.browser.getDocument()?.getElementById(id)?.remove();
  }

  private loadScriptOnce(options: SdkLoadOptions): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const doc = this.browser.getDocument();
      if (!doc) {
        reject(new Error('Document is not available.'));
        return;
      }

      const existingScript = doc.getElementById(options.id);
      if (existingScript) {
        // Stale tags (e.g. a previous failed attempt) must not short-circuit as success.
        existingScript.remove();
      }

      const script = doc.createElement('script');
      script.id = options.id;
      script.src = options.src;
      script.async = options.async ?? true;
      script.defer = options.defer ?? false;

      if (options.attributes) {
        for (const [key, value] of Object.entries(options.attributes)) {
          script.setAttribute(key, value);
        }
      }

      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const settle = (fn: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId !== undefined) {
          clearTimeout(timeoutId);
        }
        fn();
      };

      script.onload = () => settle(() => resolve());
      script.onerror = () =>
        settle(() => {
          script.remove();
          reject(new Error(`Failed to load SDK: ${redactSdkUrl(options.src)}`));
        });

      if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          settle(() => {
            script.remove();
            reject(
              new Error(
                `Timed out loading SDK after ${options.timeoutMs}ms: ${redactSdkUrl(options.src)}`,
              ),
            );
          });
        }, options.timeoutMs);
      }

      doc.head.appendChild(script);
    });
  }
}
