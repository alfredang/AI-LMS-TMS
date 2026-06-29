# Trainer Invitations — Staff Guide

A practical guide to running the trainer-invitation process: configuring the approved-trainer list, checking who has accepted / who is pending, and handling classes where nobody has accepted (or where the start date is approaching with no trainer yet).

---

## 1. How the system works (in one minute)

Each **course** has an ordered **Approved Trainers** list. When a course **run** (a scheduled class) needs a trainer, the system invites trainers **one at a time, in list order**:

1. Trainer **#1** gets an email invitation (Accept / Decline buttons).
2. If they **Accept** → they're assigned, calendar invite goes out, and the cascade **stops**.
3. If they **Decline** → the system automatically invites trainer **#2**, then **#3**, and so on.
4. If it reaches the end of the list with no acceptance → the run is **exhausted** (needs manual attention).

Invitations are sent automatically by a twice-weekly job (Mon & Thu, 10:00 AM SGT) and can also be sent/resent manually.

**Two representations to know:**
- The **approved list** lives on the **course** (shared by all its runs).
- Each invitation's state (pending / accepted / declined) is tracked **per run, per trainer**.

**Invitations never expire (important — this shapes the alerts).** An invite stays **pending indefinitely** until the trainer clicks **Accept** or **Decline**; there is no timeout and no auto-expiry.
- The cascade advances to the next trainer **only on Decline**. If a trainer simply **ignores** the email, nothing moves automatically.
- The twice-weekly sweep still invites the *next* un-invited trainer on each run (skipping those already pending), so a run can have several trainers pending at once — none of which expire.
- A run only becomes **"List exhausted"** if trainers actively **decline** the whole list. The common *"nobody responded"* case never becomes exhausted — which is exactly why the time-based **"Not in LMS + approaching start (≤7 days)"** alert is the real safety net.
- (Admin actions can still close a pending invite: **resending** supersedes the old one; **unconfirming/resetting** a class marks its pending invites superseded.)

---

## 2. Configuring the invite list (and its order)

**Where:** **Admin View → Course Management → View Course → Edit Course → Approved Trainers** tab (Admin / Developer only).

- The **chips** at the bottom ("N assigned trainers") are the list.
- **Order = cascade order.** Left-to-right / top-to-bottom is exactly the order invitations go out.
- **Add** a trainer (search box) → appended to the **end** of the list.
- **Drag a chip** → reorder the cascade.
- **× on a chip** → remove that trainer.

> The list is **per course**, so changing it affects **every run** of that course.
> A name only receives invites if it maps to an **active trainer account** with an email — names with no account are silently skipped by the cascade (and flagged with ⚠ where shown).

---

## 3. Checking invite status

There are two views — one for a single class (deep detail), one for triage across all classes.

### A. One class — Edit → Trainer Management

**Where:** **Admin View → Class Management → Upcoming Classes** (or any class list) → click **Edit** on the class row → scroll to the **Trainer Management** section.

This shows the **full approved list in cascade order**, and for each trainer:
- a status badge — **Accepted / Pending / Declined / Resent / Not Sent / Manually Added**
- **Assigned (Local)** and **Next Available** markers
- (detailed view) the **full invitation history with sent/responded timestamps**
- **Send / Resend** invitation button
- **Pause invitations** and **Block replies** toggles

Use this when you're working on **one specific class**.

### B. All classes — Upcoming Classes panel

**Where:** **Admin View → Class Management → Upcoming Classes**.

The **Upcoming Classes** table shows one row per run with an **invite outcome badge** for quick scanning:

| Badge | Meaning | Question it answers |
|---|---|---|
| 🟢 **Accepted** | A trainer is assigned / accepted | Which classes are covered |
| 🟡 **Pending: {name} · {N}d** | Waiting on this trainer, invited N days ago | Which are pending, **and at whom** |
| 🔴 **All declined (N) — needs action** | Every approved trainer with an account declined | Which **went through the whole list and failed** |
| ⚪ **Not yet invited** | Has approved trainers, none invited yet | Which still have runway |
| ⚪ **No approved trainers** | The course has no approved list configured | Which need a list set up first |

