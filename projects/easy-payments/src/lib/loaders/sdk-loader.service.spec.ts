import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { redactSdkUrl, SdkLoaderService } from './sdk-loader.service';

describe('redactSdkUrl', () => {
  it('redacts PayPal client-id query values', () => {
    expect(
      redactSdkUrl(
        'https://www.paypal.com/sdk/js?client-id=SECRET_CLIENT&currency=USD&locale=en_US',
      ),
    ).toBe('https://www.paypal.com/sdk/js?client-id=REDACTED&currency=USD&locale=en_US');
  });
});

describe('SdkLoaderService', () => {
  let loader: SdkLoaderService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: PLATFORM_ID, useValue: 'browser' }],
    });
    loader = TestBed.inject(SdkLoaderService);
    document.querySelectorAll('script[id^="test-sdk-"]').forEach((node) => node.remove());
  });

  afterEach(() => {
    document.querySelectorAll('script[id^="test-sdk-"]').forEach((node) => node.remove());
  });

  it('removes failed scripts and allows a retry with a fresh request', async () => {
    let attempts = 0;
    const originalCreate = document.createElement.bind(document);
    spyOn(document, 'createElement').and.callFake(((tag: string) => {
      const el = originalCreate(tag);
      if (tag.toLowerCase() === 'script') {
        queueMicrotask(() => {
          attempts += 1;
          if (attempts === 1) {
            el.onerror?.(new Event('error') as never);
          } else {
            el.onload?.(new Event('load') as never);
          }
        });
      }
      return el;
    }) as typeof document.createElement);

    await expectAsync(
      loader.loadScript({
        id: 'test-sdk-retry',
        src: 'https://www.paypal.com/sdk/js?client-id=SECRET&currency=USD',
      }),
    ).toBeRejectedWithError(/Failed to load SDK: .*client-id=REDACTED/);

    expect(document.getElementById('test-sdk-retry')).toBeNull();

    await expectAsync(
      loader.loadScript({
        id: 'test-sdk-retry',
        src: 'https://www.paypal.com/sdk/js?client-id=SECRET&currency=USD',
      }),
    ).toBeResolved();
    expect(attempts).toBe(2);
  });

  it('does not treat a leftover script tag as a successful load', async () => {
    const stale = document.createElement('script');
    stale.id = 'test-sdk-stale';
    stale.src = 'https://example.test/stale.js';
    document.head.appendChild(stale);

    let loaded = false;
    const originalCreate = document.createElement.bind(document);
    spyOn(document, 'createElement').and.callFake(((tag: string) => {
      const el = originalCreate(tag);
      if (tag.toLowerCase() === 'script') {
        queueMicrotask(() => {
          loaded = true;
          el.onload?.(new Event('load') as never);
        });
      }
      return el;
    }) as typeof document.createElement);

    await loader.loadScript({
      id: 'test-sdk-stale',
      src: 'https://www.paypal.com/sdk/js?client-id=abc&currency=USD',
    });

    expect(loaded).toBeTrue();
    expect(document.getElementById('test-sdk-stale')).toBeTruthy();
  });

  it('rejects with a timeout message when the script never settles', async () => {
    const originalCreate = document.createElement.bind(document);
    spyOn(document, 'createElement').and.callFake(((tag: string) => {
      // Intentionally never fire onload/onerror.
      return originalCreate(tag);
    }) as typeof document.createElement);

    await expectAsync(
      loader.loadScript({
        id: 'test-sdk-timeout',
        src: 'https://www.paypal.com/sdk/js?client-id=SECRET&currency=USD',
        timeoutMs: 30,
      }),
    ).toBeRejectedWithError(/Timed out loading SDK after 30ms: .*client-id=REDACTED/);

    expect(document.getElementById('test-sdk-timeout')).toBeNull();
  });
});
