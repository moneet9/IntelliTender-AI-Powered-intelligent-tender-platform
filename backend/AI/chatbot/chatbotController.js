import { User, Tender, Contract, AIChatSession } from '../../models/model.js';
import { sensitiveVendorPattern } from './retrievalEngine.js';
import { callLocalChat, LOCAL_AI_MODEL } from '../localModelClient.js';

const LOCAL_AI_TIMEOUT_MS = Number(process.env.LM_STUDIO_TIMEOUT_MS || process.env.OLLAMA_TIMEOUT_MS || 60000);

const smallTalkPattern = /^(hi|hello|hey|good (morning|afternoon|evening)|thanks|thank you|ok|okay|bye|goodbye|how are you|what's up|whats up)[!.?\s]*$/i;
const committeeCountPattern = /\b(total|how many|count|number of)\b.*\b(commitee|committee)\b.*\b(member|members)\b|\b(commitee|committee)\b.*\b(total|how many|count|number of)\b/i;
const helpPattern = /\b(what can you do|help|capabilities|commands|options|how do i use you)\b/i;
const personLookupPattern = /\b(who is|who was|tell me about|show profile of|show details of)\b/i;
const countPattern = /\b(total|how many|count|number of)\b/i;
const tenderPattern = /\b(tender|tenders)\b/i;
const contractPattern = /\b(contract|contracts)\b/i;
const bidPattern = /\b(bid|bids|submission|submissions)\b/i;

const buildSmallTalkReply = ({ role, message }) => {
    const query = String(message || '').trim().toLowerCase();

    if (/^(bye|goodbye)/i.test(query)) {
        return 'Goodbye. If you need help with tenders, bids, milestones, or procurement workflows, I will be here.';
    }

    if (/^(thanks|thank you)/i.test(query)) {
        return 'You are welcome. If you need anything else about tenders, bids, milestones, or procurement, just ask.';
    }

    const roleGreeting = role === 'Vendor'
        ? 'contracts, bids, and tender requirements'
        : role === 'Committee'
            ? 'bid evaluations, AI scoring, and milestone updates'
            : role === 'PO'
                ? 'tender creation, bid evaluation, and procurement workflows'
                : 'procurement oversight and workflow management';

    return `Hello! I can help with ${roleGreeting}. What would you like to know?`;
};

const buildRoleHelpReply = (role) => {
    const capabilities = {
        Vendor: [
            'search published tenders',
            'check your submitted bids',
            'view your own contracts',
            'ask for submission guidance',
        ],
        Committee: [
            'review assigned tenders',
            'see bid documents and committee scope data',
            'check milestone updates',
            'ask for evaluation and risk summaries',
        ],
        PO: [
            'create and manage tenders',
            'review bids and committee members',
            'track contracts and milestones',
            'ask for counts, summaries, and workflow status',
        ],
        CPO: [
            'see procurement-wide summaries',
            'review all tenders, bids, and contracts',
            'check department performance',
            'ask for operational counts and analytics',
        ],
    };

    const items = capabilities[role] || capabilities.CPO;
    return `I can help you with ${items.join(', ')}. Ask me a direct question and I will answer from your role-based records first.`;
};

const buildGreetingReply = (role, message) => {
    const lower = String(message || '').trim().toLowerCase();
    if (lower.includes('how are you')) {
        return 'I am doing well and ready to help. Ask me about tenders, bids, contracts, milestones, or anything in your procurement workspace.';
    }
    return buildSmallTalkReply({ role, message });
};

const isSimpleLocalReply = (message) => {
    const lower = String(message || '').trim().toLowerCase();
    return smallTalkPattern.test(lower) || helpPattern.test(lower);
};

function inferTenderStatus(query) {
    if (/\b(published|open|visible)\b/i.test(query)) return 'Published';
    if (/\b(draft)\b/i.test(query)) return 'Draft';
    if (/\b(closed|close)\b/i.test(query)) return 'Closed';
    if (/\b(awarded|award)\b/i.test(query)) return 'Awarded';
    if (/\b(completed|complete)\b/i.test(query)) return 'Completed';
    return null;
}

function inferContractStatus(query) {
    if (/\b(awarded)\b/i.test(query)) return 'Awarded';
    if (/\b(signed|signature)\b/i.test(query)) return 'Signed';
    if (/\b(completed|complete)\b/i.test(query)) return 'Completed';
    if (/\b(cancelled|canceled)\b/i.test(query)) return 'Cancelled';
    return null;
}

function isLatestTenderQuery(message) {
    return /\b(latest|recent|newest|most recent)\b/i.test(String(message || ''));
}

function isLikelyGenericAssistantReply(reply) {
    const normalized = String(reply || '').trim().toLowerCase();

    if (!normalized) return true;
    if (normalized.length <= 20) return true;
    if (/^hello[!.?\s]*😊?\s*how can i assist you today[!.?\s]*$/i.test(normalized)) return true;
    if (/^hello[!.?\s]*how can i assist you today[!.?\s]*$/i.test(normalized)) return true;
    if (/^i can help with\b/i.test(normalized)) return true;
    if (/^i can still help with\b/i.test(normalized)) return true;
    if (/^how can i help\b/i.test(normalized)) return true;
    return false;
}

function buildTenderDisplayLine(tender) {
    if (!tender) return '';

    const pieces = [`"${tender.title}"`];
    if (tender.status) pieces.push(`status: ${tender.status}`);
    if (tender.finalSubmissionDate && tender.finalSubmissionDate !== '-') {
        pieces.push(`final submission: ${tender.finalSubmissionDate}`);
    }
    if (tender.budget !== undefined && tender.budget !== null) {
        pieces.push(`budget: ${tender.budget}`);
    }

    return pieces.join(' | ');
}

function buildScopedTenderReply({ role, message, context }) {
    const query = String(message || '').toLowerCase();
    const tenders = Array.isArray(context?.structured?.tenders) ? context.structured.tenders : [];
    const queryHasTender = /\btender(s)?\b/i.test(query);
    const queryHasAward = /\baward(ed|ing)?\b/i.test(query) || /\bto be awarded\b/i.test(query);

    if (!queryHasTender && !queryHasAward) {
        return null;
    }

    if (role === 'Vendor' && /\b(by me|created by me|my tender|my tenders)\b/i.test(query)) {
        return 'That is beyond your role. Vendors can view published tenders, their own bids, and their own contracts, but not tenders created by them.';
    }

    if (!tenders.length) {
        return queryHasAward
            ? 'I could not find any tenders in your scope that appear ready for award.'
            : 'I could not find any tenders in your scope.';
    }

    if (isLatestTenderQuery(query)) {
        return `The latest tender in your scope is ${buildTenderDisplayLine(tenders[0])}.`;
    }

    if (queryHasAward) {
        const awardable = tenders.filter((tender) => ['Published', 'Closed'].includes(String(tender.status || '')));
        const source = awardable.length ? awardable : tenders;
        const topItems = source.slice(0, 5).map(buildTenderDisplayLine).filter(Boolean);
        return topItems.length
            ? `Tenders in your scope that look relevant for award review are: ${topItems.join('; ')}.`
            : 'I could not find any tenders in your scope that appear ready for award.';
    }

    return null;
}

async function buildScopedCommitteeMemberReply({ role, userId, message }) {
    const query = String(message || '').toLowerCase();
    const wantsCommitteeMembers = /\bcommittee\b/i.test(query) && /\bmember(s)?\b/i.test(query);

    if (!wantsCommitteeMembers) {
        return null;
    }

    const isCreatedByMe = /\b(by me|created by me|my committee member(s)?|my committee)\b/i.test(query);
    const isLatest = /\b(latest|recent|newest|most recent)\b/i.test(query);

    if (role === 'Committee') {
        return 'That is beyond your role. Committee users can review assigned tenders and related evaluation data, but they do not create committee members.';
    }

    if (role !== 'PO' && role !== 'CPO') {
        return 'That is beyond your role.';
    }

    const filter = role === 'CPO'
        ? { role: 'Committee' }
        : { role: 'Committee', managerPo: userId };

    const members = await User.find(filter)
        .sort({ createdAt: -1 })
        .select('name designation specialization department accountStatus createdAt email phone')
        .lean();

    if (!members.length) {
        return 'I could not find any committee members in your scope.';
    }

    const latestMember = members[0];

    if (isLatest || isCreatedByMe) {
        const latestBits = [
            `${latestMember.name}`,
            latestMember.designation ? `designation: ${latestMember.designation}` : '',
            latestMember.department ? `department: ${latestMember.department}` : '',
            latestMember.specialization ? `specialization: ${latestMember.specialization}` : '',
            latestMember.accountStatus ? `status: ${latestMember.accountStatus}` : '',
        ].filter(Boolean).join(', ');

        if (members.length === 1) {
            return `The latest committee member in your scope is ${latestBits}.`;
        }

        const list = members.slice(0, 5).map((member) => member.name).filter(Boolean).join(', ');
        return `The latest committee member in your scope is ${latestBits}. You have ${members.length} committee member${members.length === 1 ? '' : 's'} in scope: ${list}.`;
    }

    const list = members.slice(0, 5).map((member) => member.name).filter(Boolean).join(', ');
    return `You have ${members.length} committee member${members.length === 1 ? '' : 's'} in your scope: ${list}.`;
}

const AGENT_COLLECTIONS = new Set(['Tender', 'Contract', 'User']);
const AGENT_MAX_LIMIT = 10;
const AGENT_ALLOWED_OPERATORS = new Set(['$and', '$or', '$in', '$ne', '$gte', '$lte', '$gt', '$lt', '$exists', '$regex', '$options']);

const AGENT_SCHEMA_GUIDE = [
    'Mongo schema guide:',
    '- Tender: _id, title, description, category, budget, preBidDate, finalSubmissionDate, evaluationMethod, status, createdBy, documents, bids, requiredDocuments, qcbsConfig, createdAt, updatedAt.',
    '- Contract: _id, status, timelineDefined, timelineStartDate, timelineEndDate, tenderId, vendorId, milestones, milestoneStats, aiMilestoneReports, aiMilestoneSummary, createdAt, updatedAt.',
    '- User: _id, name, email, role, phone, department, specialization, designation, managerPo, accountStatus, createdAt, updatedAt.',
    '- Relationship rules: PO-owned committee members use User.managerPo === PO user id. PO-owned tenders use Tender.createdBy === PO user id. Committee scope uses the PO in managerPo. Vendor scope is only published tenders, and their own bids/contracts/profile.',
].join('\n');

const AGENT_PROMPT = [
    'You are a MongoDB agent for IntelliTender.',
    'Think before answering, but do not mention your reasoning.',
    'Your job is to decide whether the user needs a MongoDB query or a direct answer.',
    'If MongoDB is needed, return JSON only in this shape:',
    '{ "action": "query", "collection": "Tender|Contract|User", "operation": "find|count", "filter": {...}, "sort": {...}, "limit": number, "reason": "..." }',
    'If no database query is needed, return JSON only in this shape:',
    '{ "action": "direct", "answer": "..." }',
    'Rules:',
    '- Use the schema guide provided in the next message.',
    '- Use role scope automatically.',
    '- For latest/recent/newest/most recent, sort descending by the best date field and then createdAt.',
    '- For "by me" on tenders, use createdBy = the current PO user id, or managerPo scope for committee users.',
    '- For committee member questions, use the User collection with role = Committee and managerPo = the current PO user id when appropriate.',
    '- If the request is beyond the user role, answer directly with a short beyond-role message.',
    '- Do not fabricate ids, dates, counts, or records.',
].join('\n');

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeMongoValue(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeMongoValue(entry)).filter((entry) => entry !== undefined);
    }

    if (!isPlainObject(value)) {
        return value;
    }

    const cleaned = {};
    for (const [key, entry] of Object.entries(value)) {
        if (key.startsWith('$') && !AGENT_ALLOWED_OPERATORS.has(key)) {
            continue;
        }
        const cleanedValue = sanitizeMongoValue(entry);
        if (cleanedValue !== undefined) {
            cleaned[key] = cleanedValue;
        }
    }
    return cleaned;
}

