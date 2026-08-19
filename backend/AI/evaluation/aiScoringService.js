import { BidDocument } from '../../models/model.js';
import { callLocalChat, LOCAL_AI_MODEL } from '../localModelClient.js';
import { getIndexedDocumentGroups } from '../documents/documentEmbeddingService.js';
import { decodeStoredDocument, extractTextFromContent } from '../documents/documentTextExtractor.js';

const MAX_TEXT_CHARS = 4000;
const MAX_DOCS_PER_SIDE = 4;
const MAX_TOTAL_CONTEXT_CHARS = 14000;
const AI_SCORING_MODEL = process.env.AI_SCORING_MODEL || 'qwen/qwen3-4b-2507';
const AI_SCORING_MAX_TOKENS = Number(process.env.AI_SCORING_MAX_TOKENS || 1200);

const safeJsonParse = (value) => {
    if (!value || typeof value !== 'string') return null;
    const tryParse = (input) => {
        try {
            return JSON.parse(input);
        } catch {
            return null;
        }
    };

    const direct = tryParse(value);
    if (direct) return direct;

    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
        const fencedParsed = tryParse(fenced[1].trim());
        if (fencedParsed) return fencedParsed;
    }

    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start >= 0 && end > start) {
        const sliced = value.slice(start, end + 1);
        const slicedParsed = tryParse(sliced);
        if (slicedParsed) return slicedParsed;
    }

    return null;
};

const buildFallbackSummary = () => ({
    eligibility: { passed: false, reasons: [] },
    criteriaScores: [],
    commercialAnalysis: {
        statedValue: null,
        adjustedValue: null,
        rationale: '',
        risks: ['AI response could not be parsed cleanly'],
    },
    genuityChecks: {
        warnings: ['AI response could not be parsed cleanly'],
        confidence: 0,
    },
    aiScores: {
        technicalScore: 0,
        financialScore: 0,
        overallScore: 0,
    },
    summary: 'AI response was not valid JSON, so a fallback summary was generated.',
    rationale: ['AI response was not valid JSON.'],
});

const buildFallbackCriteriaScores = ({ tender, summary, tenderDocs, bidDocs }) => {
    const criteria = Array.isArray(tender?.qcbsConfig?.technicalCriteria) && tender.qcbsConfig.technicalCriteria.length
        ? tender.qcbsConfig.technicalCriteria.map((criterion) => ({
            label: String(criterion?.name || '').trim(),
            maxMarks: Number(criterion?.maxMarks || 0),
        }))
        : Array.isArray(tender?.requiredDocuments)
            ? tender.requiredDocuments
                .filter((document) => String(document?.category || '').toLowerCase() === 'technical')
                .map((document) => ({
                    label: String(document?.label || '').trim(),
                    maxMarks: 0,
                }))
            : [];

    const eligibilityReasons = Array.isArray(summary?.eligibility?.reasons)
        ? summary.eligibility.reasons.map((item) => String(item).trim()).filter(Boolean)
        : [];

    const documentNames = [
        ...tenderDocs.map((item) => String(item?.name || item?.label || '').trim()).filter(Boolean),
        ...bidDocs.map((item) => String(item?.name || item?.label || '').trim()).filter(Boolean),
    ];

    const contextEvidence = [
        eligibilityReasons.length ? `Eligibility review: ${eligibilityReasons[0]}` : 'Eligibility review found no valid technical evidence.',
        documentNames.length ? `Documents inspected: ${documentNames.slice(0, 3).join(', ')}` : 'No document names were available for inspection.',
    ];

    return criteria
        .filter((criterion) => criterion.label)
        .map((criterion) => ({
            criterion: criterion.label,
            maxMarks: criterion.maxMarks,
            awardedMarks: 0,
            ruleType: 'textual',
            evidence: contextEvidence,
            documentLabel: criterion.label,
        }));
};

const truncateText = (value) => {
    const text = String(value || '').trim();
    if (text.length <= MAX_TEXT_CHARS) return text;
    return `${text.slice(0, MAX_TEXT_CHARS)}\n[TRUNCATED]`;
};

const normalizeLabel = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const buildDocumentPack = (documents, sideLabel) => {
    return Array.isArray(documents)
        ? documents.map((document, index) => ({
            index: index + 1,
            label: String(document?.label || document?.name || `${sideLabel} document ${index + 1}`).trim(),
            referenceName: String(document?.name || document?.label || `${sideLabel} document ${index + 1}`).trim(),
            category: String(document?.category || '').trim(),
            mimeType: document?.mimeType || null,
            text: truncateText(document?.text || ''),
        }))
        : [];
};

