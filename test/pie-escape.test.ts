import {describe, it, expect} from 'vitest';
import {safeColor, safeThumbUrl} from '../src/apps/user-analytics-pie-helpers';

describe('safeColor', () => {
  it('passes 6-digit hex', () => {
    expect(safeColor('#aabbcc')).toBe('#aabbcc');
  });

  it('passes 3-digit hex', () => {
    expect(safeColor('#abc')).toBe('#abc');
  });

  it('passes 8-digit hex (with alpha)', () => {
    expect(safeColor('#aabbccdd')).toBe('#aabbccdd');
  });

  it('rejects CSS keywords', () => {
    expect(safeColor('red')).toBe('#999');
    expect(safeColor('rebeccapurple')).toBe('#999');
  });

  it('rejects rgb()/rgba() functions', () => {
    expect(safeColor('rgb(255,0,0)')).toBe('#999');
  });

  it('rejects var(...) references', () => {
    expect(safeColor('var(--di-text)')).toBe('#999');
  });

  it('rejects CSS injection attempts', () => {
    expect(safeColor('red; background-image:url(x)')).toBe('#999');
    expect(safeColor("#aabbcc; background:url('x')")).toBe('#999');
    expect(safeColor('#aabbcc"><script>')).toBe('#999');
  });

  it('rejects empty / nullish input', () => {
    expect(safeColor('')).toBe('#999');
    expect(safeColor(null)).toBe('#999');
    expect(safeColor(undefined)).toBe('#999');
  });

  it('rejects 4/5/7-digit hex (not standard)', () => {
    expect(safeColor('#a')).toBe('#999');
    expect(safeColor('#ab')).toBe('#999');
  });
});

describe('safeThumbUrl', () => {
  it('accepts cdn.donmai.us https url', () => {
    const u = 'https://cdn.donmai.us/sample/abc/sample-xxx.jpg';
    expect(safeThumbUrl(u)).toBe(u);
  });

  it('accepts other donmai.us subdomains (images, s, etc.)', () => {
    expect(safeThumbUrl('https://images.donmai.us/x.jpg')).toBe(
      'https://images.donmai.us/x.jpg',
    );
    expect(safeThumbUrl('https://s.donmai.us/x.jpg')).toBe(
      'https://s.donmai.us/x.jpg',
    );
  });

  it('rejects non-donmai hosts', () => {
    expect(safeThumbUrl('https://attacker.example/x.jpg')).toBeNull();
    expect(safeThumbUrl('https://donmai.us.evil.com/x.jpg')).toBeNull();
  });

  it('rejects http (non-https)', () => {
    expect(safeThumbUrl('http://cdn.donmai.us/x.jpg')).toBeNull();
  });

  it('rejects javascript: / data: schemes', () => {
    expect(safeThumbUrl('javascript:alert(1)')).toBeNull();
    expect(safeThumbUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('rejects attribute-injection attempts', () => {
    expect(safeThumbUrl('" onerror="alert(1)" data-x="')).toBeNull();
    expect(
      safeThumbUrl('https://cdn.donmai.us/x.jpg" onerror="alert(1)'),
    ).toBeNull();
  });

  it('rejects empty / nullish input', () => {
    expect(safeThumbUrl('')).toBeNull();
    expect(safeThumbUrl(null)).toBeNull();
    expect(safeThumbUrl(undefined)).toBeNull();
  });

  it('rejects bare donmai.us with no path', () => {
    expect(safeThumbUrl('https://donmai.us')).toBeNull();
    expect(safeThumbUrl('https://cdn.donmai.us')).toBeNull();
  });
});
