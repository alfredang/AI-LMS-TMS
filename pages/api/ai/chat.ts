import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

interface ProviderConfig {
    provider: string;
    apiKey: string;
    model: string | null;
}

async function getProviderConfigs(): Promise<{ default: ProviderConfig | null; fallback: ProviderConfig | null }> {
    const result = await pool.query(`
        SELECT key_name, key_value, selected_model
        FROM training_provider_api
        WHERE training_provider_id = (
            SELECT id FROM training_provider ORDER BY created_at DESC LIMIT 1
        )
    `);

    const configs: Record<string, { keyValue: string; selectedModel: string | null }> = {};
    let defaultProviderKey: string | null = null;
    let fallbackProviderKey: string | null = null;

    for (const row of result.rows) {
        if (row.key_name === 'DEFAULT_AI_PROVIDER') {
            defaultProviderKey = row.key_value;
        } else if (row.key_name === 'FALLBACK_AI_PROVIDER') {
            fallbackProviderKey = row.key_value;
        } else {
            configs[row.key_name] = { keyValue: row.key_value, selectedModel: row.selected_model };
        }
    }

    if (!defaultProviderKey) {
        if (configs['ANTHROPIC_API_KEY']?.keyValue && configs['ANTHROPIC_API_KEY']?.selectedModel) {
            defaultProviderKey = 'ANTHROPIC_API_KEY';
        } else if (configs['GEMINI_API_KEY']?.keyValue) {
            defaultProviderKey = 'GEMINI_API_KEY';
        }
    }

    const makeConfig = (key: string | null): ProviderConfig | null => {
        if (!key || !configs[key]) return null;
        return { provider: key, apiKey: configs[key].keyValue, model: configs[key].selectedModel };
    };

    return { default: makeConfig(defaultProviderKey), fallback: makeConfig(fallbackProviderKey) };
}

async function callAnthropic(apiKey: string, model: string, messages: any[], systemPrompt?: string): Promise<string> {
    const body: any = {
        model,
        max_tokens: 4096,
        messages: messages.map((m: any) => ({
            role: m.role === 'model' ? 'assistant' : m.role,
            content: m.content || m.text
        }))
    };
    if (systemPrompt) {
        body.system = systemPrompt;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Anthropic API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text || '';
}

async function callGemini(apiKey: string, model: string, messages: any[], systemPrompt?: string): Promise<string> {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const geminiModel = genAI.getGenerativeModel({ model: model || 'gemini-2.5-flash' });

    // Build the prompt from messages
    const conversationText = messages
        .map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content || m.text}`)
        .join('\n');

    const fullPrompt = systemPrompt
        ? `${systemPrompt}\n\n${conversationText}\n\nPlease respond to the latest user message:`
        : conversationText;

    const result = await geminiModel.generateContent(fullPrompt);
    const response = await result.response;
    return response.text();
}

async function callProvider(config: ProviderConfig, messages: any[], systemPrompt?: string): Promise<string> {
    const { provider, apiKey, model } = config;

    if (provider === 'ANTHROPIC_API_KEY') {
        return callAnthropic(apiKey, model || 'claude-sonnet-4-6-20250527', messages, systemPrompt);
    } else if (provider === 'GEMINI_API_KEY') {
        return callGemini(apiKey, model || 'gemini-2.5-flash', messages, systemPrompt);
    } else if (provider === 'OPENAI_API_KEY') {
        // OpenAI support
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model || 'gpt-4o',
                messages: [
                    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                    ...messages.map((m: any) => ({
                        role: m.role === 'model' ? 'assistant' : m.role,
                        content: m.content || m.text
                    }))
                ],
                max_tokens: 4096
            })
        });
        if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
        const data = await response.json();
        return data.choices?.[0]?.message?.content || '';
    } else if (provider === 'MINIMAX_API_KEY') {
        // MiniMax API (OpenAI-compatible endpoint)
        const response = await fetch('https://api.minimaxi.chat/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model || 'MiniMax-M2.7',
                messages: [
                    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                    ...messages.map((m: any) => ({
                        role: m.role === 'model' ? 'assistant' : m.role,
                        content: m.content || m.text
                    }))
                ],
                max_tokens: 4096
            })
        });
        if (!response.ok) throw new Error(`MiniMax API error: ${response.status}`);
        const data = await response.json();
        return data.choices?.[0]?.message?.content || '';
    } else if (provider === 'KIMI_API_KEY') {
        // Kimi / Moonshot API (OpenAI-compatible endpoint)
        const response = await fetch('https://api.moonshot.cn/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model || 'moonshot-v1-8k',
                messages: [
                    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                    ...messages.map((m: any) => ({
                        role: m.role === 'model' ? 'assistant' : m.role,
                        content: m.content || m.text
                    }))
                ],
                max_tokens: 4096
            })
        });
        if (!response.ok) throw new Error(`Kimi API error: ${response.status}`);
        const data = await response.json();
        return data.choices?.[0]?.message?.content || '';
    } else if (provider === 'DEEPSEEK_API_KEY') {
        // DeepSeek API (OpenAI-compatible endpoint)
        const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: model || 'deepseek-chat',
                messages: [
                    ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
                    ...messages.map((m: any) => ({
                        role: m.role === 'model' ? 'assistant' : m.role,
                        content: m.content || m.text
                    }))
                ],
                max_tokens: 4096
            })
        });
        if (!response.ok) throw new Error(`DeepSeek API error: ${response.status}`);
        const data = await response.json();
        return data.choices?.[0]?.message?.content || '';
    }

    throw new Error(`Unsupported provider: ${provider}`);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { messages, systemPrompt } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'Messages array is required' });
        }

        const providers = await getProviderConfigs();

        if (!providers.default) {
            return res.status(500).json({ error: 'No AI provider configured. Please set up an API key and select a model in your Training Provider profile.' });
        }

        try {
            // Try default provider
            const response = await callProvider(providers.default, messages, systemPrompt);
            return res.status(200).json({
                text: response,
                provider: providers.default.provider,
                model: providers.default.model
            });
        } catch (defaultError: any) {
            console.error('Default provider failed:', defaultError.message);

            // Try fallback provider
            if (providers.fallback) {
                try {
                    const response = await callProvider(providers.fallback, messages, systemPrompt);
                    return res.status(200).json({
                        text: response,
                        provider: providers.fallback.provider,
                        model: providers.fallback.model,
                        usedFallback: true
                    });
                } catch (fallbackError: any) {
                    console.error('Fallback provider also failed:', fallbackError.message);
                    return res.status(500).json({
                        error: 'Both default and fallback AI providers failed',
                        defaultError: defaultError.message,
                        fallbackError: fallbackError.message
                    });
                }
            }

            return res.status(500).json({
                error: 'AI provider failed and no fallback configured',
                details: defaultError.message
            });
        }
    } catch (error: any) {
        console.error('AI chat error:', error);
        return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
}
