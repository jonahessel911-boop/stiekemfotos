/** ViewBox + ontmoetingsplek-coördinaten per provincie (SVG-ruimte lander 9). */
export type ProvinceMapMeta = {
  viewBox: string;
  spots: { x: number; y: number }[];
};

export const START_PROVINCE_MAP: Record<string, ProvinceMapMeta> = {
  groningen: {
    viewBox: '143.34 -2.12 59.06 65.28',
    spots: [
      { x: 159.6, y: 18.7 },
      { x: 183.5, y: 15.7 },
      { x: 164.9, y: 39.4 },
      { x: 186.1, y: 42.4 },
      { x: 172.9, y: 27.6 },
    ],
  },
  friesland: {
    viewBox: '77.11 1.37 85.40 65.67',
    spots: [
      { x: 100, y: 22.3 },
      { x: 135.7, y: 19.3 },
      { x: 107.9, y: 43.2 },
      { x: 139.7, y: 46.1 },
      { x: 119.8, y: 31.2 },
    ],
  },
  drenthe: {
    viewBox: '141.01 27.33 55.19 55.21',
    spots: [
      { x: 156.3, y: 45.1 },
      { x: 178.4, y: 42.6 },
      { x: 161.2, y: 62.3 },
      { x: 180.9, y: 64.8 },
      { x: 168.6, y: 52.5 },
    ],
  },
  flevoland: {
    viewBox: '90.28 57.55 51.70 55.60',
    spots: [
      { x: 104.7, y: 75.4 },
      { x: 125.3, y: 72.9 },
      { x: 109.3, y: 92.8 },
      { x: 127.6, y: 95.3 },
      { x: 116.1, y: 82.9 },
    ],
  },
  overijssel: {
    viewBox: '124.75 56.39 71.46 67.22',
    spots: [
      { x: 144.1, y: 77.8 },
      { x: 173.6, y: 74.7 },
      { x: 150.7, y: 99.2 },
      { x: 176.8, y: 102.2 },
      { x: 160.5, y: 86.9 },
    ],
  },
  gelderland: {
    viewBox: '83.69 84.28 100.89 72.26',
    spots: [
      { x: 110.4, y: 107.2 },
      { x: 153.1, y: 103.8 },
      { x: 119.9, y: 130.3 },
      { x: 157.9, y: 133.7 },
      { x: 134.1, y: 117.1 },
    ],
  },
  utrecht: {
    viewBox: '73.23 102.88 48.99 43.20',
    spots: [
      { x: 87, y: 117 },
      { x: 106.3, y: 115.2 },
      { x: 91.3, y: 130.1 },
      { x: 108.5, y: 131.9 },
      { x: 97.7, y: 122.6 },
    ],
  },
  'noord-holland': {
    viewBox: '58.13 29.26 48.22 90.85',
    spots: [
      { x: 71.7, y: 57.7 },
      { x: 90.7, y: 53.5 },
      { x: 75.9, y: 87.4 },
      { x: 92.8, y: 91.7 },
      { x: 82.2, y: 70.4 },
    ],
  },
  'zuid-holland': {
    viewBox: '23.66 100.56 67.97 61.79',
    spots: [
      { x: 42.1, y: 120.3 },
      { x: 70, y: 117.5 },
      { x: 48.3, y: 139.8 },
      { x: 73.1, y: 142.6 },
      { x: 57.6, y: 128.7 },
    ],
  },
  zeeland: {
    viewBox: '-2.29 147.44 54.41 52.50',
    spots: [
      { x: 12.8, y: 164.4 },
      { x: 34.6, y: 162.1 },
      { x: 17.7, y: 180.7 },
      { x: 37, y: 183 },
      { x: 24.9, y: 171.4 },
    ],
  },
  'noord-brabant': {
    viewBox: '41.86 142.40 102.44 56.76',
    spots: [
      { x: 69, y: 160.6 },
      { x: 112.4, y: 158.1 },
      { x: 78.6, y: 178.4 },
      { x: 117.2, y: 180.9 },
      { x: 93.1, y: 168.2 },
    ],
  },
  limburg: {
    viewBox: '113.51 146.66 40.47 91.63',
    spots: [
      { x: 125.1, y: 175.4 },
      { x: 140.6, y: 171.1 },
      { x: 128.6, y: 205.3 },
      { x: 142.4, y: 209.6 },
      { x: 133.7, y: 188.2 },
    ],
  },
};

export function parseViewBox(viewBox: string): { x: number; y: number; w: number; h: number } {
  const [x, y, w, h] = viewBox.split(/\s+/).map(Number);
  return { x, y, w, h };
}

export function spotToPercent(
  spot: { x: number; y: number },
  box: { x: number; y: number; w: number; h: number }
): { left: number; top: number } {
  return {
    left: ((spot.x - box.x) / box.w) * 100,
    top: ((spot.y - box.y) / box.h) * 100,
  };
}
