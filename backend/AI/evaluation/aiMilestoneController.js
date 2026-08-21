import { AIMilestoneReport, AINotification, Tender } from '../../models/model.js';
import { runMilestoneAiReview } from './aiMilestoneService.js';
import { recordResearchMetric } from '../../utils/researchMetrics.js';

const normalizeTimeline = (value) => ({
    plannedStartDate: value?.plannedStartDate ? new Date(value.plannedStartDate) : undefined,
    plannedEndDate: value?.plannedEndDate ? new Date(value.plannedEndDate) : undefined,
    actualStartDate: value?.actualStartDate ? new Date(value.actualStartDate) : undefined,
    actualEndDate: value?.actualEndDate ? new Date(value.actualEndDate) : undefined,
    delayedDays: Number(value?.delayedDays || 0),
    status: value?.status || '',
});

const normalizeReport = (parsed) => ({
    timeline: normalizeTimeline(parsed?.timeline),
    checklistSummary: Array.isArray(parsed?.checklistSummary)
        ? parsed.checklistSummary.map((item) => String(item))
        : [],
    observations: Array.isArray(parsed?.observations)
        ? parsed.observations.map((item) => String(item))
        : [],
    alerts: Array.isArray(parsed?.alerts)
        ? parsed.alerts.map((item) => String(item))
        : [],
    severity: ['low', 'medium', 'high'].includes(parsed?.severity) ? parsed.severity : 'low',
    penaltyEstimate: parsed?.penaltyEstimate ?? null,
    summary: parsed?.summary || '',
    committeeReport: parsed?.committeeReport && typeof parsed.committeeReport === 'object'
        ? parsed.committeeReport
        : null,
    aiAssessment: parsed?.aiAssessment && typeof parsed.aiAssessment === 'object'
        ? parsed.aiAssessment
        : null,
});

const asText = (value) => String(value || '').trim();
const hasPenaltyClause = (text) => /penalt|liquidated damages|damages|delay compensation|deduct|withhold|replacement|rework|rejection/i.test(text);

// Deterministic guardrail: the model may be unavailable or may not return a complete
// decision, so backlog and penalty guidance must still be based on supplied evidence.
const buildEvidenceAnalysis = ({ tender, milestone, update, report }) => {
    const committee = update?.committeeReport || report?.committeeReport || {};
    const checklist = Array.isArray(update?.checklist) ? update.checklist : (milestone?.checklist || []);
    const incomplete = checklist.filter((item) => !item?.checked).map((item) => item?.label).filter(Boolean);
    const plannedEnd = milestone?.plannedEndDate ? new Date(milestone.plannedEndDate) : null;
    const actualEnd = update?.actualEndDate || milestone?.actualEndDate;
    const end = actualEnd ? new Date(actualEnd) : null;
    const delayed = milestone?.status === 'Delayed' || (plannedEnd && !Number.isNaN(plannedEnd.getTime()) && !end && plannedEnd < new Date());
    const tenderText = JSON.stringify(tender?.documents || []) + ' ' + JSON.stringify(tender?.requiredDocuments || []);
    const clauseFound = hasPenaltyClause(tenderText) || hasPenaltyClause(asText(committee.clauseReference));
    const items = [];
    if (delayed) items.push('Milestone is behind its planned end date.');
    if (incomplete.length) items.push(`Incomplete checklist items: ${incomplete.join(', ')}.`);
    if (Number(update?.progress ?? milestone?.progress ?? 0) < 100 && (update?.status || milestone?.status) === 'Completed') items.push('Status is Completed but reported progress is below 100%.');
    if (!asText(committee.workDone) && !asText(report?.description)) items.push('Committee work-done evidence is missing.');
    if (!asText(committee.materialQuality)) items.push('Material or quality verification is not recorded.');
    const queries = [];
    if (delayed) queries.push({ priority: 'high', question: 'What is the contractual cause of the delay, and what recovery date and supporting evidence can the committee provide?', evidence: 'Planned/actual milestone dates' });
    incomplete.forEach((item) => queries.push({ priority: 'high', question: `Has “${item}” been completed? Upload the inspection, measurement, or acceptance evidence.`, evidence: 'Milestone checklist' }));
    if (!asText(committee.materialQuality)) queries.push({ priority: 'medium', question: 'What inspection result confirms that the delivered work/material meets the tender specification?', evidence: 'Committee material-quality field is empty' });
    if (!clauseFound && delayed) queries.push({ priority: 'high', question: 'Which tender or contract clause authorizes a delay deduction? If none applies, confirm that no penalty should be imposed.', evidence: 'No penalty clause identified in available tender context' });
    const penaltyNeeded = clauseFound && delayed ? 'yes' : (delayed ? 'review' : 'no');
    return {
        backlog: { exists: items.length > 0, items, reason: items.length ? 'A milestone obligation is delayed, incomplete, or unsupported by evidence.' : 'No backlog signal was found in the supplied milestone and committee data.' },
        penaltyDecision: { needed: penaltyNeeded, basis: clauseFound ? 'A penalty/deduction clause signal was found in the available tender or committee clause reference.' : 'No applicable penalty clause was found in the available tender context.', action: penaltyNeeded === 'yes' ? 'Verify the clause and calculate only according to the contract formula before approval.' : penaltyNeeded === 'review' ? 'Ask the committee to identify the governing clause before applying any deduction.' : 'Do not apply a penalty based on this review.' },
        queries,
    };
};

