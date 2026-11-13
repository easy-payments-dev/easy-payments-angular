import {
  clampGooglePayButtonRadius,
  parseCssLengthToPx,
  resolvePayPalBorderRadiusStyle,
} from './button-border-radius';

describe('button-border-radius helpers', () => {
  it('parses pixel lengths and accepts 0', () => {
    expect(parseCssLengthToPx('0')).toBe(0);
    expect(parseCssLengthToPx('0px')).toBe(0);
    expect(parseCssLengthToPx('4')).toBe(4);
    expect(parseCssLengthToPx('4px')).toBe(4);
    expect(parseCssLengthToPx('999px')).toBe(999);
    expect(parseCssLengthToPx(' 12px ')).toBe(12);
    expect(parseCssLengthToPx('')).toBeNull();
    expect(parseCssLengthToPx('1rem')).toBeNull();
    expect(parseCssLengthToPx('50%')).toBeNull();
    expect(parseCssLengthToPx(null)).toBeNull();
  });

  it('maps PayPal/Venmo radius including the borderRadius=0 sharp workaround', () => {
    expect(resolvePayPalBorderRadiusStyle(null)).toEqual({ shape: 'rect' });
    expect(resolvePayPalBorderRadiusStyle(0)).toEqual({ shape: 'sharp' });
    expect(resolvePayPalBorderRadiusStyle(4)).toEqual({ borderRadius: 4 });
    expect(resolvePayPalBorderRadiusStyle(999)).toEqual({ borderRadius: 999 });
  });

  it('clamps Google Pay buttonRadius to half the button height', () => {
    expect(clampGooglePayButtonRadius(0)).toBe(0);
    expect(clampGooglePayButtonRadius(4)).toBe(4);
    expect(clampGooglePayButtonRadius(20)).toBe(20);
    expect(clampGooglePayButtonRadius(999)).toBe(20);
    expect(clampGooglePayButtonRadius(30, 48)).toBe(24);
  });
});
