import { BidDocument } from '../../models/model.js';
import { callLocalChat, LOCAL_AI_MODEL, readLocalGpuPowerWatts } from '../localModelClient.js';
import { decodeStoredDocument, extractTextFromContent } from '../documents/documentTextExtractor.js';

const MAX_TEXT_CHARS = Number(process.env.AI_SCORING_MAX_TEXT_CHARS || 1800);
const MAX_COMMERCIAL_TEXT_CHARS = Number(process.env.AI_SCORING_MAX_COMMERCIAL_TEXT_CHARS || 2400);
const MAX_DOCS_PER_SIDE = Number(process.env.AI_SCORING_MAX_DOCS_PER_SIDE || 8);
// Keep enough room for the commercial file plus all normal technical uploads.
// The previous 10k default could omit a later consolidated technical PDF.
const MAX_TOTAL_CONTEXT_CHARS = Number(process.env.AI_SCORING_MAX_CONTEXT_CHARS || 16000);
const PRIORITIZE_SCHEDULE_DOCUMENTS = String(process.env.AI_SCORING_PRIORITIZE_SCHEDULE_DOCUMENTS ?? 'true').toLowerCase() !== 'false';
const SCHEDULE_PRIORITY_TERMS = String(process.env.AI_SCORING_SCHEDULE_PRIORITY_TERMS || 'schedule,methodology')
    .split(',')
    .map((term) => String(term || '').trim().toLowerCase())
    .filter(Boolean);
const AI_SCORING_MODEL = process.env.AI_SCORING_MODEL || 'qwen/qwen3-4b-2507';
const AI_SCORING_STRUCTURED_OUTPUT = String(process.env.AI_SCORING_STRUCTURED_OUTPUT || 'false').toLowerCase() === 'true';
// Set to 0 to omit the cap, but keep a finite default to prevent runaway JSON.
const AI_SCORING_MAX_TOKENS = Number(process.env.AI_SCORING_MAX_TOKENS ?? 700);
const extractedTextCache = new Map();
const TEXT_CACHE_LIMIT = 300;

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

const truncateCommercialText = (value) => {
    const text = String(value || '').trim();
    if (text.length <= MAX_COMMERCIAL_TEXT_CHARS) return text;
    const headLength = Math.floor(MAX_COMMERCIAL_TEXT_CHARS * 0.45);
    const tailLength = MAX_COMMERCIAL_TEXT_CHARS - headLength - 30;
    return `${text.slice(0, headLength)}\n[COMMERCIAL MIDDLE TRUNCATED]\n${text.slice(-tailLength)}`;
};

const extractCachedText = async (content, mimeType, name) => {
    const cacheKey = `${mimeType || ''}:${name || ''}:${String(content || '').length}:${String(content || '').slice(0, 160)}`;
    if (extractedTextCache.has(cacheKey)) return extractedTextCache.get(cacheKey);
    const text = await extractTextFromContent(content, mimeType, name);
    if (extractedTextCache.size >= TEXT_CACHE_LIMIT) {
        const oldestKey = extractedTextCache.keys().next().value;
        if (oldestKey) extractedTextCache.delete(oldestKey);
    }
    extractedTextCache.set(cacheKey, text);
    return text;
};

const normalizeLabel = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_./\\-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ');

const findMatchingBidDocument = (criterion, bidDocs) => {
    const criterionLabel = normalizeLabel(criterion);
    if (!criterionLabel) return null;

    const labelMatch = bidDocs.find((document) => {
        const documentLabel = normalizeLabel(document?.label || document?.name);
        return documentLabel && (
            documentLabel === criterionLabel
            || documentLabel.includes(criterionLabel)
            || criterionLabel.includes(documentLabel)
        );
    });
    if (labelMatch) return labelMatch;

    // Some vendors upload a single consolidated PDF with a generic filename
    // (for example, Technical_Documents.pdf). Match the criterion against the
    // extracted content as a fallback so a readable section is not treated as
    // an absent document.
    const isScheduleCriterion = criterionLabel.includes('schedule') && criterionLabel.includes('methodolog');
    if (!isScheduleCriterion) return null;

    const criterionTerms = criterionLabel
        .split(' ')
        .filter((term) => term.length >= 4 && !['and', 'with', 'from', 'this'].includes(term));
    return bidDocs.find((document) => {
        const documentText = normalizeLabel(document?.text);
        const matchedTerms = criterionTerms.filter((term) => documentText.includes(term));
        return criterionTerms.length >= 2 && matchedTerms.length >= Math.min(criterionTerms.length, 2);
    }) || null;
};

