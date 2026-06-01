import { buildHybridAssistantContext, buildOllamaMessages, sensitiveVendorPattern } from './retrievalEngine.js';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3.5';
const OLLAMA_AUTH_TOKEN = process.env.OLLAMA_AUTH_TOKEN || '';

export const chatWithAssistant = async (req, res) => {
    try {
        const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        if (!message) {
            return res.status(400).json({ message: 'Message is required' });
        }

        const role = req.user?.role;
        const userId = req.user?.id;

        if (!role || !userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (role === 'Vendor' && sensitiveVendorPattern.test(message)) {
            return res.json({
                reply: 'I can help with your published tenders, bids, and contracts, but evaluation marks and technical scoring are not available in vendor view.',
                model: 'policy-guard',
            });
        }

        const history = Array.isArray(req.body?.messages) ? req.body.messages : [];
        const context = await buildHybridAssistantContext({ role, userId, query: message });

        const response = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(OLLAMA_AUTH_TOKEN ? { Authorization: `Bearer ${OLLAMA_AUTH_TOKEN}` } : {}),
            },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                stream: false,
                messages: buildOllamaMessages({ role, message, history, context }),
                options: {
                    temperature: 0.2,
                },
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ollama error: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        const reply = data?.message?.content || data?.response || '';

        if (!reply.trim()) {
            throw new Error('Empty response from Ollama');
        }

        return res.json({
            reply,
            model: OLLAMA_MODEL,
            contextSummary: context.summary || {},
            retrievalPlan: context.retrievalPlan || [],
            intent: context.intent || null,
        });
    } catch (error) {
        return res.status(500).json({
            message: error instanceof Error ? error.message : 'Failed to generate assistant response',
        });
    }
};
