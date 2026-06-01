import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Contract, Tender, User, AIMilestoneReport } from '../../models/model.js';
import { classifyIntent } from './intentRouter.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const EMBEDDING_MODEL = process.env.OLLAMA_EMBED_MODEL || process.env.OLLAMA_MODEL || 'nomic-embed-text';
const OLLAMA_AUTH_TOKEN = process.env.OLLAMA_AUTH_TOKEN || '';

const stopWords = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'what', 'show', 'tell', 'give', 'about', 'please',
    'tender', 'tenders', 'contract', 'contracts', 'vendor', 'committee', 'po', 'cpo', 'bid', 'bids', 'my', 'your',
    'a', 'an', 'to', 'of', 'in', 'on', 'is', 'are', 'be', 'can', 'i', 'we', 'you', 'it', 'me', 'have', 'has', 'how',
]);

export const sensitiveVendorPattern = /\b(mark|marks|score|scores|evaluation|technical|financial|committee comment|bid comparison|rank|ranking)\b/i;

const knowledgeSources = [
    path.join(repoRoot, 'frontend', 'src', 'imports', 'intellitender-system-overview.md'),
];

const textCache = new Map();
const embeddingCache = new Map();

function tokenize(value) {
    return Array.from(new Set(String(value || '').toLowerCase().match(/[a-z0-9]+/g) || []))
        .filter((token) => token.length > 2 && !stopWords.has(token));
}

function scoreText(text, tokens) {
    const haystack = String(text || '').toLowerCase();
    return tokens.reduce((score, token) => score + (haystack.includes(token) ? (token.length >= 5 ? 2 : 1) : 0), 0);
}

function rankItems(items, query, toText, limit = 5) {
    const tokens = tokenize(query);
    if (!tokens.length) {
        return items.slice(0, limit);
    }

    return items
        .map((item) => ({ item, score: scoreText(toText(item), tokens) }))
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, limit)
        .map(({ item }) => item);
}

function formatDate(value) {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toISOString().slice(0, 10);
}

function summarizeTender(tender, role, userId) {
    const summary = {
        id: String(tender._id),
        title: tender.title,
        category: tender.category,
        status: tender.status,
        budget: tender.budget,
        finalSubmissionDate: formatDate(tender.finalSubmissionDate),
        documentCount: Array.isArray(tender.documents) ? tender.documents.length : 0,
        requiredDocuments: Array.isArray(tender.requiredDocuments) ? tender.requiredDocuments.map((document) => document.label) : [],
    };

    if (role !== 'Vendor') {
        summary.evaluationMethod = tender.evaluationMethod;
        summary.qcbs = tender.qcbsConfig ? {
            technicalWeight: tender.qcbsConfig.technicalWeight,
            commercialWeight: tender.qcbsConfig.commercialWeight,
            technicalCriteria: Array.isArray(tender.qcbsConfig.technicalCriteria)
                ? tender.qcbsConfig.technicalCriteria.map((criterion) => ({ name: criterion.name, maxMarks: criterion.maxMarks }))
                : [],
        } : null;
    }

    if (role === 'CPO' || role === 'PO' || role === 'Committee') {
        summary.bids = Array.isArray(tender.bids)
            ? tender.bids.map((bid) => ({
                vendorName: bid.vendorName,
                proposedAmount: bid.proposedAmount,
                status: bid.status,
                technicalScore: bid.technicalScore,
                financialScore: bid.financialScore,
                comments: bid.comments,
            }))
            : [];
    } else if (role === 'Vendor') {
        summary.bids = Array.isArray(tender.bids)
            ? tender.bids
                .filter((bid) => String(bid.vendorId) === String(userId))
                .map((bid) => ({
                    status: bid.status,
                    proposedAmount: bid.proposedAmount,
                }))
            : [];
    }

    return summary;
}

