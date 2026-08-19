import { AIBidSummary, Tender } from '../../models/model.js';
import { runAiScoring } from './aiScoringService.js';
import { recordResearchMetric } from '../../utils/researchMetrics.js';

const AI_QUEUE_STALE_RUNNING_MS = Number(process.env.AI_QUEUE_STALE_RUNNING_MS || 10 * 60 * 1000);
const activeTenderScoringJobs = new Map();

const normalizeCriteriaScores = (items) => Array.isArray(items)
    ? items.map((item) => ({
        criterion: String(item?.criterion || ''),
        maxMarks: Number(item?.maxMarks || 0),
        awardedMarks: Number(item?.awardedMarks || 0),
        ruleType: item?.ruleType || 'textual',
        evidence: Array.isArray(item?.evidence) ? item.evidence.map((e) => String(e)) : [],
        documentLabel: String(item?.documentLabel || ''),
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
    aiRank: parsed?.aiRank ?? null,
    summary: parsed?.summary || '',
    rationale: Array.isArray(parsed?.rationale) ? parsed.rationale.map((item) => String(item)) : [],
});

const refreshTenderAiRanks = async (tenderId) => {
    const summaries = await AIBidSummary.find({ tenderId }).lean();
    const ranked = summaries
        .filter((summary) => summary.status === 'success')
        .sort((left, right) => {
            const leftOverall = Number(left?.aiScores?.overallScore || 0);
            const rightOverall = Number(right?.aiScores?.overallScore || 0);
            if (rightOverall !== leftOverall) return rightOverall - leftOverall;

            const leftTechnical = Number(left?.aiScores?.technicalScore || 0);
            const rightTechnical = Number(right?.aiScores?.technicalScore || 0);
            if (rightTechnical !== leftTechnical) return rightTechnical - leftTechnical;

            const leftFinancial = Number(left?.aiScores?.financialScore || 0);
            const rightFinancial = Number(right?.aiScores?.financialScore || 0);
            if (rightFinancial !== leftFinancial) return rightFinancial - leftFinancial;

            return new Date(left?.generatedAt || 0).getTime() - new Date(right?.generatedAt || 0).getTime();
        });

    await Promise.all(ranked.map((summary, index) => AIBidSummary.updateOne(
        { _id: summary._id },
        { $set: { aiRank: index + 1 } }
    )));
};

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

const isStaleRunningQueueState = (state) => {
    if (!state || state.status !== 'running') return false;
    const referenceTime = state.updatedAt || state.startedAt;
    if (!referenceTime) return false;

    return Date.now() - new Date(referenceTime).getTime() > AI_QUEUE_STALE_RUNNING_MS;
};

const recoverStaleQueueState = async (tenderId, currentState) => {
    if (!isStaleRunningQueueState(currentState)) {
        return currentState;
    }

    return saveQueueState(tenderId, currentState, {
        status: 'idle',
        action: 'start',
        currentBidId: null,
        currentVendorName: '',
        nextBidIndex: 0,
        totalBids: currentState.totalBids || 0,
        completedBids: currentState.completedBids || 0,
        lastError: 'Recovered stale AI queue state',
        force: false,
    });
};

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
        if (summary) continue;
        return index;
    }

    return bids.length;
};

const shouldAutoRun = (tender) => {
    if (!tender) return false;
    if (!['Published', 'Closed'].includes(tender.status)) return false;

    const bids = Array.isArray(tender.bids) ? tender.bids : [];
    if (!bids.length) return false;

    const currentState = normalizeQueueState(tender.aiEvaluationState);
    return currentState.status !== 'paused' && (currentState.status !== 'running' || isStaleRunningQueueState(currentState));
};

export const scheduleTenderAiScoring = (tenderId) => {
    void processTenderAiQueue({
        tenderId,
        force: false,
        manual: true,
        action: 'auto',
    }).catch((error) => {
        console.error('Tender AI scoring schedule failed:', error.message || error);
    });
};