const repairFalseMissingTechnicalEvidence = ({ tender, criteriaScores, bidDocs }) => {
    if (!Array.isArray(criteriaScores)) return [];
    const configuredCriteria = Array.isArray(tender?.qcbsConfig?.technicalCriteria)
        ? tender.qcbsConfig.technicalCriteria
        : [];

    return criteriaScores.map((criterion) => {
        const configured = configuredCriteria.find((item) =>
            normalizeLabel(item?.name) === normalizeLabel(criterion?.criterion)
        );
        const match = findMatchingBidDocument(configured?.name || criterion?.criterion, bidDocs);
        const readable = match && String(match.text || '').trim();
        if (!match || !readable) return criterion;

        const evidence = Array.isArray(criterion.evidence)
            ? criterion.evidence.map((item) => String(item).trim()).filter(Boolean)
            : [];
        const falselyMissing = evidence.length === 0
            || evidence.some((item) => /not uploaded|missing|no evidence|not found|could not find/i.test(item));
        if (!falselyMissing) {
            return { ...criterion, documentLabel: match.label || criterion.documentLabel };
        }

        return {
            ...criterion,
            documentLabel: match.label || criterion.documentLabel,
            // Preserve the model's evidence-based mark, including zero. This
            // repair only corrects the false missing-document explanation.
            evidence: [`Readable evidence was extracted from the uploaded document “${match.label}”; assess its contents against the criterion.`],
        };
    });
};

const buildDocumentGateSummary = (reasons) => ({
    eligibility: {
        passed: false,
        reasons,
    },
    criteriaScores: [],
    commercialAnalysis: {
        statedValue: null,
        adjustedValue: null,
        rationale: 'Commercial evaluation was not started because document eligibility was not established.',
        risks: ['Document gate failed before scoring.'],
    },
    genuityChecks: {
        warnings: ['Document gate failed before AI scoring.'],
        confidence: 1,
    },
    aiScores: {
        technicalScore: 0,
        financialScore: 0,
        overallScore: 0,
    },
    summary: 'Bid was not eligible for scoring because required documents were missing or unreadable.',
    rationale: reasons,
});

const getMandatoryDocumentLabels = (tender) => (Array.isArray(tender?.requiredDocuments) ? tender.requiredDocuments : [])
    .filter((document) => document?.category === 'Commercial'
        || normalizeLabel(document?.label) === 'eligibility proof')
    .map((document) => normalizeLabel(document.label))
    .filter(Boolean);

const getBidDocumentLabels = (bid) => {
    const labels = Array.isArray(bid?.bidDocuments)
        ? bid.bidDocuments.map((document) => normalizeLabel(document?.label)).filter(Boolean)
        : [];
    if (bid?.proposalDocument) labels.push('commercial bid document');
    return new Set(labels);
};

const validateDocumentPack = ({ tender, bid, tenderDocs, bidDocs }) => {
    const reasons = [];
    if (!tenderDocs.length) reasons.push('Tender documents could not be read or indexed.');
    if (!bidDocs.length) reasons.push('No readable bid documents were found.');

    const expectedTenderCount = Array.isArray(tender?.documents) ? tender.documents.length : 0;
    if (expectedTenderCount > tenderDocs.length) {
        reasons.push(`Only ${tenderDocs.length} of ${expectedTenderCount} tender documents are readable.`);
    }

    const availableBidLabels = bidDocs
        .map((document) => normalizeLabel(document?.label || document?.name))
        .filter(Boolean);
    for (const requiredLabel of getMandatoryDocumentLabels(tender)) {
        const present = availableBidLabels.some((label) => label === requiredLabel || label.includes(requiredLabel) || requiredLabel.includes(label));
        if (!present) reasons.push(`Missing mandatory document: ${requiredLabel}.`);
    }

    return reasons;
};

