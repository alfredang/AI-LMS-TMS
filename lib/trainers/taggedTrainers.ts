/**
 * Tagged-trainer model for the in-app calendar + reschedulers.
 *
 * A course run does NOT have one trainer — it has a LIST of trainers, each carrying one or more
 * independent TAGS:
 *   - 'lms'      → assigned in TMS-LMS (course_run_trainer). Grants TMS access; need NOT be on TPG
 *                  (stand-in / shadow / unofficial trainers).
 *   - 'accepted' → accepted the LMS email invitation (trainer_invitation status='accepted').
 *   - 'tpg'      → the official SSG/TPGateway assignment (course_run.tpg_assigned_trainer_*),
 *                  incl. direct-TPG assignments made outside the LMS invite flow.
 *
 * The three sources are merged into one row per person, keyed by EMAIL (assume one email per person
 * across LMS/TPG/invite). Rows without an email fall back to a normalized-name key. Mismatches
 * (e.g. accepted ≠ tpg) are preserved as separate rows so admins can see what to act on.
 */
export type TrainerTag = 'lms' | 'accepted' | 'tpg';

export interface TaggedTrainer {
  name: string;
  email: string | null;
  tags: TrainerTag[];
}

interface RawTrainer { name?: string | null; email?: string | null; }

const normEmail = (s?: string | null) => (s || '').trim().toLowerCase();
const normName = (s?: string | null) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const TAG_ORDER: TrainerTag[] = ['tpg', 'accepted', 'lms'];

/** Merge LMS / accepted-invite / TPG trainers into one tagged list, deduped by email (then name). */
export function mergeTaggedTrainers(input: {
  lms?: RawTrainer[];
  accepted?: RawTrainer[];
  tpg?: RawTrainer[];
}): TaggedTrainer[] {
  const map = new Map<string, TaggedTrainer>();
  const add = (tag: TrainerTag, entries?: RawTrainer[]) => {
    for (const e of entries || []) {
      const name = (e.name || '').trim();
      const email = (e.email || '').trim();
      if (!name && !email) continue;
      const key = email ? `e:${normEmail(email)}` : `n:${normName(name)}`;
      let t = map.get(key);
      if (!t) { t = { name, email: email || null, tags: [] }; map.set(key, t); }
      else {
        if (!t.name && name) t.name = name;
        if (!t.email && email) t.email = email;
      }
      if (!t.tags.includes(tag)) t.tags.push(tag);
    }
  };
  add('lms', input.lms);
  add('accepted', input.accepted);
  add('tpg', input.tpg);
  // Stable, meaningful tag order for display.
  for (const t of map.values()) t.tags.sort((a, b) => TAG_ORDER.indexOf(a) - TAG_ORDER.indexOf(b));
  return Array.from(map.values());
}

/** Does the run have at least one trainer carrying any of the given tags? */
export function hasAnyTag(trainers: TaggedTrainer[] | undefined, tags: TrainerTag[]): boolean {
  if (!trainers?.length) return false;
  return trainers.some((t) => t.tags.some((tag) => tags.includes(tag)));
}

/** A trainer exists but none is on TPG → an admin likely needs to push it to TPGateway. */
export function needsTpg(trainers: TaggedTrainer[] | undefined): boolean {
  if (!trainers?.length) return false;
  return !trainers.some((t) => t.tags.includes('tpg'));
}

export const TAG_LABELS: Record<TrainerTag, string> = {
  tpg: 'Assigned in TPG',
  accepted: 'Accepted Email',
  lms: 'TMS-LMS',
};
export const TAG_SHORT: Record<TrainerTag, string> = { tpg: 'TPG', accepted: 'Email', lms: 'LMS' };
