import { BidDocument } from '../../models/model.js';

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

const safeJsonParse = (value) => {
    if (!value || typeof value !== 'string') return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const decodeStoredDocument = (value, fallbackName = 'Document') => {
    if (!value || typeof value !== 'string') {
        return { name: fallbackName, content: '', mimeType: undefined };
    }

    const parsed = safeJsonParse(value);
    if (parsed && typeof parsed === 'object' && typeof parsed.content === 'string') {
        return {
            name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : fallbackName,
            content: parsed.content,
            mimeType: typeof parsed.mimeType === 'string' ? parsed.mimeType : undefined,
        };
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

const collectBidDocuments = async (bid) => {
    const outputs = [];
    const bidDocs = Array.isArray(bid?.bidDocuments) ? bid.bidDocuments : [];

    for (const entry of bidDocs) {
        if (entry?.documentId) {
            const stored = await BidDocument.findById(entry.documentId).lean();
            if (stored) {
                const decoded = decodeStoredDocument(stored.content, stored.name || entry.label || 'Bid document');
                const text = await extractTextFromDocument(decoded);
                outputs.push({
                    label: entry.label || stored.name || 'Bid document',
                    mimeType: decoded.mimeType || stored.mimeType,
                    text: truncateText(text),
                });
            }
            continue;
        }

        const decoded = decodeStoredDocument(entry?.document, entry?.label || 'Bid document');
        const text = await extractTextFromDocument(decoded);
        outputs.push({
            label: entry?.label || decoded.name || 'Bid document',
            mimeType: decoded.mimeType,
            text: truncateText(text),
        });
    }

    if (bid?.proposalDocument) {
        const decoded = decodeStoredDocument(bid.proposalDocument, 'Proposal document');
        const text = await extractTextFromDocument(decoded);
        outputs.push({
            label: 'Proposal document',
            mimeType: decoded.mimeType,
            text: truncateText(text),
        });
    }

    return outputs;
};

const buildPrompt = ({ tender, bid, tenderDocs, bidDocs }) => {
    const tenderMeta = {
        title: tender?.title,
        category: tender?.category,
        evaluationMethod: tender?.evaluationMethod,
        qcbsConfig: tender?.qcbsConfig || null,
        l1Config: tender?.l1Config || null,
        requiredDocuments: tender?.requiredDocuments || [],
    };

    const bidMeta = {
        vendorName: bid?.vendorName,
        proposedAmount: bid?.proposedAmount,
    };

    return `You are an AI evaluation engine for procurement tenders.\n\nRules:\n- Use tender documents and required documents to infer criteria and conditions.\n- Score each criterion using maxMarks. Binary criteria are full marks or zero.\n- Ratio criteria: award proportional marks (e.g., 2/3 * 20).\n- Validate certificate issuing authority when specified (logo/letterhead/issuer).\n- Flag suspected document tampering or manipulation.\n- Provide 2-3 lines of reasoning for awarded marks.\n- For commercial values: validate calculations and adjust if context implies realistic market variance.\n\nReturn STRICT JSON with this shape:\n{\n  "eligibility": {"passed": boolean, "reasons": [string]},\n  "criteriaScores": [{"criterion": string, "maxMarks": number, "awardedMarks": number, "ruleType": "binary|ratio|numeric|textual", "evidence": [string]}],\n  "commercialAnalysis": {"statedValue": number, "adjustedValue": number, "rationale": string, "risks": [string]},\n  "genuityChecks": {"warnings": [string], "confidence": number},\n  "aiScores": {"technicalScore": number, "financialScore": number, "overallScore": number},\n  "summary": string,\n  "rationale": [string]\n}\n\nTender metadata:\n${JSON.stringify(tenderMeta)}\n\nTender documents (text extracts):\n${JSON.stringify(tenderDocs)}\n\nBid metadata:\n${JSON.stringify(bidMeta)}\n\nBid documents (text extracts):\n${JSON.stringify(bidDocs)}\n`;
};

const callOllama = async (prompt) => {
    const headers = {
        'Content-Type': 'application/json',
    };

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
    const content = data?.message?.content || data?.response || '';
    return content;
};

export const runAiScoring = async ({ tender, bid }) => {
    const tenderDocs = await collectTenderDocuments(tender);
    const bidDocs = await collectBidDocuments(bid);
    const prompt = buildPrompt({ tender, bid, tenderDocs, bidDocs });

    const responseText = await callOllama(prompt);
    const parsed = safeJsonParse(responseText);

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Failed to parse AI response as JSON');
    }

    return {
        parsed,
        raw: responseText,
        tenderDocs,
        bidDocs,
        promptVersion: 'v1',
        model: OLLAMA_MODEL,
    };
};
