import { MilestoneAsset } from '../../models/model.js';
import { callLocalChat, LOCAL_AI_MODEL } from '../localModelClient.js';
import { getIndexedDocumentGroups } from '../documents/documentEmbeddingService.js';
import { decodeStoredDocument, extractTextFromContent } from '../documents/documentTextExtractor.js';

const MAX_TEXT_CHARS = 12000;
const AI_MILESTONE_MODEL = process.env.AI_MILESTONE_MODEL || 'qwen/qwen3-4b-2507';
const AI_MILESTONE_MAX_TOKENS = Number(process.env.AI_MILESTONE_MAX_TOKENS || 2200);

const truncateText = (value) => {
    const text = String(value || '').trim();
    if (text.length <= MAX_TEXT_CHARS) return text;
    return `${text.slice(0, MAX_TEXT_CHARS)}\n[TRUNCATED]`;
};

const collectAssetTexts = async (assetIds) => {
    const outputs = [];
    const ids = Array.isArray(assetIds) ? assetIds : [];

    for (const assetId of ids) {
        const asset = await MilestoneAsset.findById(assetId).lean();
        if (!asset) continue;
        const decoded = decodeStoredDocument(asset.content, asset.name || 'Attachment');
        const text = await extractTextFromContent(decoded.content, decoded.mimeType || asset.mimeType, decoded.name);
        outputs.push({
            name: decoded.name,
            mimeType: decoded.mimeType || asset.mimeType,
            text: truncateText(text),
        });
    }

    return outputs;
};

const collectIndexedTenderDocuments = async (tender) => {
    if (!tender?._id) return [];

    const groups = await getIndexedDocumentGroups({
        tenderIds: [tender._id],
        sourceKinds: ['tender-document'],
        limit: 100,
    });

    return groups.map((group, index) => ({
        name: group.sourceName || `Tender Document ${index + 1}`,
        mimeType: null,
        text: truncateText(group.text || ''),
    })).filter((item) => item.text);
};

const collectIndexedAttachments = async ({ contractId, milestoneId }) => {
    const groups = await getIndexedDocumentGroups({
        contractIds: contractId ? [contractId] : [],
        milestoneIds: milestoneId ? [milestoneId] : [],
        sourceKinds: ['committee-report'],
        limit: 100,
    });

    return groups.map((group, index) => ({
        name: group.sourceName || `Attachment ${index + 1}`,
        mimeType: null,
        text: truncateText(group.text || ''),
    })).filter((item) => item.text);
};

const collectTenderDocuments = async (tender) => {
    const docs = Array.isArray(tender?.documents) ? tender.documents : [];
    const results = [];

    for (let index = 0; index < docs.length; index += 1) {
        const decoded = decodeStoredDocument(docs[index], `Tender Document ${index + 1}`);
        const text = await extractTextFromContent(decoded.content, decoded.mimeType, decoded.name);
        results.push({
            name: decoded.name,
            mimeType: decoded.mimeType,
            text: truncateText(text),
        });
    }

    return results;
};

const buildPrompt = ({ tender, contract, milestone, update, report, tenderDocs, attachments }) => {
    const tenderMeta = {
        title: tender?.title,
        category: tender?.category,
        requiredDocuments: tender?.requiredDocuments || [],
        evaluationMethod: tender?.evaluationMethod,
    };

    const milestoneMeta = {
        title: milestone?.title,
        plannedStartDate: milestone?.plannedStartDate,
        plannedEndDate: milestone?.plannedEndDate,
        actualStartDate: update?.actualStartDate || milestone?.actualStartDate,
        actualEndDate: update?.actualEndDate || milestone?.actualEndDate,
        status: update?.status || milestone?.status,
        progress: update?.progress ?? milestone?.progress,
        checklist: update?.checklist || milestone?.checklist || [],
        remarks: update?.remarks || milestone?.remarks || '',
    };

    const reportMeta = report || null;
    const committeeReport = update?.committeeReport || report?.committeeReport || null;
    const contractMeta = {
        status: contract?.status,
        timelineDefined: contract?.timelineDefined,
        timelineStartDate: contract?.timelineStartDate,
        timelineEndDate: contract?.timelineEndDate,
    };

    return `You are an AI milestone review engine.\n\nTasks:\n- Compare milestone planned vs actual dates and detect delays.\n- Validate checklist completion vs reported status.\n- Review tender clauses for penalties or quality requirements.\n- Review milestone attachments for evidence (use OCR text extracts).\n- Produce alerts for PO if delay/quality risks exist.\n- Compare the committee report against the original tender and contract timeline.\n- If the tender or contract mentions late delivery, low-quality material, rejected work, or replacement obligations, estimate a reasonable penalty.\n- Cite specific clause language or document signals in the reasoning when possible.\n\nReturn STRICT JSON with this shape:\n{\n  "timeline": {"plannedStartDate": string, "plannedEndDate": string, "actualStartDate": string, "actualEndDate": string, "delayedDays": number, "status": string},\n  "checklistSummary": [string],\n  "observations": [string],\n  "alerts": [string],\n  "severity": "low|medium|high",\n  "penaltyEstimate": number,\n  "summary": string,\n  "committeeReport": object,\n  "aiAssessment": {\n    "clauseReferences": [string],\n    "documentSignals": [string],\n    "qualityNotes": [string],\n    "penaltyReason": string\n  }\n}\n\nTender metadata:\n${JSON.stringify(tenderMeta)}\n\nContract metadata:\n${JSON.stringify(contractMeta)}\n\nTender documents (text extracts):\n${JSON.stringify(tenderDocs)}\n\nMilestone context:\n${JSON.stringify(milestoneMeta)}\n\nCommittee report:\n${JSON.stringify(committeeReport)}\n\nProgress report:\n${JSON.stringify(reportMeta)}\n\nAttachments (text extracts):\n${JSON.stringify(attachments)}\n`;
};

const callLocalModel = async (prompt) => {
    return callLocalChat({
        model: AI_MILESTONE_MODEL || LOCAL_AI_MODEL,
        temperature: 0.2,
        messages: [
            { role: 'system', content: 'Return only valid JSON. No markdown.' },
            { role: 'user', content: prompt },
        ],
        responseFormat: { type: 'json_object' },
        maxTokens: AI_MILESTONE_MAX_TOKENS,
    });
};

export const runMilestoneAiReview = async ({ tender, contract, milestone, update, report }) => {
    const attachmentIds = [
        ...(Array.isArray(update?.documents) ? update.documents : []),
        ...(Array.isArray(update?.images) ? update.images : []),
        ...(Array.isArray(report?.attachments) ? report.attachments : []),
    ];

    const indexedAttachments = await collectIndexedAttachments({
        contractId: contract?._id,
        milestoneId: milestone?._id,
    });
    const attachments = indexedAttachments.length ? indexedAttachments : await collectAssetTexts(attachmentIds);
    const indexedTenderDocs = await collectIndexedTenderDocuments(tender);
    const tenderDocs = indexedTenderDocs.length ? indexedTenderDocs : await collectTenderDocuments(tender);
    const prompt = buildPrompt({ tender, contract, milestone, update, report, tenderDocs, attachments });

    const responseText = await callLocalModel(prompt);
    let parsed = null;
    try {
        parsed = JSON.parse(responseText);
    } catch {
        throw new Error('Failed to parse AI milestone response');
    }

    return {
        parsed,
        raw: responseText,
        model: AI_MILESTONE_MODEL || LOCAL_AI_MODEL,
        promptVersion: 'v1',
    };
};
