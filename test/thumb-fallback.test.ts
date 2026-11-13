// @vitest-environment jsdom

import {describe, it, expect, vi, afterEach} from 'vitest';
import {
  THUMB_FALLBACK_CLASS,
  applyThumbFallback,
  installThumbFallback,
} from '../src/ui/thumb-fallback';

/** `error` on an <img> does not bubble — mirror the browser. */
function fireImgError(img: Element): void {
  img.dispatchEvent(new Event('error', {bubbles: false}));
}

function makeRoot(html: string): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  installThumbFallback(root);
  root.innerHTML = html;
  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('installThumbFallback', () => {
  it('swaps a failed marked thumbnail for the favicon', () => {
    const root = makeRoot(
      `<a href="/posts/1"><img class="${THUMB_FALLBACK_CLASS}" src="/broken.jpg"></a>`,
    );
    const img = root.querySelector('img')!;
    fireImgError(img);
    expect(img.getAttribute('src')).toBe('/favicon.ico');
    expect(img.style.objectFit).toBe('contain');
    expect(img.style.padding).toBe('4px');
  });

  it('applies the fallback only once (no loop if the favicon fails too)', () => {
    const root = makeRoot(
      `<img class="${THUMB_FALLBACK_CLASS}" src="/broken.jpg">`,
    );
    const img = root.querySelector('img')!;
    fireImgError(img);
    img.setAttribute('src', '/still-broken.ico');
    fireImgError(img);
    expect(img.getAttribute('src')).toBe('/still-broken.ico');
  });

  it('leaves unmarked images alone', () => {
    const root = makeRoot('<img src="/broken.jpg">');
    const img = root.querySelector('img')!;
    fireImgError(img);
    expect(img.getAttribute('src')).toBe('/broken.jpg');
  });

  it('keeps working after the container innerHTML is replaced', () => {
    const root = makeRoot('<p>first render</p>');
    root.innerHTML = `<img class="${THUMB_FALLBACK_CLASS}" src="/x.jpg">`;
    const img = root.querySelector('img')!;
    fireImgError(img);
    expect(img.getAttribute('src')).toBe('/favicon.ico');
  });

  it('adds one listener per container however often it is called', () => {
    const root = document.createElement('div');
    const spy = vi.spyOn(root, 'addEventListener');
    installThumbFallback(root);
    installThumbFallback(root);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('error', expect.any(Function), true);
  });
});

describe('applyThumbFallback', () => {
  it('works on a detached image too', () => {
    const img = document.createElement('img');
    img.src = '/x.jpg';
    applyThumbFallback(img);
    expect(img.getAttribute('src')).toBe('/favicon.ico');
    expect(img.dataset.diFallback).toBe('1');
  });
});
