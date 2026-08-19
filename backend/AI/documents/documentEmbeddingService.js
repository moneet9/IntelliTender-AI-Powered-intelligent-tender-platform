import crypto from 'crypto';
import { DocumentChunk, DocumentEmbeddingJob, Tender, BidDocument, MilestoneAsset, Contract } from '../../models/model.js';
import { callLocalEmbedding, LOCAL_AI_EMBED_MODEL, LOCAL_AI_BASE_URL } from '../localModelClient.js';
import { decodeStoredDocument, extractTextFromContent } from './documentTextExtractor.js';

const MAX_TEXT_CHARS = 50000;
const DEFAULT_CHUNK_SIZE = Number(process.env.DOCUMENT_EMBED_CHUNK_SIZE || 1200);
const DEFAULT_CHUNK_OVERLAP = Number(process.env.DOCUMENT_EMBED_CHUNK_OVERLAP || 180);
const DEFAULT_BATCH_SIZE = Number(process.env.DOCUMENT_EMBED_BATCH_SIZE || 20);
const STALE_RUNNING_JOB_MS = Number(process.env.DOCUMENT_EMBED_STALE_RUNNING_JOB_MS || 15 * 60 * 1000);
const LOCAL_AI_HEALTH_CACHE_TTL_MS = Number(process.env.LOCAL_AI_HEALTH_CACHE_TTL_MS || 5 * 60 * 1000);
const DOCUMENT_SCOPE_TO_KIND = {
    tender: 'tender-document',
    bid: 'bid-document',
    committee: 'committee-report',
};

let localAiHealthCache = { checkedAt: 0, online: false };

const sha1 = (value) => crypto.createHash('sha1').update(String(value || '')).digest('hex');

const truncateText = (value) => {
    const text = String(value || '').trim();
    if (text.length <= MAX_TEXT_CHARS) return text;
    return `${text.slice(0, MAX_TEXT_CHARS)}\n[TRUNCATED]`;
};

const normalizeText = (value) => String(value || '').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const tokenizeText = (value) => String(value || '').toLowerCase().match(/[a-z0-9]+/g) || [];

const splitParagraphs = (text) => normalizeText(text)
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

const splitLongParagraph = (paragraph, chunkSize) => {
    const sentences = String(paragraph || '')
        .split(/(?<=[.!?])\s+/)
        .map((part) => part.trim())
        .filter(Boolean);

    if (!sentences.length) {
        return [];
    }

    const chunks = [];
    let buffer = '';

    for (const sentence of sentences) {
        const candidate = buffer ? `${buffer} ${sentence}` : sentence;
        if (candidate.length <= chunkSize) {
            buffer = candidate;
            continue;
        }

        if (buffer) {
            chunks.push(buffer);
        }

        if (sentence.length > chunkSize) {
            for (let start = 0; start < sentence.length; start += chunkSize) {
                chunks.push(sentence.slice(start, start + chunkSize).trim());
            }
            buffer = '';
        } else {
            buffer = sentence;
        }
    }

    if (buffer) {
        chunks.push(buffer);
    }

    return chunks.filter(Boolean);
};

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

const splitTextIntoChunks = (text, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP) => {
    const paragraphs = splitParagraphs(text);
    if (!paragraphs.length) return [];
    if (paragraphs.length === 1 && paragraphs[0].length <= chunkSize) return [paragraphs[0]];

    const chunks = [];
    let buffer = '';

    const pushBuffer = () => {
        const chunk = buffer.trim();
        if (chunk) {
            chunks.push(chunk);
        }
        buffer = '';
    };

    for (const paragraph of paragraphs) {
        if (paragraph.length > chunkSize) {
            pushBuffer();
            const pieces = splitLongParagraph(paragraph, chunkSize);
            chunks.push(...pieces);
            continue;
        }

        const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
        if (candidate.length <= chunkSize) {
            buffer = candidate;
            continue;
        }

        pushBuffer();

        if (paragraph.length <= chunkSize) {
            buffer = paragraph;
        } else {
            chunks.push(paragraph.slice(0, chunkSize).trim());
        }
    }

    pushBuffer();

    if (!chunks.length && overlap > 0) {
        return [normalizeText(text).slice(0, chunkSize).trim()].filter(Boolean);
    }

    return chunks;
};