function normalizeMongoFilter(filter) {
    if (!isPlainObject(filter)) {
        return {};
    }
    return sanitizeMongoValue(filter);
}

function normalizeMongoSort(sort) {
    if (!isPlainObject(sort)) {
        return undefined;
    }

    const cleaned = {};
    for (const [key, value] of Object.entries(sort)) {
        if (typeof value === 'number' || typeof value === 'string') {
            cleaned[key] = value;
        }
    }

    return Object.keys(cleaned).length ? cleaned : undefined;
}

function normalizeMongoPlan(content) {
    const raw = extractJsonCandidate(content);
    if (!raw) return null;

    try {
        const parsed = JSON.parse(raw);
        if (!isPlainObject(parsed)) return null;

        if (parsed.action === 'direct' && typeof parsed.answer === 'string' && parsed.answer.trim()) {
            return { action: 'direct', answer: parsed.answer.trim() };
        }

        if (parsed.action !== 'query') return null;
        if (!AGENT_COLLECTIONS.has(parsed.collection)) return null;

        const operation = parsed.operation === 'count' ? 'count' : 'find';
        const limit = Math.max(1, Math.min(Number(parsed.limit) || 5, AGENT_MAX_LIMIT));

        return {
            action: 'query',
            collection: parsed.collection,
            operation,
            filter: normalizeMongoFilter(parsed.filter),
            sort: normalizeMongoSort(parsed.sort),
            limit,
            reason: typeof parsed.reason === 'string' ? parsed.reason.trim() : '',
        };
    } catch {
        return null;
    }
}

