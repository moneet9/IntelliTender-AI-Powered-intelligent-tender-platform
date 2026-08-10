import crypto from 'crypto';
import { DocumentChunk, DocumentEmbeddingJob, Tender, BidDocument, MilestoneAsset, Contract } from '../../models/model.js';
import { callLocalEmbedding, LOCAL_AI_EMBED_MODEL, LOCAL_AI_BASE_URL } from '../localModelClient.js';

const MAX_TEXT_CHARS = 50000;
const DEFAULT_CHUNK_SIZE = Number(process.env.DOCUMENT_EMBED_CHUNK_SIZE || 1200);
const DEFAULT_CHUNK_OVERLAP = Number(process.env.DOCUMENT_EMBED_CHUNK_OVERLAP || 180);
const DEFAULT_BATCH_SIZE = Number(process.env.DOCUMENT_EMBED_BATCH_SIZE || 20);
const DOCUMENT_SCOPE_TO_KIND = {
    tender: 'tender-document',
    bid: 'bid-document',
    committee: 'committee-report',
};

let tesseractWorkerPromise = null;

const safeJsonParse = (value) => {
    if (typeof value !== 'string') return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const sha1 = (value) => crypto.createHash('sha1').update(String(value || '')).digest('hex');

const truncateText = (value) => {
    const text = String(value || '').trim();
    if (text.length <= MAX_TEXT_CHARS) return text;
    return `${text.slice(0, MAX_TEXT_CHARS)}\n[TRUNCATED]`;
};

const normalizeText = (value) => String(value || '').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const buildSearchableDocumentText = (chunk) => {
    const meta = chunk?.sourceMeta && typeof chunk.sourceMeta === 'object'
        ? JSON.stringify(chunk.sourceMeta)
        : '';

    return normalizeText([
        chunk?.sourceName || '',
        chunk?.sourceKey || '',
        chunk?.tenderId || '',
        chunk?.contractId || '',
        chunk?.bidId || '',
        chunk?.reportId || '',
        chunk?.uploadedBy || '',
        chunk?.vendorId || '',
        meta,
        chunk?.chunkText || '',
    ].filter(Boolean).join(' '));
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

const extractTextFromContent = async (rawContent, mimeType) => {
    if (!rawContent) return '';

    const decoded = decodeStoredDocument(rawContent, 'Document');
    const content = decoded.content;
    const resolvedMimeType = mimeType || decoded.mimeType;

    if (content.startsWith('data:')) {
        const dataUrl = decodeDataUrl(content);
        if (!dataUrl) return '';
        return extractTextFromBuffer(dataUrl.buffer, resolvedMimeType || dataUrl.mimeType);
    }

    if (content.startsWith('http://') || content.startsWith('https://')) {
        const fetched = await fetchBinary(content);
        return extractTextFromBuffer(fetched.buffer, resolvedMimeType || fetched.mimeType);
    }

    return String(content || '');
};

const splitTextIntoChunks = (text, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP) => {
    const normalized = normalizeText(text);
    if (!normalized) return [];
    if (normalized.length <= chunkSize) return [normalized];

    const chunks = [];
    let start = 0;

    while (start < normalized.length) {
        const end = Math.min(start + chunkSize, normalized.length);
        const chunk = normalized.slice(start, end).trim();
        if (chunk) {
            chunks.push(chunk);
        }

        if (end >= normalized.length) {
            break;
        }

        start = Math.max(0, end - overlap);
    }

    return chunks;
};

const embeddingInputForModel = (modelId, text, kind = 'document') => {
    const model = String(modelId || '').toLowerCase();
    const cleaned = normalizeText(text);

    if (!cleaned) return '';

    if (model.includes('nomic')) {
        return `${kind === 'query' ? 'search_query' : 'search_document'}: ${cleaned}`;
    }

    return cleaned;
};

const buildSourceKey = (sourceKind, parts = []) => `${sourceKind}:${parts.map((part) => String(part || '').trim()).filter(Boolean).join(':')}`;

const normalizeDocumentScope = (scope) => {
    const normalized = String(scope || '').trim().toLowerCase();
    if (normalized === 'tender' || normalized === 'tender-document' || normalized === 'tender-documents') return 'tender';
    if (normalized === 'bid' || normalized === 'bid-document' || normalized === 'bid-documents' || normalized === 'vendor') return 'bid';
    if (normalized === 'committee' || normalized === 'committee-report' || normalized === 'committee-reports' || normalized === 'report') return 'committee';
    return 'all';
};

const kindForScope = (scope) => DOCUMENT_SCOPE_TO_KIND[normalizeDocumentScope(scope)] || null;

const buildJobShape = (payload) => {
    const rawContent = String(payload?.rawContent || '');
    return {
        sourceKind: payload.sourceKind,
        sourceKey: payload.sourceKey,
        tenderId: payload.tenderId || undefined,
        contractId: payload.contractId || undefined,
        milestoneId: payload.milestoneId || undefined,
        bidId: payload.bidId || undefined,
        reportId: payload.reportId || undefined,
        uploadedBy: payload.uploadedBy || undefined,
        vendorId: payload.vendorId || undefined,
        sourceIndex: Number.isFinite(Number(payload.sourceIndex)) ? Number(payload.sourceIndex) : 0,
        sourceName: payload.sourceName || 'Document',
        mimeType: payload.mimeType || undefined,
        rawContent,
        contentHash: sha1(rawContent),
        sourceMeta: payload.sourceMeta || {},
        status: 'pending',
        attempts: 0,
        chunkCount: 0,
        embeddingModel: '',
        lastError: '',
        queuedAt: new Date(),
        startedAt: null,
        processedAt: null,
    };
};

export async function isLocalAiOnline() {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(`${LOCAL_AI_BASE_URL}/models`, {
            method: 'GET',
            signal: controller.signal,
        });
        clearTimeout(timeout);
        return response.ok;
    } catch {
        return false;
    }
}

export async function queueDocumentEmbeddingJob(payload, { replaceExisting = false } = {}) {
    const job = buildJobShape(payload);
    if (!job.sourceKind || !job.sourceKey || !job.rawContent) {
        return null;
    }

    if (replaceExisting) {
        await DocumentChunk.deleteMany({ sourceKey: job.sourceKey });
    }

    const saved = await DocumentEmbeddingJob.findOneAndUpdate(
        { sourceKey: job.sourceKey },
        { $set: job },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return saved;
}

export async function queueTenderDocumentEmbeddings(tender, { replaceExisting = true } = {}) {
    if (!tender?._id) return [];

    const docs = Array.isArray(tender.documents) ? tender.documents : [];
    if (!docs.length) return [];

    if (replaceExisting) {
        await DocumentChunk.deleteMany({
            sourceKind: 'tender-document',
            tenderId: tender._id,
        });
        await DocumentEmbeddingJob.deleteMany({
            sourceKind: 'tender-document',
            tenderId: tender._id,
        });
    }

    const jobs = [];
    for (let index = 0; index < docs.length; index += 1) {
        const decoded = decodeStoredDocument(docs[index], `Tender Document ${index + 1}`);
        if (!decoded.content) continue;

        const sourceKey = buildSourceKey('tender-document', [tender._id, index]);
        jobs.push(queueDocumentEmbeddingJob({
            sourceKind: 'tender-document',
            sourceKey,
            tenderId: tender._id,
            sourceIndex: index,
            sourceName: decoded.name || `Tender Document ${index + 1}`,
            mimeType: decoded.mimeType,
            rawContent: decoded.content,
            sourceMeta: {
                tenderTitle: tender.title || '',
                createdBy: tender.createdBy || null,
            },
        }, { replaceExisting: false }));
    }

    return Promise.all(jobs);
}

export async function queueBidDocumentEmbeddings({ tenderId, bidId, vendorId, documents = [], proposalDocument = null, replaceExisting = true }) {
    const jobs = [];
    const normalizedDocuments = [];

    if (Array.isArray(documents)) {
        normalizedDocuments.push(...documents);
    }

    if (proposalDocument) {
        normalizedDocuments.push({
            documentId: proposalDocument.documentId || proposalDocument._id || null,
            label: proposalDocument.label || 'Proposal document',
            document: proposalDocument.document || proposalDocument.content || '',
            name: proposalDocument.name || proposalDocument.label || 'Proposal document',
            mimeType: proposalDocument.mimeType,
        });
    }

    for (const entry of normalizedDocuments) {
        const rawContent = typeof entry?.document === 'string' ? entry.document : '';
        if (!rawContent) continue;

        const sourceKey = buildSourceKey('bid-document', [
            entry.documentId || entry._id || tenderId,
            bidId || vendorId || '',
        ]);

        jobs.push(queueDocumentEmbeddingJob({
            sourceKind: 'bid-document',
            sourceKey,
            tenderId,
            bidId,
            vendorId,
            sourceName: entry.name || entry.label || 'Bid document',
            mimeType: entry.mimeType,
            rawContent,
            sourceMeta: {
                label: entry.label || '',
            },
        }, { replaceExisting: replaceExisting }));
    }

    return Promise.all(jobs);
}

export async function queueMilestoneAssetEmbedding(asset, { replaceExisting = true } = {}) {
    if (!asset?._id || !asset.content) return null;

    const sourceKey = buildSourceKey('committee-report', [asset._id]);
    return queueDocumentEmbeddingJob({
        sourceKind: 'committee-report',
        sourceKey,
        tenderId: asset.contractId ? undefined : undefined,
        contractId: asset.contractId || undefined,
        milestoneId: asset.milestoneId || undefined,
        reportId: asset.reportId || undefined,
        uploadedBy: asset.uploadedBy || undefined,
        sourceName: asset.name || 'Committee report attachment',
        mimeType: asset.mimeType,
        rawContent: asset.content,
        sourceMeta: {
            assetType: asset.assetType || 'committee-report',
            milestoneId: asset.milestoneId || null,
        },
    }, { replaceExisting });
}

export async function queueCommitteeReportEmbedding({
    contractId,
    milestoneId,
    reportId,
    uploadedBy,
    sourceName,
    rawContent,
    mimeType,
    sourceMeta = {},
    replaceExisting = true,
}) {
    if (!rawContent) return null;

    const sourceKey = buildSourceKey('committee-report', [
        contractId,
        milestoneId || 'general',
        reportId || sha1(rawContent).slice(0, 12),
    ]);

    return queueDocumentEmbeddingJob({
        sourceKind: 'committee-report',
        sourceKey,
        contractId,
        milestoneId,
        reportId,
        uploadedBy,
        sourceName: sourceName || 'Committee report',
        mimeType,
        rawContent,
        sourceMeta,
    }, { replaceExisting });
}

async function removeExistingChunks(sourceKey) {
    await DocumentChunk.deleteMany({ sourceKey });
}

async function saveChunksForJob(job, chunks) {
    if (!chunks.length) return 0;

    const embeddingModel = LOCAL_AI_EMBED_MODEL;
    const sourceText = normalizeText(job.rawContent);
    const contentHash = sha1(sourceText);
    const savedChunks = [];

    for (let index = 0; index < chunks.length; index += 1) {
        const chunkText = chunks[index];
        const embedding = await callLocalEmbedding({
            input: embeddingInputForModel(embeddingModel, chunkText, 'document'),
            model: embeddingModel,
        });

        savedChunks.push({
            sourceKind: job.sourceKind,
            sourceKey: job.sourceKey,
            tenderId: job.tenderId || undefined,
            contractId: job.contractId || undefined,
            milestoneId: job.milestoneId || undefined,
            bidId: job.bidId || undefined,
            reportId: job.reportId || undefined,
            uploadedBy: job.uploadedBy || undefined,
            vendorId: job.vendorId || undefined,
            sourceIndex: job.sourceIndex || 0,
            chunkIndex: index,
            chunkText,
            chunkHash: sha1(`${job.sourceKey}:${index}:${chunkText}`),
            contentHash,
            mimeType: job.mimeType || undefined,
            ocrUsed: Boolean(job.sourceMeta?.ocrUsed),
            tokenCount: chunkText.split(/\s+/).filter(Boolean).length,
            embedding,
            embeddingModel,
            sourceName: job.sourceName || 'Document',
            sourceMeta: job.sourceMeta || {},
        });
    }

    await DocumentChunk.insertMany(savedChunks, { ordered: false });
    return savedChunks.length;
}

async function processJob(job) {
    const rawText = await extractTextFromContent(job.rawContent, job.mimeType);
    const text = truncateText(rawText);
    const chunks = splitTextIntoChunks(text);

    await removeExistingChunks(job.sourceKey);

    if (!chunks.length) {
        await DocumentEmbeddingJob.findByIdAndUpdate(job._id, {
            $set: {
                status: 'completed',
                chunkCount: 0,
                embeddingModel: LOCAL_AI_EMBED_MODEL,
                processedAt: new Date(),
                lastError: '',
            },
            $inc: { attempts: 1 },
        });
        return { chunkCount: 0 };
    }

    const chunkCount = await saveChunksForJob(job, chunks);

    await DocumentEmbeddingJob.findByIdAndUpdate(job._id, {
        $set: {
            status: 'completed',
            chunkCount,
            embeddingModel: LOCAL_AI_EMBED_MODEL,
            processedAt: new Date(),
            lastError: '',
        },
        $inc: { attempts: 1 },
    });

    return { chunkCount };
}

export async function seedDocumentEmbeddingJobs({ scope = 'all' } = {}) {
    const normalizedScope = normalizeDocumentScope(scope);
    const allowedKinds = normalizedScope === 'all'
        ? new Set(Object.values(DOCUMENT_SCOPE_TO_KIND))
        : new Set([kindForScope(normalizedScope)]);

    const tenders = await Tender.find({ documents: { $exists: true, $ne: [] } })
        .select('title documents createdBy')
        .lean();

    const bidDocuments = await BidDocument.find({})
        .select('tenderId vendorId name content mimeType')
        .lean();

    const assets = await MilestoneAsset.find({})
        .select('contractId milestoneId reportId uploadedBy assetType name content mimeType')
        .lean();

    const progressReports = await Contract.find({})
        .select('progressReports milestones')
        .lean();

    if (allowedKinds.has('tender-document')) {
        for (const tender of tenders) {
            const docs = Array.isArray(tender.documents) ? tender.documents : [];
            for (let index = 0; index < docs.length; index += 1) {
                const decoded = decodeStoredDocument(docs[index], `Tender Document ${index + 1}`);
                if (!decoded.content) continue;
                await queueDocumentEmbeddingJob({
                    sourceKind: 'tender-document',
                    sourceKey: buildSourceKey('tender-document', [tender._id, index]),
                    tenderId: tender._id,
                    sourceIndex: index,
                    sourceName: decoded.name || `Tender Document ${index + 1}`,
                    mimeType: decoded.mimeType,
                    rawContent: decoded.content,
                    sourceMeta: { tenderTitle: tender.title || '', createdBy: tender.createdBy || null },
                });
            }
        }
    }

    if (allowedKinds.has('bid-document')) {
        for (const doc of bidDocuments) {
            if (!doc?.content) continue;
            await queueDocumentEmbeddingJob({
                sourceKind: 'bid-document',
                sourceKey: buildSourceKey('bid-document', [doc._id]),
                tenderId: doc.tenderId,
                vendorId: doc.vendorId,
                sourceName: doc.name || 'Bid document',
                mimeType: doc.mimeType,
                rawContent: doc.content,
                sourceMeta: { bidDocumentId: doc._id },
            });
        }
    }

    if (allowedKinds.has('committee-report')) {
        for (const asset of assets) {
            if (!asset?.content) continue;
            await queueDocumentEmbeddingJob({
                sourceKind: 'committee-report',
                sourceKey: buildSourceKey('committee-report', [asset._id]),
                contractId: asset.contractId,
                milestoneId: asset.milestoneId,
                reportId: asset.reportId,
                uploadedBy: asset.uploadedBy,
                sourceName: asset.name || 'Committee report attachment',
                mimeType: asset.mimeType,
                rawContent: asset.content,
                sourceMeta: {
                    assetType: asset.assetType,
                    milestoneId: asset.milestoneId || null,
                },
            });
        }

        for (const contract of progressReports) {
            const reports = Array.isArray(contract.progressReports) ? contract.progressReports : [];
            for (let index = 0; index < reports.length; index += 1) {
                const report = reports[index];
                const rawContent = normalizeText([
                    report.reportType ? `Report type: ${report.reportType}` : '',
                    report.milestoneTitle ? `Milestone: ${report.milestoneTitle}` : '',
                    report.description ? `Description: ${report.description}` : '',
                    report.observations ? `Observations: ${report.observations}` : '',
                ].filter(Boolean).join('\n'));

                if (!rawContent) continue;

                await queueDocumentEmbeddingJob({
                    sourceKind: 'committee-report',
                    sourceKey: buildSourceKey('committee-report', [contract._id, report._id || index]),
                    contractId: contract._id,
                    milestoneId: report.milestoneId || undefined,
                    reportId: report._id || undefined,
                    uploadedBy: report.reportedBy || undefined,
                    sourceName: report.milestoneTitle || `Progress report ${index + 1}`,
                    rawContent,
                    sourceMeta: { reportType: report.reportType || 'General' },
                });
            }
        }
    }
}

export async function processPendingDocumentEmbeddingJobs({ batchSize = DEFAULT_BATCH_SIZE, sourceKinds = null } = {}) {
    if (!(await isLocalAiOnline())) {
        return { online: false, processed: 0, completed: 0, failed: 0 };
    }

    const normalizedKinds = Array.isArray(sourceKinds)
        ? sourceKinds.filter(Boolean).map((kind) => String(kind))
        : null;

    const jobs = await DocumentEmbeddingJob.find({
        status: { $in: ['pending', 'failed'] },
        attempts: { $lt: 5 },
        ...(normalizedKinds?.length ? { sourceKind: { $in: normalizedKinds } } : {}),
    })
        .sort({ queuedAt: 1, updatedAt: 1 })
        .limit(batchSize)
        .lean();

    let processed = 0;
    let completed = 0;
    let failed = 0;

    for (const job of jobs) {
        processed += 1;

        await DocumentEmbeddingJob.findByIdAndUpdate(job._id, {
            $set: {
                status: 'running',
                startedAt: new Date(),
                lastError: '',
            },
            $inc: { attempts: 1 },
        });

        try {
            const result = await processJob(job);
            completed += 1;
            if (result?.chunkCount) {
                completed += 0;
            }
        } catch (error) {
            failed += 1;
            await DocumentEmbeddingJob.findByIdAndUpdate(job._id, {
                $set: {
                    status: 'failed',
                    lastError: error instanceof Error ? error.message : 'Document embedding failed',
                    processedAt: new Date(),
                },
            });
        }
    }

    return { online: true, processed, completed, failed };
}

export async function rebuildAllDocumentEmbeddings() {
    await seedDocumentEmbeddingJobs();
    return processPendingDocumentEmbeddingJobs({ batchSize: DEFAULT_BATCH_SIZE * 2 });
}

export async function rebuildDocumentEmbeddingsByScope(scope) {
    const normalizedScope = normalizeDocumentScope(scope);
    const kind = kindForScope(normalizedScope);

    if (!kind) {
        return rebuildAllDocumentEmbeddings();
    }

    await DocumentChunk.deleteMany({ sourceKind: kind });
    await DocumentEmbeddingJob.deleteMany({ sourceKind: kind });

    await seedDocumentEmbeddingJobs({ scope: normalizedScope });
    return processPendingDocumentEmbeddingJobs({
        batchSize: DEFAULT_BATCH_SIZE * 2,
        sourceKinds: [kind],
    });
}

function cosineSimilarity(leftVector, rightVector) {
    if (!Array.isArray(leftVector) || !Array.isArray(rightVector) || !leftVector.length || !rightVector.length) {
        return 0;
    }

    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    const size = Math.min(leftVector.length, rightVector.length);

    for (let index = 0; index < size; index += 1) {
        const leftValue = Number(leftVector[index]) || 0;
        const rightValue = Number(rightVector[index]) || 0;
        dot += leftValue * rightValue;
        leftNorm += leftValue * leftValue;
        rightNorm += rightValue * rightValue;
    }

    if (!leftNorm || !rightNorm) {
        return 0;
    }

    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export async function searchDocumentChunks({
    query,
    role,
    userId,
    tenderIds = [],
    contractIds = [],
    milestoneIds = [],
    sourceKinds = null,
    vendorId = null,
    limit = 6,
}) {
    const queryText = normalizeText(query);
    if (!queryText) return [];

    const accessibleKinds = role === 'Vendor'
        ? ['tender-document', 'bid-document']
        : ['tender-document', 'bid-document', 'committee-report'];

    const requestedKinds = Array.isArray(sourceKinds) && sourceKinds.length
        ? sourceKinds.map((kind) => String(kind)).filter((kind) => accessibleKinds.includes(kind))
        : accessibleKinds;

    const filter = {
        sourceKind: { $in: requestedKinds },
    };

    if (Array.isArray(tenderIds) && tenderIds.length) {
        filter.tenderId = { $in: tenderIds };
    }

    if (Array.isArray(contractIds) && contractIds.length) {
        filter.contractId = { $in: contractIds };
    }

    if (Array.isArray(milestoneIds) && milestoneIds.length) {
        filter.milestoneId = { $in: milestoneIds };
    }

    if (role === 'Vendor') {
        filter.$or = [
            { sourceKind: 'tender-document' },
            { sourceKind: 'bid-document', vendorId: vendorId || userId },
        ];
    } else if (role === 'Committee') {
        filter.$or = [
            { sourceKind: 'tender-document' },
            { sourceKind: 'bid-document' },
            { sourceKind: 'committee-report' },
        ];
    }

    const chunks = await DocumentChunk.find(filter)
        .sort({ createdAt: -1 })
        .limit(250)
        .lean();

    if (!chunks.length) return [];

    const queryEmbedding = await callLocalEmbedding({
        input: embeddingInputForModel(LOCAL_AI_EMBED_MODEL, queryText, 'query'),
        model: LOCAL_AI_EMBED_MODEL,
    });

    const queryTokens = normalizeText(queryText).toLowerCase().match(/[a-z0-9]+/g) || [];

    const scored = chunks
        .map((chunk) => {
            const similarityScore = cosineSimilarity(queryEmbedding, Array.isArray(chunk.embedding) ? chunk.embedding : []);
            const searchableText = buildSearchableDocumentText(chunk).toLowerCase();
            const lexicalScore = queryTokens.reduce((score, token) => score + (searchableText.includes(token) ? (token.length >= 5 ? 0.08 : 0.04) : 0), 0);
            const sourceKindBoost = queryTokens.some((token) => token === 'tender' && chunk.sourceKind === 'tender-document')
                || queryTokens.some((token) => token === 'bid' && chunk.sourceKind === 'bid-document')
                || queryTokens.some((token) => token === 'report' && chunk.sourceKind === 'committee-report')
                ? 0.05
                : 0;

            return {
                ...chunk,
                score: similarityScore + lexicalScore + sourceKindBoost,
                similarityScore,
                lexicalScore,
            };
        })
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, limit);

    return scored.map((chunk) => ({
        sourceKind: chunk.sourceKind,
        sourceName: chunk.sourceName,
        score: Number(chunk.score.toFixed(4)),
        excerpt: chunk.chunkText,
        tenderId: chunk.tenderId || null,
        contractId: chunk.contractId || null,
        bidId: chunk.bidId || null,
        reportId: chunk.reportId || null,
        sourceKey: chunk.sourceKey,
        chunkIndex: chunk.chunkIndex,
        mimeType: chunk.mimeType || null,
    }));
}

export async function getIndexedDocumentGroups({
    tenderIds = [],
    contractIds = [],
    milestoneIds = [],
    bidIds = [],
    vendorId = null,
    sourceKinds = null,
    limit = 150,
}) {
    const filter = {};

    if (Array.isArray(tenderIds) && tenderIds.length) {
        filter.tenderId = { $in: tenderIds };
    }

    if (Array.isArray(contractIds) && contractIds.length) {
        filter.contractId = { $in: contractIds };
    }

    if (Array.isArray(milestoneIds) && milestoneIds.length) {
        filter.milestoneId = { $in: milestoneIds };
    }

    if (Array.isArray(bidIds) && bidIds.length) {
        filter.bidId = { $in: bidIds };
    }

    if (vendorId) {
        filter.vendorId = vendorId;
    }

    if (Array.isArray(sourceKinds) && sourceKinds.length) {
        filter.sourceKind = { $in: sourceKinds };
    }

    const chunks = await DocumentChunk.find(filter)
        .sort({ sourceName: 1, sourceIndex: 1, chunkIndex: 1, createdAt: 1 })
        .limit(limit)
        .lean();

    const grouped = new Map();
    for (const chunk of chunks) {
        const key = String(chunk.sourceKey || `${chunk.sourceKind}:${chunk._id}`);
        const current = grouped.get(key) || {
            sourceKind: chunk.sourceKind,
            sourceKey: chunk.sourceKey,
            sourceName: chunk.sourceName,
            tenderId: chunk.tenderId || null,
            contractId: chunk.contractId || null,
            milestoneId: chunk.milestoneId || null,
            bidId: chunk.bidId || null,
            reportId: chunk.reportId || null,
            uploadedBy: chunk.uploadedBy || null,
            vendorId: chunk.vendorId || null,
            sourceMeta: chunk.sourceMeta || {},
            chunks: [],
        };

        current.chunks.push({
            chunkIndex: chunk.chunkIndex,
            chunkText: chunk.chunkText,
            tokenCount: chunk.tokenCount || 0,
        });
        grouped.set(key, current);
    }

    return Array.from(grouped.values()).map((group) => ({
        sourceKind: group.sourceKind,
        sourceKey: group.sourceKey,
        sourceName: group.sourceName,
        tenderId: group.tenderId,
        contractId: group.contractId,
        milestoneId: group.milestoneId,
        bidId: group.bidId,
        reportId: group.reportId,
        uploadedBy: group.uploadedBy,
        vendorId: group.vendorId,
        sourceMeta: group.sourceMeta,
        chunkCount: group.chunks.length,
        text: normalizeText(group.chunks
            .sort((left, right) => Number(left.chunkIndex || 0) - Number(right.chunkIndex || 0))
            .map((item) => item.chunkText)
            .join('\n\n')),
    }));
}
