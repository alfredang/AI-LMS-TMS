# Course Validity TPG view rollout

The shared code deploys to every tenant, but the enhanced Course Validity columns,
Excel headings, and `Approved` status wording are controlled by
`training_provider.course_validity_tpg_enabled`.

- Default and missing-column state: **off** (legacy view and legacy status writes).
- Tertiary provider UEN `201200696W`: **on** via
  `database/migrations/20260930_course_validity_feature_flag.sql`.
- The course-list API uses optional JSON column access so older customer schemas
  without the new course fields remain readable.
- The TPG sync script is a manual Tertiary operation; this deployment does not
  schedule or run a scrape or sync for any tenant.

The Tertiary database flag was activated before the shared-main deployment.
The migration is idempotent and can also be applied to other tenant databases:
only the exact Tertiary UEN is enabled.

To turn off the enhanced view immediately on Tertiary without redeploying:

```sql
UPDATE public.training_provider
SET course_validity_tpg_enabled = false
WHERE uen = '201200696W';
```

Refresh the Course Validity page after changing the flag. The API reads the flag
on each request; it is not cached server-side.
