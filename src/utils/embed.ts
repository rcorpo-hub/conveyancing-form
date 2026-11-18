/** Coordinate layout with the WordPress host without sharing form answers. */
export function connectEmbed(root: HTMLElement) {
  if (window.parent === window) return;
  document.documentElement.dataset.embedded = 'true';
  let parentOrigin: string;
  try { parentOrigin = new URL(document.referrer).origin; } catch { return; }

  let lastHeight = 0;
  const publishHeight = (force = false) => {
    const height = Math.ceil(root.getBoundingClientRect().height);
    if (height > 0 && (force || height !== lastHeight)) {
      lastHeight = height;
      window.parent.postMessage({ type: 'RAIKAN_FORM_RESIZE', height }, parentOrigin);
    }
  };
  // A load handshake covers either the host or child script loading first.
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== parentOrigin) return;
    if (event.data?.type === 'RAIKAN_FORM_REQUEST_SIZE') publishHeight(true);
  });
  new ResizeObserver(() => publishHeight()).observe(root);
}

/** Changing a step must scroll the outer page too when inside an iframe. */
export function scrollFormToTop() {
  window.scrollTo(0, 0);
  if (window.parent === window) return;
  try {
    window.parent.postMessage({ type: 'RAIKAN_FORM_SCROLL_TOP' }, new URL(document.referrer).origin);
  } catch { /* The standalone form still works when no referrer is available. */ }
}