const countDocumentChunks = (sourceKey, chunkIndexMap) => (chunkIndexMap?.get(sourceKey)?.size || 0);

const embeddingInputForModel = (modelId, text, kind = 'document') => {
    const model = String(modelId || '').toLowerCase();
    const cleaned = normalizeText(text);

    if (!cleaned) return '';

    if (model.includes('nomic')) {
        return `${kind === 'query' ? 'search_query' : 'search_document'}: ${cleaned}`;
    }

    return cleaned;
};

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
    const now = Date.now();
    if (localAiHealthCache.online && now - localAiHealthCache.checkedAt < LOCAL_AI_HEALTH_CACHE_TTL_MS) {
        return true;
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(`${LOCAL_AI_BASE_URL}/models`, {
            method: 'GET',
            signal: controller.signal,
        });
        clearTimeout(timeout);
        localAiHealthCache = { checkedAt: now, online: response.ok };
        return response.ok;
    } catch {
        localAiHealthCache = { checkedAt: now, online: false };
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

    const uniqueDocuments = new Map();
    for (const entry of normalizedDocuments) {
        const documentId = entry?.documentId || entry?._id;
        const key = documentId
            ? String(documentId)
            : `${String(entry?.label || '')}:${sha1(String(entry?.document || ''))}`;
        if (!uniqueDocuments.has(key)) {
            uniqueDocuments.set(key, entry);
        }
    }

    for (const entry of uniqueDocuments.values()) {
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
    const sourceKey = job.sourceKey;
    const existingChunks = await DocumentChunk.find({ sourceKey }).select('chunkIndex contentHash').lean();
    const existingChunkIndexes = new Set(existingChunks.map((chunk) => Number(chunk.chunkIndex)));
    const existingContentHash = existingChunks.find((chunk) => chunk.contentHash)?.contentHash || null;

    if (existingChunks.length > 0 && existingContentHash !== contentHash) {
        await removeExistingChunks(sourceKey);
        existingChunkIndexes.clear();
    }

    let completedChunkCount = existingChunkIndexes.size;

    for (let index = 0; index < chunks.length; index += 1) {
        if (existingChunkIndexes.has(index)) {
            continue;
        }

        const chunkText = chunks[index];
        const embedding = await callLocalEmbedding({
            input: embeddingInputForModel(embeddingModel, chunkText, 'document'),
            model: embeddingModel,
        });

        await DocumentChunk.findOneAndUpdate(
            { sourceKey, chunkIndex: index },
            {
                sourceKind: job.sourceKind,
                sourceKey,
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
                chunkHash: sha1(`${sourceKey}:${index}:${chunkText}`),
                contentHash,
                mimeType: job.mimeType || undefined,
                ocrUsed: Boolean(job.sourceMeta?.ocrUsed),
                tokenCount: chunkText.split(/\s+/).filter(Boolean).length,
                embedding,
                embeddingModel,
                sourceName: job.sourceName || 'Document',
                sourceMeta: job.sourceMeta || {},
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        completedChunkCount += 1;
        await DocumentEmbeddingJob.findByIdAndUpdate(job._id, {
            $set: {
                status: 'running',
                chunkCount: completedChunkCount,
                embeddingModel,
                lastError: '',
                startedAt: job.startedAt || new Date(),
                processedAt: null,
            },
        });
    }

    return completedChunkCount;
}

async function processJob(job) {
    const rawText = await extractTextFromContent(job.rawContent, job.mimeType);
    const text = truncateText(rawText);
    const chunks = splitTextIntoChunks(text);

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
    const staleRunningBefore = new Date(Date.now() - STALE_RUNNING_JOB_MS);
    const normalizedKinds = Array.isArray(sourceKinds)
        ? sourceKinds.filter(Boolean).map((kind) => String(kind))
        : null;

    const pendingFilter = {
        attempts: { $lt: 5 },
        $or: [
            { status: { $in: ['pending', 'failed'] } },
            { status: 'running', updatedAt: { $lte: staleRunningBefore } },
        ],
        ...(normalizedKinds?.length ? { sourceKind: { $in: normalizedKinds } } : {}),
    };

    const pendingCount = await DocumentEmbeddingJob.countDocuments(pendingFilter);
    if (!pendingCount) {
        return { online: true, processed: 0, completed: 0, failed: 0 };
    }

    if (!(await isLocalAiOnline())) {
        return { online: false, processed: 0, completed: 0, failed: 0 };
    }

    const jobs = await DocumentEmbeddingJob.find(pendingFilter)
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
                    lastError: error instanceof Error ? error.message : 'Document prep failed',
                    processedAt: new Date(),
                },
            });
        }
    }

    return { online: true, processed, completed, failed };
}