function extractJsonCandidate(content) {
    const text = String(content || '').trim();
    if (!text) return '';

    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
        return fenced[1].trim();
    }

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
        return text.slice(start, end + 1).trim();
    }

    return text;
}

function buildAgentMessages({ role, userId, message, history, localFacts }) {
    const conversation = Array.isArray(history)
        ? history
            .filter((entry) => entry && typeof entry.content === 'string' && (entry.role === 'user' || entry.role === 'assistant'))
            .slice(-6)
            .map((entry) => ({ role: entry.role, content: entry.content }))
        : [];

    return [
        { role: 'system', content: AGENT_PROMPT },
        { role: 'system', content: AGENT_SCHEMA_GUIDE },
        {
            role: 'system',
            content: [
                `Current user role: ${role}`,
                `Current user id: ${String(userId)}`,
                'Known local facts:',
                Array.isArray(localFacts) && localFacts.length ? localFacts.map((fact) => `- ${fact}`).join('\n') : '- none',
            ].join('\n'),
        },
        ...conversation,
        { role: 'user', content: message },
    ];
}

function buildRoleScope(collection, role, userId) {
    if (collection === 'Tender') {
        if (role === 'CPO') return {};
        if (role === 'PO') return { createdBy: userId };
        if (role === 'Committee') {
            return {};
        }
        if (role === 'Vendor') {
            return { status: { $in: ['Published', 'Closed', 'Awarded', 'Completed'] } };
        }
    }

    if (collection === 'Contract') {
        if (role === 'CPO') return {};
        if (role === 'Vendor') return { vendorId: userId };
        if (role === 'PO') return {};
        if (role === 'Committee') return {};
    }

    if (collection === 'User') {
        if (role === 'CPO') return {};
        if (role === 'PO') return {};
        return { _id: userId };
    }

    return {};
}

