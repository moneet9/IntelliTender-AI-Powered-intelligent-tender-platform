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

export const evaluateMilestoneWithAi = async ({ contract, milestone, update, report }) => {
    const startedAt = Date.now();
    const tender = await Tender.findById(contract.tenderId).lean();
    if (!tender) throw new Error('Tender not found for contract');

    const result = await runMilestoneAiReview({ tender, contract, milestone, update, report });
    const normalized = normalizeReport(result.parsed);

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