export async function getTenderDocumentEmbeddingProgress({ createdBy = null, tenderIds = [] } = {}) {
    const tenderFilter = {};
    if (createdBy) {
        tenderFilter.createdBy = createdBy;
    }
    if (Array.isArray(tenderIds) && tenderIds.length) {
        tenderFilter._id = { $in: tenderIds };
    }

    const tenders = await Tender.find(tenderFilter)
        .select('title bids createdBy')
        .populate('createdBy', 'name')
        .lean();

    if (!tenders.length) {
        return [];
    }

    const tenderIdList = tenders.map((tender) => tender._id);
    const jobs = await DocumentEmbeddingJob.find({ tenderId: { $in: tenderIdList } })
        .select('tenderId sourceKey sourceKind sourceName status queuedAt startedAt updatedAt processedAt lastError chunkCount')
        .sort({ queuedAt: 1, updatedAt: 1 })
        .lean();

    const chunks = await DocumentChunk.find({ tenderId: { $in: tenderIdList } })
        .select('sourceKey chunkIndex')
        .lean();

    const chunksBySourceKey = new Map();
    for (const chunk of chunks) {
        const sourceKey = String(chunk.sourceKey || '');
        if (!sourceKey) continue;
        if (!chunksBySourceKey.has(sourceKey)) {
            chunksBySourceKey.set(sourceKey, new Set());
        }
        chunksBySourceKey.get(sourceKey).add(Number(chunk.chunkIndex));
    }

    const jobsByTenderId = new Map();
    for (const job of jobs) {
        const tenderId = String(job.tenderId || '');
        if (!tenderId) continue;
        if (!jobsByTenderId.has(tenderId)) {
            jobsByTenderId.set(tenderId, []);
        }
        jobsByTenderId.get(tenderId).push(job);
    }

    return tenders.map((tender) => {
        const tenderJobs = jobsByTenderId.get(String(tender._id)) || [];
        const totalJobs = tenderJobs.length;
        const completedJobs = tenderJobs.filter((job) => job.status === 'completed').length;
        const runningJobs = tenderJobs.filter((job) => job.status === 'running').length;
        const pendingJobs = tenderJobs.filter((job) => job.status === 'pending').length;
        const failedJobs = tenderJobs.filter((job) => job.status === 'failed').length;
        const staleRunningJobs = tenderJobs.filter(
            (job) => job.status === 'running' && job.updatedAt && new Date(job.updatedAt).getTime() <= Date.now() - STALE_RUNNING_JOB_MS
        ).length;
        const activeJob = tenderJobs.find((job) => job.status === 'running')
            || tenderJobs.find((job) => job.status === 'pending')
            || tenderJobs.find((job) => job.status === 'failed')
            || null;
        const submissionCount = Array.isArray(tender.bids) ? tender.bids.length : 0;
        const progressPercent = totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0;

        return {
            tenderId: tender._id,
            tenderTitle: tender.title,
            submissionCount,
            totalJobs,
            completedJobs,
            runningJobs,
            pendingJobs,
            failedJobs,
            staleRunningJobs,
            progressPercent,
            activeJob: activeJob ? {
                sourceKey: activeJob.sourceKey,
                sourceKind: activeJob.sourceKind,
                sourceName: activeJob.sourceName,
                status: activeJob.status,
                updatedAt: activeJob.updatedAt || null,
                processedAt: activeJob.processedAt || null,
                lastError: activeJob.lastError || '',
                chunkCount: Number(activeJob.chunkCount || 0),
                savedChunks: countDocumentChunks(activeJob.sourceKey, chunksBySourceKey),
            } : null,
            documents: tenderJobs.map((job) => ({
                sourceKey: job.sourceKey,
                sourceKind: job.sourceKind,
                sourceName: job.sourceName,
                status: job.status,
                updatedAt: job.updatedAt || null,
                processedAt: job.processedAt || null,
                lastError: job.lastError || '',
                chunkCount: Number(job.chunkCount || 0),
                savedChunks: countDocumentChunks(job.sourceKey, chunksBySourceKey),
            })),
        };
    });
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

export async function reparseDocumentTextByScope(scope) {
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
    const querySet = new Set(queryTokens);
    const queryBigrams = [];
    for (let index = 0; index < Math.max(0, queryTokens.length - 1); index += 1) {
        queryBigrams.push(`${queryTokens[index]} ${queryTokens[index + 1]}`);
    }

    const queryLength = Math.max(queryTokens.length, 1);
    const scored = chunks
        .map((chunk) => {
            const searchableText = buildSearchableDocumentText(chunk).toLowerCase();
            const similarityScore = cosineSimilarity(queryEmbedding, Array.isArray(chunk.embedding) ? chunk.embedding : []);
            const chunkTokens = tokenizeText(searchableText);
            if (!chunkTokens.length) {
                return { ...chunk, score: similarityScore, lexicalScore: 0 };
            }

            const termCounts = chunkTokens.reduce((accumulator, token) => {
                accumulator[token] = (accumulator[token] || 0) + 1;
                return accumulator;
            }, {});
            const chunkLength = chunkTokens.length;
            const avgChunkLength = 180;
            const k1 = 1.2;
            const b = 0.72;

            const bm25Score = queryTokens.reduce((sum, token) => {
                const frequency = termCounts[token] || 0;
                if (!frequency) return sum;
                const idf = token.length >= 8 ? 1.4 : token.length >= 5 ? 1.1 : 0.8;
                const numerator = frequency * (k1 + 1);
                const denominator = frequency + k1 * (1 - b + (b * chunkLength) / avgChunkLength);
                return sum + (idf * numerator / denominator);
            }, 0);

            const exactPhraseHits = queryBigrams.reduce((score, phrase) => score + (searchableText.includes(phrase) ? 1.3 : 0), 0);
            const coverage = queryTokens.filter((token) => termCounts[token]).length / queryLength;
            const sourceKindBoost = querySet.has('tender') && chunk.sourceKind === 'tender-document'
                ? 0.7
                : querySet.has('bid') && chunk.sourceKind === 'bid-document'
                    ? 0.7
                    : querySet.has('report') && chunk.sourceKind === 'committee-report'
                        ? 0.7
                        : 0;
            const authorityBoost = /requirements|specification|scope|eligibility|submission|deadline|criteria|compliance|terms|conditions|instructions/.test(searchableText)
                ? 0.4
                : 0;

            return {
                ...chunk,
                score: similarityScore + bm25Score + exactPhraseHits + (coverage * 1.2) + sourceKindBoost + authorityBoost,
                lexicalScore: bm25Score,
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
