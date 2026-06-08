import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (cors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const { userId } = req.body;

  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ success: false, message: 'userId is required' });
  }

  const client = await pool.connect();
  try {
    // Verify user exists
    const userResult = await client.query(
      'SELECT id, full_name, email FROM public.app_user WHERE id = $1',
      [userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const { full_name, email } = userResult.rows[0];

    await client.query('BEGIN');

    // Handle training_provider_member cleanup before deletion
    const memberships = await client.query(
      'DELETE FROM public.training_provider_member WHERE user_id = $1 RETURNING provider_id',
      [userId]
    );

    for (const { provider_id } of memberships.rows) {
      const remaining = await client.query(
        'SELECT COUNT(*) as count FROM public.training_provider_member WHERE provider_id = $1',
        [provider_id]
      );
      if (parseInt(remaining.rows[0].count) === 0) {
        // Last member — delete the training provider org (cascades its sub-tables)
        const providerInfo = await client.query(
          'SELECT company_name, uen FROM public.training_provider WHERE id = $1',
          [provider_id]
        );
        if (providerInfo.rows.length > 0) {
          const { company_name, uen } = providerInfo.rows[0];
          await client.query('DELETE FROM public.training_provider WHERE id = $1', [provider_id]);
          console.log(`🏢 Deleted org: ${company_name} (UEN: ${uen}) — no remaining members`);
        }
      }
    }

    // Clean up tables whose FK to app_user is NOT ON DELETE CASCADE, otherwise the
    // final DELETE FROM app_user throws a foreign-key violation and the whole delete
    // fails with a generic error. support_ticket / support_ticket_reply / trainer_payout
    // are NO ACTION (verified against the live schema); the rest below are defensive.
    // - support_ticket_reply by user_id: this user's replies on ANY ticket.
    // - support_ticket by user_id: this user's own tickets (cascades replies on them).
    // - trainer_payout.updated_by is nullable, so NULL it rather than deleting payout rows.
    const cleanupQueries = [
      `DELETE FROM public.work_experience WHERE developer_id = $1`,
      `DELETE FROM public.education_history WHERE developer_id = $1`,
      `DELETE FROM public.user_subtopic_bookmark WHERE user_id = $1`,
      `DELETE FROM public.learner_subtopic_completion WHERE user_id = $1`,
      `DELETE FROM public.submission WHERE user_id = $1`,
      `DELETE FROM public.support_ticket_reply WHERE user_id = $1`,
      `DELETE FROM public.support_ticket WHERE user_id = $1`,
      `UPDATE public.trainer_payout SET updated_by = NULL WHERE updated_by = $1`,
    ];
    for (const sql of cleanupQueries) {
      await client.query('SAVEPOINT cleanup_sp');
      try {
        await client.query(sql, [userId]);
        await client.query('RELEASE SAVEPOINT cleanup_sp');
      } catch {
        await client.query('ROLLBACK TO SAVEPOINT cleanup_sp');
      }
    }

    // Hard delete from app_user — cascades to:
    // user_role_map, learner_profile, trainer_profile, developer_profile, admin_profile,
    // enrollment, chat_conversation, provider_admin_user, etc.
    await client.query('DELETE FROM public.app_user WHERE id = $1', [userId]);

    await client.query('COMMIT');

    console.log(`🗑️ Hard-deleted user ${email} (${full_name})`);

    return res.status(200).json({ success: true, message: 'User permanently deleted' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error hard-deleting user:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to permanently delete user',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  } finally {
    client.release();
  }
}
