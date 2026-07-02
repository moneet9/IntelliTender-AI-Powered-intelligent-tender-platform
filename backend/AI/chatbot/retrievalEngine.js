import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { Contract, Tender, User, AIMilestoneReport } from '../../models/model.js';
import { classifyIntent } from './intentRouter.js';
import { callLocalEmbedding, LOCAL_AI_EMBED_MODEL } from '../localModelClient.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

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
    const milestones = Array.isArray(contract.milestones) ? contract.milestones : [];
    const totalMilestones = milestones.length;
    const completedMilestones = milestones.filter((milestone) => String(milestone.status || '').toLowerCase() === 'completed').length;
    const averageProgress = totalMilestones
        ? Math.round(milestones.reduce((sum, milestone) => sum + (Number(milestone.progress) || 0), 0) / totalMilestones)
        : 0;

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

    summary.milestoneStats = {
        total: totalMilestones,
        completed: completedMilestones,
        pending: Math.max(totalMilestones - completedMilestones, 0),
        averageProgress,
    };

    if (Array.isArray(contract.aiMilestoneReports) && contract.aiMilestoneReports.length) {
        summary.aiMilestoneReports = contract.aiMilestoneReports;
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
    const reportsByContract = new Map();
    reports.forEach((report) => {
        const key = String(report.contractId);
        const compact = {
            severity: report.severity,
            alerts: report.alerts || [],
            penaltyEstimate: report.penaltyEstimate,
            delayedDays: report.timeline?.delayedDays || 0,
            summary: report.summary || '',
            milestoneId: String(report.milestoneId || ''),
            committeeReport: report.committeeReport || null,
            aiAssessment: report.aiAssessment || null,
            timeline: report.timeline || null,
            generatedAt: report.generatedAt,
        };

        if (!summaryByContract.has(key)) {
            summaryByContract.set(key, compact);
        }

        const recent = reportsByContract.get(key) || [];
        if (recent.length < 3) {
            recent.push(compact);
            reportsByContract.set(key, recent);
        }
    });

    return contracts.map((contract) => ({
        ...contract,
        aiMilestoneSummary: summaryByContract.get(String(contract._id)) || null,
        aiMilestoneReports: reportsByContract.get(String(contract._id)) || [],
    }));
}

export function buildRoleInstruction(role) {
    const roleName = String(role || 'User');

    return [
        `You are IntelliTender AI for the ${roleName} role.`,
        'You are a MongoDB-aware procurement assistant. Think from the database records provided to you.',
        'Talk naturally like a helpful chat assistant.',
        'Use the provided database context, knowledge docs, tool output, and conversation history as grounding, not as a script.',
        'If the user asks for data outside their role, say it is unavailable in their role and do not invent it.',
        'If the context includes structured tender or contract records, answer from those records first.',
        'For latest, recent, newest, or most recent tender questions, use the first structured tender match in the context.',
        'If no matching records are available, say that clearly instead of giving a generic explanation.',
        'Be warm, clear, and short by default, but expand when the user asks for more detail.',
        'If local facts are provided, treat them as authoritative and weave them into the answer naturally.',
        'When the answer is uncertain, ask one short clarifying question instead of giving a vague reply.',
        'Do not mention internal branches, retrieval names, or fallback mechanics.',
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

export function buildAssistantMessages({ role, message, history, context }) {
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
            content: buildContextDigest(context),
        },
        {
            role: 'system',
            content: [
                'Answer style:',
                '- Start with a direct, friendly answer.',
                '- Use a natural conversational tone.',
                '- If the user asks a follow-up, continue naturally from the previous message.',
                '- Only mention sources if the user asks or if it helps explain the answer briefly.',
            ].join('\n'),
        },
        ...conversation,
        { role: 'user', content: message },
    ];
}

