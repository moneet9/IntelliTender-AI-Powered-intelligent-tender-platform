import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

const DEFAULT_BASE_URL = 'http://localhost:1234/v1';
const rawBaseUrl = process.env.LM_STUDIO_URL || process.env.LOCAL_AI_URL || DEFAULT_BASE_URL;
const normalizedBaseUrl = trimTrailingSlash(rawBaseUrl).endsWith('/v1')
    ? trimTrailingSlash(rawBaseUrl)
    : `${trimTrailingSlash(rawBaseUrl)}/v1`;

const LOCAL_MODEL = process.env.LM_STUDIO_MODEL || process.env.OLLAMA_MODEL || 'qwen3.5:9b';
const LOCAL_CHAT_MODEL = process.env.LM_STUDIO_CHAT_MODEL || LOCAL_MODEL;
const LOCAL_EMBED_MODEL = process.env.LM_STUDIO_EMBED_MODEL || process.env.OLLAMA_EMBED_MODEL || 'bge-m3';
const LOCAL_API_KEY = process.env.LM_STUDIO_API_KEY || process.env.LOCAL_AI_API_KEY || process.env.OLLAMA_AUTH_TOKEN || '';
const LM_STUDIO_NATIVE_API = String(process.env.LM_STUDIO_NATIVE_API || 'true').toLowerCase() !== 'false';
const GPU_POWER_SAMPLE_TIMEOUT_MS = 1000;
// Capture only two host samples per bid evaluation. Disable explicitly when
// desired; NVIDIA users get power metrics by default.
const GPU_POWER_TELEMETRY_ENABLED = String(process.env.RESEARCH_GPU_TELEMETRY || 'true').toLowerCase() !== 'false';
const modelListCache = {
    chat: null,
    embedding: null,
    fetchedAt: 0,
};
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

export const LOCAL_AI_BASE_URL = normalizedBaseUrl;
export const LOCAL_AI_MODEL = LOCAL_MODEL;
export const LOCAL_AI_CHAT_MODEL = LOCAL_CHAT_MODEL;
export const LOCAL_AI_EMBED_MODEL = LOCAL_EMBED_MODEL;

export async function checkLocalAiConnection({ timeoutMs = 5000 } = {}) {
    const configuredUrl = buildUrl('/models');
    const nativeUrl = buildNativeUrl('/models');
    const urls = Array.from(new Set([configuredUrl, nativeUrl]));

    for (const url of urls) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, { method: 'GET', headers: buildHeaders(), signal: controller.signal });
            if (response.ok) {
                const data = await response.json().catch(() => ({}));
                return {
                    online: true,
                    endpoint: url,
                    modelCount: Array.isArray(data?.data) ? data.data.length : 0,
                };
            }
        } catch {
            // Try the next compatible LM Studio API route.
        } finally {
            clearTimeout(timeout);
        }
    }

    return { online: false, endpoint: configuredUrl, modelCount: 0 };
}

const buildNativeUrl = (path) => {
    const origin = normalizedBaseUrl.replace(/\/v1$/i, '');
    return `${origin}/api/v1${path}`;
};

export const readLocalGpuPowerWatts = async () => {
    if (!GPU_POWER_TELEMETRY_ENABLED) return null;
    try {
        const { stdout } = await execFileAsync(
            'nvidia-smi',
            ['--query-gpu=power.draw', '--format=csv,noheader,nounits'],
            { timeout: GPU_POWER_SAMPLE_TIMEOUT_MS, windowsHide: true },
        );
        const watts = Number.parseFloat(String(stdout).trim().split(/\s+/)[0]);
        return Number.isFinite(watts) ? watts : null;
    } catch {
        return null;
    }
};

const buildHeaders = () => {
    const headers = {
        'Content-Type': 'application/json',
    };

    if (LOCAL_API_KEY) {
        headers.Authorization = `Bearer ${LOCAL_API_KEY}`;
    }

    return headers;
};

const buildUrl = (path) => `${LOCAL_AI_BASE_URL}${path}`;