function summarizeContract(contract, role) {
    const summary = {
        id: String(contract._id),
        status: contract.status,
        timelineDefined: contract.timelineDefined,
        timelineStartDate: formatDate(contract.timelineStartDate),
        timelineEndDate: formatDate(contract.timelineEndDate),
        tender: contract.tenderId && typeof contract.tenderId === 'object'
            ? {
                title: contract.tenderId.title,
                category: contract.tenderId.category,
                budget: contract.tenderId.budget,
                finalSubmissionDate: formatDate(contract.tenderId.finalSubmissionDate),
                documentCount: Array.isArray(contract.tenderId.documents) ? contract.tenderId.documents.length : 0,
            }
            : contract.tenderId,
    };

    if (role === 'Vendor') {
        summary.milestones = Array.isArray(contract.milestones)
            ? contract.milestones.map((milestone) => ({
                title: milestone.title,
                status: milestone.status,
                progress: milestone.progress,
                plannedEndDate: formatDate(milestone.plannedEndDate),
                actualEndDate: formatDate(milestone.actualEndDate),
            }))
            : [];
    } else {
        summary.vendor = contract.vendorId && typeof contract.vendorId === 'object'
            ? {
                name: contract.vendorId.name,
                email: contract.vendorId.email,
                phone: contract.vendorId.phone,
                department: contract.vendorId.department,
                specialization: contract.vendorId.specialization,
            }
            : contract.vendorId;
        summary.milestones = Array.isArray(contract.milestones)
            ? contract.milestones.map((milestone) => ({
                title: milestone.title,
                status: milestone.status,
                progress: milestone.progress,
                plannedStartDate: formatDate(milestone.plannedStartDate),
                plannedEndDate: formatDate(milestone.plannedEndDate),
                actualStartDate: formatDate(milestone.actualStartDate),
                actualEndDate: formatDate(milestone.actualEndDate),
                remarks: milestone.remarks,
            }))
            : [];
    }

    if (contract.aiMilestoneSummary) {
        summary.aiMilestoneSummary = contract.aiMilestoneSummary;
    }

    return summary;
}

async function attachAiMilestoneSummaries(contracts) {
    const contractIds = Array.isArray(contracts)
        ? contracts.map((contract) => String(contract._id)).filter(Boolean)
        : [];

    if (!contractIds.length) return contracts;

    const reports = await AIMilestoneReport.find({ contractId: { $in: contractIds } })
        .sort({ generatedAt: -1 })
        .lean();

    const summaryByContract = new Map();
    reports.forEach((report) => {
        const key = String(report.contractId);
        if (summaryByContract.has(key)) return;
        summaryByContract.set(key, {
            severity: report.severity,
            alerts: report.alerts || [],
            penaltyEstimate: report.penaltyEstimate,
            delayedDays: report.timeline?.delayedDays || 0,
            summary: report.summary || '',
            generatedAt: report.generatedAt,
        });
    });

    return contracts.map((contract) => ({
        ...contract,
        aiMilestoneSummary: summaryByContract.get(String(contract._id)) || null,
    }));
}

export function buildRoleInstruction(role) {
    const roleName = String(role || 'User');

    return [
        `You are IntelliTender AI for the ${roleName} role.`,
        'Answer only from the provided database context, knowledge docs, tool output, and conversation history.',
        'If the user asks for data outside their role, say it is unavailable in their role and do not invent it.',
        'Be concise, specific, and procurement-focused.',
        roleName === 'Vendor'
            ? 'Vendor users can see published tenders, their own bids, and their own contracts. Do not reveal evaluation marks, technical scores, financial scores, or committee-only comments.'
            : '',
        roleName === 'Committee'
            ? 'Committee users can see assigned tenders, bid details, and milestone progress for their manager PO scope.'
            : '',
        roleName === 'PO'
            ? 'PO users can see their tenders, related bids, and contracts they manage.'
            : '',
        roleName === 'CPO'
            ? 'CPO users can see all tenders, bids, contracts, and operational summaries.'
            : '',
    ].filter(Boolean).join('\n');
}

export function buildOllamaMessages({ role, message, history, context }) {
    const system = buildRoleInstruction(role);
    const conversation = Array.isArray(history)
        ? history
            .filter((entry) => entry && typeof entry.content === 'string' && (entry.role === 'user' || entry.role === 'assistant'))
            .slice(-8)
            .map((entry) => ({ role: entry.role, content: entry.content }))
        : [];

    return [
        { role: 'system', content: system },
        {
            role: 'system',
            content: `Hybrid retrieval context for the ${role} role:\n${JSON.stringify(context, null, 2)}`,
        },
        ...conversation,
        { role: 'user', content: message },
    ];
}

function splitKnowledgeChunks(document) {
    return String(document.content || '')
        .split(/\n{2,}/)
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .slice(0, 20)
        .map((chunk, index) => ({
            source: document.title,
            path: document.path,
            chunk,
            chunkId: index + 1,
        }));
}

