import pool from '@lib/db';

/**
 * Work out which trainer ACCOUNT a non-WSQ class belongs to.
 *
 * Non-WSQ classes are typed in by hand, and the trainer used to be captured as
 * a name and nothing else — `trainer_id` was left null on every row the dialog
 * created. That link is not cosmetic: a trainer's own payout history finds
 * their classes by account id, so a class with a null id is invisible to the
 * person who taught it and missing from the total on their card. The Payroll
 * screens never noticed because they display `trainer_name` directly.
 *
 * The dialog now sends an id whenever the trainer was picked from the list.
 * This is the safety net for everything else: a name typed by hand, a row
 * created through the API, an import. An exact single match is adopted; a name
 * that matches nobody, or more than one person, is left unlinked rather than
 * guessed at — attaching a payout to the wrong trainer's history is worse than
 * leaving it off, because nothing downstream would ever question it.
 */

/**
 * Comparison key for a person's name: case-folded, ends trimmed, internal runs
 * of whitespace collapsed to one space.
 *
 * `[[:space:]]` rather than `\s` on purpose. This SQL lives in a template
 * literal, where a lone backslash is swallowed before Postgres ever sees it —
 * `'\s+'` silently becomes `'s+'`, which replaces the letter "s" instead of
 * whitespace. The POSIX class needs no escape, so it cannot be mangled that way.
 */
const nameKey = (expr: string) =>
  `lower(regexp_replace(btrim(${expr}), '[[:space:]]+', ' ', 'g'))`;

/** The same normalisation, applied to the value we send as a parameter. */
function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function resolveTrainerId(
  explicitId: string | null | undefined,
  trainerName: string | null | undefined,
  /**
   * Set when the caller has decided this class belongs to NOBODY with an
   * account, and the name match must not run.
   *
   * "No id supplied" and "deliberately not linked" are different instructions
   * that otherwise look identical here, and the difference matters when a name
   * is shared. Two people really can both be Jane Tan — one on staff, one a
   * freelancer — and without this the freelancer's class silently lands in the
   * staff trainer's payout history, inflating a total that nothing downstream
   * would ever question.
   */
  unlinked?: boolean
): Promise<string | null> {
  if (unlinked) return null;

  // An id chosen in the UI wins outright — it is the unambiguous answer, and
  // two trainers really can share a name.
  const id = (explicitId || '').trim();
  if (id) {
    try {
      const r = await pool.query(
        `SELECT au.id FROM app_user au
           JOIN trainer_profile tp ON tp.user_id = au.id
          WHERE au.id = $1`,
        [id]
      );
      if (r.rowCount) return r.rows[0].id;
      // Not a trainer account. Fall through to the name match rather than
      // storing an id that points at nothing useful.
      console.warn(`[payroll] trainer_id ${id} is not a trainer account; falling back to the name.`);
    } catch (e) {
      console.warn('[payroll] could not verify trainer_id:', e instanceof Error ? e.message : e);
      // Don't discard a plausible id because the lookup failed.
      return id;
    }
  }

  const name = (trainerName || '').trim();
  if (!name) return null;

  try {
    // Match on the account name or the trainer's common name — Payroll write
    // whichever they know them by. LIMIT 2 is all it takes to tell "exactly
    // one" from "more than one".
    const r = await pool.query(
      `SELECT au.id
         FROM trainer_profile tp
         JOIN app_user au ON au.id = tp.user_id
        WHERE ${nameKey('au.full_name')} = $1
           OR ${nameKey("COALESCE(tp.common_name, '')")} = $1
        LIMIT 2`,
      [normalizeName(name)]
    );
    if (r.rowCount === 1) return r.rows[0].id;
    if ((r.rowCount ?? 0) > 1) {
      console.warn(`[payroll] "${name}" matches more than one trainer; leaving the class unlinked.`);
    }
    return null;
  } catch (e) {
    console.warn('[payroll] trainer name lookup failed:', e instanceof Error ? e.message : e);
    return null;
  }
}