const safeJsonParse = async (response) => {
    const text = await response.text();
    try {
        return text ? JSON.parse(text) : null;
    } catch {
        return { raw: text };
    }
};

// LM Studio can return zero usage for some native v1 model/runtime pairs.
// This is a transparent character-based estimate, never presented as a
// server-reported count.
const estimateTokenCount = (value) => {
    const text = Array.isArray(value)
        ? value.map((item) => item?.content || '').join(' ')
        : String(value || '');
    return Math.max(0, Math.ceil(text.trim().length / 4));
};

const normalizeResponseFormat = (responseFormat) => {
    if (!responseFormat || typeof responseFormat !== 'object') {
        return null;
    }

    if (responseFormat.type === 'json_schema') {
        return responseFormat;
    }

    if (responseFormat.type === 'json_object') {
        return {
            type: 'json_schema',
            json_schema: {
                name: 'intellitender_json',
                strict: false,
                schema: {
                    type: 'object',
                    additionalProperties: true,
                },
            },
        };
    }

    if (responseFormat.type === 'text') {
        return responseFormat;
    }

    return null;
};

const isEmbeddingModel = (modelId) => /embed/i.test(String(modelId || '')) || /nomic/i.test(String(modelId || '')) || /bge/i.test(String(modelId || ''));

const fetchAvailableModels = async () => {
    const now = Date.now();
    if (modelListCache.fetchedAt && now - modelListCache.fetchedAt < MODEL_CACHE_TTL_MS) {
        return modelListCache;
    }

    const response = await fetch(buildUrl('/models'), {
        method: 'GET',
        headers: buildHeaders(),
    });

    if (!response.ok) {
        const errorBody = await safeJsonParse(response);
        throw new Error(`Local AI model list error: ${response.status} ${JSON.stringify(errorBody)}`);
    }

    const data = await response.json();
    const models = Array.isArray(data?.data) ? data.data : [];
    const chatModels = models.map((item) => item?.id).filter(Boolean).filter((modelId) => !isEmbeddingModel(modelId));
    const embeddingModels = models.map((item) => item?.id).filter(Boolean).filter((modelId) => isEmbeddingModel(modelId));

    modelListCache.chat = chatModels;
    modelListCache.embedding = embeddingModels;
    modelListCache.fetchedAt = now;

    return modelListCache;
};

const resolveChatModel = async (preferredModel) => {
    const requested = String(preferredModel || '').trim();
    const models = await fetchAvailableModels();
    if (requested && models.chat?.includes(requested)) {
        return requested;
    }

    return models.chat?.[0] || requested || LOCAL_MODEL;
};

const resolveEmbeddingModel = async (preferredModel) => {
    const requested = String(preferredModel || '').trim();
    const models = await fetchAvailableModels();
    if (requested && models.embedding?.includes(requested)) {
        return requested;
    }

    return models.embedding?.[0] || requested || LOCAL_EMBED_MODEL;
};