const budgetDocumentContext = (documents, sideLabel) => {
    const result = [];
    let totalChars = 0;

    for (const document of documents) {
        if (result.length >= MAX_DOCS_PER_SIDE || totalChars >= MAX_TOTAL_CONTEXT_CHARS) {
            break;
        }

        const text = String(document?.text || '').trim();
        if (!text) {
            continue;
        }

        const remaining = MAX_TOTAL_CONTEXT_CHARS - totalChars;
        if (remaining <= 0) {
            break;
        }

        const budgetedText = text.length > remaining
            ? `${text.slice(0, Math.max(0, remaining - 14))}\n[TRUNCATED]`
            : text;

        result.push({
            ...document,
            text: budgetedText,
        });

        totalChars += budgetedText.length;
    }

    if (documents.length > result.length) {
        result.push({
            label: `${sideLabel} context note`,
            mimeType: null,
            text: `Additional ${sideLabel.toLowerCase()} documents were omitted to keep the AI prompt small and avoid local model memory pressure.`,
        });
    }

    return result;
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

const collectBidDocuments = async (bid) => {
    const outputs = [];
    const bidDocs = Array.isArray(bid?.bidDocuments) ? bid.bidDocuments : [];

    for (const entry of bidDocs) {
        if (entry?.documentId) {
            const stored = await BidDocument.findById(entry.documentId).lean();
            if (stored) {
                const decoded = decodeStoredDocument(stored.content, stored.name || entry.label || 'Bid document');
                const text = await extractTextFromContent(decoded.content, decoded.mimeType, decoded.name);
                outputs.push({
                    label: entry.label || stored.name || 'Bid document',
                    category: entry.category || 'Technical',
                    mimeType: decoded.mimeType || stored.mimeType,
                    text: truncateText(text),
                });
            }
            continue;
        }

        const decoded = decodeStoredDocument(entry?.document, entry?.label || 'Bid document');
        const text = await extractTextFromContent(decoded.content, decoded.mimeType, decoded.name);
        outputs.push({
            label: entry?.label || decoded.name || 'Bid document',
            category: entry?.category || 'Technical',
            mimeType: decoded.mimeType,
            text: truncateText(text),
        });
    }

    if (bid?.proposalDocument) {
        const decoded = decodeStoredDocument(bid.proposalDocument, 'Proposal document');
        const text = await extractTextFromContent(decoded.content, decoded.mimeType, decoded.name);
        outputs.push({
            label: 'Proposal document',
            category: 'Commercial',
            mimeType: decoded.mimeType,
            text: truncateText(text),
        });
    }

    return outputs;
};

const collectIndexedBidDocuments = async (tender, bid) => {
    if (!tender?._id || !bid?._id) return [];

    const groups = await getIndexedDocumentGroups({
        tenderIds: [tender._id],
        bidIds: [bid._id],
        vendorId: bid.vendorId || null,
        sourceKinds: ['bid-document'],
        limit: 100,
    });

    return groups.map((group, index) => ({
        label: group.sourceName || `Bid document ${index + 1}`,
        category: group.sourceKind === 'bid-document' ? 'Technical' : 'Technical',
        mimeType: null,
        text: truncateText(group.text || ''),
    })).filter((item) => item.text);
};

const buildPrompt = ({ tender, bid, tenderDocs, bidDocs }) => {
    const tenderPack = buildDocumentPack(tenderDocs, 'Tender');
    const bidPack = buildDocumentPack(bidDocs, 'Bid');
    const tenderMeta = {
        title: tender?.title,
        category: tender?.category,
        evaluationMethod: tender?.evaluationMethod,
        qcbsConfig: tender?.qcbsConfig || null,
        l1Config: tender?.l1Config || null,
        requiredDocuments: tender?.requiredDocuments || [],
    };

    const bidMeta = {
        vendorName: bid?.vendorName,
        proposedAmount: bid?.proposedAmount,
    };

    return `You are an AI evaluation engine for procurement tenders.

Rules:
- Treat the tender documents as the source of truth.
- Read the bid documents only as claims that must be checked against the tender.
- Separate the buyer-side identity from the bidder identity.
- Any organization name on the tender pack is usually the issuing authority, buyer, or certifier, not the bidder.
- Do not reject a bid because the tender-side document shows a different company name than the bidder name.
- Only flag a name mismatch when the bid response pack itself names a different bidder than bid.vendorName or the tender explicitly requires a bidder legal name that conflicts with the bid pack.
- Phase 1: decide eligibility first.
- Phase 2: only if eligibility passes, evaluate technical criteria one by one.
- Phase 3: only if eligibility passes, evaluate the commercial bid document.
- Review documents in their labeled order. Use the label as the source of truth for what each document is meant to do.
- The upload flow already enforces the required document labels, so do not waste scoring on re-checking whether the files were accepted; focus on their content, purpose, and evidence.
- For each technical criterion, return the documentLabel you used for the score.
- Score each criterion using maxMarks. Binary criteria are full marks or zero.
- Ratio criteria: award proportional marks (e.g., 2/3 * 20).
- Validate certificate issuing authority only against the bid response pack and the tender's explicit requirement. A tender-side issuer name is not a bidder mismatch.
- Flag suspected document tampering or manipulation.
- Keep evidence and rationale short: one brief sentence per criterion, no long quotes, no filler.
- Do not assume a bid is compliant unless the bid text explicitly proves it against the tender text.
- If a tender requirement is not found in the bid documents, mark it as missing.
- For missing commercial bid documents, mark the bid ineligible instead of inferring compliance from tender-side paperwork.
- For commercial values, apply the tender evaluation method. Use QCBS weights when QCBS is selected and use the lowest-price commercial logic for L1-style evaluation.
- Keep the answer structured so the PO can review committee marks, AI marks, and the final award decision.

Return STRICT JSON with this shape:
{
  "eligibility": {"passed": boolean, "reasons": [string]},
  "criteriaScores": [{"criterion": string, "documentLabel": string, "maxMarks": number, "awardedMarks": number, "ruleType": "binary|ratio|numeric|textual", "evidence": [string]}],
  "commercialAnalysis": {"statedValue": number, "adjustedValue": number, "rationale": string, "risks": [string]},
  "genuityChecks": {"warnings": [string], "confidence": number},
  "aiScores": {"technicalScore": number, "financialScore": number, "overallScore": number},
  "summary": string,
  "rationale": [string]
}

Tender metadata:
${JSON.stringify(tenderMeta)}

Tender authority pack:
${JSON.stringify(tenderPack)}

Bid metadata:
${JSON.stringify(bidMeta)}

Bid response pack:
${JSON.stringify(bidPack)}
`;
};

const callLocalModel = async (prompt) => {
    return callLocalChat({
        model: AI_SCORING_MODEL || LOCAL_AI_MODEL,
        temperature: 0.2,
        messages: [
            { role: 'system', content: 'Return only valid JSON. No markdown.' },
            { role: 'user', content: prompt },
        ],
        responseFormat: { type: 'json_object' },
        maxTokens: AI_SCORING_MAX_TOKENS,
    });
};

const buildStrictJsonRetryPrompt = (prompt) => `${prompt}\n\nIMPORTANT RETRY: Your previous answer was not valid JSON. Return exactly one complete JSON object matching the requested shape. Do not include reasoning, comments, markdown, or any text before or after the JSON object.`;

export const runAiScoring = async ({ tender, bid }) => {
    const indexedTenderDocs = await collectIndexedTenderDocuments(tender);
    const indexedBidDocs = await collectIndexedBidDocuments(tender, bid);
    const tenderDocs = budgetDocumentContext(
        indexedTenderDocs.length ? indexedTenderDocs : await collectTenderDocuments(tender),
        'Tender'
    );
    const bidDocs = budgetDocumentContext(
        indexedBidDocs.length ? indexedBidDocs : await collectBidDocuments(bid),
        'Bid'
    );

    const prompt = buildPrompt({ tender, bid, tenderDocs, bidDocs });

    let responseText = await callLocalModel(prompt);
    let parsed = safeJsonParse(responseText);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        responseText = await callLocalModel(buildStrictJsonRetryPrompt(prompt));
        parsed = safeJsonParse(responseText);
    }
    const normalized = parsed && typeof parsed === 'object' ? parsed : buildFallbackSummary();
    if (!Array.isArray(normalized.criteriaScores) || !normalized.criteriaScores.length) {
        normalized.criteriaScores = buildFallbackCriteriaScores({ tender, summary: normalized, tenderDocs, bidDocs });
    }
    if (normalized.eligibility?.passed === false && Array.isArray(normalized.criteriaScores)) {
        normalized.criteriaScores = normalized.criteriaScores.map((criterion) => ({
            ...criterion,
            awardedMarks: 0,
        }));
    }

    return {
        parsed: normalized,
        raw: responseText,
        tenderDocs,
        bidDocs,
        promptVersion: 'strict-doc-compare-v2',
        model: AI_SCORING_MODEL || LOCAL_AI_MODEL,
        parseWarning: parsed && typeof parsed === 'object' ? null : 'AI response could not be parsed cleanly',
    };
};