export const evaluateMilestoneWithAi = async ({ contract, milestone, update, report }) => {
    const startedAt = Date.now();
    const tender = await Tender.findById(contract.tenderId).lean();
    if (!tender) throw new Error('Tender not found for contract');

    const result = await runMilestoneAiReview({ tender, contract, milestone, update, report });
    const normalized = normalizeReport(result.parsed);
    const evidenceAnalysis = buildEvidenceAnalysis({ tender, milestone, update, report });
    normalized.aiAssessment = {
        ...(normalized.aiAssessment || {}),
        ...evidenceAnalysis,
        // Prefer the model's clause-grounded decision when it returned one after
        // reading extracted tender text; retain deterministic fallback otherwise.
        penaltyDecision: normalized.aiAssessment?.penaltyDecision || evidenceAnalysis.penaltyDecision,
        queries: [
            ...evidenceAnalysis.queries,
            ...(Array.isArray(normalized.aiAssessment?.queries) ? normalized.aiAssessment.queries : []),
        ].filter((item, index, all) => item?.question && all.findIndex((candidate) => candidate?.question === item.question) === index),
    };

    const saved = await AIMilestoneReport.findOneAndUpdate(
        { contractId: contract._id, milestoneId: milestone._id },
        {
            contractId: contract._id,
            milestoneId: milestone._id,
            tenderId: tender._id,
            reportedBy: update?.verifiedBy || update?.updatedBy || report?.reportedBy,
            committeeReport: update?.committeeReport || report?.committeeReport || null,
            aiAssessment: normalized.aiAssessment,
            status: 'success',
            model: result.model,
            promptVersion: result.promptVersion,
            generatedAt: new Date(),
            timeline: normalized.timeline,
            checklistSummary: normalized.checklistSummary,
            observations: normalized.observations,
            alerts: normalized.alerts,
            severity: normalized.severity,
            penaltyEstimate: normalized.penaltyEstimate,
            summary: normalized.summary,
            rawResponse: result.parsed,
            error: undefined,
        },
        { upsert: true, new: true }
    );

    const poUserId = tender.createdBy;
    if (normalized.alerts.length) {
        await AINotification.create({
            userId: poUserId,
            type: 'milestone-alert',
            title: `${milestone.title} milestone alert`,
            message: normalized.summary || normalized.alerts[0],
            severity: normalized.severity,
            link: `/po/milestones?contract=${contract._id}&milestone=${milestone._id}`,
        });
    }

    void recordResearchMetric({
        eventType: 'milestone-ai-review',
        actorId: update?.verifiedBy || update?.updatedBy || report?.reportedBy || undefined,
        actorRole: 'Committee',
        contractId: contract._id,
        tenderId: tender._id,
        milestoneId: milestone._id,
        durationMs: Date.now() - startedAt,
        status: 'success',
        metricName: 'milestone_review_time',
        value: 1,
        note: 'Milestone AI review completed',
        metadata: {
            severity: normalized.severity,
            alerts: normalized.alerts.length,
            delayedDays: Number(normalized.timeline?.delayedDays || 0),
        },
    });

    return saved;
};

const persistFailedMilestoneReview = async ({ contract, milestone, update, report, error }) => {
    if (!contract?._id || !milestone?._id) return null;

    const tender = await Tender.findById(contract.tenderId).lean();
    if (!tender) return null;

    const message = error instanceof Error ? error.message : 'AI milestone review failed';
    void recordResearchMetric({
        eventType: 'milestone-ai-review',
        actorId: update?.verifiedBy || update?.updatedBy || report?.reportedBy || undefined,
        actorRole: 'Committee',
        contractId: contract._id,
        tenderId: tender._id,
        milestoneId: milestone._id,
        durationMs: 0,
        status: 'failed',
        metricName: 'milestone_review_time',
        value: 1,
        note: message,
        metadata: {},
    });
    return AIMilestoneReport.findOneAndUpdate(
        { contractId: contract._id, milestoneId: milestone._id },
        {
            contractId: contract._id,
            milestoneId: milestone._id,
            tenderId: tender._id,
            reportedBy: update?.verifiedBy || update?.updatedBy || report?.reportedBy,
            committeeReport: update?.committeeReport || report?.committeeReport || null,
            status: 'failed',
            generatedAt: new Date(),
            error: message,
        },
        { upsert: true, new: true }
    );
};

export const scheduleMilestoneAiReview = ({ contract, milestone, update, report }) => {
    void evaluateMilestoneWithAi({ contract, milestone, update, report }).catch((error) => {
        void persistFailedMilestoneReview({ contract, milestone, update, report, error }).catch((persistError) => {
            console.error('Failed to persist milestone AI failure:', persistError.message || persistError);
        });
        console.error('Milestone AI review failed:', error.message || error);
    });
};

export const getMilestoneReports = async (req, res) => {
    try {
        const contractId = req.params.contractId;
        const reports = await AIMilestoneReport.find({ contractId })
            .sort({ generatedAt: -1 })
            .lean();
        res.json(reports);
    } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to load milestone reports' });
    }
};

export const getNotifications = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ message: 'Unauthorized' });
        const items = await AINotification.find({ userId }).sort({ createdAt: -1 }).limit(10).lean();
        const unreadCount = await AINotification.countDocuments({ userId, read: false });
        res.json({ items, unreadCount });
    } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to load notifications' });
    }
};

export const markNotificationRead = async (req, res) => {
    try {
        const userId = req.user?.id;
        const notificationId = req.params.notificationId;
        const updated = await AINotification.findOneAndUpdate(
            { _id: notificationId, userId },
            { read: true },
            { new: true }
        );
        if (!updated) return res.status(404).json({ message: 'Notification not found' });
        res.json(updated);
    } catch (error) {
        res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to update notification' });
    }
};