const repairFalseMissingDocumentEligibility = ({ tender, summary, bidDocs }) => {
    if (summary?.eligibility?.passed !== false) return summary;
    const reasons = Array.isArray(summary?.eligibility?.reasons) ? summary.eligibility.reasons : [];
    const hasIdentityOrIntegrityFailure = reasons.some((reason) => /mismatch|wrong entity|identity|tamper|fake|invalid|expired/i.test(String(reason)));
    if (hasIdentityOrIntegrityFailure) return summary;

    const criteria = Array.isArray(tender?.qcbsConfig?.technicalCriteria) ? tender.qcbsConfig.technicalCriteria : [];
    const allCriteriaUploaded = criteria.length > 0 && criteria.every((criterion) => {
        const matchingDocument = findMatchingBidDocument(criterion?.name, bidDocs);
        return Boolean(matchingDocument && String(matchingDocument.text || '').trim());
    });
    const hasOnlyMissingClaims = reasons.length > 0 && reasons.every((reason) => /missing|not uploaded|no (?:evidence|document|proof|schedule|methodology)|not found|unavailable|could not find|not provided|not submitted/i.test(String(reason)));
    if (!allCriteriaUploaded || !hasOnlyMissingClaims) return summary;

    return {
        ...summary,
        eligibility: {
            ...summary.eligibility,
            passed: true,
            reasons: ['Required bid documents were uploaded and readable; eligibility was restored from the authoritative document inventory.'],
        },
    };
};

const ensureTechnicalCriteria = ({ tender, summary, bidDocs }) => {
    if (summary?.eligibility?.passed !== true) return summary?.criteriaScores || [];

    const configuredCriteria = Array.isArray(tender?.qcbsConfig?.technicalCriteria)
        ? tender.qcbsConfig.technicalCriteria
        : [];
    const existing = new Map(
        (Array.isArray(summary?.criteriaScores) ? summary.criteriaScores : [])
            .map((item) => [normalizeLabel(item?.criterion), item])
            .filter(([key]) => key)
    );
    const uploadedLabels = new Set(
        bidDocs.map((document) => normalizeLabel(document?.label || document?.name)).filter(Boolean)
    );

    return configuredCriteria.map((criterion) => {
        const label = String(criterion?.name || '').trim();
        const key = normalizeLabel(label);
        const matched = existing.get(key);
        if (matched) return matched;

        const hasTechnicalDocument = [...uploadedLabels].some((uploaded) => uploaded === key || uploaded.includes(key) || key.includes(uploaded));
        return {
            criterion: label,
            documentLabel: hasTechnicalDocument ? label : '',
            maxMarks: Number(criterion?.maxMarks || 0),
            awardedMarks: 0,
            ruleType: 'textual',
            evidence: [hasTechnicalDocument ? 'No qualifying evidence was returned for this criterion.' : 'Technical document was not uploaded; zero marks awarded.'],
        };
    });
};

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

const buildEvaluationTrace = ({ tender, bid, tenderDocs, bidDocs, documentGateReasons = [] }) => ({
    tenderTitle: String(tender?.title || ''),
    vendorName: String(bid?.vendorName || ''),
    inspectedTenderDocuments: tenderDocs.map((document) => ({
        name: String(document?.name || document?.label || ''),
        readableCharacters: String(document?.text || '').length,
    })),
    inspectedBidDocuments: bidDocs.map((document) => ({
        label: String(document?.label || document?.name || ''),
        category: String(document?.category || ''),
        readableCharacters: String(document?.text || '').length,
    })),
    documentGateReasons: documentGateReasons.map((reason) => String(reason)),
    evaluationOrder: ['eligibility', 'technical', 'commercial'],
    source: 'direct tender and bid document text with OCR where required',
});

