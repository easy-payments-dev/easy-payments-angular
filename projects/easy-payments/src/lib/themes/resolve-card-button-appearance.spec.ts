import { resolveCardButtonAppearance } from './resolve-card-button-appearance';

describe('resolveCardButtonAppearance', () => {
  it('returns empty overrides for null / undefined / non-object', () => {
    expect(resolveCardButtonAppearance(null).label).toBeNull();
    expect(resolveCardButtonAppearance(undefined).cssVars.backgroundColor).toBeNull();
    expect(resolveCardButtonAppearance({} as never).cssVars.textColor).toBeNull();
  });

  it('sanitizes a full valid appearance payload', () => {
    const resolved = resolveCardButtonAppearance({
      label: '  Pay now  ',
      backgroundColor: '#112233',
      textColor: 'rgb(255, 255, 255)',
      fontFamily: 'Georgia, serif',
      fontSize: '16px',
      fontWeight: 700,
      textAlign: 'left',
      borderWidth: '2px',
      borderStyle: 'solid',
      borderColor: '#abcdef',
      borderRadius: '8px',
      minHeight: '48px',
      width: '100%',
      padding: '8px 16px',
      hoverBackgroundColor: '#223344',
      hoverTextColor: '#f8fafc',
      disabledBackgroundColor: '#334455',
      disabledTextColor: '#94a3b8',
      loadingBackgroundColor: '#445566',
      loadingTextColor: '#e2e8f0',
      focusOutlineColor: '#2563eb',
      focusOutlineWidth: '3px',
      focusOutlineOffset: '4px',
    });

    expect(resolved.label).toBe('Pay now');
    expect(resolved.cssVars.backgroundColor).toBe('#112233');
    expect(resolved.cssVars.textColor).toBe('rgb(255, 255, 255)');
    expect(resolved.cssVars.fontFamily).toBe('Georgia, serif');
    expect(resolved.cssVars.fontSize).toBe('16px');
    expect(resolved.cssVars.fontWeight).toBe('700');
    expect(resolved.cssVars.textAlign).toBe('left');
    expect(resolved.cssVars.borderWidth).toBe('2px');
    expect(resolved.cssVars.borderStyle).toBe('solid');
    expect(resolved.cssVars.borderColor).toBe('#abcdef');
    expect(resolved.cssVars.borderRadius).toBe('8px');
    expect(resolved.cssVars.minHeight).toBe('48px');
    expect(resolved.cssVars.width).toBe('100%');
    expect(resolved.cssVars.padding).toBe('8px 16px');
    expect(resolved.cssVars.hoverBackgroundColor).toBe('#223344');
    expect(resolved.cssVars.disabledBackgroundColor).toBe('#334455');
    expect(resolved.cssVars.loadingBackgroundColor).toBe('#445566');
    expect(resolved.cssVars.focusOutlineColor).toBe('#2563eb');
    expect(resolved.cssVars.focusOutlineWidth).toBe('3px');
    expect(resolved.cssVars.focusOutlineOffset).toBe('4px');
  });

  it('forces border none when border is none', () => {
    const resolved = resolveCardButtonAppearance({
      border: 'none',
      borderWidth: '4px',
      borderStyle: 'dashed',
      borderColor: '#ff0000',
    });
    expect(resolved.cssVars.borderWidth).toBe('0px');
    expect(resolved.cssVars.borderStyle).toBe('none');
    expect(resolved.cssVars.borderColor).toBe('transparent');
  });

  it('rejects unsafe or invalid optional values', () => {
    const resolved = resolveCardButtonAppearance({
      label: '<script>alert(1)</script>',
      backgroundColor: 'red; background: url(https://x)',
      textColor: 'expression(alert(1))',
      fontFamily: 'var(--x, url(https://evil))',
      fontSize: '16px; color: red',
      fontWeight: 9999,
      textAlign: 'justify' as never,
      borderStyle: 'groovy' as never,
      padding: '8px 16px 8px 16px 8px',
      width: 'calc(100% - 10px)',
    });

    expect(resolved.label).toBeNull();
    expect(resolved.cssVars.backgroundColor).toBeNull();
    expect(resolved.cssVars.textColor).toBeNull();
    expect(resolved.cssVars.fontFamily).toBeNull();
    expect(resolved.cssVars.fontSize).toBeNull();
    expect(resolved.cssVars.fontWeight).toBeNull();
    expect(resolved.cssVars.textAlign).toBeNull();
    expect(resolved.cssVars.borderStyle).toBeNull();
    expect(resolved.cssVars.padding).toBeNull();
    expect(resolved.cssVars.width).toBeNull();
  });

  it('rejects empty / oversized labels', () => {
    expect(resolveCardButtonAppearance({ label: '   ' }).label).toBeNull();
    expect(resolveCardButtonAppearance({ label: 'x'.repeat(81) }).label).toBeNull();
  });
});
