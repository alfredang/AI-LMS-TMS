import pool from '../db';

/** The class venue as a postal address for the map link. A run with its own street gives
 *  "Blk Street #Floor-Unit Building, Singapore Postal"; a run with no street (most runs carry only
 *  floor, unit and postal code) is held at the academy, so the provider's address is used.
 *  Online-only classes have no venue. */
export function venueAddress(run: any, providerAddress: unknown): string | null {
  const t = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const format = t(run.format).toLowerCase();
  if (!format.includes('hybrid') && (format.includes('online') || format.includes('virtual'))) return null;
  const street = t(run.venue_street);
  if (street) {
    const unit = t(run.venue_floor) && t(run.venue_unit) ? `#${t(run.venue_floor)}-${t(run.venue_unit)}` : '';
    const line = [t(run.venue_block), street, unit, t(run.venue_building)].filter(Boolean).join(' ');
    return [line, t(run.venue_postal_code) ? `Singapore ${t(run.venue_postal_code)}` : ''].filter(Boolean).join(', ');
  }
  return t(providerAddress) || null;
}

/** The raw venue columns venueAddress() reads, for a query on course_run aliased "cr". */
export const VENUE_COLUMNS = `cr.venue_block, cr.venue_street, cr.venue_floor, cr.venue_unit, cr.venue_building, cr.venue_postal_code`;

/** The provider's address, used for runs that carry no street of their own. */
export async function providerAddress(): Promise<string | null> {
  const r = await pool.query(`SELECT company_address AS address FROM training_provider ORDER BY created_at ASC LIMIT 1`)
    .catch(() => ({ rows: [] as any[] }));
  return r.rows[0]?.address || null;
}

/** Replaces the raw venue columns on each row with the one venue address. */
export function withVenue<T extends Record<string, any>>(rows: T[], address: string | null) {
  return rows.map(r => {
    const { venue_block, venue_street, venue_floor, venue_unit, venue_building, venue_postal_code, ...rest } = r;
    return { ...rest, venue: venueAddress(r, address) };
  });
}