function buildContextDigest(context) {
    const sections = [];

    sections.push([
        'Mongo schema guide:',
        '- Tender: title, description, category, budget, preBidDate, finalSubmissionDate, evaluationMethod, status, createdBy, documents, bids, requiredDocuments, qcbsConfig.',
        '- Contract: status, timelineDefined, timelineStartDate, timelineEndDate, tenderId, vendorId, milestones, milestoneStats, aiMilestoneReports, aiMilestoneSummary.',
        '- User: name, role, department, designation, specialization, managerPo, accountStatus.',
        '- Rule: answer from the records shown here; do not invent Mongo data.',
    ].join('\n'));

    const localFacts = Array.isArray(context?.localFacts) ? context.localFacts : [];
    if (localFacts.length) {
        sections.push(`Local facts:\n${localFacts.map((fact) => `- ${fact}`).join('\n')}`);
    }

    const structuredTenders = Array.isArray(context?.structured?.tenders) ? context.structured.tenders : [];
    if (structuredTenders.length) {
        sections.push([
            'Top tender matches:',
            ...structuredTenders.slice(0, 5).map((tender) => `- ${tender.title} | status: ${tender.status} | final submission: ${tender.finalSubmissionDate} | budget: ${tender.budget}`),
        ].join('\n'));
    }

    const structuredContracts = Array.isArray(context?.structured?.contracts) ? context.structured.contracts : [];
    if (structuredContracts.length) {
        sections.push([
            'Top contract matches:',
            ...structuredContracts.slice(0, 5).map((contract) => `- ${contract.id} | status: ${contract.status}`),
        ].join('\n'));
    }

    if (!sections.length) {
        return 'No local context records were found.';
    }

    return sections.join('\n\n');
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

    const embedding = await callLocalEmbedding({
        input: key,
        model: LOCAL_AI_EMBED_MODEL,
    });

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

function compareTenderRecency(left, right) {
    const leftDate = new Date(left?.finalSubmissionDate || left?.createdAt || 0).getTime();
    const rightDate = new Date(right?.finalSubmissionDate || right?.createdAt || 0).getTime();
    return rightDate - leftDate;
}

function buildContractSnippet(contract, role) {
    const summary = summarizeContract(contract, role);
    const tenderTitle = summary.tender && typeof summary.tender === 'object' ? summary.tender.title : String(summary.tender || '');
    const latestReport = Array.isArray(summary.aiMilestoneReports) && summary.aiMilestoneReports.length
        ? summary.aiMilestoneReports[0]
        : summary.aiMilestoneSummary;

    return [
        `Contract status: ${summary.status}`,
        `Tender: ${tenderTitle}`,
        `Timeline: ${summary.timelineStartDate} -> ${summary.timelineEndDate}`,
        `Milestones: ${Array.isArray(summary.milestones) ? summary.milestones.length : 0}`,
        latestReport && latestReport.penaltyEstimate ? `Penalty estimate: ${latestReport.penaltyEstimate}` : '',
        latestReport && latestReport.delayedDays ? `Delay days: ${latestReport.delayedDays}` : '',
        latestReport ? `Latest AI milestone note: ${latestReport.summary || latestReport.alerts?.[0] || ''}` : '',
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
    const wantsRecency = /\b(latest|recent|newest|most recent|new)\b/i.test(lowerQuery);

    const [tenders, contracts] = await Promise.all([
        fetchRoleScopedTenders(role, userId, {}),
        fetchRoleScopedContracts(role, userId, {}),
    ]);

    const contractsWithAi = await attachAiMilestoneSummaries(contracts);

    return {
        branch: 'structured',
        summary: {
            matchedTenders: tenders.length,
            matchedContracts: contracts.length,
            recencyRequested: wantsRecency,
            role,
        },
        tenders: rankItems(
            wantsRecency ? [...tenders].sort(compareTenderRecency) : tenders,
            queryText,
            (tender) => `${tender.title} ${tender.description} ${tender.category} ${tender.status}`,
            6
        )
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

    const scored = await Promise.all(candidates.map(async (candidate) => {
        try {
            const candidateEmbedding = await getEmbedding(candidate.snippet);
            const score = queryEmbedding ? cosineSimilarity(queryEmbedding, candidateEmbedding) : scoreText(candidate.snippet, queryTokens) / 10;
            return { ...candidate, score };
        } catch {
            return {
                ...candidate,
                score: scoreText(candidate.snippet, queryTokens) / 10,
            };
        }
    }));

    const topMatches = scored
        .sort((left, right) => right.score - left.score)
        .slice(0, 6);

    return {
        branch: 'semantic',
        summary: {
            candidates: candidates.length,
            matched: topMatches.length,
            embeddingModel: LOCAL_AI_EMBED_MODEL,
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

    const scored = await Promise.all(chunks.map(async (chunk) => {
        try {
            const chunkEmbedding = await getEmbedding(chunk.chunk);
            const score = queryEmbedding ? cosineSimilarity(queryEmbedding, chunkEmbedding) : scoreText(chunk.chunk, queryTokens) / 10;
            return { ...chunk, score };
        } catch {
            return {
                ...chunk,
                score: scoreText(chunk.chunk, queryTokens) / 10,
            };
        }
    }));

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

function mergeContext({ role, userId, query, localFacts, intent, structured, semantic, knowledge, tools }) {
    return {
        role,
        userId: String(userId),
        query,
        localFacts: Array.isArray(localFacts) ? localFacts : [],
        intent,
        retrievalPlan: intent.branches,
        structured,
        semantic,
        knowledge,
        tools,
        summary: {
            localFacts: Array.isArray(localFacts) ? localFacts.length : 0,
            structuredMatches: structured?.summary?.matchedTenders || 0,
            semanticMatches: semantic?.summary?.matched || 0,
            knowledgeMatches: knowledge?.matches?.length || 0,
            toolActions: tools?.actions?.length || 0,
        },
    };
}

export async function buildHybridAssistantContext({ role, userId, query, localFacts = [] }) {
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
        localFacts,
        intent,
        structured: branches.structured,
        semantic: branches.semantic,
        knowledge: branches.knowledge,
        tools: branches.tools,
    });
}
