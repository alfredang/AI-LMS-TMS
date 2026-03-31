import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    const { query } = req.query;

    if (!query) {
        return res.status(400).json({ message: 'Query parameter is required' });
    }

    try {
        console.log('API Proxy: Received request for query:', query);

        // Switched to Production URL for continuous operation (Requires n8n Workflow to be ACTIVE)
        const n8nUrl = `https://n8n.srv923061.hstgr.cloud/webhook/0c7cca8b-96b3-4050-91e7-8480bc98b961`;

        console.log('API Proxy: Forwarding to n8n URL:', n8nUrl);

        // Forward the request to n8n
        // User's n8n Webhook is set to POST, so we must use POST.
        const response = await fetch(`${n8nUrl}?query=${encodeURIComponent(query as string)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query: query }) // Sending in body too just in case
        });

        console.log('API Proxy: n8n response status:', response.status);

        if (!response.ok) {
            throw new Error(`n8n responded with ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('API Proxy: n8n data received, sending to client.');
        res.status(200).json(data);
    } catch (error) {
        console.error('API Proxy error:', error);
        res.status(500).json({ message: error instanceof Error ? error.message : 'Internal server error' });
    }
}