async function resolveRoleScopedFilter(collection, role, userId) {
    if (collection === 'Tender') {
        if (role === 'CPO') return {};
        if (role === 'PO') return { createdBy: userId };
        if (role === 'Committee') {
            const user = await User.findById(userId).select('managerPo').lean();
            if (!user?.managerPo) return { _id: { $exists: false } };
            return { createdBy: user.managerPo };
        }
        return { status: { $in: ['Published', 'Closed', 'Awarded', 'Completed'] } };
    }

    if (collection === 'Contract') {
        if (role === 'CPO') return {};
        if (role === 'Vendor') return { vendorId: userId };
        if (role === 'PO') return { 'tenderId.createdBy': userId };
        if (role === 'Committee') {
            const user = await User.findById(userId).select('managerPo').lean();
            const managerPo = String(user?.managerPo || '');
            if (!managerPo) return { _id: { $exists: false } };
            return { 'tenderId.createdBy': managerPo };
        }
    }

    if (collection === 'User') {
        if (role === 'CPO') return {};
        if (role === 'PO') {
            return {
                $or: [
                    { _id: userId },
                    { role: 'Committee', managerPo: userId },
                ],
            };
        }
        return { _id: userId };
    }

    return {};
}

function getMongoModel(collection) {
    if (collection === 'Tender') return Tender;
    if (collection === 'Contract') return Contract;
    return User;
}

function getMongoSelectFields(collection) {
    if (collection === 'Tender') {
        return 'title description category budget preBidDate finalSubmissionDate evaluationMethod status createdBy documents bids requiredDocuments qcbsConfig createdAt updatedAt';
    }

    if (collection === 'Contract') {
        return 'status timelineDefined timelineStartDate timelineEndDate tenderId vendorId milestones aiMilestoneReports aiMilestoneSummary createdAt updatedAt';
    }

    return 'name email role phone department specialization designation managerPo accountStatus createdAt updatedAt';
}

function summarizeMongoRecord(collection, record) {
    if (collection === 'Tender') {
        return {
            id: String(record._id),
            title: record.title,
            status: record.status,
            category: record.category,
            finalSubmissionDate: record.finalSubmissionDate ? new Date(record.finalSubmissionDate).toISOString().slice(0, 10) : null,
            budget: record.budget,
            createdAt: record.createdAt,
        };
    }

    if (collection === 'Contract') {
        const milestones = Array.isArray(record.milestones) ? record.milestones : [];
        const totalMilestones = milestones.length;
        const completedMilestones = milestones.filter((milestone) => String(milestone.status || '').toLowerCase() === 'completed').length;
        const averageProgress = totalMilestones
            ? Math.round(milestones.reduce((sum, milestone) => sum + (Number(milestone.progress) || 0), 0) / totalMilestones)
            : 0;

        return {
            id: String(record._id),
            status: record.status,
            tender: record.tenderId && typeof record.tenderId === 'object' ? record.tenderId.title : record.tenderId,
            vendor: record.vendorId && typeof record.vendorId === 'object' ? record.vendorId.name : record.vendorId,
            timelineStartDate: record.timelineStartDate ? new Date(record.timelineStartDate).toISOString().slice(0, 10) : null,
            timelineEndDate: record.timelineEndDate ? new Date(record.timelineEndDate).toISOString().slice(0, 10) : null,
            milestoneStats: {
                total: totalMilestones,
                completed: completedMilestones,
                pending: Math.max(totalMilestones - completedMilestones, 0),
                averageProgress,
            },
            milestones: milestones.map((milestone) => ({
                title: milestone.title,
                status: milestone.status,
                progress: milestone.progress,
                plannedEndDate: milestone.plannedEndDate ? new Date(milestone.plannedEndDate).toISOString().slice(0, 10) : null,
                actualEndDate: milestone.actualEndDate ? new Date(milestone.actualEndDate).toISOString().slice(0, 10) : null,
            })),
            createdAt: record.createdAt,
        };
    }

    return {
        id: String(record._id),
        name: record.name,
        role: record.role,
        designation: record.designation,
        department: record.department,
        specialization: record.specialization,
        managerPo: record.managerPo,
        accountStatus: record.accountStatus,
        createdAt: record.createdAt,
    };
}

function buildFinalAnswerPrompt({ role, message, plan, records, count, collection }) {
    return [
        `You are answering the user as IntelliTender AI for the ${role} role.`,
        'Use the MongoDB results below and answer naturally in one short paragraph unless a list is needed.',
        'If the results are empty, say that clearly.',
        'If the request is beyond the role, say that clearly.',
        'Do not mention JSON, tools, or internal execution steps.',
        `User question: ${message}`,
        `Plan summary: ${plan ? JSON.stringify(plan) : 'none'}`,
        `Collection: ${collection}`,
        `Count: ${typeof count === 'number' ? count : 'n/a'}`,
        `Results: ${JSON.stringify(records, null, 2)}`,
    ].join('\n');
}

