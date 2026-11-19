import { ensureEnrolmentDetailRequestTable } from '../learner/enrolmentDetailRequest';
import { ensureSigninRequestTable } from '../learner/selfEnrolment';

/**
 * The self-registration tables that `classMemberSql` reads are created lazily;
 * call this before running a query that uses the predicate.
 */
export async function ensureClassMembershipTables(): Promise<void> {
  await Promise.all([ensureEnrolmentDetailRequestTable(), ensureSigninRequestTable()]);
}
