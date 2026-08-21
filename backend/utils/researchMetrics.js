import { ResearchMetricEvent } from '../models/model.js';

export const recordResearchMetric = async (payload) => {
    try {
        if (!payload?.eventType) return null;

        return await ResearchMetricEvent.create({
            eventType: String(payload.eventType),
            actorId: payload.actorId || undefined,
            actorRole: payload.actorRole || 'System',
            actorName: String(payload.actorName || ''),
            tenderId: payload.tenderId || undefined,
            bidId: payload.bidId || undefined,
            contractId: payload.contractId || undefined,
            milestoneId: payload.milestoneId || undefined,
            chatId: payload.chatId || undefined,
            durationMs: Number(payload.durationMs || 0),
            status: payload.status || 'success',
            metricName: String(payload.metricName || ''),
            value: Number(payload.value || 0),
            note: String(payload.note || ''),
            metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
        });
    } catch (error) {
        console.error('Failed to record research metric:', error.message || error);
        return null;
    }
};

export const formatMetricEvent = (event) => ({
    id: String(event._id),
    eventType: event.eventType,
    actorRole: event.actorRole,
    actorName: event.actorName || '',
    tenderId: event.tenderId ? String(event.tenderId) : null,
    bidId: event.bidId ? String(event.bidId) : null,
    contractId: event.contractId ? String(event.contractId) : null,
    milestoneId: event.milestoneId ? String(event.milestoneId) : null,
    chatId: event.chatId ? String(event.chatId) : null,
    durationMs: Number(event.durationMs || 0),
    status: event.status,
    metricName: event.metricName || '',
    value: Number(event.value || 0),
    note: event.note || '',
    metadata: event.metadata || {},
    createdAt: event.createdAt,
});
