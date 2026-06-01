import { AIBidSummary, Tender } from '../../models/model.js';
import { runAiScoring } from './aiScoringService.js';

const normalizeCriteriaScores = (items) => Array.isArray(items)
    ? items.map((item) => ({
        criterion: String(item?.criterion || ''),
        maxMarks: Number(item?.maxMarks || 0),
        awardedMarks: Number(item?.awardedMarks || 0),
        ruleType: item?.ruleType || 'textual',
        evidence: Array.isArray(item?.evidence) ? item.evidence.map((e) => String(e)) : [],
    }))
    : [];

const coerceAiSummary = (parsed) => ({
    eligibility: {
        passed: Boolean(parsed?.eligibility?.passed),
        reasons: Array.isArray(parsed?.eligibility?.reasons)
            ? parsed.eligibility.reasons.map((item) => String(item))
            : [],
    },
    criteriaScores: normalizeCriteriaScores(parsed?.criteriaScores),
    commercialAnalysis: {
        statedValue: parsed?.commercialAnalysis?.statedValue ?? null,
        adjustedValue: parsed?.commercialAnalysis?.adjustedValue ?? null,
        rationale: parsed?.commercialAnalysis?.rationale || '',
        risks: Array.isArray(parsed?.commercialAnalysis?.risks)
            ? parsed.commercialAnalysis.risks.map((item) => String(item))
            : [],
    },
    genuityChecks: {
        warnings: Array.isArray(parsed?.genuityChecks?.warnings)
            ? parsed.genuityChecks.warnings.map((item) => String(item))
            : [],
        confidence: parsed?.genuityChecks?.confidence ?? null,
    },
    aiScores: {
        technicalScore: parsed?.aiScores?.technicalScore ?? null,
        financialScore: parsed?.aiScores?.financialScore ?? null,
        overallScore: parsed?.aiScores?.overallScore ?? null,
    },
    summary: parsed?.summary || '',
    rationale: Array.isArray(parsed?.rationale) ? parsed.rationale.map((item) => String(item)) : [],
});

const shouldAutoRun = (tender) => {
    if (!tender?.finalSubmissionDate) return false;
    const deadline = new Date(tender.finalSubmissionDate);
    return !Number.isNaN(deadline.getTime()) && deadline < new Date();
};

export const runTenderAiScoring = async (req, res) => {
    try {
        const tenderId = req.params.tenderId;
        const force = req.query.force === 'true';
        const manual = req.query.manual === 'true';

        const tender = await Tender.findById(tenderId).lean();
        if (!tender) return res.status(404).json({ message: 'Tender not found' });

        if (!manual && !shouldAutoRun(tender)) {
            return res.status(400).json({ message: 'Tender submission deadline has not passed yet' });
        }

        const bids = Array.isArray(tender.bids) ? tender.bids : [];
        if (!bids.length) {
            return res.json({ message: 'No bids to evaluate', summaries: [] });
        }

        const summaries = [];
        for (const bid of bids) {
            const existing = await AIBidSummary.findOne({ tenderId, bidId: bid._id }).lean();
            if (existing && !force) {
                summaries.push(existing);
                continue;
            }

            await AIBidSummary.findOneAndUpdate(
                { tenderId, bidId: bid._id },
                {
                    tenderId,
                    bidId: bid._id,
                    vendorId: bid.vendorId,
                    evaluationMethod: tender.evaluationMethod || 'QCBS',
                    status: 'pending',
                    model: undefined,
                    error: undefined,
                    generatedAt: new Date(),
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            try {
                const result = await runAiScoring({ tender, bid });
                const normalized = coerceAiSummary(result.parsed);

                const saved = await AIBidSummary.findOneAndUpdate(
                    { tenderId, bidId: bid._id },
                    {
                        tenderId,
                        bidId: bid._id,
                        vendorId: bid.vendorId,
                        evaluationMethod: tender.evaluationMethod || 'QCBS',
                        status: 'success',
                        model: result.model,
                        promptVersion: result.promptVersion,
                        generatedAt: new Date(),
                        eligibility: normalized.eligibility,
                        criteriaScores: normalized.criteriaScores,
                        commercialAnalysis: normalized.commercialAnalysis,
                        genuityChecks: normalized.genuityChecks,
                        aiScores: normalized.aiScores,
                        summary: normalized.summary,
                        rationale: normalized.rationale,
                        rawResponse: result.parsed,
                        error: undefined,
                    },
                    { upsert: true, new: true }
                );

                summaries.push(saved);
            } catch (error) {
                const saved = await AIBidSummary.findOneAndUpdate(
                    { tenderId, bidId: bid._id },
                    {
                        tenderId,
                        bidId: bid._id,
                        vendorId: bid.vendorId,
                        evaluationMethod: tender.evaluationMethod || 'QCBS',
                        status: 'failed',
                        error: error instanceof Error ? error.message : 'AI scoring failed',
                        generatedAt: new Date(),
                    },
                    { upsert: true, new: true }
                );
                summaries.push(saved);
            }
        }

        res.json({ message: 'AI scoring completed', summaries });
    } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : 'AI scoring failed' });
    }
};

