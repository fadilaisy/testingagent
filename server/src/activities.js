// Activity categories (PRD §1) with the numbers used to estimate duration and
// difficulty. Speeds are moderate-group averages, not race pace.

export const ACTIVITY_TYPES = {
  road_cycling: { label: 'Road Cycling', speedKmh: 25, climbMPerH: 800, effortPerM: 1 / 50, thresholds: [40, 80, 140] },
  gravel: { label: 'Gravel', speedKmh: 18, climbMPerH: 600, effortPerM: 1 / 40, thresholds: [30, 60, 110] },
  mtb: { label: 'MTB', speedKmh: 12, climbMPerH: 500, effortPerM: 1 / 25, thresholds: [20, 40, 70] },
  running: { label: 'Running', speedKmh: 10, climbMPerH: 1000, effortPerM: 1 / 100, thresholds: [10, 21, 42] },
  trail_running: { label: 'Trail Running', speedKmh: 7, climbMPerH: 600, effortPerM: 1 / 50, thresholds: [12, 25, 45] },
  hiking: { label: 'Hiking', speedKmh: 4, climbMPerH: 600, effortPerM: 1 / 80, thresholds: [8, 16, 28] },
  other: { label: 'Other Outdoor', speedKmh: 8, climbMPerH: 600, effortPerM: 1 / 60, thresholds: [10, 25, 50] },
};

export const ACTIVITY_KEYS = Object.keys(ACTIVITY_TYPES);
export const DIFFICULTIES = ['easy', 'moderate', 'hard', 'extreme'];

export function isActivityType(value) {
  return Object.hasOwn(ACTIVITY_TYPES, value);
}

export function estimateDurationSeconds(activityType, distanceM, elevationGainM) {
  const t = ACTIVITY_TYPES[activityType] ?? ACTIVITY_TYPES.other;
  const hours = distanceM / 1000 / t.speedKmh + (elevationGainM ?? 0) / t.climbMPerH;
  return Math.round(hours * 3600);
}

export function estimateDifficulty(activityType, distanceM, elevationGainM) {
  const t = ACTIVITY_TYPES[activityType] ?? ACTIVITY_TYPES.other;
  const effort = distanceM / 1000 + (elevationGainM ?? 0) * t.effortPerM;
  const [easy, moderate, hard] = t.thresholds;
  if (effort < easy) return 'easy';
  if (effort < moderate) return 'moderate';
  if (effort < hard) return 'hard';
  return 'extreme';
}

// Track condition vocabulary (PRD §16). Each value carries a severity used for
// the green/yellow/red indicators and the route safety warning.
export const CONDITION_CATEGORIES = {
  road: {
    label: 'Road condition',
    values: { good: 0, rough: 1, damaged: 2, road_work: 2, flooded: 2, slippery: 2 },
  },
  traffic: { label: 'Traffic', values: { empty: 0, light: 0, moderate: 1, heavy: 2 } },
  weather: { label: 'Weather', values: { sunny: 0, cloudy: 0, rain: 1, heavy_rain: 2 } },
  trail: { label: 'Trail condition', values: { dry: 0, wet: 1, muddy: 1, rocky: 1, blocked: 2 } },
  crowd: { label: 'Crowd level', values: { low: 0, medium: 1, high: 2 } },
};

export function conditionSeverity(category, value) {
  return CONDITION_CATEGORIES[category]?.values[value];
}
