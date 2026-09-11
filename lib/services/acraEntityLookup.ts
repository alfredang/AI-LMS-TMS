/**
 * Registered company details from a UEN, via ACRA's open dataset on
 * data.gov.sg.
 *
 * A Company Application collects the employer's UEN but never their address, so
 * a company auto-created in QuickBooks was created with no address at all and
 * its invoices printed a company name over empty space. This fills that in from
 * the one identifier we always have.
 *
 * WHY NOT BIZFILE. The repo already proxies api.bizfile.gov.sg and the
 * credentials authenticate, but every data endpoint answers
 * "subscription not found" — the account has no paid subscription, so that
 * integration has never returned a record. This dataset is free, needs no
 * credentials, and carries the fields an invoice needs.
 *
 * WHAT IT DOES NOT GIVE YOU. `reg_street_name` and `reg_postal_code` only —
 * street and postal code, never a block or unit number. In Singapore the postal
 * code identifies the building, so the result is deliverable but is not the full
 * address a company prints on its own letterhead. That is a property of the
 * dataset, not something better code recovers.
 *
 * Nothing here is allowed to be load-bearing: every failure returns null and the
 * caller proceeds exactly as it did before. An address is worth having, never
 * worth failing an invoice over.
 */

/** data.gov.sg resource id for "ACRA Information on Corporate Entities". */
const ACRA_RESOURCE_ID = 'd_3f960c10fed6145404ca7b821f263b87';
const ACRA_SEARCH_URL = 'https://data.gov.sg/api/action/datastore_search';

/**
 * Hard ceiling on the lookup. This runs inside invoice generation, which is
 * already a slow multi-call path, so a hanging public API must not add to it.
 */
const LOOKUP_TIMEOUT_MS = 10_000;

/** One immediate retry. Observed latency is 20-100ms; a stall is a blip, not a state. */
const ATTEMPTS = 2;

/**
 * In-process cache. One upload batch is often several learners from the same
 * employer, and the registered address does not change between them.
 *
 * Only ANSWERS are cached — a hit, or a definite "this UEN is not in the
 * register". A timeout or a network error is never cached: doing so let one
 * transient stall silently deny that employer an address for the lifetime of
 * the process, and the next invoice for them would print a bare company name
 * with nothing in the log to explain why.
 */
const cache = new Map<string, AcraEntity | null>();

export interface AcraEntity {
  uen: string;
  /** Official registered name, e.g. "10X GENOMICS PTE. LTD." */
  entityName: string;
  /** Street only — no block or unit number. May be blank. */
  street: string;
  postalCode: string;
  /** e.g. "Registered", "Struck Off", "Cancelled". */
  status: string;
  entityType: string;
}

/**
 * Look up a UEN. Returns null when the UEN is unknown, blank, or the lookup
 * fails for any reason — callers must treat null as "carry on without".
 */
export async function lookupAcraEntity(
  uen: string | null | undefined,
  /**
   * Bulk callers pass a shorter budget and no retry. One invoice can afford to
   * wait; a sweep over dozens of employers cannot, and it can simply be run
   * again — whereas a slow sweep holds a request open for minutes and starves
   * the connection pool everything else is waiting on.
   */
  opts: { timeoutMs?: number; attempts?: number } = {}
): Promise<AcraEntity | null> {
  const key = String(uen || '').trim().toUpperCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;

  const timeoutMs = Math.max(1_000, opts.timeoutMs ?? LOOKUP_TIMEOUT_MS);
  const attempts = Math.max(1, opts.attempts ?? ATTEMPTS);
  const url = `${ACRA_SEARCH_URL}?resource_id=${ACRA_RESOURCE_ID}&q=${encodeURIComponent(key)}`;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) {
        // Not an answer — the register may hold this UEN perfectly well. Retry,
        // then give up WITHOUT caching.
        console.warn(`[acra] Lookup for ${key} returned HTTP ${res.status} (attempt ${attempt}/${attempts})`);
        continue;
      }

      const json: any = await res.json();
      const records: any[] = Array.isArray(json?.result?.records) ? json.result.records : [];

      // The endpoint is a free-text search, so it can return near matches for
      // other entities. Only an exact UEN is this company.
      const match = records.find(r => String(r?.uen || '').trim().toUpperCase() === key);
      if (!match) {
        // A real answer: the register does not hold this UEN. Worth caching.
        cache.set(key, null);
        return null;
      }

      const entity: AcraEntity = {
        uen: key,
        entityName: String(match.entity_name || '').trim(),
        street: String(match.reg_street_name || '').trim(),
        postalCode: String(match.reg_postal_code || '').trim(),
        status: String(match.uen_status_desc || '').trim(),
        entityType: String(match.entity_type_desc || '').trim(),
      };
      cache.set(key, entity);
      return entity;
    } catch (err) {
      const aborted = controller.signal.aborted;
      console.warn(
        `[acra] Lookup for ${key} failed${aborted ? ' (timed out)' : ''} (attempt ${attempt}/${attempts}):`,
        err instanceof Error ? err.message : err
      );
    } finally {
      clearTimeout(timer);
    }
  }

  // Every attempt failed. Deliberately NOT cached — this says nothing about
  // whether the register holds this UEN, and the next invoice deserves a fresh
  // try rather than inheriting one bad moment.
  return null;
}

/**
 * The registered address shaped for a QuickBooks BillAddr, or null when there
 * is nothing worth writing.
 *
 * Line1 is left to the caller: a company invoice bills the ORGANISATION, and
 * which name goes on that line is a decision the invoice builder already makes
 * deliberately. This supplies the lines beneath it.
 *
 * "Singapore" goes in City rather than Country. QuickBooks prints city and
 * postal code on one line, so with the city empty the number stands alone:
 *
 *     KALLANG WAY          KALLANG WAY
 *     349248        vs     Singapore 349248
 *     Singapore
 *
 * The second is how a Singapore address is actually written. The dataset is
 * Singapore-only, so the city is never in doubt.
 */
export function acraAddressFields(entity: AcraEntity | null): Record<string, string> | null {
  if (!entity) return null;
  const street = entity.street.trim();
  const postal = entity.postalCode.trim();
  if (!street && !postal) return null;

  const fields: Record<string, string> = {};
  if (street) fields.Line2 = street;
  fields.City = 'Singapore';
  if (postal) fields.PostalCode = postal;
  fields.Country = 'Singapore';
  return fields;
}
