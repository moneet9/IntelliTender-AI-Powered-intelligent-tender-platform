const structuredKeywords = [
    'count', 'how many', 'list', 'show', 'find', 'search', 'status', 'tender id', 'contract id',
    'my tenders', 'my bids', 'my contracts', 'assigned', 'published', 'awarded', 'completed',
    'latest', 'recent', 'newest', 'most recent', 'by me', 'mine',
    'pending', 'rejected', 'signed', 'frozen', 'active', 'overdue', 'delayed', 'budget', 'category',
    'bidder', 'winner', 'winning', 'marks', 'score', 'scores', 'qcbs', 'l1', 'fraud', 'fake', 'forgery',
    'mismatch', 'inconsistency', 'genuity', 'eligibility',
];

const semanticKeywords = [
    'compare', 'difference', 'why', 'reason', 'explain', 'summary', 'insight', 'trend', 'pattern',
    'risk', 'anomaly', 'recommend', 'suggest', 'should', 'best', 'improve', 'guide me', 'what should',
];

const knowledgeKeywords = [
    'policy', 'guide', 'guideline', 'how do i', 'workflow', 'process', 'documentation', 'docs',
    'system overview', 'contract clause', 'evaluation rule', 'committee rule', 'what is the process',
    'what is qcbs', 'quality and cost based selection', 'how does qcbs work',
];

const toolKeywords = [
    'analytics', 'metric', 'metrics', 'dashboard', 'report', 'reports', 'summary', 'kpi', 'trend',
    'overdue', 'delay', 'delayed', 'action', 'actions', 'export', 'flag', 'flags', 'risk', 'performance',
];

const documentKeywords = [
    'document', 'documents', 'attachment', 'attachments', 'file', 'files', 'pdf', 'ocr', 'scan',
    'scanned', 'upload', 'uploaded', 'content', 'clause', 'clauses', 'report', 'reports', 'evidence',
];

function countKeywordHits(message, keywords) {
    const lowerMessage = String(message || '').toLowerCase();
    return keywords.reduce((count, keyword) => count + (lowerMessage.includes(keyword) ? 1 : 0), 0);
}

export function classifyIntent(message) {
    const normalizedMessage = String(message || '').toLowerCase();

    const scores = {
        structured: countKeywordHits(normalizedMessage, structuredKeywords),
        semantic: countKeywordHits(normalizedMessage, semanticKeywords),
        knowledge: countKeywordHits(normalizedMessage, knowledgeKeywords),
        tools: countKeywordHits(normalizedMessage, toolKeywords),
        documents: countKeywordHits(normalizedMessage, documentKeywords),
    };

    const ordered = Object.entries(scores)
        .filter(([, score]) => score > 0)
        .sort((left, right) => right[1] - left[1])
        .map(([branch]) => branch);

    if (!ordered.length) {
        return {
            primary: 'semantic',
            branches: ['semantic', 'knowledge'],
            scores,
            reason: 'fallback',
        };
    }

    const strongest = ordered[0];
    const branches = new Set([strongest]);

    if (scores.structured > 0 && strongest !== 'structured') {
        branches.add('structured');
    }

    if (scores.semantic > 0 && strongest !== 'semantic') {
        branches.add('semantic');
    }

    if (scores.knowledge > 0 || /how do i|how can i|what is the process|where do i/i.test(normalizedMessage)) {
        branches.add('knowledge');
    }

    if (scores.tools > 0 || /count|how many|summary|analytics|dashboard|report|trend|risk|overdue/i.test(normalizedMessage)) {
        branches.add('tools');
    }

    if (scores.documents > 0 || /\b(pdf|ocr|attachment|attachments|document|documents|file|files|report|reports|scan|scanned|upload|uploaded)\b/i.test(normalizedMessage)) {
        branches.add('documents');
    }

    if (/\b(fraud|fraudulent|fake|forgery|forged|genuity|suspicious|mismatch|inconsisten|alias|spelling)\b/i.test(normalizedMessage)) {
        branches.add('documents');
    }

    if (branches.size === 1 && (strongest === 'semantic' || strongest === 'knowledge')) {
        branches.add('structured');
    }

    return {
        primary: strongest,
        branches: Array.from(branches),
        scores,
        reason: strongest,
    };
}