const processTenderAiQueue = async ({ tenderId, force, manual, action, bidId = null }) => {
    const tenderLockKey = String(tenderId || '');
    if (!tenderLockKey) {
        return { statusCode: 400, payload: { message: 'Tender id is required' } };
    }

    const activeJob = activeTenderScoringJobs.get(tenderLockKey);
    if (activeJob) {
        return activeJob;
    }

    const job = (async () => {
        try {
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
                payload: { message: 'Tender is not ready for automatic AI scoring yet' },
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

        const targetBidId = String(bidId || '').trim();
        const evaluationBids = targetBidId
            ? bids.filter((bid) => String(bid?._id) === targetBidId)
            : bids;

        if (targetBidId && !evaluationBids.length) {
            return {
                statusCode: 404,
                payload: { message: 'Bid not found for this tender' },
            };
        }

        const currentState = getQueueState(tender);
        const existingSummaries = await AIBidSummary.find({ tenderId }).lean();
        const summaryMap = new Map(existingSummaries.map((summary) => [String(summary.bidId), summary]));
        const startIndex = currentState.status === 'paused' && !targetBidId
            ? Number(currentState.nextBidIndex || 0)
            : getResumeIndex(evaluationBids, summaryMap, force);

        if (startIndex >= evaluationBids.length && !force) {
            const completedState = await saveQueueState(tenderId, currentState, {
                status: 'completed',
                action: action || 'resume',
                completedAt: new Date(),
                totalBids: evaluationBids.length,
                completedBids: evaluationBids.filter((bid) => summaryMap.get(String(bid._id))?.status === 'success').length,
                nextBidIndex: evaluationBids.length,
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
            totalBids: evaluationBids.length,
            completedBids: startIndex,
            lastError: '',
            force,
        });

        const summaries = [];
        let processedCount = startIndex;

        for (let index = startIndex; index < evaluationBids.length; index += 1) {
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

            const bid = evaluationBids[index];
            const vendorName = String(bid?.vendorName || bid?.vendorDetails?.name || `Vendor ${index + 1}`);

            await saveQueueState(tenderId, startedState, {
                status: 'running',
                action: action || (currentState.status === 'paused' ? 'resume' : 'start'),
                currentBidId: bid._id,
                currentVendorName: vendorName,
                nextBidIndex: index,
                totalBids: evaluationBids.length,
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
                    totalBids: evaluationBids.length,
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
                        aiRank: null,
                        generatedAt: new Date(),
                    },
                    { upsert: true, new: true, setDefaultsOnInsert: true }
                );

            try {
                const scoringStartedAt = Date.now();
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
                        aiRank: null,
                        summary: normalized.summary,
                        rationale: normalized.rationale,
                        rawResponse: result.parsed,
                        error: undefined,
                    },
                    { upsert: true, new: true }
                );

                await refreshTenderAiRanks(tenderId);
                summaries.push(saved);
                processedCount += 1;

                void recordResearchMetric({
                    eventType: 'ai-bid-scoring',
                    actorId: tender.createdBy,
                    actorRole: 'PO',
                    tenderId: tender._id,
                    bidId: bid._id,
                    durationMs: Date.now() - scoringStartedAt,
                    status: 'success',
                    metricName: 'ai_bid_scoring_time',
                    value: 1,
                    note: 'AI bid scoring completed',
                    metadata: {
                        vendorName,
                        aiRank: saved?.aiRank || null,
                        warnings: Array.isArray(normalized.genuityChecks?.warnings) ? normalized.genuityChecks.warnings.length : 0,
                        risks: Array.isArray(normalized.commercialAnalysis?.risks) ? normalized.commercialAnalysis.risks.length : 0,
                    },
                });

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
                        aiRank: null,
                        generatedAt: new Date(),
                    },
                    { upsert: true, new: true }
                );

                summaries.push(saved);
                processedCount += 1;

                void recordResearchMetric({
                    eventType: 'ai-bid-scoring',
                    actorId: tender.createdBy,
                    actorRole: 'PO',
                    tenderId: tender._id,
                    bidId: bid._id,
                    durationMs: 0,
                    status: 'failed',
                    metricName: 'ai_bid_scoring_time',
                    value: 1,
                    note: error instanceof Error ? error.message : 'AI scoring failed',
                    metadata: {
                        vendorName,
                    },
                });

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
                    totalBids: evaluationBids.length,
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
            nextBidIndex: evaluationBids.length,
            totalBids: evaluationBids.length,
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
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'AI scoring failed';
            console.error('AI scoring queue failed:', errorMessage);

            const tender = await Tender.findById(tenderId).select('aiEvaluationState').lean();
            const currentState = getQueueState(tender);
            const resetState = await saveQueueState(tenderId, currentState, {
                status: 'idle',
                action: 'start',
                currentBidId: null,
                currentVendorName: '',
                nextBidIndex: 0,
                totalBids: currentState.totalBids || 0,
                completedBids: currentState.completedBids || 0,
                lastError: errorMessage,
                force: false,
            });

            return {
                statusCode: 500,
                payload: {
                    message: errorMessage,
                    summaries: [],
                    evaluationState: resetState,
                },
            };
        } finally {
            activeTenderScoringJobs.delete(tenderLockKey);
        }
    })();

    activeTenderScoringJobs.set(tenderLockKey, job);
    return job;
};

