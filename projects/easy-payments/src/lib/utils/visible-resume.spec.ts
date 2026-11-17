import { listenForVisibleResume } from './visible-resume';

describe('listenForVisibleResume', () => {
  it('invokes the callback when the document becomes visible', () => {
    const doc = document.implementation.createHTMLDocument('resume');
    Object.defineProperty(doc, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    const onVisible = jasmine.createSpy('onVisible');
    const stop = listenForVisibleResume(onVisible, doc);
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(onVisible).toHaveBeenCalledTimes(1);
    stop();
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(onVisible).toHaveBeenCalledTimes(1);
  });

  it('ignores hidden visibility events', () => {
    const doc = document.implementation.createHTMLDocument('resume');
    Object.defineProperty(doc, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    const onVisible = jasmine.createSpy('onVisible');
    const stop = listenForVisibleResume(onVisible, doc);
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(onVisible).not.toHaveBeenCalled();
    stop();
  });

  it('is a no-op when document is null', () => {
    expect(() => listenForVisibleResume(() => undefined, null)()).not.toThrow();
  });
});
