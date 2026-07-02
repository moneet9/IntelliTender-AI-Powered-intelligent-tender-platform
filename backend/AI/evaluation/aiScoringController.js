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

const DEFAULT_QUEUE_STATE = {
    status: 'idle',
    action: 'start',
    startedAt: null,
    updatedAt: null,
    pausedAt: null,
    completedAt: null,
    currentBidId: null,
    currentVendorName: '',
    nextBidIndex: 0,
    totalBids: 0,
    completedBids: 0,
    lastError: '',
    force: false,
};

const normalizeQueueState = (value) => ({
    ...DEFAULT_QUEUE_STATE,
    ...(value && typeof value === 'object' ? value : {}),
    status: ['idle', 'running', 'paused', 'completed', 'failed'].includes(value?.status)
        ? value.status
        : DEFAULT_QUEUE_STATE.status,
    action: ['start', 'resume', 'pause', 'auto'].includes(value?.action)
        ? value.action
        : DEFAULT_QUEUE_STATE.action,
    startedAt: value?.startedAt || null,
    updatedAt: value?.updatedAt || null,
    pausedAt: value?.pausedAt || null,
    completedAt: value?.completedAt || null,
    currentBidId: value?.currentBidId || null,
    currentVendorName: String(value?.currentVendorName || ''),
    nextBidIndex: Number.isFinite(Number(value?.nextBidIndex)) ? Number(value.nextBidIndex) : 0,
    totalBids: Number.isFinite(Number(value?.totalBids)) ? Number(value.totalBids) : 0,
    completedBids: Number.isFinite(Number(value?.completedBids)) ? Number(value.completedBids) : 0,
    lastError: String(value?.lastError || ''),
    force: Boolean(value?.force),
});

const getQueueState = (tender) => normalizeQueueState(tender?.aiEvaluationState);

const saveQueueState = async (tenderId, currentState, patch) => {
    const nextState = normalizeQueueState({
        ...currentState,
        ...patch,
        updatedAt: new Date(),
    });

    const updatedTender = await Tender.findByIdAndUpdate(
        tenderId,
        { $set: { aiEvaluationState: nextState } },
        { new: true }
    ).select('aiEvaluationState').lean();

    return normalizeQueueState(updatedTender?.aiEvaluationState || nextState);
};

const getResumeIndex = (bids, summaryMap, force) => {
    if (force) return 0;

    for (let index = 0; index < bids.length; index += 1) {
        const bid = bids[index];
        const summary = summaryMap.get(String(bid._id));
        if (summary?.status === 'success') continue;
        return index;
    }

    return bids.length;
};

const shouldAutoRun = (tender) => {
    if (!tender?.finalSubmissionDate) return false;
    const deadline = new Date(tender.finalSubmissionDate);
    return !Number.isNaN(deadline.getTime()) && deadline < new Date();
};