export const getTenderAiSummaries = async (req, res) => {
    try {
        const tenderId = req.params.tenderId;
        const summaries = await AIBidSummary.find({ tenderId }).lean();
        res.json(summaries);
    } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to load AI summaries' });
    }
};

export const getBidAiSummary = async (req, res) => {
    try {
        const tenderId = req.params.tenderId;
        const bidId = req.params.bidId;
        const summary = await AIBidSummary.findOne({ tenderId, bidId }).lean();
        if (!summary) return res.status(404).json({ message: 'AI summary not found' });
        res.json(summary);
    } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to load AI summary' });
    }
};

export const runAutoAiScoring = async () => {
    const tenders = await Tender.find({ status: { $in: ['Published', 'Closed'] } }).lean();
    for (const tender of tenders) {
        if (!shouldAutoRun(tender)) continue;
        const bids = Array.isArray(tender.bids) ? tender.bids : [];
        if (!bids.length) continue;

        for (const bid of bids) {
            const existing = await AIBidSummary.findOne({ tenderId: tender._id, bidId: bid._id }).lean();
            if (existing && existing.status === 'success') continue;
            try {
                const result = await runAiScoring({ tender, bid });
                const normalized = coerceAiSummary(result.parsed);
                await AIBidSummary.findOneAndUpdate(
                    { tenderId: tender._id, bidId: bid._id },
                    {
                        tenderId: tender._id,
                        bidId: bid._id,
                        vendorId: bid.vendorId,
                        evaluationMethod: tender.evaluationMethod || 'QCBS',
                        status: 'success',
                        model: result.model,
                        promptVersion: result.promptVersion,
                        generatedAt: new Date(),
                        eligibility: normalized.eligibility,
                        criteriaScores: normalized.criteriaScores,
                        commercialAnalysis: normalized.commercialAnalysis,
                        genuityChecks: normalized.genuityChecks,
                        aiScores: normalized.aiScores,
                        summary: normalized.summary,
                        rationale: normalized.rationale,
                        rawResponse: result.parsed,
                        error: undefined,
                    },
                    { upsert: true, new: true }
                );
            } catch (error) {
                await AIBidSummary.findOneAndUpdate(
                    { tenderId: tender._id, bidId: bid._id },
                    {
                        tenderId: tender._id,
                        bidId: bid._id,
                        vendorId: bid.vendorId,
                        evaluationMethod: tender.evaluationMethod || 'QCBS',
                        status: 'failed',
                        error: error instanceof Error ? error.message : 'AI scoring failed',
                        generatedAt: new Date(),
                    },
                    { upsert: true, new: true }
                );
            }
        }
    }
};