export const callLocalChat = async ({
    messages,
    model = LOCAL_AI_MODEL,
    temperature = 0.2,
    responseFormat = null,
    signal,
    maxTokens = null,
    onTelemetry = null,
    useNativeApi = false,
}) => {
    const requestStartedAt = Date.now();
    const requestBody = {
        model,
        messages,
        temperature,
        stream: false,
        ...(normalizeResponseFormat(responseFormat) ? { response_format: normalizeResponseFormat(responseFormat) } : {}),
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
    };

    const sendChatRequest = async (modelId) => {
        if (useNativeApi && LM_STUDIO_NATIVE_API) {
            const systemMessage = messages.find((item) => item?.role === 'system')?.content;
            const inputMessages = messages
                .filter((item) => item?.role !== 'system')
                .map((item) => ({ type: 'message', content: String(item?.content || '') }));
            return fetch(buildNativeUrl('/chat'), {
                method: 'POST',
                signal,
                headers: buildHeaders(),
                body: JSON.stringify({
                    model: modelId,
                    input: inputMessages.length === 1 ? inputMessages[0].content : inputMessages,
                    ...(systemMessage ? { system_prompt: String(systemMessage) } : {}),
                    temperature,
                    stream: false,
                    ...(maxTokens ? { max_output_tokens: maxTokens } : {}),
                }),
            });
        }

        return fetch(buildUrl('/chat/completions'), {
            method: 'POST',
            signal,
            headers: buildHeaders(),
            body: JSON.stringify({ ...requestBody, model: modelId }),
        });
    };

    const sendCompatibilityRequest = (modelId) => fetch(buildUrl('/chat/completions'), {
        method: 'POST',
        signal,
        headers: buildHeaders(),
        body: JSON.stringify({ ...requestBody, model: modelId }),
    });

    const tryModels = Array.from(new Set([
        await resolveChatModel(model),
        await resolveChatModel(LOCAL_AI_MODEL),
    ])).filter(Boolean);

    let lastError = null;
    for (const modelId of tryModels) {
        let response;
        let responseSource = useNativeApi && LM_STUDIO_NATIVE_API ? 'lm-studio-native-v1' : 'openai-compatible-v1';
        try {
            response = await sendChatRequest(modelId);
        } catch (error) {
            lastError = error;
            if (!(useNativeApi && LM_STUDIO_NATIVE_API)) {
                throw new Error(`Local AI request failed: ${error instanceof Error ? error.message : 'fetch failed'}`);
            }
            try {
                response = await sendCompatibilityRequest(modelId);
                responseSource = 'openai-compatible-v1-fallback';
            } catch (fallbackError) {
                throw new Error(`Local AI request failed on native and compatibility v1 APIs: ${fallbackError instanceof Error ? fallbackError.message : 'fetch failed'}`);
            }
        }
        if (!response.ok && useNativeApi && LM_STUDIO_NATIVE_API && [400, 404, 405].includes(response.status)) {
            const fallbackResponse = await sendCompatibilityRequest(modelId);
            responseSource = 'openai-compatible-v1-fallback';
            if (fallbackResponse.ok || fallbackResponse.status !== 404) {
                if (fallbackResponse.ok) {
                    const data = await fallbackResponse.json();
                    const message = data?.choices?.[0]?.message || data?.message || {};
                    const messageContent = Array.isArray(message?.content)
                        ? message.content.map((item) => item?.text || '').join('')
                        : message?.content || message?.reasoning_content || data?.response || data?.output_text || '';
                    if (typeof onTelemetry === 'function') {
                        onTelemetry({ model: modelId, usage: data?.usage || {}, stats: { ...(data?.stats || {}), generation_time: data?.stats?.generation_time || (Date.now() - requestStartedAt) / 1000 }, source: responseSource });
                    }
                    return messageContent;
                }
            }
        }
        if (response.ok) {
            const data = await response.json();
            const nativeMessage = Array.isArray(data?.output)
                ? data.output.find((item) => item?.type === 'message')
                : null;
            const message = data?.choices?.[0]?.message || data?.message || nativeMessage || {};
            const messageContent = Array.isArray(message?.content)
                ? message.content.map((item) => item?.text || '').join('')
                : message?.content || message?.reasoning_content || '';
            if (!String(messageContent || '').trim() && useNativeApi && LM_STUDIO_NATIVE_API) {
                // Some LM Studio/model combinations finish native v1 with an
                // empty output and zero stats. Retry the compatible v1 route
                // before allowing the evaluator to continue with blank JSON.
                const fallbackResponse = await sendCompatibilityRequest(modelId);
                if (fallbackResponse.ok) {
                    const fallbackData = await fallbackResponse.json();
                    const fallbackMessage = fallbackData?.choices?.[0]?.message || fallbackData?.message || {};
                    const fallbackContent = Array.isArray(fallbackMessage?.content)
                        ? fallbackMessage.content.map((item) => item?.text || '').join('')
                        : fallbackMessage?.content || fallbackMessage?.reasoning_content || fallbackData?.response || fallbackData?.output_text || '';
                    if (String(fallbackContent || '').trim()) {
                        if (typeof onTelemetry === 'function') {
                            onTelemetry({
                                model: modelId,
                                usage: fallbackData?.usage || {},
                                stats: { ...(fallbackData?.stats || {}), generation_time: fallbackData?.stats?.generation_time || (Date.now() - requestStartedAt) / 1000 },
                                source: 'openai-compatible-v1-empty-native-fallback',
                            });
                        }
                        return fallbackContent;
                    }
                }
                throw new Error(`LM Studio returned an empty response for model ${modelId}`);
            }
            if (typeof onTelemetry === 'function') {
                const nativeStats = data?.stats || {};
                const serverInputTokens = Number(nativeStats.input_tokens ?? data?.usage?.prompt_tokens ?? 0);
                const serverOutputTokens = Number(nativeStats.total_output_tokens ?? data?.usage?.completion_tokens ?? 0);
                const serverTotalTokens = Number(data?.usage?.total_tokens || 0) || serverInputTokens + serverOutputTokens;
                const hasServerTokens = serverTotalTokens > 0;
                const estimatedInputTokens = estimateTokenCount(messages);
                const estimatedOutputTokens = estimateTokenCount(messageContent);
                const generationSeconds = Number(nativeStats.generation_time_seconds || 0)
                    || Math.max(0, (Date.now() - requestStartedAt) / 1000 - Number(nativeStats.time_to_first_token_seconds || 0));
                const inputTokens = hasServerTokens ? serverInputTokens : estimatedInputTokens;
                const outputTokens = hasServerTokens ? serverOutputTokens : estimatedOutputTokens;
                onTelemetry({
                    model: modelId,
                    usage: hasServerTokens ? (data?.usage || {
                        prompt_tokens: inputTokens,
                        completion_tokens: outputTokens,
                        total_tokens: inputTokens + outputTokens,
                    }) : {
                        prompt_tokens: inputTokens,
                        completion_tokens: outputTokens,
                        total_tokens: inputTokens + outputTokens,
                    },
                    stats: {
                        ...nativeStats,
                        input_tokens: inputTokens,
                        total_output_tokens: outputTokens,
                        time_to_first_token: nativeStats.time_to_first_token_seconds,
                        generation_time: generationSeconds,
                        tokens_per_second: Number(nativeStats.tokens_per_second || 0) || (outputTokens > 0 && generationSeconds > 0 ? outputTokens / generationSeconds : 0),
                    },
                    source: hasServerTokens
                        ? responseSource
                        : 'estimated-from-text-lm-studio-zero-usage',
                });
            }
            return (
                messageContent ||
                message?.reasoning_content ||
                data?.response ||
                data?.output_text ||
                ''
            );
        }

        const errorBody = await safeJsonParse(response);
        lastError = { response, errorBody, modelId };

        if (String(errorBody?.error?.code || errorBody?.code || '') !== 'model_not_found') {
            throw new Error(`Local AI error: ${response.status} ${JSON.stringify(errorBody)}`);
        }
    }

    throw new Error(`Local AI error: ${lastError?.response?.status || 500} ${JSON.stringify(lastError?.errorBody || {})}`);
};

export const callLocalEmbedding = async ({
    input,
    model = LOCAL_AI_EMBED_MODEL,
}) => {
    const resolvedModel = await resolveEmbeddingModel(model);
    const response = await fetch(buildUrl('/embeddings'), {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({
            model: resolvedModel,
            input,
        }),
    });

    if (!response.ok) {
        const errorBody = await safeJsonParse(response);
        throw new Error(`Local embedding error: ${response.status} ${JSON.stringify(errorBody)}`);
    }

    const data = await response.json();
    const embedding = Array.isArray(data?.data)
        ? data.data?.[0]?.embedding
        : data?.embedding;

    return Array.isArray(embedding) ? embedding : [];
};