function buildDirectFallbackAnswer({ role, collection, count, records }) {
    const entity = collection === 'Tender' ? 'tender' : collection === 'Contract' ? 'contract' : 'committee member';

    if (!count) {
        return `I could not find any ${entity}${role === 'Vendor' && collection === 'User' ? '' : 's'} in your scope.`;
    }

    if (collection === 'Tender') {
        const top = records[0];
        return `The latest tender in your scope is "${top.title}" with status ${top.status}${top.finalSubmissionDate ? ` and final submission date ${top.finalSubmissionDate}` : ''}.`;
    }

    if (collection === 'User') {
        const names = records.slice(0, 5).map((item) => item.name).filter(Boolean).join(', ');
        return `You have ${count} committee member${count === 1 ? '' : 's'} in your scope: ${names}.`;
    }

    const names = records.slice(0, 5).map((item) => item.tender || item.vendor || item.id).filter(Boolean).join(', ');
    return `I found ${count} ${entity}${count === 1 ? '' : 's'} in your scope: ${names}.`;
}

async function executeMongoPlan(plan, role, userId) {
    const Model = getMongoModel(plan.collection);
    const roleScope = await resolveRoleScopedFilter(plan.collection, role, userId);

    const hasRoleScope = isPlainObject(roleScope) && Object.keys(roleScope).length > 0;
    const hasPlanFilter = isPlainObject(plan.filter) && Object.keys(plan.filter).length > 0;
    const query = hasRoleScope && hasPlanFilter
        ? { $and: [roleScope, plan.filter] }
        : (hasRoleScope ? roleScope : (hasPlanFilter ? plan.filter : {}));

    const finder = Model.find(query).select(getMongoSelectFields(plan.collection));

    if (plan.collection === 'Contract') {
        finder.populate('tenderId', 'title category budget finalSubmissionDate createdBy');
        finder.populate('vendorId', 'name email phone department specialization');
    }

    if (plan.operation === 'count') {
        const count = await Model.countDocuments(query);
        return { count, records: [] };
    }

    const sort = plan.sort || (plan.collection === 'Tender'
        ? { finalSubmissionDate: -1, createdAt: -1 }
        : { createdAt: -1 });

    const docs = await finder.sort(sort).limit(plan.limit).lean();
    const records = docs.map((doc) => summarizeMongoRecord(plan.collection, doc));
    return { count: records.length, records };
}

async function runMongoAgent({ role, userId, message, history, localFacts }) {
    const planResponse = await callLocalChat({
        model: LOCAL_AI_MODEL,
        temperature: 0,
        responseFormat: { type: 'json_object' },
        messages: buildAgentMessages({ role, userId, message, history, localFacts }),
    });

    const plan = normalizeMongoPlan(planResponse);
    if (!plan) {
        return {
            reply: String(planResponse || '').trim(),
            model: LOCAL_AI_MODEL,
            responseMode: 'lmstudio',
            plan: null,
            records: [],
            count: 0,
            collection: null,
        };
    }

    if (plan.action === 'direct') {
        return {
            reply: plan.answer,
            model: LOCAL_AI_MODEL,
            responseMode: 'lmstudio',
            plan,
            records: [],
            count: 0,
            collection: null,
        };
    }

    const { count, records } = await executeMongoPlan(plan, role, userId);

    const finalReply = await callLocalChat({
        model: LOCAL_AI_MODEL,
        temperature: 0.2,
        messages: [
            { role: 'system', content: AGENT_SCHEMA_GUIDE },
            { role: 'system', content: buildFinalAnswerPrompt({ role, message, plan, records, count, collection: plan.collection }) },
        ],
    });

    const reply = isLikelyGenericAssistantReply(finalReply)
        ? buildDirectFallbackAnswer({ role, collection: plan.collection, count, records })
        : finalReply.trim();

    return {
        reply,
        model: LOCAL_AI_MODEL,
        responseMode: 'lmstudio',
        plan,
        records,
        count,
        collection: plan.collection,
    };
}

async function getTenderScopeQuery(role, userId) {
    if (role === 'CPO') return {};
    if (role === 'PO') return { createdBy: userId };
    if (role === 'Committee') {
        const user = await User.findById(userId).select('managerPo').lean();
        if (!user?.managerPo) return { _id: { $exists: false } };
        return { createdBy: user.managerPo };
    }
    return { status: { $in: ['Published', 'Closed', 'Awarded', 'Completed'] } };
}

async function fetchVisibleContracts(role, userId) {
    const contracts = await Contract.find({})
        .populate('tenderId', 'title category budget finalSubmissionDate documents createdBy status')
        .populate('vendorId', 'name email phone department specialization')
        .lean();

    if (role === 'CPO') return contracts;

    if (role === 'Vendor') {
        return contracts.filter((contract) => String(contract.vendorId?._id || contract.vendorId) === String(userId));
    }

    if (role === 'PO') {
        return contracts.filter((contract) => String(contract.tenderId?.createdBy || '') === String(userId));
    }

    if (role === 'Committee') {
        const user = await User.findById(userId).select('managerPo').lean();
        const managerPo = String(user?.managerPo || '');
        if (!managerPo) return [];
        return contracts.filter((contract) => String(contract.tenderId?.createdBy || '') === managerPo);
    }

    return contracts;
}

