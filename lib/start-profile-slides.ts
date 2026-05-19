/** Slides voor /start/2 en /start/3 — zelfde set, ander pad-prefix. */
export function startProfileSlides(basePath: '/start/2' | '/start/3') {
  return [1, 2, 3, 4, 5].map((n) => ({
    src: `${basePath}/profile-${n}.png`,
  }));
}
