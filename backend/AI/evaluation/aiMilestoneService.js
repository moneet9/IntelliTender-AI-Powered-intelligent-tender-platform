import { MilestoneAsset } from '../../models/model.js';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3.5:9b';
const OLLAMA_AUTH_TOKEN = process.env.OLLAMA_AUTH_TOKEN || '';

const MAX_TEXT_CHARS = 12000;
let tesseractWorkerPromise = null;

const truncateText = (value) => {
    const text = String(value || '').trim();
    if (text.length <= MAX_TEXT_CHARS) return text;
    return `${text.slice(0, MAX_TEXT_CHARS)}\n[TRUNCATED]`;
};

const decodeStoredDocument = (value, fallbackName = 'Document') => {
    if (!value || typeof value !== 'string') {
        return { name: fallbackName, content: '', mimeType: undefined };
    }

    try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && typeof parsed.content === 'string') {
            return {
                name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : fallbackName,
                content: parsed.content,
                mimeType: typeof parsed.mimeType === 'string' ? parsed.mimeType : undefined,
            };
        }
    } catch {
        // Fallback to legacy string formats.
    }

    if (value.startsWith('data:')) {
        const mimeType = value.slice(5, value.indexOf(';')) || undefined;
        return { name: fallbackName, content: value, mimeType };
    }

    if (value.startsWith('http://') || value.startsWith('https://')) {
        const tail = value.split('/').pop() || fallbackName;
        return { name: tail, content: value, mimeType: undefined };
    }

    return { name: fallbackName, content: value, mimeType: undefined };
};

const decodeDataUrl = (value) => {
    if (!value.startsWith('data:')) return null;
    const commaIndex = value.indexOf(',');
    if (commaIndex < 0) return null;
    const metadata = value.slice(5, commaIndex);
    const payload = value.slice(commaIndex + 1);
    const mimeType = metadata.split(';')[0] || 'application/octet-stream';
    const isBase64 = metadata.includes(';base64');

    const buffer = isBase64
        ? Buffer.from(payload, 'base64')
        : Buffer.from(decodeURIComponent(payload), 'utf8');

    return { buffer, mimeType };
};

