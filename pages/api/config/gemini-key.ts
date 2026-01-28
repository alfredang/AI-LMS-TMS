import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // Apply CORS middleware
    if (cors(req, res)) {
        return;
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const client = await pool.connect();

    try {
        // Fetch the most recently created gemini_api_key
        // In a real multi-tenant app, you'd filter by user/org context.
        const query = `
      SELECT key_value 
      FROM training_provider_api 
      WHERE key_name = 'gemini_api_key'
      ORDER BY created_at DESC 
      LIMIT 1
    `;

        const result = await client.query(query);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'No Gemini API key found in database' });
        }

        const apiKey = result.rows[0].key_value;

        return res.status(200).json({ success: true, apiKey });

    } catch (error) {
        console.error('Error fetching Gemini API key:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
}
