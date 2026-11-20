import type { AuthedUser } from './requireRole';

/**
 * The course GitHub Link (`course.github_url`) is Developer-only. Course APIs
 * return or accept it only when this is true; learners and trainers never
 * receive it. Machine callers (agents that maintain the link) are allowed.
 */
export function canSeeGithubLink(user: AuthedUser | undefined | null): boolean {
  if (!user) return false;
  return !!user.isService || user.roles.has('developer');
}