async function buildRoleAwareTenderCountReply({ role, userId, query }) {
    const status = inferTenderStatus(query);
    const filter = { ...(await getTenderScopeQuery(role, userId)) };
    if (status) filter.status = status;

    const count = await Tender.countDocuments(filter);
    if (status) {
        return `You have ${count} ${status.toLowerCase()} tender${count === 1 ? '' : 's'} in your scope.`;
    }

    return role === 'Vendor'
        ? `There are ${count} tender${count === 1 ? '' : 's'} visible to you.`
        : `There are ${count} tender${count === 1 ? '' : 's'} in your scope.`;
}

async function buildRoleAwareContractCountReply({ role, userId, query }) {
    const status = inferContractStatus(query);
    const contracts = await fetchVisibleContracts(role, userId);
    const count = contracts.filter((contract) => {
        if (!status) return true;
        return String(contract.status || '').toLowerCase() === status.toLowerCase();
    }).length;

    if (status) {
        return `You have ${count} ${status.toLowerCase()} contract${count === 1 ? '' : 's'} in your scope.`;
    }

    return role === 'Vendor'
        ? `You have ${count} contract${count === 1 ? '' : 's'} in your records.`
        : `There are ${count} contract${count === 1 ? '' : 's'} in your scope.`;
}

async function buildRoleAwareBidCountReply({ role, userId }) {
    if (role === 'Vendor') {
        const tenders = await Tender.find({
            status: { $in: ['Published', 'Closed', 'Awarded', 'Completed'] },
            bids: { $elemMatch: { vendorId: userId } },
        }).select('bids').lean();

        const count = tenders.reduce((sum, tender) => sum + (Array.isArray(tender.bids)
            ? tender.bids.filter((bid) => String(bid.vendorId) === String(userId)).length
            : 0), 0);
        return `You have submitted ${count} bid${count === 1 ? '' : 's'}.`;
    }

    const tenderFilter = await getTenderScopeQuery(role, userId);
    const tenders = await Tender.find(tenderFilter).select('bids').lean();
    const bidCount = tenders.reduce((sum, tender) => sum + (Array.isArray(tender.bids) ? tender.bids.length : 0), 0);
    const contractCount = (await fetchVisibleContracts(role, userId)).length;

    return `There are ${bidCount} bid${bidCount === 1 ? '' : 's'} and ${contractCount} contract${contractCount === 1 ? '' : 's'} in your scope.`;
}

async function buildPersonLookupReply({ role, userId, message }) {
    const raw = String(message || '')
        .replace(/\b(who is|who was|tell me about|show profile of|show details of)\b/ig, ' ')
        .replace(/[?.!,]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!raw) return null;

    const scopeFilter = role === 'CPO'
        ? {}
        : role === 'PO'
            ? {
                $or: [
                    { _id: userId },
                    { managerPo: userId },
                ],
            }
            : role === 'Committee'
                ? {
                    $or: [
                        { _id: userId },
                    ],
                }
                : {
                    $or: [
                        { _id: userId },
                    ],
                };

    const nameRegex = new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const match = await User.findOne({
        ...scopeFilter,
        name: nameRegex,
    }).lean();

    if (!match) {
        return null;
    }

    const pieces = [
        `${match.name} is a ${match.role.toLowerCase()} user`,
        match.designation ? `designation: ${match.designation}` : '',
        match.department ? `department: ${match.department}` : '',
        match.specialization ? `specialization: ${match.specialization}` : '',
        match.accountStatus ? `status: ${match.accountStatus}` : '',
    ].filter(Boolean);

    return pieces.join(', ') + '.';
}

function buildChatContext({ role, userId, message, localFacts }) {
    return {
        role,
        userId,
        query: message,
        localFacts,
        summary: {
            localFacts: Array.isArray(localFacts) ? localFacts.length : 0,
        },
    };
}

const CHAT_MESSAGE_LIMIT = 30;

function toChatMessage(entry) {
    if (!entry || (entry.role !== 'user' && entry.role !== 'assistant') || typeof entry.content !== 'string') {
        return null;
    }

    return {
        role: entry.role,
        content: entry.content,
        createdAt: entry.createdAt || entry.timestamp || new Date(),
        meta: entry.meta || undefined,
    };
}