const processTenderAiQueue = async ({ tenderId, force, manual, action }) => {
    const tender = await Tender.findById(tenderId).lean();
    if (!tender) {
        return { statusCode: 404, payload: { message: 'Tender not found' } };
    }

    if (action === 'pause') {
        const currentState = getQueueState(tender);
        if (currentState.status !== 'running' && currentState.status !== 'paused') {
            return {
                statusCode: 200,
                payload: {
                    message: 'AI evaluation is not running',
                    evaluationState: currentState,
                    summaries: [],
                },
            };
        }

        const evaluationState = await saveQueueState(tenderId, currentState, {
            status: 'paused',
            action: 'pause',
            pausedAt: new Date(),
            currentBidId: currentState.currentBidId,
            currentVendorName: currentState.currentVendorName,
        });

        return {
            statusCode: 200,
            payload: {
                message: 'AI evaluation paused',
                evaluationState,
                summaries: [],
            },
        };
    }

    if (!manual && !shouldAutoRun(tender)) {
        return {
            statusCode: 400,
            payload: { message: 'Tender submission deadline has not passed yet' },
        };
    }

    const bids = Array.isArray(tender.bids) ? tender.bids : [];
    if (!bids.length) {
        const emptyState = await saveQueueState(tenderId, getQueueState(tender), {
            status: 'completed',
            action: action || 'start',
            completedAt: new Date(),
            totalBids: 0,
            completedBids: 0,
            nextBidIndex: 0,
            currentBidId: null,
            currentVendorName: '',
            lastError: '',
            force,
        });

        return {
            statusCode: 200,
            payload: {
                message: 'No bids to evaluate',
                summaries: [],
                evaluationState: emptyState,
            },
        };
    }

    const currentState = getQueueState(tender);
    if (currentState.status === 'running') {
        return {
            statusCode: 409,
            payload: {
                message: 'AI scoring is already running',
                evaluationState: currentState,
                summaries: [],
            },
        };
    }

    const existingSummaries = await AIBidSummary.find({ tenderId }).lean();
    const summaryMap = new Map(existingSummaries.map((summary) => [String(summary.bidId), summary]));
    const startIndex = currentState.status === 'paused'
        ? Number(currentState.nextBidIndex || 0)
        : getResumeIndex(bids, summaryMap, force);

    if (startIndex >= bids.length && !force) {
        const completedState = await saveQueueState(tenderId, currentState, {
            status: 'completed',
            action: action || 'resume',
            completedAt: new Date(),
            totalBids: bids.length,
            completedBids: bids.filter((bid) => summaryMap.get(String(bid._id))?.status === 'success').length,
            nextBidIndex: bids.length,
            currentBidId: null,
            currentVendorName: '',
            lastError: '',
            force,
        });

        return {
            statusCode: 200,
            payload: {
                message: 'AI scoring already completed',
                summaries: existingSummaries,
                evaluationState: completedState,
            },
        };
    }

    const startedState = await saveQueueState(tenderId, currentState, {
        status: 'running',
        action: action || (currentState.status === 'paused' ? 'resume' : 'start'),
        startedAt: currentState.startedAt || new Date(),
        updatedAt: new Date(),
        pausedAt: null,
        completedAt: null,
        currentBidId: null,
        currentVendorName: '',
        nextBidIndex: startIndex,
        totalBids: bids.length,
        completedBids: startIndex,
        lastError: '',
        force,
    });

    const summaries = [];
    let processedCount = startIndex;

    for (let index = startIndex; index < bids.length; index += 1) {
        const latestTender = await Tender.findById(tenderId).select('aiEvaluationState').lean();
        const latestState = getQueueState(latestTender);
        if (latestState.status === 'paused') {
            return {
                statusCode: 200,
                payload: {
                    message: 'AI scoring paused',
                    summaries,
                    evaluationState: latestState,
                },
            };
        }

        const bid = bids[index];
        const vendorName = String(bid?.vendorName || bid?.vendorDetails?.name || `Vendor ${index + 1}`);

        await saveQueueState(tenderId, startedState, {
            status: 'running',
            action: action || (currentState.status === 'paused' ? 'resume' : 'start'),
            currentBidId: bid._id,
            currentVendorName: vendorName,
            nextBidIndex: index,
            totalBids: bids.length,
            completedBids: processedCount,
            lastError: '',
            force,
        });

        const existing = summaryMap.get(String(bid._id));
        if (existing && existing.status === 'success' && !force) {
            summaries.push(existing);
            processedCount += 1;
            const latestAfterSkip = await Tender.findById(tenderId).select('aiEvaluationState').lean();
            const latestAfterSkipState = getQueueState(latestAfterSkip);
            if (latestAfterSkipState.status === 'paused') {
                return {
                    statusCode: 200,
                    payload: {
                        message: 'AI scoring paused',
                        summaries,
                        evaluationState: latestAfterSkipState,
                    },
                };
            }
            await saveQueueState(tenderId, startedState, {
                status: 'running',
                action: action || 'resume',
                currentBidId: null,
                currentVendorName: '',
                nextBidIndex: index + 1,
                totalBids: bids.length,
                completedBids: processedCount,
                lastError: '',
                force,
            });
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
            processedCount += 1;

            const latestAfterSuccess = await Tender.findById(tenderId).select('aiEvaluationState').lean();
            const latestAfterSuccessState = getQueueState(latestAfterSuccess);
            if (latestAfterSuccessState.status === 'paused') {
                return {
                    statusCode: 200,
                    payload: {
                        message: 'AI scoring paused',
                        summaries,
                        evaluationState: latestAfterSuccessState,
                    },
                };
            }

            await saveQueueState(tenderId, startedState, {
                status: 'running',
                action: action || 'resume',
                currentBidId: null,
                currentVendorName: '',
                nextBidIndex: index + 1,
                totalBids: bids.length,
                completedBids: processedCount,
                lastError: '',
                force,
            });
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
            processedCount += 1;

            const latestAfterFailure = await Tender.findById(tenderId).select('aiEvaluationState').lean();
            const latestAfterFailureState = getQueueState(latestAfterFailure);
            if (latestAfterFailureState.status === 'paused') {
                return {
                    statusCode: 200,
                    payload: {
                        message: 'AI scoring paused',
                        summaries,
                        evaluationState: latestAfterFailureState,
                    },
                };
            }

            await saveQueueState(tenderId, startedState, {
                status: 'running',
                action: action || 'resume',
                currentBidId: null,
                currentVendorName: '',
                nextBidIndex: index + 1,
                totalBids: bids.length,
                completedBids: processedCount,
                lastError: error instanceof Error ? error.message : 'AI scoring failed',
                force,
            });
        }
    }

    const latestBeforeComplete = await Tender.findById(tenderId).select('aiEvaluationState').lean();
    const latestBeforeCompleteState = getQueueState(latestBeforeComplete);
    if (latestBeforeCompleteState.status === 'paused') {
        return {
            statusCode: 200,
            payload: {
                message: 'AI scoring paused',
                summaries,
                evaluationState: latestBeforeCompleteState,
            },
        };
    }

    const finalState = await saveQueueState(tenderId, startedState, {
        status: 'completed',
        action: action || 'resume',
        completedAt: new Date(),
        currentBidId: null,
        currentVendorName: '',
        nextBidIndex: bids.length,
        totalBids: bids.length,
        completedBids: processedCount,
        lastError: '',
        force,
    });

    return {
        statusCode: 200,
        payload: {
            message: 'AI scoring completed',
            summaries,
            evaluationState: finalState,
        },
    };
};