Use this for **triage across everything**. For per-trainer detail, click **Edit** on that row.

---

## 4. Handling the problem cases

### The "⚠ Needs attention" banner + filter

A red banner appears above the Upcoming Classes table whenever any run needs attention. It shows the **total** plus three **clickable chips** — click a chip to filter the table to just that issue type:

| Chip / row tag | Means | Why it's a problem |
|---|---|---|
| **Not in LMS** | No LMS trainer assigned, starting within the window (default **7 days**) | Class shows **Pending** and the trainer **can't access** the run — even if TPG already has a name pencilled in |
| **Not in TPG** | Assigned/accepted in the LMS but **never pushed to TPG/SSG** | The official SSG record has no trainer |
| **List exhausted** | The whole approved list was invited and **everyone declined** | Cascade has no one left — needs manual intervention |

Flagged rows also carry a small tag (**⚠ Not in LMS** / **⚠ Not in TPG**) next to their status badge. The window is adjustable in the advanced filter ("Approaching start within N days"). The **⚠ Needs attention** filter-bar button toggles all types at once.

> **Why "Not in LMS" matters most:** because invites never expire (Section 1), the common *"trainer ignored the email"* case never shows as "List exhausted" — it just sits Pending. The time-based **Not in LMS** alert is what catches those before the class starts.

**Each run shows under exactly one chip / tag.** The three issue types are mutually exclusive — a run is counted once and tagged once. A run with **no LMS *and* no TPG trainer** shows only as **Not in LMS** (the blocking gap); "Not in TPG" only applies once a trainer *is* assigned in the LMS (you can't be missing the TPG push until there's an LMS trainer to push).

### Case 1 — "Not in LMS" (no LMS trainer, approaching start)
The class can't run as-is — even a TPG-pencilled trainer can't access it.

> **⚠ Common pitfall — assigned in TPG but not the LMS.** If a trainer is assigned **directly in TPGateway** (or only the TPG field gets set) **without** also being assigned in the LMS, the class *looks* staffed on TPG but in the LMS it still shows **Pending**, and the trainer **cannot access the trainer page** for the run — LMS access comes from the **LMS** assignment, not the TPG field. These surface as **⚠ Not in LMS · TPG set**. **Rule of thumb:** always mirror a manual TPG assignment in the LMS (open the class → **Edit → Trainer Management** → assign them there to confirm the class + grant access).

**Triage tip:** the tag tells you the effort — **⚠ Not in LMS · TPG set** is a one-step LMS assignment (the pitfall above); plain **⚠ Not in LMS** means no trainer anywhere, so you start from scratch.

Steps (all from **Edit → Trainer Management**):
1. **TPG set** → just assign that trainer in the LMS; the class confirms and they get access.
2. **From scratch** → if **Not yet invited**, **Send Invite** to the next trainer; if **Pending** too long, **Resend** or move to the next (and chase them directly).
3. **No approved trainers?** Add a list first (Section 2), then send.

### Case 2 — "Not in TPG" (assigned in LMS, missing from TPG)
The trainer is staffed locally but the SSG/TPG record is missing (a push likely failed). Steps:
1. Open the class → re-trigger the TPG push (re-assign / the bulk TPG assign), or
2. Check the TPG sync status and resolve the underlying error, then push again.

### Case 3 — "List exhausted" (everyone declined)
The whole approved list declined. Options:
1. **Add more trainers** to the course's Approved Trainers list (Section 2) — the cascade picks up new names on the next send.
2. **Reorder** to retry a stronger candidate, then **Resend** from Edit → Trainer Management.
3. **Assign a trainer manually** if you've sourced someone outside the list.
4. If it genuinely can't be staffed, escalate / reschedule / cancel. (The configured **Exhausted-list Alert Recipients** also get an **automatic email** when this happens — Section 5.)

