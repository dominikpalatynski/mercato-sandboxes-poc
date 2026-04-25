// Tiny wrapper around Intl.RelativeTimeFormat that picks the largest unit
// where the magnitude is >= 1 ("2 minutes ago", "3 days ago"). Always emits
// English; runs on both server and client without locale configuration.

const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['week', 60 * 60 * 24 * 7],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
  ['second', 1],
];

export function formatRelative(date: Date | string | number, now: Date = new Date()): string {
  const d = date instanceof Date ? date : new Date(date);
  const deltaSec = Math.round((d.getTime() - now.getTime()) / 1000);
  const absSec = Math.abs(deltaSec);
  for (const [unit, secInUnit] of UNITS) {
    if (absSec >= secInUnit || unit === 'second') {
      const value = Math.round(deltaSec / secInUnit);
      return RTF.format(value, unit);
    }
  }
  // Fallback (unreachable thanks to the seconds catch-all above).
  return RTF.format(deltaSec, 'second');
}