export const runTenderAiScoring = async (req, res) => {
    try {
        const tenderId = req.params.tenderId;
        const force = req.query.force === 'true' || req.body.force === true;
        const manual = req.query.manual === 'true' || req.body.manual === true;
        const action = String(req.body.action || req.query.action || 'start').toLowerCase();

        const result = await processTenderAiQueue({ tenderId, force, manual, action });
        return res.status(result.statusCode).json(result.payload);
    } catch (error) {
        return res.status(500).json({ message: error instanceof Error ? error.message : 'AI scoring failed' });
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

export const getTenderAiEvaluationState = async (req, res) => {
    try {
        const tender = await Tender.findById(req.params.tenderId).select('aiEvaluationState').lean();
        if (!tender) return res.status(404).json({ message: 'Tender not found' });
        res.json(getQueueState(tender));
    } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to load AI evaluation state' });
    }
};

export const runAutoAiScoring = async () => {
    const tenders = await Tender.find({ status: { $in: ['Published', 'Closed'] } }).lean();
    for (const tender of tenders) {
        if (!shouldAutoRun(tender)) continue;
        const queueState = getQueueState(tender);
        if (queueState.status === 'running' || queueState.status === 'paused') continue;

        await processTenderAiQueue({
            tenderId: tender._id,
            force: false,
            manual: false,
            action: 'auto',
        });
    }
};