const budgetDocumentContext = (documents, sideLabel) => {
    const result = [];
    let totalChars = 0;
    const orderedDocuments = sideLabel === 'Bid'
        ? [...documents].sort((left, right) => {
            const commercialPriority = (document) => document?.category === 'Commercial' ? 0 : 1;
            const schedulePriority = (document) => {
                if (!PRIORITIZE_SCHEDULE_DOCUMENTS) return 1;
                const value = normalizeLabel(`${document?.label || ''} ${document?.name || ''} ${document?.text || ''}`);
                return SCHEDULE_PRIORITY_TERMS.some((term) => value.includes(term)) ? 0 : 1;
            };
            return (commercialPriority(left) - commercialPriority(right))
                || (schedulePriority(left) - schedulePriority(right));
        })
        : documents;

    for (const document of orderedDocuments) {
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
    return Promise.all(docs.map(async (document, index) => {
        const decoded = decodeStoredDocument(docs[index], `Tender Document ${index + 1}`);
        const text = await extractCachedText(decoded.content, decoded.mimeType, decoded.name);
        return {
            name: decoded.name,
            mimeType: decoded.mimeType,
            fullText: text,
            text: truncateText(text),
        };
    }));
};

const collectBidDocuments = async (bid) => {
    const bidDocs = Array.isArray(bid?.bidDocuments) ? bid.bidDocuments : [];

    const outputs = await Promise.all(bidDocs.map(async (entry) => {
        if (entry?.documentId) {
            const stored = await BidDocument.findById(entry.documentId).lean();
            if (stored) {
                const decoded = decodeStoredDocument(stored.content, stored.name || entry.label || 'Bid document');
                const text = await extractCachedText(decoded.content, decoded.mimeType, decoded.name);
                return {
                    label: entry.label || stored.name || 'Bid document',
                    category: entry.category || 'Technical',
                    mimeType: decoded.mimeType || stored.mimeType,
                    text: entry.category === 'Commercial' ? truncateCommercialText(text) : truncateText(text),
                };
            }
            return null;
        }

        const decoded = decodeStoredDocument(entry?.document, entry?.label || 'Bid document');
        const text = await extractCachedText(decoded.content, decoded.mimeType, decoded.name);
        return {
            label: entry?.label || decoded.name || 'Bid document',
            category: entry?.category || 'Technical',
            mimeType: decoded.mimeType,
            text: entry?.category === 'Commercial' ? truncateCommercialText(text) : truncateText(text),
        };
    })).then((items) => items.filter(Boolean));

    const proposalAlreadyCollected = bid?.proposalDocumentId
        && bidDocs.some((entry) => String(entry?.documentId || '') === String(bid.proposalDocumentId));
    if (bid?.proposalDocument && !proposalAlreadyCollected) {
        const decoded = decodeStoredDocument(bid.proposalDocument, 'Proposal document');
        const text = await extractCachedText(decoded.content, decoded.mimeType, decoded.name);
        outputs.push({
            label: 'Proposal document',
            category: 'Commercial',
            mimeType: decoded.mimeType,
            text: truncateCommercialText(text),
        });
    }

    return outputs;
};

const buildPrompt = ({ tender, bid, tenderDocs, bidDocs, bypassEligibility = false }) => {
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
- This evaluation is scoped to exactly one selected tender and one selected vendor bid. Never use documents from another tender, vendor, or database-wide search result.
- Separate the buyer-side identity from the bidder identity.
- Any organization name on the tender pack is usually the issuing authority, buyer, or certifier, not the bidder.
- Do not reject a bid because the tender-side document shows a different company name than the bidder name.
- Only flag a name mismatch when the bid response pack itself names a different bidder than bid.vendorName or the tender explicitly requires a bidder legal name that conflicts with the bid pack.
- Phase 1: decide eligibility first.
- Phase 2: only if eligibility passes, evaluate technical criteria one by one.
- Phase 3: only if eligibility passes, evaluate the commercial bid document.
${bypassEligibility ? '- PO override is active: report eligibility honestly, but continue with conditional technical and commercial scoring using only supported vendor evidence. Do not change eligibility from false to true because of the override.' : ''}
- Compare every configured technical criterion against the most relevant vendor document individually.
- A vendor may submit a consolidated document with a generic filename (for example, Technical_Documents.pdf). Match criteria by extracted document content as well as the upload label; do not call a criterion missing when its required evidence is clearly present in that content.
- If the vendor did not upload the document needed for a technical criterion, award exactly zero for that criterion and explain that the document was not uploaded.
- For every awarded mark, include the exact vendor documentLabel and one concise evidence/reason sentence.
- Never award more than maxMarks. Never invent evidence that is not present in the vendor document text.
- Use graded technical marks, not automatic full marks. Award full marks only when the document clearly satisfies every material part of the criterion. Award partial marks such as 25%, 50%, or 75% when evidence is incomplete, unclear, outdated, weakly relevant, or only satisfies part of the requirement. Award zero when the required evidence is absent or contradicted.
- Do not treat a document merely being uploaded as proof of compliance. Verify entity name, validity dates, issuing authority, scope, thresholds, quantities, and relevance against the tender requirement.
- Calculate final marks from the returned criterion and commercial marks, and make the rationale explain the score ordering.
- Review documents in their labeled order. Use the label as the source of truth for what each document is meant to do.
- The upload flow already enforces the required document labels, so do not waste scoring on re-checking whether the files were accepted; focus on their content, purpose, and evidence.
- For each technical criterion, return the documentLabel you used for the score.
- Score each criterion using maxMarks. Use binary full-or-zero scoring only when the tender requirement is explicitly binary; otherwise use proportional evidence-based scoring.
- Ratio criteria: award proportional marks (e.g., 2/3 * 20).
- Validate certificate issuing authority only against the bid response pack and the tender's explicit requirement. A tender-side issuer name is not a bidder mismatch.
- Flag suspected document tampering or manipulation.
- Keep evidence and rationale short: one brief sentence per criterion, no long quotes, no filler.
- Return no more than 4 eligibility reasons, 1 evidence sentence per criterion, 3 commercial risks, and 3 rationale items.
- Keep the summary under 35 words. Do not repeat the same evidence in reasons, criteria, rationale, and summary.
- Do not assume a bid is compliant unless the bid text explicitly proves it against the tender text.
- If a tender requirement is not found in the bid documents, mark it as missing.
- The authoritative uploaded bid-document inventory is listed below. If a label appears in that inventory, never say that document was not uploaded; assess its content instead.
- For missing commercial bid documents, mark the bid ineligible instead of inferring compliance from tender-side paperwork.
- For commercial values, apply the tender evaluation method. Do not award 100 commercial marks merely because the bid is within budget. Commercial ranking is relative: the lowest valid eligible bid receives the highest financial score and higher valid prices receive proportionally lower scores. The server recalculates this comparison across all eligible bids.
- The bid.proposedAmount field is unverified metadata, not the final commercial amount. Read the complete commercial bid evidence available in the excerpt, locate the grand total/amount payable including applicable taxes and adjustments, and return that verified value in commercialAnalysis.statedValue. If the document total is missing or cannot be reconciled, return null and explain the issue; do not silently accept bid.proposedAmount.
- Do not produce commercial marks or commercial rationale when eligibility is false unless the PO override is active.
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

Authoritative uploaded bid-document inventory:
${JSON.stringify(bidDocs.map((document) => ({ label: document.label, category: document.category, readable: Boolean(String(document.text || '').trim()) })))}
`;
};

const callLocalModel = async (prompt, onTelemetry) => {
    return callLocalChat({
        model: AI_SCORING_MODEL || LOCAL_AI_MODEL,
        temperature: 0.2,
        messages: [
            { role: 'system', content: 'Return only valid JSON. No markdown.' },
            { role: 'user', content: prompt },
        ],
        onTelemetry,
        useNativeApi: true,
        responseFormat: AI_SCORING_STRUCTURED_OUTPUT ? { type: 'json_object' } : null,
        maxTokens: AI_SCORING_MAX_TOKENS,
    });
};

const buildStrictJsonRetryPrompt = (prompt) => `${prompt}\n\nIMPORTANT RETRY: Your previous answer was not valid JSON. Return exactly one complete JSON object matching the requested shape. Do not include reasoning, comments, markdown, or any text before or after the JSON object.`;

const applyTenderTextDocumentRequirements = ({ tenderDocs, criteriaScores, bidDocs }) => {
    const tenderText = tenderDocs
        .map((document) => String(document?.fullText || document?.text || ''))
        .join('\n')
        .toLowerCase();
    const requiresTwoPowProjects = /(?:proof\s+of\s+work|client\s+certificates)[\s\S]{0,260}at\s+least\s+(?:two|2)\s+completed\s+renovation\s+projects/i.test(tenderText)
        || /at\s+least\s+(?:two|2)\s+completed\s+renovation\s+projects[\s\S]{0,260}(?:proof\s+of\s+work|client\s+certificates)/i.test(tenderText);
    if (!requiresTwoPowProjects) return criteriaScores;

    return criteriaScores.map((criterion) => {
        const label = normalizeLabel(`${criterion?.criterion || ''} ${criterion?.documentLabel || ''}`);
        if (!label.includes('proof of work') && !label.includes('pow')) return criterion;
        const powDocuments = bidDocs.filter((document) => {
            const documentLabel = normalizeLabel(document?.label || document?.name);
            return documentLabel.includes('proof of work') || documentLabel.includes('pow') || documentLabel.includes('client certificate');
        });
        const uploadedCount = powDocuments.length;
        if (uploadedCount >= 2) return criterion;
        const maxMarks = Math.max(0, Number(criterion?.maxMarks || 0));
        const cappedMarks = Number((maxMarks * (uploadedCount / 2)).toFixed(2));
        const evidence = `Tender requires at least two completed renovation projects with POW/client certificates; ${uploadedCount} supporting document${uploadedCount === 1 ? '' : 's'} found, so this criterion is capped at ${cappedMarks}/${maxMarks}.`;
        return {
            ...criterion,
            awardedMarks: Math.min(Math.max(0, Number(criterion?.awardedMarks || 0)), cappedMarks),
            evidence: [evidence, ...(Array.isArray(criterion?.evidence) ? criterion.evidence : [])].slice(0, 2),
        };
    });
};

const recalculateAiScores = ({ tender, summary, bypassEligibility = false }) => {
    const criteria = Array.isArray(summary?.criteriaScores) ? summary.criteriaScores : [];
    const maxTechnicalMarks = criteria.reduce((total, item) => total + Math.max(0, Number(item?.maxMarks || 0)), 0);
    const awardedTechnicalMarks = criteria.reduce((total, item) => {
        const maxMarks = Math.max(0, Number(item?.maxMarks || 0));
        return total + Math.min(maxMarks, Math.max(0, Number(item?.awardedMarks || 0)));
    }, 0);
    const technicalScore = maxTechnicalMarks > 0
        ? Number(((awardedTechnicalMarks / maxTechnicalMarks) * 100).toFixed(2))
        : null;
    const rawFinancialScore = Number(summary?.aiScores?.financialScore);
    const commercialScoringBlocked = summary?.eligibility?.passed === false && !bypassEligibility;
    const financialScore = Number.isFinite(rawFinancialScore)
        ? (commercialScoringBlocked ? 0 : Math.min(100, Math.max(0, Number(rawFinancialScore.toFixed(2)))))
        : null;
    const technicalWeight = Number(tender?.qcbsConfig?.technicalWeight);
    const commercialWeight = Number(tender?.qcbsConfig?.commercialWeight);
    const hasWeights = Number.isFinite(technicalWeight) && Number.isFinite(commercialWeight)
        && technicalWeight >= 0 && commercialWeight >= 0 && (technicalWeight + commercialWeight) > 0;
    const normalizedTechnicalWeight = hasWeights ? technicalWeight : 50;
    const normalizedCommercialWeight = hasWeights ? commercialWeight : 50;
    const overallScore = technicalScore !== null && financialScore !== null
        ? Number(((technicalScore * normalizedTechnicalWeight + financialScore * normalizedCommercialWeight)
            / (normalizedTechnicalWeight + normalizedCommercialWeight)).toFixed(2))
        : (technicalScore ?? 0);

    return {
        technicalScore: technicalScore ?? 0,
        financialScore: financialScore ?? 0,
        overallScore,
    };
};

export const runAiScoring = async ({ tender, bid, bypassEligibility = false }) => {
    // Evaluation is document-first and must not wait for the background
    // embedding queue. Native text/OCR is the source used for scoring.
    const directTenderDocs = await collectTenderDocuments(tender);
    const directBidDocs = await collectBidDocuments(bid);
    const gpuPowerBeforeWatts = await readLocalGpuPowerWatts();
    const telemetry = {
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        generationTimeSeconds: 0,
        timeToFirstTokenSeconds: 0,
        tokensPerSecond: 0,
        model: AI_SCORING_MODEL || LOCAL_AI_MODEL,
        source: 'unavailable',
    };
    const collectTelemetry = (item = {}) => {
        const usage = item.usage || {};
        const stats = item.stats || {};
        telemetry.requests += 1;
        telemetry.promptTokens += Number(usage.prompt_tokens || 0);
        telemetry.completionTokens += Number(usage.completion_tokens || 0);
        telemetry.totalTokens += Number(usage.total_tokens || 0);
        telemetry.generationTimeSeconds += Number(stats.generation_time || 0);
        telemetry.timeToFirstTokenSeconds += Number(stats.time_to_first_token || 0);
        telemetry.tokensPerSecond = Number(stats.tokens_per_second || telemetry.tokensPerSecond || 0);
        telemetry.model = item.model || telemetry.model;
        telemetry.source = item.source || telemetry.source;
    };
    const tenderDocs = budgetDocumentContext(directTenderDocs, 'Tender');
    const bidDocs = budgetDocumentContext(directBidDocs, 'Bid');

    const documentGateReasons = validateDocumentPack({ tender, bid, tenderDocs: directTenderDocs, bidDocs: directBidDocs });
    if (documentGateReasons.length && !bypassEligibility) {
        return {
            parsed: buildDocumentGateSummary(documentGateReasons),
            raw: '',
            tenderDocs,
            bidDocs,
            telemetry: { ...telemetry, gpuPowerBeforeWatts, gpuPowerAfterWatts: await readLocalGpuPowerWatts() },
            audit: buildEvaluationTrace({ tender, bid, tenderDocs: directTenderDocs, bidDocs: directBidDocs, documentGateReasons }),
            promptVersion: 'document-gate-v1',
            model: AI_SCORING_MODEL || LOCAL_AI_MODEL,
            parseWarning: null,
        };
    }

    const prompt = buildPrompt({ tender, bid, tenderDocs, bidDocs, bypassEligibility });

    let responseText = await callLocalModel(prompt, collectTelemetry);
    let parsed = safeJsonParse(responseText);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        responseText = await callLocalModel(buildStrictJsonRetryPrompt(prompt), collectTelemetry);
        parsed = safeJsonParse(responseText);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('LM Studio returned invalid JSON after the retry; no AI decision was saved.');
    }
    const normalized = repairFalseMissingDocumentEligibility({
        tender,
        summary: parsed,
        bidDocs: directBidDocs,
    });
    normalized.criteriaScores = ensureTechnicalCriteria({ tender, summary: normalized, bidDocs: directBidDocs });
    if (!Array.isArray(normalized.criteriaScores) || !normalized.criteriaScores.length) {
        normalized.criteriaScores = buildFallbackCriteriaScores({ tender, summary: normalized, tenderDocs, bidDocs });
    }
    if (normalized.eligibility?.passed === false && !bypassEligibility && Array.isArray(normalized.criteriaScores)) {
        normalized.criteriaScores = normalized.criteriaScores.map((criterion) => ({
            ...criterion,
            awardedMarks: 0,
        }));
        normalized.commercialAnalysis = {
            statedValue: null,
            adjustedValue: null,
            rationale: 'Commercial evaluation was not started because eligibility failed.',
            risks: normalized.commercialAnalysis?.risks || [],
        };
    }
    normalized.criteriaScores = applyTenderTextDocumentRequirements({
        tenderDocs: directTenderDocs,
        criteriaScores: normalized.criteriaScores,
        bidDocs: directBidDocs,
    });
    normalized.criteriaScores = repairFalseMissingTechnicalEvidence({
        tender,
        criteriaScores: normalized.criteriaScores,
        bidDocs: directBidDocs,
    });
    normalized.aiScores = recalculateAiScores({ tender, summary: normalized, bypassEligibility });

    return {
        parsed: normalized,
        raw: responseText,
        tenderDocs,
        bidDocs,
        telemetry: {
            ...telemetry,
            gpuPowerBeforeWatts,
            gpuPowerAfterWatts: await readLocalGpuPowerWatts(),
        },
        audit: {
            ...buildEvaluationTrace({ tender, bid, tenderDocs: directTenderDocs, bidDocs: directBidDocs }),
            eligibilityOverride: Boolean(bypassEligibility),
            scoreCalculation: 'Technical score is calculated from awardedMarks/maxMarks; overall score uses configured QCBS weights.',
        },
        bypassEligibility: Boolean(bypassEligibility),
        promptVersion: 'strict-doc-compare-v2',
        model: AI_SCORING_MODEL || LOCAL_AI_MODEL,
        parseWarning: parsed && typeof parsed === 'object' ? null : 'AI response could not be parsed cleanly',
    };
};
