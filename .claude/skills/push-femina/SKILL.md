---
name: push-femina
description: Commit and push the current work to the femina branch — fetch origin, merge, then push, without ever switching off femina. Use whenever the user says to commit/push/ship their change, "push this", "commit and push", or asks to sync femina with origin, unless they explicitly name a different branch or ask for a PR instead.
---

# Push to femina

Femina Jasmin's standing workflow for landing local changes on the remote `femina`
branch. This repo's default branch to work on is `femina`; `main` is only touched
when the user explicitly asks for a merge/PR into it.

## Steps

1. **`git status` first.** Compare against what changed *because of the current
   task* versus pre-existing modified/untracked files that were already sitting
   there. Per this repo's CLAUDE.md workflow rule: if unrelated pre-existing
   changes are present, surface them and ask whether to include them — do not
   silently commit them, and do not silently leave them out without saying so.
   Only stage the files that belong to the task just completed unless the user
   says otherwise.
2. **Stage precisely** — `git add <specific files>`, never `git add -A` / `git add .`,
   so nothing unrelated (secrets, scratch files, other in-flight work) rides along.
3. **Commit** with a concise message focused on *why*, following the repo's normal
   commit-message conventions (see the global git instructions: why over what,
   `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer, heredoc for
   multi-line messages). Only create a new commit — never amend unless explicitly
   asked.
4. **`git fetch origin`.**
5. **`git merge origin/femina --no-edit`** — brings in anything teammates pushed to
   femina since. This is normally a no-op fast-forward. If it produces real
   conflicts, stop and resolve them with the user rather than guessing; never
   `git checkout --theirs/--ours` blindly on conflicting hunks without checking
   what they mean.
6. **`git push origin femina`.**
7. **Stay on `femina` the entire time** — do not `git checkout` another branch to
   do any of this, even transiently, unless the user explicitly asks to work on a
   different branch.

## What this skill does NOT do

- Does not push to `main`, open a PR, or merge `origin/main` into `femina` — those
  are separate, larger decisions the user makes explicitly each time.
- Does not force-push, rebase interactively, or skip hooks (`--no-verify`).
- Does not push if there's nothing staged/committed for the current task — say so
  instead of inventing a commit.

## If origin/main has advanced

It's normal for `origin/main` to move ahead of `femina` independently (other PRs
merging in). Mention it in passing if noticed (e.g. "origin/main is N commits
ahead — let me know if you want that merged into femina too") but don't merge it
in automatically.