export const runTenderAiScoring = async (req, res) => {
    try {
        const tenderId = req.params.tenderId;
        const force = req.query.force === 'true' || req.body.force === true;
        const manual = req.query.manual === 'true' || req.body.manual === true;
        const action = String(req.body.action || req.query.action || 'start').toLowerCase();
        const bidId = String(req.body.bidId || req.query.bidId || '').trim() || null;

        // A re-evaluation is independent from the background tender queue. This
        // prevents a stale queue state from blocking the selected bid.
        if (bidId) {
            const tender = await Tender.findById(tenderId).lean();
            if (!tender) return res.status(404).json({ message: 'Tender not found' });

            const bid = (Array.isArray(tender.bids) ? tender.bids : [])
                .find((item) => String(item?._id) === bidId);
            if (!bid) return res.status(404).json({ message: 'Bid not found for this tender' });

            try {
                const scoringStartedAt = Date.now();
                await AIBidSummary.findOneAndUpdate(
                    { tenderId, bidId: bid._id },
                    {
                        tenderId,
                        bidId: bid._id,
                        vendorId: bid.vendorId,
                        evaluationMethod: tender.evaluationMethod || 'QCBS',
                        status: 'pending',
                        error: undefined,
                        aiRank: null,
                        generatedAt: new Date(),
                    },
                    { upsert: true, new: true, setDefaultsOnInsert: true }
                );

                const result = await runAiScoring({ tender, bid });
                const normalized = coerceAiSummary(result.parsed);
                const summary = await AIBidSummary.findOneAndUpdate(
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
                        aiRank: null,
                        summary: normalized.summary,
                        rationale: normalized.rationale,
                        rawResponse: result.parsed,
                        error: undefined,
                    },
                    { upsert: true, new: true }
                );

                await refreshTenderAiRanks(tenderId);
                void recordResearchMetric({
                    eventType: 'ai-bid-scoring',
                    actorId: tender.createdBy,
                    actorRole: 'PO',
                    tenderId: tender._id,
                    bidId: bid._id,
                    durationMs: Date.now() - scoringStartedAt,
                    status: 'success',
                    metricName: 'ai_bid_scoring_time',
                    value: 1,
                    note: 'AI bid re-evaluation completed',
                    metadata: {
                        vendorName: bid.vendorName || '',
                        warnings: Array.isArray(normalized.genuityChecks?.warnings) ? normalized.genuityChecks.warnings.length : 0,
                        risks: Array.isArray(normalized.commercialAnalysis?.risks) ? normalized.commercialAnalysis.risks.length : 0,
                    },
                });
                return res.json({
                    message: 'Bid AI re-evaluation completed',
                    summary,
                    summaries: [summary],
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : 'AI re-evaluation failed';
                const failedSummary = await AIBidSummary.findOneAndUpdate(
                    { tenderId, bidId: bid._id },
                    {
                        tenderId,
                        bidId: bid._id,
                        vendorId: bid.vendorId,
                        evaluationMethod: tender.evaluationMethod || 'QCBS',
                        status: 'failed',
                        error: message,
                        aiRank: null,
                        generatedAt: new Date(),
                    },
                    { upsert: true, new: true }
                );

                void recordResearchMetric({
                    eventType: 'ai-bid-scoring',
                    actorId: tender.createdBy,
                    actorRole: 'PO',
                    tenderId: tender._id,
                    bidId: bid._id,
                    durationMs: Date.now() - scoringStartedAt,
                    status: 'failed',
                    metricName: 'ai_bid_scoring_time',
                    value: 1,
                    note: message,
                    metadata: {
                        vendorName: bid.vendorName || '',
                    },
                });

                return res.status(200).json({
                    message: 'Bid AI re-evaluation failed',
                    summary: failedSummary,
                    summaries: [failedSummary],
                });
            }
        }

        const result = await processTenderAiQueue({ tenderId, force, manual, action, bidId });
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

        const queueState = await recoverStaleQueueState(req.params.tenderId, getQueueState(tender));
        res.json(queueState);
    } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to load AI evaluation state' });
    }
};

export const runAutoAiScoring = async () => {
    const tenders = await Tender.find({ status: { $in: ['Published', 'Closed'] } }).lean();
    for (const tender of tenders) {
        if (!shouldAutoRun(tender)) continue;

        const queueState = await recoverStaleQueueState(tender._id, getQueueState(tender));
        if (queueState.status === 'running' || queueState.status === 'paused') continue;

        await processTenderAiQueue({
            tenderId: tender._id,
            force: false,
            manual: false,
            action: 'auto',
        });
    }
};
