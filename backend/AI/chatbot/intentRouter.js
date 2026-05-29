const structuredKeywords = [
    'count', 'how many', 'list', 'show', 'find', 'search', 'status', 'tender id', 'contract id',
    'my tenders', 'my bids', 'my contracts', 'assigned', 'published', 'awarded', 'completed',
    'pending', 'rejected', 'signed', 'frozen', 'active', 'overdue', 'delayed', 'budget', 'category',
];

const semanticKeywords = [
    'compare', 'difference', 'why', 'reason', 'explain', 'summary', 'insight', 'trend', 'pattern',
    'risk', 'anomaly', 'recommend', 'suggest', 'should', 'best', 'improve', 'guide me', 'what should',
];

const knowledgeKeywords = [
    'policy', 'guide', 'guideline', 'how do i', 'workflow', 'process', 'documentation', 'docs',
    'system overview', 'contract clause', 'evaluation rule', 'committee rule', 'what is the process',
];

const toolKeywords = [
    'analytics', 'metric', 'metrics', 'dashboard', 'report', 'reports', 'summary', 'kpi', 'trend',
    'overdue', 'delay', 'delayed', 'action', 'actions', 'export', 'flag', 'flags', 'risk', 'performance',
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
