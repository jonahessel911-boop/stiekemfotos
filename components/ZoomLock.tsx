'use client';

import { useEffect } from 'react';

/**
 * Schakelt pinch-zoom en dubbeltik-zoom hard uit op mobiel — vooral nodig voor
 * iOS Safari, dat sinds iOS 10 `user-scalable=no` in de viewport meta negeert.
 *
 * Combineert drie maatregelen:
 *  1. `gesturestart/gesturechange/gestureend` preventDefault → blokkeert
 *     Safari's pinch-zoom gesture API.
 *  2. `touchmove` met ≥2 vingers → preventDefault → blokkeert multi-touch zoom
 *     in andere browsers / WebKit varianten.
 *  3. `dblclick` preventDefault → blokkeert double-tap-to-zoom op desktop touch
 *     en sommige Androids.
 *
 * Elementen die zelf zoom willen toestaan (bv. fullscreen foto-viewer) kunnen
 * dit per element opheffen via `data-allow-zoom="1"`.
 */
export default function ZoomLock() {
  useEffect(() => {
    const isInsideAllowZoom = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      return target.closest('[data-allow-zoom="1"]') !== null;
    };

    const onGesture = (e: Event) => {
      if (isInsideAllowZoom(e.target)) return;
      e.preventDefault();
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2 && !isInsideAllowZoom(e.target)) {
        e.preventDefault();
      }
    };

    const onDblClick = (e: MouseEvent) => {
      if (isInsideAllowZoom(e.target)) return;
      e.preventDefault();
    };

    /** `passive: false` is verplicht voor preventDefault op touchmove in moderne browsers. */
    document.addEventListener('gesturestart', onGesture, { passive: false });
    document.addEventListener('gesturechange', onGesture, { passive: false });
    document.addEventListener('gestureend', onGesture, { passive: false });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('dblclick', onDblClick, { passive: false });

    return () => {
      document.removeEventListener('gesturestart', onGesture);
      document.removeEventListener('gesturechange', onGesture);
      document.removeEventListener('gestureend', onGesture);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('dblclick', onDblClick);
    };
  }, []);

  return null;
}
