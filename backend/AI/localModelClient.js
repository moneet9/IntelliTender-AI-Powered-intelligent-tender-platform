import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { recordResearchMetric } from '../utils/researchMetrics.js';

const execFileAsync = promisify(execFile);

const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

const DEFAULT_BASE_URL = 'http://localhost:1234/v1';
const rawBaseUrl = process.env.LM_STUDIO_URL || process.env.LOCAL_AI_URL || DEFAULT_BASE_URL;
const normalizedBaseUrl = trimTrailingSlash(rawBaseUrl).endsWith('/v1')
    ? trimTrailingSlash(rawBaseUrl)
    : `${trimTrailingSlash(rawBaseUrl)}/v1`;

const LOCAL_MODEL = process.env.LM_STUDIO_MODEL || process.env.OLLAMA_MODEL || 'qwen3.5:9b';
const LOCAL_EMBED_MODEL = process.env.LM_STUDIO_EMBED_MODEL || process.env.OLLAMA_EMBED_MODEL || 'bge-m3';
const LOCAL_API_KEY = process.env.LM_STUDIO_API_KEY || process.env.LOCAL_AI_API_KEY || process.env.OLLAMA_AUTH_TOKEN || '';
const modelListCache = {
    chat: null,
    embedding: null,
    fetchedAt: 0,
};
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const GPU_POWER_SAMPLE_TIMEOUT_MS = 1000;
const GPU_POWER_TELEMETRY_ENABLED = process.env.RESEARCH_GPU_TELEMETRY === 'true';

export const LOCAL_AI_BASE_URL = normalizedBaseUrl;
export const LOCAL_AI_MODEL = LOCAL_MODEL;
export const LOCAL_AI_EMBED_MODEL = LOCAL_EMBED_MODEL;

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

const readGpuPowerWatts = async () => {
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

const recordInferenceMetric = async ({
    operation,
    model,
    startedAt,
    usage = {},
    powerBeforeWatts = null,
    powerAfterWatts = null,
    status = 'success',
}) => {
    const durationMs = Date.now() - startedAt;
    const totalTokens = Number(usage.total_tokens || 0);
    const averagePowerWatts = Number.isFinite(powerBeforeWatts) && Number.isFinite(powerAfterWatts)
        ? (powerBeforeWatts + powerAfterWatts) / 2
        : null;
    const energyJoules = averagePowerWatts === null ? null : averagePowerWatts * (durationMs / 1000);
    const tokensPerSecond = totalTokens > 0 && durationMs > 0
        ? totalTokens / (durationMs / 1000)
        : null;

    void recordResearchMetric({
        eventType: 'local-ai-inference',
        durationMs,
        status,
        metricName: operation,
        value: totalTokens,
        note: 'LM Studio inference telemetry',
        metadata: {
            model,
            promptTokens: Number(usage.prompt_tokens || 0),
            completionTokens: Number(usage.completion_tokens || 0),
            totalTokens,
            tokensPerSecond,
            gpuPowerBeforeWatts: powerBeforeWatts,
            gpuPowerAfterWatts: powerAfterWatts,
            averageGpuPowerWatts: averagePowerWatts,
            estimatedEnergyJoules: energyJoules,
            estimatedEnergyWh: energyJoules === null ? null : energyJoules / 3600,
            telemetrySource: averagePowerWatts === null ? 'tokens-and-duration-only' : 'nvidia-smi',
        },
    });
};

const estimateTokenCount = (value) => {
    const text = Array.isArray(value)
        ? value.map((item) => item?.content || '').join(' ')
        : String(value || '');
    return Math.ceil(text.trim().length / 4);
};

const safeJsonParse = async (response) => {
    const text = await response.text();
    try {
        return text ? JSON.parse(text) : null;
    } catch {
        return { raw: text };
    }
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
}) => {
    const startedAt = Date.now();
    const powerBeforeWatts = await readGpuPowerWatts();
    const requestBody = {
        model,
        messages,
        temperature,
        stream: false,
        ...(normalizeResponseFormat(responseFormat) ? { response_format: normalizeResponseFormat(responseFormat) } : {}),
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
    };

    const sendChatRequest = async (modelId) => fetch(buildUrl('/chat/completions'), {
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
        const response = await sendChatRequest(modelId);
        if (response.ok) {
            const data = await response.json();
            const message = data?.choices?.[0]?.message || data?.message || {};
            void recordInferenceMetric({
                operation: 'chat-completion',
                model: modelId,
                startedAt,
                usage: {
                    prompt_tokens: data?.usage?.prompt_tokens ?? estimateTokenCount(messages),
                    completion_tokens: data?.usage?.completion_tokens ?? estimateTokenCount(message?.content),
                    total_tokens: data?.usage?.total_tokens ?? estimateTokenCount(messages) + estimateTokenCount(message?.content),
                },
                powerBeforeWatts,
                powerAfterWatts: await readGpuPowerWatts(),
            });
            return (
                message?.content ||
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
    const startedAt = Date.now();
    const powerBeforeWatts = await readGpuPowerWatts();
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

    void recordInferenceMetric({
        operation: 'embedding',
        model: resolvedModel,
        startedAt,
        usage: {
            prompt_tokens: data?.usage?.prompt_tokens ?? estimateTokenCount(input),
            completion_tokens: data?.usage?.completion_tokens ?? 0,
            total_tokens: data?.usage?.total_tokens ?? estimateTokenCount(input),
        },
        powerBeforeWatts,
        powerAfterWatts: await readGpuPowerWatts(),
    });

    return Array.isArray(embedding) ? embedding : [];
};