async function getEmbedding(text) {
    const key = String(text || '').trim();
    if (!key) {
        return [];
    }

    const cached = embeddingCache.get(key);
    if (cached) {
        return cached;
    }

    const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(OLLAMA_AUTH_TOKEN ? { Authorization: `Bearer ${OLLAMA_AUTH_TOKEN}` } : {}),
        },
        body: JSON.stringify({
            model: EMBEDDING_MODEL,
            prompt: key,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Embedding error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const embedding = Array.isArray(data.embedding) ? data.embedding : [];
    embeddingCache.set(key, embedding);
    return embedding;
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

function buildTenderSnippet(tender, role, userId) {
    const summary = summarizeTender(tender, role, userId);
    return [
        `Tender: ${summary.title}`,
        `Category: ${summary.category}`,
        `Status: ${summary.status}`,
        `Budget: ${summary.budget}`,
        `Final submission: ${summary.finalSubmissionDate}`,
        `Documents: ${summary.documentCount}`,
        Array.isArray(summary.requiredDocuments) ? `Required: ${summary.requiredDocuments.join(', ')}` : '',
    ].filter(Boolean).join(' | ');
}

function buildContractSnippet(contract, role) {
    const summary = summarizeContract(contract, role);
    const tenderTitle = summary.tender && typeof summary.tender === 'object' ? summary.tender.title : String(summary.tender || '');

    return [
        `Contract status: ${summary.status}`,
        `Tender: ${tenderTitle}`,
        `Timeline: ${summary.timelineStartDate} -> ${summary.timelineEndDate}`,
        `Milestones: ${Array.isArray(summary.milestones) ? summary.milestones.length : 0}`,
    ].join(' | ');
}

async function fetchRoleScopedTenders(role, userId, filters = {}) {
    if (role === 'Vendor') {
        return Tender.find({ ...filters, status: filters.status || { $in: ['Published', 'Closed', 'Awarded', 'Completed'] } })
            .select('title description category budget finalSubmissionDate status requiredDocuments documents bids evaluationMethod qcbsConfig createdBy')
            .lean();
    }

    if (role === 'Committee') {
        const user = await User.findById(userId).select('managerPo').lean();
        if (!user?.managerPo) {
            return [];
        }

        return Tender.find({ ...filters, createdBy: user.managerPo })
            .select('title description category budget finalSubmissionDate status requiredDocuments documents bids evaluationMethod qcbsConfig createdBy')
            .lean();
    }

    if (role === 'PO') {
        return Tender.find({ ...filters, createdBy: userId })
            .select('title description category budget finalSubmissionDate status requiredDocuments documents bids evaluationMethod qcbsConfig createdBy')
            .lean();
    }

    return Tender.find(filters)
        .select('title description category budget finalSubmissionDate status requiredDocuments documents bids evaluationMethod qcbsConfig createdBy')
        .lean();
}

async function fetchRoleScopedContracts(role, userId, filters = {}) {
    const query = Contract.find(filters)
        .populate('tenderId', 'title category budget finalSubmissionDate documents createdBy')
        .populate('vendorId', 'name email phone department specialization')
        .lean();

    const contracts = await query;

    if (role === 'Vendor') {
        return contracts.filter((contract) => String(contract.vendorId?._id || contract.vendorId) === String(userId));
    }

    if (role === 'Committee') {
        const user = await User.findById(userId).select('managerPo').lean();
        const managerPo = String(user?.managerPo || '');
        if (!managerPo) {
            return [];
        }

        return contracts.filter((contract) => String(contract.tenderId?.createdBy || '') === managerPo);
    }

    if (role === 'PO') {
        return contracts.filter((contract) => String(contract.tenderId?.createdBy || '') === String(userId));
    }

    return contracts;
}

async function buildStructuredBranch(role, userId, query) {
    const queryText = String(query || '').trim();
    const lowerQuery = queryText.toLowerCase();

    const statuses = ['draft', 'published', 'closed', 'awarded', 'completed', 'pending', 'evaluated', 'selected', 'rejected', 'signed', 'cancelled']
        .filter((status) => lowerQuery.includes(status));

    const categories = ['supply', 'work', 'service', 'general']
        .filter((category) => lowerQuery.includes(category));

    const tenderFilters = {};
    const contractFilters = {};

    if (statuses.length) {
        const tenderStatuses = statuses
            .filter((status) => ['draft', 'published', 'closed', 'awarded', 'completed'].includes(status))
            .map((status) => status.charAt(0).toUpperCase() + status.slice(1));
        if (tenderStatuses.length) {
            tenderFilters.status = { $in: tenderStatuses };
        }

        const contractStatuses = statuses
            .filter((status) => ['awarded', 'signed', 'completed', 'cancelled'].includes(status))
            .map((status) => status.charAt(0).toUpperCase() + status.slice(1));
        if (contractStatuses.length) {
            contractFilters.status = { $in: contractStatuses };
        }
    }

    if (categories.length) {
        tenderFilters.category = { $in: categories.map((category) => category.charAt(0).toUpperCase() + category.slice(1)) };
    }

    if (queryText.length >= 3) {
        tenderFilters.$or = [
            { title: { $regex: queryText, $options: 'i' } },
            { description: { $regex: queryText, $options: 'i' } },
        ];
        contractFilters.$or = [
            { status: { $regex: queryText, $options: 'i' } },
        ];
    }

    const [tenders, contracts] = await Promise.all([
        fetchRoleScopedTenders(role, userId, tenderFilters),
        fetchRoleScopedContracts(role, userId, contractFilters),
    ]);

    const contractsWithAi = await attachAiMilestoneSummaries(contracts);

    return {
        branch: 'structured',
        summary: {
            matchedTenders: tenders.length,
            matchedContracts: contracts.length,
            role,
        },
        tenders: rankItems(tenders, queryText, (tender) => `${tender.title} ${tender.description} ${tender.category} ${tender.status}`, 6)
            .map((tender) => summarizeTender(tender, role, userId)),
        contracts: rankItems(contractsWithAi, queryText, (contract) => `${contract?.tenderId?.title || ''} ${contract?.status || ''}`, 6)
            .map((contract) => summarizeContract(contract, role)),
    };
}

async function buildSemanticBranch(role, userId, query) {
    const tenders = await fetchRoleScopedTenders(role, userId, {});
    const contracts = await fetchRoleScopedContracts(role, userId, {});
    const contractsWithAi = await attachAiMilestoneSummaries(contracts);

    const candidates = [
        ...tenders.map((tender) => ({
            kind: 'tender',
            item: tender,
            snippet: buildTenderSnippet(tender, role, userId),
        })),
        ...contractsWithAi.map((contract) => ({
            kind: 'contract',
            item: contract,
            snippet: buildContractSnippet(contract, role),
        })),
    ].slice(0, 18);

    const queryTokens = tokenize(query);
    let queryEmbedding = null;

    try {
        queryEmbedding = await getEmbedding(query);
    } catch {
        queryEmbedding = null;
    }

    const scored = [];
    for (const candidate of candidates) {
        try {
            const candidateEmbedding = await getEmbedding(candidate.snippet);
            const score = queryEmbedding ? cosineSimilarity(queryEmbedding, candidateEmbedding) : scoreText(candidate.snippet, queryTokens) / 10;
            scored.push({ ...candidate, score });
        } catch {
            scored.push({
                ...candidate,
                score: scoreText(candidate.snippet, queryTokens) / 10,
            });
        }
    }

    const topMatches = scored
        .sort((left, right) => right.score - left.score)
        .slice(0, 6);

    return {
        branch: 'semantic',
        summary: {
            candidates: candidates.length,
            matched: topMatches.length,
            embeddingModel: EMBEDDING_MODEL,
        },
        matches: topMatches.map((match) => ({
            kind: match.kind,
            score: Number(match.score.toFixed(4)),
            snippet: match.snippet,
            data: match.kind === 'tender'
                ? summarizeTender(match.item, role, userId)
                : summarizeContract(match.item, role),
        })),
    };
}

async function readKnowledgeDocs() {
    const docs = [];

    for (const sourcePath of knowledgeSources) {
        try {
            const cached = textCache.get(sourcePath);
            if (cached) {
                docs.push(cached);
                continue;
            }

            const content = await fs.readFile(sourcePath, 'utf8');
            const document = {
                path: sourcePath,
                title: path.basename(sourcePath),
                content,
            };

            textCache.set(sourcePath, document);
            docs.push(document);
        } catch {
            // Ignore missing knowledge docs and continue with available sources.
        }
    }

    return docs;
}

async function buildKnowledgeBranch(query) {
    const docs = await readKnowledgeDocs();
    const chunks = docs.flatMap(splitKnowledgeChunks);

    if (!chunks.length) {
        return {
            branch: 'knowledge',
            summary: { documents: 0, chunks: 0 },
            matches: [],
        };
    }

    const queryTokens = tokenize(query);
    let queryEmbedding = null;

    try {
        queryEmbedding = await getEmbedding(query);
    } catch {
        queryEmbedding = null;
    }

    const scored = [];

    for (const chunk of chunks) {
        try {
            const chunkEmbedding = await getEmbedding(chunk.chunk);
            const score = queryEmbedding ? cosineSimilarity(queryEmbedding, chunkEmbedding) : scoreText(chunk.chunk, queryTokens) / 10;
            scored.push({ ...chunk, score });
        } catch {
            scored.push({
                ...chunk,
                score: scoreText(chunk.chunk, queryTokens) / 10,
            });
        }
    }

    const topMatches = scored
        .sort((left, right) => right.score - left.score)
        .slice(0, 5);

    return {
        branch: 'knowledge',
        summary: {
            documents: docs.length,
            chunks: chunks.length,
        },
        matches: topMatches.map((match) => ({
            source: match.source,
            path: match.path,
            chunkId: match.chunkId,
            score: Number(match.score.toFixed(4)),
            excerpt: match.chunk,
        })),
    };
}

async function buildToolsBranch(role, userId, query) {
    const queryText = String(query || '').toLowerCase();
    const wantsAnalytics = /analytics|summary|dashboard|report|metrics|trend|risk|overdue|delay|flags?/i.test(queryText);
    const wantsAction = /action|approve|review|assign|close|reject|select|start|export/i.test(queryText);

    if (!wantsAnalytics && !wantsAction) {
        return {
            branch: 'tools',
            summary: { executed: false },
            actions: [],
        };
    }

    const tenders = await fetchRoleScopedTenders(role, userId, {});
    const contracts = await fetchRoleScopedContracts(role, userId, {});

    const tenderCountByStatus = tenders.reduce((accumulator, tender) => {
        const status = tender.status || 'Unknown';
        accumulator[status] = (accumulator[status] || 0) + 1;
        return accumulator;
    }, {});

    const contractCountByStatus = contracts.reduce((accumulator, contract) => {
        const status = contract.status || 'Unknown';
        accumulator[status] = (accumulator[status] || 0) + 1;
        return accumulator;
    }, {});

    const actionItems = [];
    if (wantsAnalytics) {
        actionItems.push({
            type: 'analytics',
            summary: {
                tenderCount: tenders.length,
                contractCount: contracts.length,
                tenderCountByStatus,
                contractCountByStatus,
            },
        });
    }

    if (wantsAction) {
        actionItems.push({
            type: 'recommendation',
            summary: role === 'Vendor'
                ? 'Use the documents and bid status above to decide whether you need to submit or revise a proposal.'
                : 'Use the filtered record set to review the next operational action in the workflow.',
        });
    }

    return {
        branch: 'tools',
        summary: {
            executed: true,
            analyticsRequested: wantsAnalytics,
            actionRequested: wantsAction,
        },
        actions: actionItems,
    };
}

function mergeContext({ role, userId, query, intent, structured, semantic, knowledge, tools }) {
    return {
        role,
        userId: String(userId),
        query,
        intent,
        retrievalPlan: intent.branches,
        structured,
        semantic,
        knowledge,
        tools,
        summary: {
            structuredMatches: structured?.summary?.matchedTenders || 0,
            semanticMatches: semantic?.summary?.matched || 0,
            knowledgeMatches: knowledge?.matches?.length || 0,
            toolActions: tools?.actions?.length || 0,
        },
    };
}

export async function buildHybridAssistantContext({ role, userId, query }) {
    const intent = classifyIntent(query);
    const branchSet = new Set(intent.branches);

    const branches = {
        structured: null,
        semantic: null,
        knowledge: null,
        tools: null,
    };

    const branchTasks = [];

    if (branchSet.has('structured')) {
        branchTasks.push(
            buildStructuredBranch(role, userId, query).then((result) => {
                branches.structured = result;
            })
        );
    }

    if (branchSet.has('semantic')) {
        branchTasks.push(
            buildSemanticBranch(role, userId, query).then((result) => {
                branches.semantic = result;
            })
        );
    }

    if (branchSet.has('knowledge')) {
        branchTasks.push(
            buildKnowledgeBranch(query).then((result) => {
                branches.knowledge = result;
            })
        );
    }

    if (branchSet.has('tools')) {
        branchTasks.push(
            buildToolsBranch(role, userId, query).then((result) => {
                branches.tools = result;
            })
        );
    }

    await Promise.all(branchTasks);

    return mergeContext({
        role,
        userId,
        query,
        intent,
        structured: branches.structured,
        semantic: branches.semantic,
        knowledge: branches.knowledge,
        tools: branches.tools,
    });
}