const fetchBinary = async (url) => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch document: ${response.status}`);
    }
    const contentType = response.headers.get('content-type') || '';
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, mimeType: contentType };
};

const getTesseractWorker = async () => {
    if (!tesseractWorkerPromise) {
        tesseractWorkerPromise = (async () => {
            const { createWorker } = await import('tesseract.js');
            const worker = await createWorker();
            await worker.loadLanguage('eng');
            await worker.initialize('eng');
            return worker;
        })();
    }
    return tesseractWorkerPromise;
};

const extractTextFromBuffer = async (buffer, mimeType) => {
    if (!buffer || !buffer.length) return '';
    const normalizedMime = String(mimeType || '').toLowerCase();

    if (normalizedMime.includes('pdf')) {
        const pdfParse = (await import('pdf-parse')).default;
        const parsed = await pdfParse(buffer);
        return parsed?.text || '';
    }

    if (normalizedMime.startsWith('image/')) {
        try {
            const worker = await getTesseractWorker();
            const result = await worker.recognize(buffer);
            return result?.data?.text || '';
        } catch {
            return '';
        }
    }

    return buffer.toString('utf8');
};

const extractTextFromDocument = async (doc) => {
    if (!doc || !doc.content) return '';
    const content = doc.content;

    if (content.startsWith('data:')) {
        const decoded = decodeDataUrl(content);
        if (!decoded) return '';
        return extractTextFromBuffer(decoded.buffer, doc.mimeType || decoded.mimeType);
    }

    if (content.startsWith('http://') || content.startsWith('https://')) {
        const fetched = await fetchBinary(content);
        return extractTextFromBuffer(fetched.buffer, doc.mimeType || fetched.mimeType);
    }

    return String(content || '');
};

const collectAssetTexts = async (assetIds) => {
    const outputs = [];
    const ids = Array.isArray(assetIds) ? assetIds : [];

    for (const assetId of ids) {
        const asset = await MilestoneAsset.findById(assetId).lean();
        if (!asset) continue;
        const decoded = decodeStoredDocument(asset.content, asset.name || 'Attachment');
        const text = await extractTextFromDocument(decoded);
        outputs.push({
            name: decoded.name,
            mimeType: decoded.mimeType || asset.mimeType,
            text: truncateText(text),
        });
    }

    return outputs;
};

const collectTenderDocuments = async (tender) => {
    const docs = Array.isArray(tender?.documents) ? tender.documents : [];
    const results = [];

    for (let index = 0; index < docs.length; index += 1) {
        const decoded = decodeStoredDocument(docs[index], `Tender Document ${index + 1}`);
        const text = await extractTextFromDocument(decoded);
        results.push({
            name: decoded.name,
            mimeType: decoded.mimeType,
            text: truncateText(text),
        });
    }

    return results;
};

const buildPrompt = ({ tender, contract, milestone, update, report, tenderDocs, attachments }) => {
    const tenderMeta = {
        title: tender?.title,
        category: tender?.category,
        requiredDocuments: tender?.requiredDocuments || [],
        evaluationMethod: tender?.evaluationMethod,
    };

    const milestoneMeta = {
        title: milestone?.title,
        plannedStartDate: milestone?.plannedStartDate,
        plannedEndDate: milestone?.plannedEndDate,
        actualStartDate: update?.actualStartDate || milestone?.actualStartDate,
        actualEndDate: update?.actualEndDate || milestone?.actualEndDate,
        status: update?.status || milestone?.status,
        progress: update?.progress ?? milestone?.progress,
        checklist: update?.checklist || milestone?.checklist || [],
        remarks: update?.remarks || milestone?.remarks || '',
    };

    const reportMeta = report || null;

    return `You are an AI milestone review engine.\n\nTasks:\n- Compare milestone planned vs actual dates and detect delays.\n- Validate checklist completion vs reported status.\n- Review tender clauses for penalties or quality requirements.\n- Review milestone attachments for evidence (use OCR text extracts).\n- Produce alerts for PO if delay/quality risks exist.\n\nReturn STRICT JSON with this shape:\n{\n  "timeline": {"plannedStartDate": string, "plannedEndDate": string, "actualStartDate": string, "actualEndDate": string, "delayedDays": number, "status": string},\n  "checklistSummary": [string],\n  "observations": [string],\n  "alerts": [string],\n  "severity": "low|medium|high",\n  "penaltyEstimate": number,\n  "summary": string\n}\n\nTender metadata:\n${JSON.stringify(tenderMeta)}\n\nTender documents (text extracts):\n${JSON.stringify(tenderDocs)}\n\nMilestone context:\n${JSON.stringify(milestoneMeta)}\n\nProgress report:\n${JSON.stringify(reportMeta)}\n\nAttachments (text extracts):\n${JSON.stringify(attachments)}\n`;
};

const callOllama = async (prompt) => {
    const headers = { 'Content-Type': 'application/json' };
    if (OLLAMA_AUTH_TOKEN) {
        headers.Authorization = `Bearer ${OLLAMA_AUTH_TOKEN}`;
    }

    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model: OLLAMA_MODEL,
            stream: false,
            messages: [
                { role: 'system', content: 'Return only valid JSON. No markdown.' },
                { role: 'user', content: prompt },
            ],
            options: { temperature: 0.2 },
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return data?.message?.content || data?.response || '';
};

export const runMilestoneAiReview = async ({ tender, contract, milestone, update, report }) => {
    const attachmentIds = [
        ...(Array.isArray(update?.documents) ? update.documents : []),
        ...(Array.isArray(update?.images) ? update.images : []),
        ...(Array.isArray(report?.attachments) ? report.attachments : []),
    ];

    const attachments = await collectAssetTexts(attachmentIds);
    const tenderDocs = await collectTenderDocuments(tender);
    const prompt = buildPrompt({ tender, contract, milestone, update, report, tenderDocs, attachments });

    const responseText = await callOllama(prompt);
    let parsed = null;
    try {
        parsed = JSON.parse(responseText);
    } catch {
        throw new Error('Failed to parse AI milestone response');
    }

    return {
        parsed,
        raw: responseText,
        model: OLLAMA_MODEL,
        promptVersion: 'v1',
    };
};
