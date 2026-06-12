import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

type Row = {
  id: number;
  license: string;
  software: string;
  login: string;
  password: string;
  licence_type: string;
  url: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const result = await pool.query<Row>(
        `SELECT * FROM public.software_credential
         ORDER BY license, software, login`
      );
      return res.status(200).json({ success: true, data: result.rows });
    }

    if (req.method === 'POST') {
      const { license, software, login, password, licence_type, url, notes } = req.body || {};
      if (!license || typeof license !== 'string') {
        return res.status(400).json({ success: false, message: 'license is required' });
      }
      const result = await pool.query<Row>(
        `INSERT INTO public.software_credential
           (license, software, login, password, licence_type, url, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [license, software || '', login || '', password || '', licence_type || '', url || '', notes || '']
      );
      return res.status(200).json({ success: true, data: result.rows[0] });
    }

    if (req.method === 'PUT') {
      const { id, license, software, login, password, licence_type, url, notes } = req.body || {};
      if (!id) return res.status(400).json({ success: false, message: 'id is required' });
      const result = await pool.query<Row>(
        `UPDATE public.software_credential
            SET license      = $2,
                software     = $3,
                login        = $4,
                password     = $5,
                licence_type = $6,
                url          = $7,
                notes        = $8,
                updated_at   = NOW()
          WHERE id = $1
          RETURNING *`,
        [id, license, software || '', login || '', password || '', licence_type || '', url || '', notes || '']
      );
      if (!result.rowCount) return res.status(404).json({ success: false, message: 'Not found' });
      return res.status(200).json({ success: true, data: result.rows[0] });
    }

    if (req.method === 'DELETE') {
      const id = Number(req.query.id);
      if (!id) return res.status(400).json({ success: false, message: 'id is required' });
      const result = await pool.query(`DELETE FROM public.software_credential WHERE id = $1`, [id]);
      if (!result.rowCount) return res.status(404).json({ success: false, message: 'Not found' });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ success: false, message: 'Method not allowed' });
  } catch (err) {
    console.error('software-credentials API error:', err);
    return res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : 'Internal server error',
    });
  }
}
