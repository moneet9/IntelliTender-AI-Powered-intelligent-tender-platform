import { User, Tender, Contract, AIBidSummary, AIChatSession, AIMilestoneReport } from '../../models/model.js';
import { sensitiveVendorPattern } from './retrievalEngine.js';
import { getIndexedDocumentGroups } from '../documents/documentEmbeddingService.js';
import { callLocalChat, LOCAL_AI_CHAT_MODEL } from '../localModelClient.js';
import { recordResearchMetric } from '../../utils/researchMetrics.js';

const CHAT_MAX_TOKENS = Number(process.env.LM_STUDIO_CHAT_MAX_TOKENS || 1200);
const CHAT_STRUCTURED_OUTPUT = String(process.env.LM_STUDIO_CHAT_STRUCTURED_OUTPUT || 'false').toLowerCase() === 'true';

const LOCAL_AI_TIMEOUT_MS = Number(process.env.LM_STUDIO_TIMEOUT_MS || process.env.OLLAMA_TIMEOUT_MS || 60000);

const smallTalkPattern = /^(hi|hello|hey|good (morning|afternoon|evening)|thanks|thank you|ok|okay|bye|goodbye|how are you|what's up|whats up)[!.?\s]*$/i;
const committeeCountPattern = /\b(total|how many|count|number of)\b.*\b(commitee|committee)\b.*\b(member|members)\b|\b(commitee|committee)\b.*\b(total|how many|count|number of)\b/i;
const helpPattern = /\b(what can you do|help|capabilities|commands|options|how do i use you)\b/i;
const personLookupPattern = /\b(who is|who was|tell me about|show profile of|show details of)\b/i;
const countPattern = /\b(total|how many|count|number of)\b/i;
const tenderPattern = /\b(tender|tenders)\b/i;
const contractPattern = /\b(contract|contracts)\b/i;
const bidPattern = /\b(bid|bids|submission|submissions)\b/i;
const awardedContractDetailPattern = /(?:\b(recent|recently|latest|most recent|newest)\b[\s\S]*\b(contract|award|aw[a-z]*ed|awrded)\b)|(?:\b(contract|award)\b[\s\S]*\b(to\s*whom|towhom|who|top\s*2|scores?|rejected|reject)\b)|(?:\b(contract|award)\b[\s\S]*\b(bidder|winner|selected)\b)/i;
const bidRejectionPattern = /\b(why|explain|reason)\b[\s\S]*\b(bid|bidder|rejected|reject)\b/i;
const awardDecisionPattern = /\b(selected|winner|winning|second\s+bidder|second\s+bid|fair|fairness)\b[\s\S]*\b(bid|bidder|reject|reason|score|fair)|\b(which|what)\s+bid\b[\s\S]*\b(selected|won|winner)\b/i;
const emptyAwardAnswerPattern = /\b(no bids? available|no bids? (were|was) found|no bid has been selected|no bid.*rejected|no bids? in the system)\b/i;
const milestoneBacklogPenaltyPattern = /\b(milestone|backlog|back log|delayed|delay|penalt|penalty|needed or not)\b/i;

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

const shouldUseFastLocalReply = (message) => {
    // Milestone delay questions have a deterministic, role-scoped database
    // answer. Do not let the language-model planner replace it with an
    // unrelated bid/tender answer.
    return isSimpleLocalReply(message)
        || (milestoneBacklogPenaltyPattern.test(message) && !isDetailedMilestoneQuery(message));
};

const isDetailedMilestoneQuery = (message) => /penalt|clause|violat|backlog|committee|evidence|penalty needed|detail|research|analys|report|recommend|action/i.test(String(message || '').toLowerCase());

function scoreAwardedBids(tender) {
    const bids = Array.isArray(tender?.bids) ? tender.bids : [];
    const evaluationMethod = tender?.evaluationMethod || 'QCBS';
    const technicalCriteria = tender?.qcbsConfig?.technicalCriteria || [];
    const maxTechnical = technicalCriteria.reduce((sum, criterion) => sum + Number(criterion.maxMarks || 0), 0);
    const technicalWeight = Number(tender?.qcbsConfig?.technicalWeight || 0);
    const commercialWeight = Number(tender?.qcbsConfig?.commercialWeight || 0);
    const prices = bids.map((bid) => Number(bid.financialScore || bid.proposedAmount || 0)).filter((value) => value > 0);
    const lowestPrice = prices.length ? Math.min(...prices) : 0;
    const cutoff = Number(tender?.l1Config?.technicalCutoff || 0);

    return bids.map((bid) => {
        const technicalScore = Number(bid.technicalScore || 0);
        const price = Number(bid.financialScore || bid.proposedAmount || 0);
        const technicalNormalized = maxTechnical > 0 ? (technicalScore / maxTechnical) * 100 : 0;
        const commercialNormalized = lowestPrice > 0 && price > 0 ? (lowestPrice / price) * 100 : 0;
        const overallScore = evaluationMethod === 'L1'
            ? technicalScore
            : (technicalNormalized * (technicalWeight / 100)) + (commercialNormalized * (commercialWeight / 100));
        return {
            id: String(bid._id),
            vendor: bid.vendorName || 'Unknown bidder',
            status: bid.status,
            proposedAmount: bid.proposedAmount,
            technicalScore,
            financialScore: bid.financialScore,
            overallScore: Number(overallScore.toFixed(2)),
            technicalNormalized: Number(technicalNormalized.toFixed(2)),
            commercialNormalized: Number(commercialNormalized.toFixed(2)),
            comments: bid.comments || '',
            committeeEvaluations: Array.isArray(bid.committeeEvaluations) ? bid.committeeEvaluations : [],
            cutoff,
        };
    }).sort((left, right) => right.overallScore - left.overallScore);
}

async function buildAwardedContractDetailReply({ role, userId }) {
    const contracts = await fetchVisibleContracts(role, userId);
    const awarded = contracts.filter((contract) => String(contract.status || '').toLowerCase() === 'awarded');
    const contract = awarded.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
    if (!contract?.tenderId?._id) return 'I could not find a recently awarded contract in your scope.';

    const tender = await Tender.findById(contract.tenderId._id)
        .select('title evaluationMethod qcbsConfig l1Config bids')
        .lean();
    if (!tender) return 'I found the awarded contract, but its tender and bidder scores are unavailable.';

    const scored = scoreAwardedBids(tender);
    const summaries = await AIBidSummary.find({ tenderId: tender._id, bidId: { $in: scored.map((bid) => bid.id) } })
        .select('bidId eligibility rationale summary criteriaScores')
        .lean();
    const summaryByBid = new Map(summaries.map((item) => [String(item.bidId), item]));
    const winner = scored.find((bid) => bid.status === 'Selected') || scored[0];
    const topTwo = scored.slice(0, 2);
    const scoreText = topTwo.map((bid, index) => {
        const summary = summaryByBid.get(bid.id);
        const eligibility = summary?.eligibility?.passed === false ? 'not eligible' : 'eligible';
        const reason = summary?.summary || bid.comments || '';
        return `${index + 1}) ${bid.vendor} — overall ${bid.overallScore.toFixed(2)}, technical ${bid.technicalScore.toFixed(2)}, commercial ${bid.financialScore ?? bid.proposedAmount ?? '-'} (${eligibility})${reason ? `; ${reason}` : ''}`;
    }).join(' ');
    const rejected = scored.filter((bid) => bid.status === 'Rejected');
    const rejectionText = rejected.slice(0, 5).map((bid) => {
        const summary = summaryByBid.get(bid.id);
        const reasons = [
            ...(summary?.eligibility?.reasons || []),
            ...(summary?.rationale || []),
            ...bid.committeeEvaluations.filter((item) => item.eligibilityChecked === false).map((item) => item.comments).filter(Boolean),
        ].filter(Boolean);
        const cutoffReason = tender.evaluationMethod === 'L1' && bid.technicalScore < bid.cutoff
            ? `technical score ${bid.technicalScore} was below the cutoff ${bid.cutoff}` : '';
        return `${bid.vendor}: ${reasons[0] || cutoffReason || 'not selected after the tender evaluation and award decision'}`;
    }).join(' ');

    const runnerUp = topTwo.find((bid) => bid.id !== winner?.id);
    const fairness = winner && runnerUp
        ? (winner.overallScore >= runnerUp.overallScore
            ? `Fairness check: based on the recorded scores, the selection appears consistent because the selected bidder ranked above the second bidder (${winner.overallScore.toFixed(2)} vs ${runnerUp.overallScore.toFixed(2)}). This is a score-based assessment, not a legal finding.`
            : `Fairness check: the selected bidder scored below the second bidder (${winner.overallScore.toFixed(2)} vs ${runnerUp.overallScore.toFixed(2)}), so the award should be reviewed against the configured evaluation rule and committee justification.`)
        : 'Fairness check: there is not enough recorded score data to assess the decision.';
    return `The most recently awarded contract is for "${tender.title}" and was awarded to ${winner?.vendor || 'the selected bidder'}. Top bidder scores: ${scoreText || 'score details are unavailable'}. ${rejectionText ? `Rejected bidder reasons: ${rejectionText}` : 'No rejected bidder reason was recorded in the available evaluation data.'} ${fairness}`;
}

async function buildBidRejectionReply({ role, userId, message }) {
    if (!bidRejectionPattern.test(String(message || '').toLowerCase())) return null;
    const nameMatch = String(message || '').match(/\b(?:why|explain|reason)\s+(?:was\s+)?([a-z0-9][a-z0-9 .&'-]*?)\s+(?:bid|bidder|was|is|rejected)\b/i);
    if (!nameMatch) return null;
    const searchName = String(nameMatch?.[1] || message).replace(/\b(why|explain|reason|bid|bidder|rejected|reject|was|is|does|it)\b/ig, ' ').replace(/[^a-z0-9 .&'-]/ig, ' ').trim();
    if (!searchName) return null;
    const tenderFilter = await getTenderScopeQuery(role, userId);
    const tenders = await Tender.find(tenderFilter)
        .select('title status bids evaluationMethod qcbsConfig l1Config')
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(20)
        .lean();
    const terms = searchName.toLowerCase().split(/\s+/).filter((term) => term.length > 2);
    const matches = tenders.flatMap((tender) => (tender.bids || [])
        .filter((bid) => {
            const vendor = String(bid.vendorName || '').toLowerCase();
            return terms.some((term) => vendor.includes(term)) && String(bid.status || '').toLowerCase() === 'rejected';
        })
        .map((bid) => ({ tender, bid })));
    if (!matches.length) return `I could not find a rejected bid matching "${searchName}" in your scope.`;

    const { tender, bid } = matches[0];
    const summary = await AIBidSummary.findOne({ tenderId: tender._id, bidId: bid._id })
        .select('eligibility rationale summary criteriaScores')
        .lean();
    const reasons = [
        ...(summary?.eligibility?.reasons || []),
        ...(summary?.rationale || []),
        ...(bid.committeeEvaluations || []).filter((item) => item.eligibilityChecked === false).map((item) => item.comments),
        bid.comments,
    ].filter(Boolean);
    const cutoff = Number(tender.l1Config?.technicalCutoff || 0);
    const cutoffReason = tender.evaluationMethod === 'L1' && Number(bid.technicalScore || 0) < cutoff
        ? `technical score ${bid.technicalScore || 0} was below the required cutoff of ${cutoff}` : '';
    return `The bid from ${bid.vendorName || searchName} was rejected for the tender "${tender.title}". Recorded reason: ${reasons[0] || cutoffReason || 'the bid was not selected after evaluation'}. Its status is ${bid.status}; technical score: ${bid.technicalScore ?? '-'}, financial score: ${bid.financialScore ?? bid.proposedAmount ?? '-'}.`;
}

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
    '- Tender: _id, title, description, category, budget, preBidDate, finalSubmissionDate, evaluationMethod, l1Config, status, createdBy, documents, bids, requiredDocuments, qcbsConfig, createdAt, updatedAt. Each bid has vendorId, vendorName, proposedAmount, status (Pending|Evaluated|Selected|Rejected), technicalScore, financialScore, comments, committeeEvaluations, evaluatedDate.',
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
    '- For award/winner/top bidder/score/rejection questions, query Tender records and use the embedded bids and committeeEvaluations. Do not answer from generic knowledge.',
    '- When the user gives a bidder name, search bids.vendorName with a case-insensitive regex. Never put a plain name such as "technova" into bids.vendorId; vendorId is an ObjectId and must not be fabricated.',
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
            bids: scoreAwardedBids(record).map((bid) => ({
                id: bid.id,
                vendor: bid.vendor,
                status: bid.status,
                proposedAmount: bid.proposedAmount,
                technicalScore: bid.technicalScore,
                financialScore: bid.financialScore,
                calculatedOverallScore: bid.overallScore,
                comments: bid.comments,
                committeeEvaluations: bid.committeeEvaluations.map((evaluation) => ({
                    technicalScore: evaluation.technicalScore,
                    financialScore: evaluation.financialScore,
                    eligibilityChecked: evaluation.eligibilityChecked,
                    comments: evaluation.comments,
                    criteriaScores: evaluation.criteriaScores,
                })),
            })),
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
    const repairedPlanFilter = { ...(plan.filter || {}) };
    if (plan.collection === 'Tender') {
        for (const [key, value] of Object.entries(repairedPlanFilter)) {
            if (/^bids\.vendorId$/i.test(key) && typeof value === 'string' && !/^[a-f0-9]{24}$/i.test(value)) {
                delete repairedPlanFilter[key];
                repairedPlanFilter['bids.vendorName'] = { $regex: value, $options: 'i' };
            }
        }
    }

    const hasRoleScope = isPlainObject(roleScope) && Object.keys(roleScope).length > 0;
    const hasPlanFilter = isPlainObject(repairedPlanFilter) && Object.keys(repairedPlanFilter).length > 0;
    const query = hasRoleScope && hasPlanFilter
        ? { $and: [roleScope, repairedPlanFilter] }
        : (hasRoleScope ? roleScope : (hasPlanFilter ? repairedPlanFilter : {}));

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
    const telemetry = { promptTokens: 0, completionTokens: 0, totalTokens: 0, generationTimeSeconds: 0, timeToFirstTokenSeconds: 0, tokensPerSecond: 0, source: 'unavailable' };
    const collectTelemetry = (item) => {
        const usage = item?.usage || {};
        const stats = item?.stats || {};
        telemetry.promptTokens += Number(usage.prompt_tokens ?? stats.input_tokens ?? 0);
        telemetry.completionTokens += Number(usage.completion_tokens ?? stats.total_output_tokens ?? 0);
        telemetry.totalTokens += Number(usage.total_tokens || 0);
        telemetry.generationTimeSeconds += Number(stats.generation_time ?? stats.generation_time_seconds ?? 0);
        telemetry.timeToFirstTokenSeconds += Number(stats.time_to_first_token ?? stats.time_to_first_token_seconds ?? 0);
        telemetry.tokensPerSecond = Number(stats.tokens_per_second || telemetry.tokensPerSecond || 0);
        telemetry.source = item?.source || telemetry.source;
    };

    // Agentic milestone path: the database/document collector has already
    // gathered role-scoped facts. Qwen acts as the research analyst and must
    // synthesize only from those facts, cite the supplied tender references,
    // and state uncertainty instead of inventing a clause or penalty.
    if (isDetailedMilestoneQuery(message) && localFacts.length) {
        const analystReply = await callLocalChat({
            model: LOCAL_AI_CHAT_MODEL,
            temperature: 0.15,
            maxTokens: CHAT_MAX_TOKENS,
            onTelemetry: collectTelemetry,
            messages: [
                {
                    role: 'system',
                    content: [
                        'You are the IntelliTender procurement research analyst.',
                        'Use only the role-scoped milestone and tender-document facts supplied below.',
                        'Answer with clear sections: Finding, Tender clause references, Missing evidence, Penalty decision, Recommended actions, Limitations.',
                        'A delay is not automatically a breach. Mark a clause as unconfirmed when no exact clause reference is supplied.',
                        'Recommend a penalty only when the supplied evidence identifies an applicable contractual clause and a calculation basis.',
                        'Do not discuss bids or claim that no tenders exist when milestone facts are supplied.',
                    ].join('\n'),
                },
                {
                    role: 'user',
                    content: `User question: ${message}\n\nRole: ${role}\n\nCollected records and document evidence:\n${localFacts.join('\n\n')}`,
                },
            ],
        });

        return {
            reply: String(analystReply || '').trim(),
            model: LOCAL_AI_CHAT_MODEL,
            responseMode: 'agentic-milestone-research',
            plan: { action: 'research', steps: ['scope records', 'retrieve tender references', 'check evidence', 'assess penalty', 'synthesize answer'] },
            records: [],
            count: 0,
            collection: 'Contract',
            telemetry: {
                ...telemetry,
                totalTokens: telemetry.totalTokens || telemetry.promptTokens + telemetry.completionTokens,
            },
        };
    }

    let planResponse = await callLocalChat({
        model: LOCAL_AI_CHAT_MODEL,
        temperature: 0,
        ...(CHAT_STRUCTURED_OUTPUT ? { responseFormat: { type: 'json_object' } } : {}),
        maxTokens: CHAT_MAX_TOKENS,
        onTelemetry: collectTelemetry,
        messages: buildAgentMessages({ role, userId, message, history, localFacts }),
    });

    let plan = normalizeMongoPlan(planResponse);
    if (!plan) {
        // Qwen is running without structured output. Give it one compact
        // repair attempt instead of exposing raw planning text to the user.
        planResponse = await callLocalChat({
            model: LOCAL_AI_CHAT_MODEL,
            temperature: 0,
            maxTokens: 500,
            onTelemetry: collectTelemetry,
            messages: [
                { role: 'system', content: `${AGENT_PROMPT}\nReturn only one valid JSON object. No markdown and no explanation.` },
                { role: 'system', content: AGENT_SCHEMA_GUIDE },
                { role: 'user', content: message },
            ],
        });
        plan = normalizeMongoPlan(planResponse);
    }
    if (!plan) {
        return {
            reply: String(planResponse || '').trim(),
            model: LOCAL_AI_CHAT_MODEL,
            responseMode: 'lmstudio',
            plan: null,
            records: [],
            count: 0,
            collection: null,
            telemetry,
        };
    }

    if (plan.action === 'direct') {
        return {
            reply: plan.answer,
            model: LOCAL_AI_CHAT_MODEL,
            responseMode: 'lmstudio',
            plan,
            records: [],
            count: 0,
            collection: null,
            telemetry,
        };
    }

    const { count, records } = await executeMongoPlan(plan, role, userId);

    let finalReply = '';
    try {
        finalReply = await callLocalChat({
            model: LOCAL_AI_CHAT_MODEL,
            temperature: 0.2,
            messages: [
                { role: 'system', content: AGENT_SCHEMA_GUIDE },
                { role: 'system', content: buildFinalAnswerPrompt({ role, message, plan, records, count, collection: plan.collection }) },
            ],
            maxTokens: CHAT_MAX_TOKENS,
            onTelemetry: collectTelemetry,
        });
    } catch (error) {
        console.error('[AI chat] Final answer generation failed after database query:', error instanceof Error ? error.message : error);
    }

    const isAwardQuestion = awardedContractDetailPattern.test(message) || awardDecisionPattern.test(message);
    const reply = isAwardQuestion && emptyAwardAnswerPattern.test(finalReply)
        ? await buildAwardedContractDetailReply({ role, userId })
        : isLikelyGenericAssistantReply(finalReply)
        ? (isAwardQuestion
            ? await buildAwardedContractDetailReply({ role, userId })
            : buildDirectFallbackAnswer({ role, collection: plan.collection, count, records }))
        : finalReply.trim();

    return {
        reply,
        model: LOCAL_AI_CHAT_MODEL,
        responseMode: finalReply ? 'lmstudio' : 'lmstudio-query-recovery',
        plan,
        records,
        count,
        collection: plan.collection,
        telemetry: {
            ...telemetry,
            totalTokens: telemetry.totalTokens || telemetry.promptTokens + telemetry.completionTokens,
            tokensPerSecond: telemetry.tokensPerSecond || (telemetry.completionTokens > 0 && telemetry.generationTimeSeconds > 0 ? telemetry.completionTokens / telemetry.generationTimeSeconds : 0),
        },
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
        model: agentResult?.model || LOCAL_AI_CHAT_MODEL,
        responseMode: agentResult?.responseMode || 'fallback',
        collection: agentResult?.collection || null,
        count: agentResult?.count || 0,
        plan: agentResult?.plan || null,
        localFactsCount: Array.isArray(localFacts) ? localFacts.length : 0,
        records,
        telemetry: agentResult?.telemetry || null,
        durationMs: Number(agentResult?.durationMs || 0),
    };
}

async function loadChatSession(chatId, userId) {
    if (!chatId) return null;
    // Keep this as a Mongoose document because messages are appended and saved.
    const session = await AIChatSession.findOne({ _id: chatId, userId });
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

    if (milestoneBacklogPenaltyPattern.test(lower)) {
        const milestoneFact = await buildMilestoneBacklogPenaltyReply({ role, userId, message });
        if (milestoneFact) facts.push(milestoneFact);
    }

    if (awardedContractDetailPattern.test(lower) || awardDecisionPattern.test(lower)) {
        facts.push(await buildAwardedContractDetailReply({ role, userId }));
    }

    const rejectionReply = await buildBidRejectionReply({ role, userId, message });
    if (rejectionReply) facts.push(rejectionReply);

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

async function buildMilestoneBacklogPenaltyReply({ role, userId, message }) {
    const contracts = await fetchVisibleContracts(role, userId);
    if (!contracts.length) return 'I could not find any contracts with milestones in your scope.';

    const reports = await AIMilestoneReport.find({ contractId: { $in: contracts.map((contract) => contract._id) } })
        .sort({ generatedAt: -1 }).lean();
    const tenderIds = contracts.map((contract) => contract.tenderId?._id || contract.tenderId).filter(Boolean);
    const tenderDocumentGroups = await getIndexedDocumentGroups({
        tenderIds,
        sourceKinds: ['tender-document'],
        limit: 100,
    }).catch(() => []);
    const reportByMilestone = new Map(reports.map((report) => [String(report.milestoneId), report]));
    const delayedItems = [];
    const pendingItems = [];
    const penaltyDecisions = [];
    const clauseFindings = [];
    const detailedAnalysis = isDetailedMilestoneQuery(message);

    contracts.forEach((contract) => {
        (contract.milestones || []).forEach((milestone) => {
            const report = reportByMilestone.get(String(milestone._id));
            const plannedEnd = milestone.plannedEndDate ? new Date(milestone.plannedEndDate) : null;
            const completed = String(milestone.status || '').toLowerCase() === 'completed';
            const overdue = !completed && plannedEnd && !Number.isNaN(plannedEnd.getTime()) && !milestone.actualEndDate && plannedEnd < new Date();
            const incomplete = Number(milestone.progress || 0) < 100 && String(milestone.status || '').toLowerCase() !== 'not started';
            const isDelayed = String(milestone.status || '').toLowerCase() === 'delayed' || overdue;
            const delayDays = plannedEnd && isDelayed
                ? Math.max(1, Math.ceil((new Date().getTime() - plannedEnd.getTime()) / (1000 * 60 * 60 * 24)))
                : 0;
            const item = `${contract.tenderId?.title || 'Untitled tender'} — ${milestone.title}: planned ${plannedEnd ? plannedEnd.toLocaleDateString('en-GB') : 'date not set'}, ${Number(milestone.progress || 0)}% complete`;
            if (isDelayed) delayedItems.push(`${item}, ${delayDays} day(s) late`);
            else if (incomplete || String(milestone.status || '').toLowerCase() === 'not started') pendingItems.push(item);
            const decision = report?.aiAssessment?.penaltyDecision?.needed;
            if (decision) penaltyDecisions.push(decision);
            if (isDelayed) {
                const clauseReferences = Array.isArray(report?.aiAssessment?.clauseReferences)
                    ? report.aiAssessment.clauseReferences.filter(Boolean)
                    : [];
                const documentSignals = Array.isArray(report?.aiAssessment?.documentSignals)
                    ? report.aiAssessment.documentSignals.filter(Boolean)
                    : [];
                const tenderId = String(contract.tenderId?._id || contract.tenderId || '');
                const documentGroup = tenderDocumentGroups.find((group) => String(group.tenderId || group.sourceId || '') === tenderId);
                const documentText = String(documentGroup?.text || '').replace(/\s+/g, ' ').trim();
                const clauseSignal = documentText.match(/.{0,100}(penalt|liquidated damages|delay|late delivery|deduct|withhold|extension|completion).{0,220}/i)?.[0]?.trim();
                const clauseText = clauseReferences.length
                    ? clauseReferences.join(', ')
                    : clauseSignal
                        ? `Tender document reference (${documentGroup?.sourceName || 'tender document'}): ${clauseSignal}`
                        : 'No confirmed clause violation; no specific penalty/delay clause was identified in the saved review';
                clauseFindings.push(`${contract.tenderId?.title || 'Untitled tender'} — ${milestone.title}: ${clauseText}${documentSignals.length ? `; submitted evidence: ${documentSignals.slice(0, 2).join(' | ')}` : ''}`);
            }
        });
    });

    const backlogCount = delayedItems.length + pendingItems.length;
    if (!detailedAnalysis) {
        if (!delayedItems.length) return `No delayed milestones were found across ${contracts.length} contract${contracts.length === 1 ? '' : 's'}.`;
        return `Yes. ${delayedItems.length} delayed milestone${delayedItems.length === 1 ? '' : 's'} found: ${delayedItems.slice(0, 8).join('; ')}.`;
    }

    const penalty = penaltyDecisions.includes('yes') ? 'potentially required under the identified clause' : penaltyDecisions.includes('review') || delayedItems.length ? 'clause review required' : 'not required based on current milestone data';
    if (!backlogCount) return `No delayed or pending milestones were found across ${contracts.length} contract${contracts.length === 1 ? '' : 's'}. Penalty is not required based on the current milestone data, unless a tender clause says otherwise.`;
    const questions = delayedItems.slice(0, 8).map((item) => `For ${item.split(': planned')[0]}, which tender/contract clause was violated by this delay, what is the contractual reason, and what recovery date is committed?`);
    questions.push('For each delayed milestone, provide the exact tender/contract clause number and text authorizing a delay deduction. Do not apply a penalty without that clause.');
    questions.push('Please provide inspection, measurement, acceptance, or completion evidence for each incomplete milestone.');
    const sections = [`I found ${delayedItems.length} delayed milestone${delayedItems.length === 1 ? '' : 's'} and ${pendingItems.length} other pending/backlog milestone${pendingItems.length === 1 ? '' : 's'}.`, `Penalty status: ${penalty}.`];
    sections.push(`Research basis: analyzed ${contracts.length} role-scoped contract${contracts.length === 1 ? '' : 's'}, their milestone records, ${tenderDocumentGroups.length} indexed tender document group${tenderDocumentGroups.length === 1 ? '' : 's'}, and ${reports.length} saved AI milestone review${reports.length === 1 ? '' : 's'}.`);
    if (delayedItems.length) sections.push(`Delayed: ${delayedItems.slice(0, 8).join('; ')}.`);
    if (clauseFindings.length) sections.push(`Clause review by milestone: ${clauseFindings.slice(0, 8).join('; ')}.`);
    if (pendingItems.length) sections.push(`Pending/backlog: ${pendingItems.slice(0, 8).join('; ')}.`);
    sections.push(`Recommended action: ${penalty.includes('potentially required') ? 'verify the cited clause, establish excusable/non-excusable delay, calculate the contractual formula, and obtain approval before deduction.' : 'request the exact governing clause and supporting evidence; do not impose a penalty until the clause, delay responsibility, and calculation basis are verified.'}`);
    sections.push('Research limitation: a delayed milestone is not by itself proof of a contractual breach; the tender clause, approved extension, cause of delay, and committee evidence must be verified.');
    sections.push(`Committee queries: ${questions.join(' ')}`);
    return sections.join(' ');
}

const buildFallbackReply = ({ role, message, context }) => {
    const query = String(message || '').trim();
    const summary = context?.summary || {};
    const retrievalPlan = Array.isArray(context?.retrievalPlan) ? context.retrievalPlan.join(', ') : '';
    const localFacts = Array.isArray(context?.localFacts) ? context.localFacts : [];
    const firstTender = Array.isArray(context?.structured?.tenders) ? context.structured.tenders[0] : null;
    const scopedTenderReply = buildScopedTenderReply({ role, message, context });

    const parts = [];

    if (localFacts.length) {
        parts.push(localFacts[0]);
    } else if (scopedTenderReply) {
        parts.push(scopedTenderReply);
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

    if (!localFacts.length) {
        parts.push('If you want, I can try again in a moment or we can narrow the question down together.');
    }
    return parts.join(' ');
};

export const chatWithAssistant = async (req, res) => {
    let session = null;
    const startedAt = Date.now();
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
                // The browser can retain a deleted/stale chat id. Recover by
                // opening a new user-owned session instead of blocking the
                // message before it reaches the agent.
                session = await AIChatSession.create({
                    userId,
                    role,
                    title: 'New chat',
                    messages: [],
                    lastMessageAt: new Date(),
                });
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

            void recordResearchMetric({
                eventType: 'chat-query',
                actorId: userId,
                actorRole: role,
                chatId: session._id,
                durationMs: Date.now() - startedAt,
                status: 'warning',
                metricName: 'chat_response_time',
                value: 1,
                note: 'Vendor query blocked by policy guard',
                metadata: {
                    responseMode: 'policy',
                },
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
        let telemetry = {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            generationTimeSeconds: 0,
            timeToFirstTokenSeconds: 0,
            tokensPerSecond: 0,
            source: 'estimated-local-rules',
        };

        if (localFacts.length && shouldUseFastLocalReply(message)) {
            reply = localFacts.join(' ');
            model = 'local-rules';
            responseMode = 'local';
            telemetry.promptTokens = Math.ceil(message.length / 4);
            telemetry.completionTokens = Math.ceil(reply.length / 4);
            telemetry.totalTokens = telemetry.promptTokens + telemetry.completionTokens;
        } else {
            const agentResult = await runMongoAgent({
                role,
                userId,
                message,
                history,
                localFacts,
            });

            reply = agentResult.reply || buildFallbackReply({ role, message, context: null });
            if (localFacts.length && isLikelyGenericAssistantReply(reply)) {
                reply = localFacts[0];
                responseMode = 'local-record-recovery';
            }
            model = agentResult.model || LOCAL_AI_CHAT_MODEL;
            responseMode = agentResult.responseMode || 'lmstudio';
            plan = agentResult.plan || null;
            collection = agentResult.collection || null;
            count = agentResult.count || 0;
            records = Array.isArray(agentResult.records) ? agentResult.records : [];
            telemetry = agentResult.telemetry || telemetry;

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
            telemetry,
            durationMs: Date.now() - startedAt,
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

        void recordResearchMetric({
            eventType: 'chat-query',
            actorId: userId,
            actorRole: role,
            chatId: session._id,
            durationMs: Date.now() - startedAt,
            status: 'success',
            metricName: 'chat_response_time',
            value: 1,
            note: 'Chatbot response completed',
            metadata: {
                model,
                responseMode,
                plan: plan || null,
                collection,
                count,
                records: Array.isArray(records) ? records.length : 0,
            },
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
            telemetry,
            durationMs: Date.now() - startedAt,
        });
        } catch (error) {
        console.error('[AI chat] Local model request failed; using database fallback:', error instanceof Error ? error.message : error);
        if (error instanceof Error && error.stack) console.error(error.stack);
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
            const durationMs = Date.now() - startedAt;
            const promptTokens = Math.ceil(message.length / 4);
            const completionTokens = Math.ceil(reply.length / 4);
            const telemetry = {
                promptTokens,
                completionTokens,
                totalTokens: promptTokens + completionTokens,
                generationTimeSeconds: durationMs / 1000,
                timeToFirstTokenSeconds: 0,
                tokensPerSecond: completionTokens > 0 ? completionTokens / Math.max(durationMs / 1000, 0.001) : 0,
                source: 'estimated-database-fallback',
            };

            return res.json({
                reply,
                model: 'fallback',
                responseMode: localFacts.length ? 'local-record-fallback' : 'fallback',
                thinking: false,
                warning: error instanceof Error ? error.message : 'Failed to generate assistant response',
                contextSummary: { localFacts: localFacts.length },
                retrievalPlan: [],
                intent: null,
                telemetry,
                durationMs,
            });
        } catch {
            void recordResearchMetric({
                eventType: 'chat-query',
                actorId: req.user?.id,
                actorRole: req.user?.role || 'System',
                chatId: session?._id,
                durationMs: Date.now() - startedAt,
                status: 'failed',
                metricName: 'chat_response_time',
                value: 1,
                note: 'Failed to generate assistant response',
                metadata: {},
            });
            return res.status(500).json({
                message: error instanceof Error ? error.message : 'Failed to generate assistant response',
            });
        }
    }
};