function titleFromMessage(message) {
    const cleaned = String(message || '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!cleaned) return 'New chat';
    return cleaned.length > 42 ? `${cleaned.slice(0, 42).trim()}...` : cleaned;
}

function isUsefulTitleMessage(message) {
    const text = String(message || '').trim();
    if (!text) return false;
    if (isSimpleLocalReply(text)) return false;
    return text.length >= 8;
}

function formatChatSession(session) {
    const messages = Array.isArray(session?.messages) ? session.messages.map(toChatMessage).filter(Boolean) : [];
    const lastMessage = messages[messages.length - 1] || null;
    return {
        _id: String(session._id),
        userId: String(session.userId),
        role: session.role,
        title: session.title || 'New chat',
        messages,
        messageCount: messages.length,
        lastMessageAt: session.lastMessageAt || session.updatedAt || session.createdAt || null,
        createdAt: session.createdAt || null,
        updatedAt: session.updatedAt || null,
        preview: lastMessage?.content || '',
    };
}

function buildAssistantMeta(agentResult, localFacts = []) {
    const records = Array.isArray(agentResult?.records) ? agentResult.records : [];
    return {
        model: agentResult?.model || LOCAL_AI_MODEL,
        responseMode: agentResult?.responseMode || 'fallback',
        collection: agentResult?.collection || null,
        count: agentResult?.count || 0,
        plan: agentResult?.plan || null,
        localFactsCount: Array.isArray(localFacts) ? localFacts.length : 0,
        records,
    };
}

async function loadChatSession(chatId, userId) {
    if (!chatId) return null;
    const session = await AIChatSession.findOne({ _id: chatId, userId }).lean();
    return session || null;
}

async function saveChatSessionMessage(session, message) {
    const nextMessages = [...(Array.isArray(session.messages) ? session.messages : []), message]
        .slice(-CHAT_MESSAGE_LIMIT);

    session.messages = nextMessages;
    session.lastMessageAt = new Date();
    if ((!session.title || session.title === 'New chat') && message.role === 'user' && isUsefulTitleMessage(message.content)) {
        session.title = titleFromMessage(message.content);
    }

    await session.save();
    return session;
}

export const listChatSessions = async (req, res) => {
    try {
        const sessions = await AIChatSession.find({ userId: req.user.id })
            .sort({ lastMessageAt: -1, updatedAt: -1 })
            .lean();

        res.json({ items: sessions.map(formatChatSession) });
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to load chat sessions' });
    }
};

export const createChatSession = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('role').lean();
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const session = await AIChatSession.create({
            userId: req.user.id,
            role: user.role || req.user.role,
            title: 'New chat',
            messages: [],
            lastMessageAt: new Date(),
        });

        res.status(201).json({ chat: formatChatSession(session) });
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to create chat session' });
    }
};

export const getChatSession = async (req, res) => {
    try {
        const session = await AIChatSession.findOne({ _id: req.params.chatId, userId: req.user.id }).lean();
        if (!session) {
            return res.status(404).json({ message: 'Chat not found' });
        }

        res.json({ chat: formatChatSession(session) });
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to load chat session' });
    }
};

export const deleteChatSession = async (req, res) => {
    try {
        const deleted = await AIChatSession.findOneAndDelete({ _id: req.params.chatId, userId: req.user.id });
        if (!deleted) {
            return res.status(404).json({ message: 'Chat not found' });
        }

        res.json({ message: 'Chat deleted successfully', chatId: String(deleted._id) });
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to delete chat session' });
    }
};

async function collectLocalFacts({ role, userId, message }) {
    const query = String(message || '').trim();
    const lower = query.toLowerCase();
    const facts = [];

    if (helpPattern.test(lower)) {
        facts.push(buildRoleHelpReply(role));
    }

    if (smallTalkPattern.test(lower)) {
        facts.push(buildGreetingReply(role, message));
    }

    if (committeeCountPattern.test(lower)) {
        const committeeFilter = role === 'CPO'
            ? { role: 'Committee' }
            : { role: 'Committee', managerPo: userId };

        const count = await User.countDocuments(committeeFilter);
        facts.push(role === 'CPO'
            ? `There are ${count} committee members in total.`
            : `You have ${count} committee member${count === 1 ? '' : 's'} assigned.`);
    }

    if (countPattern.test(lower) && tenderPattern.test(lower)) {
        facts.push(await buildRoleAwareTenderCountReply({ role, userId, query: lower }));
    }

    if (countPattern.test(lower) && contractPattern.test(lower)) {
        facts.push(await buildRoleAwareContractCountReply({ role, userId, query: lower }));
    }

    if (countPattern.test(lower) && bidPattern.test(lower)) {
        facts.push(await buildRoleAwareBidCountReply({ role, userId }));
    }

    if (personLookupPattern.test(lower)) {
        const person = await buildPersonLookupReply({ role, userId, message });
        if (person) {
            facts.push(person);
        }
    }

    return facts.filter(Boolean);
}

const buildFallbackReply = ({ role, message, context }) => {
    const query = String(message || '').trim();
    const summary = context?.summary || {};
    const retrievalPlan = Array.isArray(context?.retrievalPlan) ? context.retrievalPlan.join(', ') : '';
    const localFacts = Array.isArray(context?.localFacts) ? context.localFacts : [];
    const firstTender = Array.isArray(context?.structured?.tenders) ? context.structured.tenders[0] : null;
    const scopedTenderReply = buildScopedTenderReply({ role, message, context });

    const parts = [];

    if (scopedTenderReply) {
        parts.push(scopedTenderReply);
    } else if (localFacts.length) {
        parts.push(localFacts[0]);
    } else if (firstTender && isLatestTenderQuery(query)) {
        const submissionDate = firstTender.finalSubmissionDate && firstTender.finalSubmissionDate !== '-'
            ? `, submission date ${firstTender.finalSubmissionDate}`
            : '';
        parts.push(`The latest tender in your scope appears to be "${firstTender.title}"${submissionDate}.`);
    } else if (query) {
        parts.push(`I can still help with "${query}".`);
    } else {
        parts.push('I can still help with that.');
    }

    if (localFacts.length > 1) {
        parts.push(`Here is what I found: ${localFacts.join(' ')}`);
    }

    if (summary.structuredMatches || summary.semanticMatches || summary.knowledgeMatches || summary.toolActions) {
        const signals = [];
        if (summary.structuredMatches) signals.push(`${summary.structuredMatches} structured match${summary.structuredMatches === 1 ? '' : 'es'}`);
        if (summary.semanticMatches) signals.push(`${summary.semanticMatches} semantic match${summary.semanticMatches === 1 ? '' : 'es'}`);
        if (summary.knowledgeMatches) signals.push(`${summary.knowledgeMatches} knowledge match${summary.knowledgeMatches === 1 ? '' : 'es'}`);
        if (summary.toolActions) signals.push(`${summary.toolActions} tool result${summary.toolActions === 1 ? '' : 's'}`);
        parts.push(`I found ${signals.join(', ')} for your ${role} view.`);
    }

    if (retrievalPlan) {
        parts.push(`I checked ${retrievalPlan} for this one.`);
    }

    parts.push('If you want, I can try again in a moment or we can narrow the question down together.');
    return parts.join(' ');
};

