import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';

const VALID_STATUSES = ['Active', 'Pending', 'Not Subscribed', 'Suspended', 'Rejected', 'Inactive'];

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_subscription (
      id          SERIAL PRIMARY KEY,
      api_name    VARCHAR(255) NOT NULL,
      version     VARCHAR(50),
      app1_status VARCHAR(50),
      app2_status VARCHAR(50),
      app3_status VARCHAR(50),
      app4_status VARCHAR(50),
      sort_order  INT NOT NULL DEFAULT 0,
      created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await ensureTable();

    // ── GET — return subscription rows + cert expiry from training_provider ──
    if (req.method === 'GET') {
      const [subResult, tpResult] = await Promise.all([
        pool.query(
          `SELECT id, api_name, version, app1_status, app2_status, app3_status, app4_status, updated_at
           FROM api_subscription
           ORDER BY sort_order ASC, id ASC`
        ),
        pool.query(
          `SELECT app1_cert_expiry, app2_cert_expiry, app3_cert_expiry, app4_secret_last_generated_at
           FROM training_provider LIMIT 1`
        ),
      ]);

      const latestUpdated = subResult.rows.reduce<string | null>((latest, row) => {
        if (!row.updated_at) return latest;
        if (!latest) return row.updated_at;
        return row.updated_at > latest ? row.updated_at : latest;
      }, null);

      const tp = tpResult.rows[0] ?? {};
      return res.status(200).json({
        success: true,
        data: subResult.rows,
        lastUpdated: latestUpdated,
        certExpiry: {
          app1_cert_expiry:       tp.app1_cert_expiry ?? null,
          app2_cert_expiry:       tp.app2_cert_expiry ?? null,
          app3_cert_expiry:       tp.app3_cert_expiry ?? null,
          app4_secret_last_generated_at: tp.app4_secret_last_generated_at ?? null,
        },
      });
    }

    // ── PUT — update subscription row statuses ──
    if (req.method === 'PUT') {
      const { id, app1_status, app2_status, app3_status, app4_status } = req.body;
      if (!id) return res.status(400).json({ error: 'id is required' });

      for (const [key, val] of Object.entries({ app1_status, app2_status, app3_status, app4_status })) {
        if (val !== undefined && !VALID_STATUSES.includes(val as string)) {
          return res.status(400).json({ error: `Invalid status for ${key}: ${val}` });
        }
      }

      const result = await pool.query(
        `UPDATE api_subscription
         SET app1_status = COALESCE($2, app1_status),
             app2_status = COALESCE($3, app2_status),
             app3_status = COALESCE($4, app3_status),
             app4_status = COALESCE($5, app4_status),
             updated_at  = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, app1_status ?? null, app2_status ?? null, app3_status ?? null, app4_status ?? null]
      );

      if (result.rows.length === 0) return res.status(404).json({ error: 'Row not found' });
      return res.status(200).json({ success: true, data: result.rows[0] });
    }

    // ── PATCH — update cert expiry / secret rotation dates ──
    if (req.method === 'PATCH') {
      const { app1_cert_expiry, app2_cert_expiry, app3_cert_expiry, app4_secret_last_generated_at } = req.body;

      await pool.query(
        `UPDATE training_provider
         SET app1_cert_expiry       = COALESCE($1, app1_cert_expiry),
             app2_cert_expiry       = COALESCE($2, app2_cert_expiry),
             app3_cert_expiry       = COALESCE($3, app3_cert_expiry),
             app4_secret_last_generated_at = COALESCE($4, app4_secret_last_generated_at)`,
        [
          app1_cert_expiry       ? new Date(app1_cert_expiry)       : null,
          app2_cert_expiry       ? new Date(app2_cert_expiry)       : null,
          app3_cert_expiry       ? new Date(app3_cert_expiry)       : null,
          app4_secret_last_generated_at ? new Date(app4_secret_last_generated_at) : null,
        ]
      );

      // Return updated values
      const tpResult = await pool.query(
        `SELECT app1_cert_expiry, app2_cert_expiry, app3_cert_expiry, app4_secret_last_generated_at
         FROM training_provider LIMIT 1`
      );
      const tp = tpResult.rows[0] ?? {};
      return res.status(200).json({
        success: true,
        certExpiry: {
          app1_cert_expiry:       tp.app1_cert_expiry ?? null,
          app2_cert_expiry:       tp.app2_cert_expiry ?? null,
          app3_cert_expiry:       tp.app3_cert_expiry ?? null,
          app4_secret_last_generated_at: tp.app4_secret_last_generated_at ?? null,
        },
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('Error in api_subscription handler:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider'] });
