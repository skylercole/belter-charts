/**
 * Time conventions.
 *
 * Internal app time: milliseconds since Unix epoch (plain JS Date semantics),
 * treated as UTC. Ephemeris files are indexed by JD TDB. We ignore the
 * TDB-UTC offset (~69 s today): at asteroid orbital speeds (~20 km/s) that is
 * ~1400 km of along-track offset, orders of magnitude inside our 0.1%
 * acceptance band. See ASSUMPTIONS.md.
 */

export const MS_PER_DAY = 86_400_000;
export const SEC_PER_DAY = 86_400;
export const JD_UNIX_EPOCH = 2440587.5;

export function dateToJd(date: Date): number {
  return date.getTime() / MS_PER_DAY + JD_UNIX_EPOCH;
}

export function jdToDate(jd: number): Date {
  return new Date((jd - JD_UNIX_EPOCH) * MS_PER_DAY);
}
