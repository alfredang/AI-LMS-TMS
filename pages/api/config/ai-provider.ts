import { withAuth } from '@lib/auth/withAuth';
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import { cors } from '../../../lib/cors';

async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (cors(req, res)) return;

    if (req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const client = await pool.connect();

    try {
        // Fetch all API configs for the training provider
        // Use the most recent training_provider as the source
        const query = `
            SELECT key_name, key_value, selected_model
            FROM training_provider_api
            WHERE training_provider_id = (
                SELECT id FROM training_provider ORDER BY created_at DESC LIMIT 1
            )
        `;

        const result = await client.query(query);
        const configs: Record<string, { keyValue: string; selectedModel: string | null }> = {};
        let defaultProviderKey: string | null = null;
        let fallbackProviderKey: string | null = null;

        for (const row of result.rows) {
            if (row.key_name === 'DEFAULT_AI_PROVIDER') {
                defaultProviderKey = row.key_value;
            } else if (row.key_name === 'FALLBACK_AI_PROVIDER') {
                fallbackProviderKey = row.key_value;
            } else {
                configs[row.key_name] = {
                    keyValue: row.key_value,
                    selectedModel: row.selected_model
                };
            }
        }

        // If no default set, try ANTHROPIC first, then GEMINI
        if (!defaultProviderKey) {
            if (configs['ANTHROPIC_API_KEY']?.keyValue) {
                defaultProviderKey = 'ANTHROPIC_API_KEY';
            } else if (configs['GEMINI_API_KEY']?.keyValue) {
                defaultProviderKey = 'GEMINI_API_KEY';
            }
        }

        // Build the response
        const defaultProvider = defaultProviderKey && configs[defaultProviderKey] ? {
            provider: defaultProviderKey,
            apiKey: configs[defaultProviderKey].keyValue,
            model: configs[defaultProviderKey].selectedModel
        } : null;

        const fallbackProvider = fallbackProviderKey && configs[fallbackProviderKey] ? {
            provider: fallbackProviderKey,
            apiKey: configs[fallbackProviderKey].keyValue,
            model: configs[fallbackProviderKey].selectedModel
        } : null;

        return res.status(200).json({
            success: true,
            defaultProvider,
            fallbackProvider,
            allProviders: Object.entries(configs)
                .filter(([_, v]) => v.keyValue && v.selectedModel)
                .map(([key, v]) => ({
                    provider: key,
                    model: v.selectedModel,
                    hasKey: true
                }))
        });

    } catch (error) {
        console.error('Error fetching AI provider config:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    } finally {
        client.release();
    }
}

export default withAuth(handler);