### Manual assignment & the invite cascade

Manually assigning a trainer in the LMS (**Edit → Trainer Management**) writes the LMS assignment and **stops new invitations** for that run:
- The Mon/Thu sweep skips any run that already has an LMS-assigned trainer.
- The decline-cascade won't send either — it stops as soon as a local trainer exists.
- If an earlier invitee clicks their old **Accept** link afterwards, they get **"Already Assigned"** — they **can't override** your manual assignment.

Two caveats:
1. **Existing pending invites are not auto-withdrawn** — they become no-ops (the trainer may still see a stale email; any accept is blocked). Use **Resend** (supersedes the old one) or **Pause invitations** to close them visibly.
2. **Don't leave a stale pending invite open for the person you just manually assigned** — if *they* later click **Decline** on that old invite, the decline removes their assignment (decline cleans up by email).

---

## 5. Email & notification settings — where to configure

All trainer email/CC/notification settings live under **Training Provider View → sidebar → Templates** (collapsible section). Two pages hold them:

### Page: "Trainer Invitation Email"
| Setting | Field | What it does |
|---|---|---|
| Invitation subject / body | **Subject**, **Body** | The invitation email template sent to trainers |
| Invitation CC | **CC List** | Addresses CC'd on **every** invitation (manual send, auto-escalation, weekly sweep) |
| Reply-To | **Reply-To** | Where trainer **replies** go — for the invitation **and** the accept/decline acknowledgements. Blank = company email |
| Exhausted-list alert | **Exhausted-list Alert Recipients** | Who is emailed **once** when a run's whole approved list has declined and none accepted (needs manual assignment). Blank = alert disabled |

### Page: "Trainer Accept/Decline Email"
| Setting | Field | What it does |
|---|---|---|
| Accept email | **Accept** subject / body / **CC** | The "thank you for accepting" email sent to the trainer; CC to also notify staff of acceptances |
| Decline email | **Decline** subject / body / **CC** | The "thank you for your response" email sent on decline; CC to also notify staff of declines |

**How to decide what goes where:**
- **Reply-To** → the person/team who owns trainer correspondence, so replies reach them directly.
- **CC List** → anyone who should be copied on every outgoing invitation (e.g. the assignment owner + oversight).
- **Exhausted-list Alert Recipients** → whoever needs to act when a run's list runs out (the people who'll manually source/assign a trainer).
- **Accept / Decline CC** → add the assignment owner here if they want to be notified each time a trainer responds.

> The specific addresses for *this* deployment are tracked separately in `trainer-invite-email-config-rollout.md`.
> Note: CC / Reply-To / alert addresses are **data** — set them on the live (production) instance; they don't carry over from a test/local environment.

## 6. Status glossary

| Status | Meaning |
|---|---|
| **Pending** | Invitation sent, awaiting the trainer's response |
| **Accepted** | Trainer confirmed; assigned + calendar invite sent |
| **Declined** | Trainer declined; cascade moved to the next trainer |
| **Resent** | A previous pending invite was superseded by a newer one |
| **Not Sent** | In the approved list but never invited for this run |
| **Manually Added** | Assigned directly (no email invitation flow) |
| **No account / skipped** | Approved-list name with no active trainer account — the cascade skips it |

---

## 7. Quick reference — where to find each answer

| You want to know… | Look here |
|---|---|
| Which courses a trainer **accepted** | Upcoming Classes → 🟢 **Accepted** badge (or Edit → Trainer Management) |
| Which are **still pending, and at whom** | Upcoming Classes → 🟡 **Pending: {name}** badge |
| The **full invite list + order** (and to change it) | Course → **Approved Trainers** tab |
| Which **went through the list with no acceptance** | Upcoming Classes → 🔴 **All declined** badge, or the **⚠ Needs attention** filter |
| Which are **about to start with no trainer** | Upcoming Classes → **⚠ Needs attention** filter |