export const chatWithAssistant = async (req, res) => {
    let session = null;
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

        if (req.body?.chatId) {
            session = await loadChatSession(req.body.chatId, userId);
            if (!session) {
                return res.status(404).json({ message: 'Chat not found' });
            }
        } else {
            session = await AIChatSession.create({
                userId,
                role,
                title: 'New chat',
                messages: [],
                lastMessageAt: new Date(),
            });
        }

        if (role === 'Vendor' && sensitiveVendorPattern.test(message)) {
            const reply = 'I can help with your published tenders, bids, and contracts, but evaluation marks and technical scoring are not available in vendor view.';
            const assistantMeta = buildAssistantMeta({
                model: 'policy-guard',
                responseMode: 'policy',
                collection: null,
                count: 0,
                plan: null,
                records: [],
            });
            await saveChatSessionMessage(session, {
                role: 'user',
                content: message,
                createdAt: new Date(),
            });
            await saveChatSessionMessage(session, {
                role: 'assistant',
                content: reply,
                createdAt: new Date(),
                meta: assistantMeta,
            });

            return res.json({
                chatId: String(session._id),
                chat: formatChatSession(session),
                reply,
                model: 'policy-guard',
                responseMode: 'policy',
                thinking: false,
                records: [],
                collection: null,
                count: 0,
            });
        }

        const history = Array.isArray(session?.messages)
            ? session.messages.slice(-8).map((entry) => ({ role: entry.role, content: entry.content }))
            : Array.isArray(req.body?.messages)
                ? req.body.messages
                : [];
        const localFacts = await collectLocalFacts({ role, userId, message });

        let reply = '';
        let model = 'fallback';
        let responseMode = 'fallback';
        let plan = null;
        let collection = null;
        let count = 0;
        let records = [];
        let warning = '';

        if (localFacts.length && isSimpleLocalReply(message)) {
            reply = localFacts[0];
            model = 'local-rules';
            responseMode = 'local';
        } else {
            const agentResult = await runMongoAgent({
                role,
                userId,
                message,
                history,
                localFacts,
            });

            reply = agentResult.reply || buildFallbackReply({ role, message, context: null });
            model = agentResult.model || LOCAL_AI_MODEL;
            responseMode = agentResult.responseMode || 'lmstudio';
            plan = agentResult.plan || null;
            collection = agentResult.collection || null;
            count = agentResult.count || 0;
            records = Array.isArray(agentResult.records) ? agentResult.records : [];

            if (!agentResult.reply) {
                warning = 'Mongo agent could not parse a query plan; returned raw model text.';
            }
        }

        const assistantMeta = buildAssistantMeta({
            model,
            responseMode,
            collection,
            count,
            plan,
            records,
        }, localFacts);

        await saveChatSessionMessage(session, {
            role: 'user',
            content: message,
            createdAt: new Date(),
        });
        await saveChatSessionMessage(session, {
            role: 'assistant',
            content: reply,
            createdAt: new Date(),
            meta: assistantMeta,
        });

        return res.json({
            chatId: String(session._id),
            chat: formatChatSession(session),
            reply,
            model,
            responseMode,
            thinking: false,
            plan,
            collection,
            count,
            records,
            contextSummary: { localFacts: localFacts.length },
            retrievalPlan: [],
            intent: null,
            warning: warning || undefined,
        });
    } catch (error) {
        try {
            if (session && (!Array.isArray(session.messages) || session.messages.length === 0)) {
                await AIChatSession.deleteOne({ _id: session._id, userId: session.userId });
            }

            const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
            const role = req.user?.role;
            const userId = req.user?.id;
            const localFacts = message && role && userId ? await collectLocalFacts({ role, userId, message }) : [];
            const reply = message && role && userId
                ? buildFallbackReply({
                    role,
                    message,
                    context: {
                        localFacts,
                    },
                })
                : 'I could not generate a response right now.';

            return res.json({
                reply,
                model: 'fallback',
                responseMode: 'fallback',
                thinking: false,
                warning: error instanceof Error ? error.message : 'Failed to generate assistant response',
                contextSummary: { localFacts: localFacts.length },
                retrievalPlan: [],
                intent: null,
            });
        } catch {
            return res.status(500).json({
                message: error instanceof Error ? error.message : 'Failed to generate assistant response',
            });
        }
    }
};
