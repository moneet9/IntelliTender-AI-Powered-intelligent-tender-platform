import {
    Tender,
    Contract,
    User,
    BidDocument,
    AIBidSummary,
    DocumentEmbeddingJob,
    DocumentChunk,
    ResearchMetricEvent,
} from '../models/model.js';
import { queueBidDocumentEmbeddings, queueTenderDocumentEmbeddings } from '../AI/documents/documentEmbeddingService.js';
import { scheduleTenderAiScoring } from '../AI/evaluation/aiScoringController.js';
import { recordResearchMetric } from '../utils/researchMetrics.js';

const decodeStoredDocument = (value, fallbackName) => {
    if (!value || typeof value !== 'string') {
        return { name: fallbackName, content: '', mimeType: undefined };
    }

    try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && typeof parsed.content === 'string') {
            return {
                name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : fallbackName,
                content: parsed.content,
                mimeType: typeof parsed.mimeType === 'string' ? parsed.mimeType : undefined,
            };
        }
    } catch {
        // Fallback to legacy string formats.
    }

    if (value.startsWith('data:')) {
        const mimeType = value.slice(5, value.indexOf(';'));
        return {
            name: mimeType === 'application/pdf' ? `${fallbackName}.pdf` : fallbackName,
            content: value,
            mimeType,
        };
    }

    if (value.startsWith('http://') || value.startsWith('https://')) {
        const parts = value.split('/');
        return {
            name: parts[parts.length - 1] || fallbackName,
            content: value,
            mimeType: undefined,
        };
    }

    return {
        name: value,
        content: '',
        mimeType: undefined,
    };
};

const toLazyDocumentReference = (value, tenderId, docIndex) => {
    const fallbackName = `Document ${docIndex + 1}`;
    const decoded = decodeStoredDocument(value, fallbackName);

    return JSON.stringify({
        name: decoded.name || fallbackName,
        content: '',
        mimeType: decoded.mimeType,
        tenderId: String(tenderId),
        docIndex,
        lazy: true,
    });
};

const looksLikeBase64Content = (value) => {
    if (typeof value !== 'string') return false;

    const normalized = value.trim().replace(/\s+/g, '');
    if (!normalized || normalized.length < 16 || normalized.length % 4 !== 0) {
        return false;
    }

    return /^[A-Za-z0-9+/=]+$/.test(normalized);
};

const sanitizeFileName = (value, fallback = 'document') => {
    const normalized = typeof value === 'string' && value.trim() ? value.trim() : fallback;
    return normalized.replace(/[^a-zA-Z0-9._-]/g, '_');
};

const buildBidDocumentAccessUrl = (req, tenderId, documentId) => {
    const forwardedProto = typeof req.headers['x-forwarded-proto'] === 'string'
        ? req.headers['x-forwarded-proto'].split(',')[0].trim()
        : '';
    const protocol = forwardedProto || req.protocol || 'http';

    return `${protocol}://${req.get('host')}/api/tenders/${tenderId}/bid-documents/${documentId}`;
};

const decodeStoredDocumentToBuffer = (value, fallbackMimeType) => {
    if (typeof value !== 'string') return null;

    const normalized = value.trim();
    if (!normalized) return null;

    if (normalized.startsWith('data:')) {
        const commaIndex = normalized.indexOf(',');
        if (commaIndex < 0) return null;

        const metadata = normalized.slice(5, commaIndex);
        const payload = normalized.slice(commaIndex + 1);
        const mimeTypeFromData = metadata.split(';')[0] || fallbackMimeType || 'application/octet-stream';
        const isBase64 = metadata.includes(';base64');

        try {
            const buffer = isBase64
                ? Buffer.from(payload, 'base64')
                : Buffer.from(decodeURIComponent(payload), 'utf8');

            return {
                buffer,
                mimeType: mimeTypeFromData,
            };
        } catch {
            return null;
        }
    }

    if (looksLikeBase64Content(normalized)) {
        try {
            return {
                buffer: Buffer.from(normalized.replace(/\s+/g, ''), 'base64'),
                mimeType: fallbackMimeType || 'application/octet-stream',
            };
        } catch {
            return null;
        }
    }

    return null;
};

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

const extractObjectId = (value) => {
    if (typeof value !== 'string') return '';

    const trimmed = value.trim();
    if (!trimmed) return '';
    if (objectIdRegex.test(trimmed)) return trimmed;

    const sanitized = trimmed.split('?')[0].split('#')[0];
    const parts = sanitized.split('/').filter(Boolean);
    const candidate = parts[parts.length - 1] || '';
    return objectIdRegex.test(candidate) ? candidate : '';
};

const resolveBidDocumentId = (bid) => {
    const explicitId = extractObjectId(String(bid?.proposalDocumentId || ''));
    if (explicitId) return explicitId;

    const proposalDocumentRaw = typeof bid?.proposalDocument === 'string' ? bid.proposalDocument : '';
    const decoded = decodeStoredDocument(proposalDocumentRaw, 'Proposal document');

    const fromContent = extractObjectId(decoded.content);
    if (fromContent) return fromContent;

    return extractObjectId(proposalDocumentRaw);
};

const resolveBidDocumentEntryId = (entry) => {
    if (!entry) return '';
    const explicitId = extractObjectId(String(entry.documentId || ''));
    if (explicitId) return explicitId;

    const rawDocument = typeof entry.document === 'string' ? entry.document : '';
    const decoded = decodeStoredDocument(rawDocument, entry.label || 'Bid document');
    const fromContent = extractObjectId(decoded.content);
    if (fromContent) return fromContent;

    return extractObjectId(rawDocument);
};

const buildProposalDocumentReference = ({ name, contentUrl, mimeType }) => JSON.stringify({
    name: name || 'Proposal document',
    content: contentUrl,
    mimeType,
});

const normalizeRequiredDocuments = (items) => {
    const seen = new Set();
    const normalized = Array.isArray(items)
        ? items
            .map((item) => {
                const label = typeof item?.label === 'string' ? item.label.trim() : '';
                const category = item?.category === 'Commercial' ? 'Commercial' : 'Technical';
                return label ? { label, category } : null;
            })
            .filter(Boolean)
        : [];

    return normalized.filter((item) => {
        const key = `${item.label.toLowerCase()}|${item.category}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const buildRequiredDocumentsFromQcbs = (qcbsSettings) => {
    const criteria = Array.isArray(qcbsSettings?.technicalCriteria) ? qcbsSettings.technicalCriteria : [];
    const technicalDocs = criteria
        .map((criterion) => ({ label: String(criterion?.name || '').trim(), category: 'Technical' }))
        .filter((item) => item.label);

    return normalizeRequiredDocuments([
        ...technicalDocs,
        { label: 'Eligibility Proof', category: 'Technical' },
        { label: 'Commercial Bid Document', category: 'Commercial' },
    ]);
};

const ensureEligibilityProof = (items) => {
    const normalized = normalizeRequiredDocuments(items);
    const hasEligibility = normalized.some(
        (item) => item.category === 'Technical' && item.label.toLowerCase() === 'eligibility proof'
    );
    if (hasEligibility) return normalized;
    return normalizeRequiredDocuments([
        ...normalized,
        { label: 'Eligibility Proof', category: 'Technical' },
    ]);
};

const enrichBidDocumentReferences = async (req, tenderId, bids) => {
    const plainBids = Array.isArray(bids)
        ? bids.map((bid) => (bid && typeof bid.toObject === 'function' ? bid.toObject() : bid))
        : [];

    if (!plainBids.length) return plainBids;

    const resolvedDocumentIdsByIndex = new Map();
    const resolvedBidEntryIdsByIndex = new Map();
    const uniqueDocumentIds = new Set();

    plainBids.forEach((bid, index) => {
        const documentId = resolveBidDocumentId(bid);
        if (!documentId) return;

        resolvedDocumentIdsByIndex.set(index, documentId);
        uniqueDocumentIds.add(documentId);
    });

    plainBids.forEach((bid, index) => {
        const bidDocuments = Array.isArray(bid?.bidDocuments) ? bid.bidDocuments : [];
        const entryIds = bidDocuments
            .map((entry) => resolveBidDocumentEntryId(entry))
            .filter(Boolean);

        if (entryIds.length) {
            resolvedBidEntryIdsByIndex.set(index, entryIds);
            entryIds.forEach((entryId) => uniqueDocumentIds.add(entryId));
        }
    });

    if (!uniqueDocumentIds.size) return plainBids;

    const documents = await BidDocument.find({
        _id: { $in: Array.from(uniqueDocumentIds) },
        tenderId,
    }).select('_id name mimeType').lean();

    const documentsById = new Map(
        documents.map((document) => [String(document._id), document])
    );

    return plainBids.map((bid, index) => {
        const resolvedDocumentId = resolvedDocumentIdsByIndex.get(index);
        const bidDocuments = Array.isArray(bid?.bidDocuments) ? bid.bidDocuments : [];
        const entryIds = resolvedBidEntryIdsByIndex.get(index) || [];

        const enrichedBidDocuments = bidDocuments.map((entry, entryIndex) => {
            const entryId = entryIds[entryIndex];
            if (!entryId) return entry;

            const document = documentsById.get(entryId);
            if (!document) return entry;

            const contentUrl = buildBidDocumentAccessUrl(req, tenderId, entryId);
            const decodedEntry = decodeStoredDocument(
                typeof entry.document === 'string' ? entry.document : '',
                entry.label || 'Bid document'
            );

            return {
                ...entry,
                documentId: entry.documentId || entryId,
                document: buildProposalDocumentReference({
                    name: document.name || decodedEntry.name || entry.label || 'Bid document',
                    contentUrl,
                    mimeType: document.mimeType || decodedEntry.mimeType,
                }),
            };
        });

        if (!resolvedDocumentId) {
            return { ...bid, bidDocuments: enrichedBidDocuments };
        }

        const document = documentsById.get(resolvedDocumentId);
        if (!document) return { ...bid, bidDocuments: enrichedBidDocuments };

        const contentUrl = buildBidDocumentAccessUrl(req, tenderId, resolvedDocumentId);
        const decodedProposal = decodeStoredDocument(
            typeof bid.proposalDocument === 'string' ? bid.proposalDocument : '',
            'Proposal document'
        );

        return {
            ...bid,
            bidDocuments: enrichedBidDocuments,
            proposalDocumentId: bid.proposalDocumentId || resolvedDocumentId,
            proposalDocument: buildProposalDocumentReference({
                name: document.name || decodedProposal.name,
                contentUrl,
                mimeType: document.mimeType || decodedProposal.mimeType,
            }),
        };
    });
};

const mapBidWithVendorDetails = (bid) => {
    const vendor = bid.vendorId && typeof bid.vendorId === 'object' ? bid.vendorId : null;
    const committeeEvaluations = Array.isArray(bid.committeeEvaluations) ? bid.committeeEvaluations : [];

    return {
        _id: bid._id,
        vendorId: vendor?._id || bid.vendorId,
        vendorName: bid.vendorName || vendor?.name || 'Vendor',
        vendorDetails: vendor
            ? {
                _id: vendor._id,
                name: vendor.name,
                email: vendor.email,
                phone: vendor.phone || '',
                department: vendor.department || '',
                specialization: vendor.specialization || '',
                accountStatus: vendor.accountStatus || 'Active',
            }
            : null,
        proposedAmount: bid.proposedAmount,
        bidDocuments: Array.isArray(bid.bidDocuments) ? bid.bidDocuments : [],
        proposalDocumentId: bid.proposalDocumentId,
        proposalDocument: bid.proposalDocument,
        status: bid.status,
        committeeEvaluations: committeeEvaluations.map((evaluation) => ({
            committeeMemberId: evaluation.committeeMemberId,
            technicalScore: evaluation.technicalScore,
            financialScore: evaluation.financialScore,
            eligibilityChecked: evaluation.eligibilityChecked,
            criteriaScores: Array.isArray(evaluation.criteriaScores) ? evaluation.criteriaScores : [],
            comments: evaluation.comments,
            evaluatedDate: evaluation.evaluatedDate,
        })),
        technicalScore: bid.technicalScore,
        financialScore: bid.financialScore,
        comments: bid.comments,
        evaluatedBy: bid.evaluatedBy,
        evaluatedDate: bid.evaluatedDate,
        createdAt: bid.createdAt,
        updatedAt: bid.updatedAt,
    };
};

// --- TENDER MANAGEMENT ---
export const createTender = async (req, res) => {
    try {
        const {
            title,
            description,
            category,
            budget,
            preBidDate,
            finalSubmissionDate,
            evaluationMethod,
            l1Config,
            qcbsSettings,
            requiredDocuments,
            documents,
            milestones,
        } = req.body;
        if (!Array.isArray(documents) || documents.length === 0) {
            return res.status(400).json({ message: 'At least one tender document is required before publishing' });
        }

        const normalizedRequiredDocuments = normalizeRequiredDocuments(requiredDocuments);
        const derivedRequiredDocuments = normalizedRequiredDocuments.length
            ? ensureEligibilityProof(normalizedRequiredDocuments)
            : buildRequiredDocumentsFromQcbs(qcbsSettings);
        const tender = await Tender.create({
            title,
            description,
            category: category || 'General',
            budget,
            preBidDate,
            finalSubmissionDate,
            evaluationMethod,
            l1Config: evaluationMethod === 'L1' ? {
                technicalCutoff: Number(l1Config?.technicalCutoff || 0),
            } : undefined,
            qcbsConfig: qcbsSettings,
            requiredDocuments: derivedRequiredDocuments,
            status: 'Published',
            documents: Array.isArray(documents) ? documents : [],
            draftMilestones: Array.isArray(milestones) && milestones.length > 0 ? milestones : [],
            createdBy: req.user.id
        });
        queueTenderDocumentEmbeddings(tender).catch((error) => {
            console.error('Tender document embedding queue failed:', error.message || error);
        });
        res.status(201).json(tender);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

export const getTenders = async (req, res) => {
    try {
        let filter = {};

        if (req.query.mine === 'true' && req.user?.id) {
            filter.createdBy = req.user.id;
        }

        // If user is Committee, only show tenders created by their assigned PO
        if (req.user?.role === 'Committee') {
            const user = await User.findById(req.user.id).select('managerPo');
            if (!user?.managerPo) {
                return res.json([]);
            }
            filter = { createdBy: user.managerPo };
        }

        if (req.query.summary === 'true') {
            const summaryFields = [
                'title',
                'status',
                'createdBy',
                'createdAt',
                'finalSubmissionDate',
                'category',
                'budget',
                'evaluationMethod',
                'qcbsConfig',
                'requiredDocuments',
                'bids._id bids.vendorId bids.technicalScore bids.financialScore bids.status bids.comments bids.proposalDocumentId bids.bidDocuments bids.committeeEvaluations',
            ].join(' ');
            const tenders = await Tender.find(filter)
                .select(summaryFields)
                .populate('createdBy', 'name')
                .lean();

            const tenderIds = tenders.map((tender) => tender._id);
            const aiSummaries = await AIBidSummary.find({ tenderId: { $in: tenderIds } })
                .select('tenderId bidId status eligibility criteriaScores aiScores summary rationale generatedAt')
                .lean();
            const aiSummaryByBidId = new Map(
                aiSummaries.map((summary) => [String(summary.bidId), summary])
            );

            return res.json(tenders.map((tender) => ({
                ...tender,
                documents: [],
                bids: Array.isArray(tender.bids)
                    ? (() => {
                        const evaluationMethod = tender.evaluationMethod || 'QCBS';
                        const technicalMaximum = (tender.qcbsConfig?.technicalCriteria || [])
                            .reduce((sum, criterion) => sum + Number(criterion?.maxMarks || 0), 0);
                        const technicalWeight = Number(tender.qcbsConfig?.technicalWeight);
                        const commercialWeight = Number(tender.qcbsConfig?.commercialWeight);
                        const hasWeights = Number.isFinite(technicalWeight)
                            && Number.isFinite(commercialWeight)
                            && technicalWeight + commercialWeight > 0;
                        const resolvedTechnicalWeight = hasWeights ? technicalWeight : 50;
                        const resolvedCommercialWeight = hasWeights ? commercialWeight : 50;
                        const rawFinancialByBidId = new Map(tender.bids.map((item) => {
                            const evaluations = Array.isArray(item.committeeEvaluations) ? item.committeeEvaluations : [];
                            const evaluatedFinancial = evaluations.length
                                ? evaluations.reduce((sum, evaluation) => sum + Number(evaluation.financialScore || 0), 0) / evaluations.length
                                : Number(item.financialScore || 0);
                            const rawFinancial = evaluationMethod === 'L1'
                                ? Number(item.proposedAmount || evaluatedFinancial || 0)
                                : evaluatedFinancial || Number(item.proposedAmount || 0);
                            return [String(item._id), rawFinancial];
                        }));
                        const validFinancialValues = Array.from(rawFinancialByBidId.values())
                            .filter((value) => Number.isFinite(value) && value > 0);
                        const lowestFinancialValue = validFinancialValues.length ? Math.min(...validFinancialValues) : 0;

                        return tender.bids
                        .filter((bid) => req.user?.role !== 'Vendor'
                            || String(bid.vendorId) === String(req.user.id))
                        .map((bid) => ({
                            _id: bid._id,
                            vendorId: bid.vendorId,
                            proposedAmount: bid.proposedAmount,
                            status: bid.status,
                            technicalScore: bid.technicalScore,
                            financialScore: bid.financialScore,
                            comments: bid.comments,
                            proposalDocumentId: bid.proposalDocumentId,
                            bidDocuments: Array.isArray(bid.bidDocuments)
                                ? bid.bidDocuments.map((document) => ({
                                    label: document.label,
                                    category: document.category,
                                    documentId: document.documentId,
                                }))
                                : [],
                            committeeEvaluations: bid.committeeEvaluations || [],
                            aiEvaluation: aiSummaryByBidId.get(String(bid._id)) || null,
                            evaluationSummary: (() => {
                                const evaluations = Array.isArray(bid.committeeEvaluations) ? bid.committeeEvaluations : [];
                                const rawTechnical = evaluations.length
                                    ? evaluations.reduce((sum, evaluation) => sum + Number(evaluation.technicalScore || 0), 0) / evaluations.length
                                    : Number(bid.technicalScore || 0);
                                const technicalScore = technicalMaximum > 0
                                    ? Math.min(100, Math.max(0, (rawTechnical / technicalMaximum) * 100))
                                    : Math.min(100, Math.max(0, rawTechnical));
                                const rawFinancial = rawFinancialByBidId.get(String(bid._id)) || 0;
                                const financialScore = lowestFinancialValue > 0 && rawFinancial > 0
                                    ? Math.min(100, (lowestFinancialValue / rawFinancial) * 100)
                                    : 0;
                                const overallScore = (technicalScore * resolvedTechnicalWeight + financialScore * resolvedCommercialWeight)
                                    / (resolvedTechnicalWeight + resolvedCommercialWeight);
                                return {
                                    technicalScore: Number(technicalScore.toFixed(2)),
                                    financialScore: Number(financialScore.toFixed(2)),
                                    overallScore: Number(overallScore.toFixed(2)),
                                    technicalWeight: resolvedTechnicalWeight,
                                    commercialWeight: resolvedCommercialWeight,
                                };
                            })(),
                        }));
                    })()
                    : [],
            })));
        }

        const tenders = await Tender.find(filter).populate('createdBy', 'name').lean();
        const minimized = await Promise.all(
            tenders.map(async (tender) => ({
                ...tender,
                documents: Array.isArray(tender.documents)
                    ? req.user?.role === 'Committee'
                        ? tender.documents
                        : tender.documents.map((document, index) => toLazyDocumentReference(document, tender._id, index))
                    : [],
                bids: await enrichBidDocumentReferences(req, tender._id, tender.bids || []),
            }))
        );
        res.json(minimized);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

export const getTenderDocument = async (req, res) => {
    try {
        const tender = await Tender.findById(req.params.id).select('documents status');
        if (!tender) return res.status(404).json({ message: 'Tender not found' });

        const docIndex = Number.parseInt(req.params.docIndex, 10);
        if (Number.isNaN(docIndex) || docIndex < 0) {
            return res.status(400).json({ message: 'Invalid document index' });
        }

        const documents = Array.isArray(tender.documents) ? tender.documents : [];
        if (docIndex >= documents.length) {
            return res.status(404).json({ message: 'Document not found' });
        }

        const decoded = decodeStoredDocument(documents[docIndex], `Document ${docIndex + 1}`);
        if (!decoded.content) {
            return res.status(404).json({ message: 'Document content not found' });
        }

        res.json({
            name: decoded.name,
            content: decoded.content,
            mimeType: decoded.mimeType,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

export const getBidDocument = async (req, res) => {
    try {
        const query = {
            _id: req.params.documentId,
            tenderId: req.params.id,
        };

        if (req.user?.role === 'Vendor') {
            query.vendorId = req.user.id;
        }

        const bidDocument = await BidDocument.findOne(query).select('name content mimeType');

        if (!bidDocument) {
            return res.status(404).json({ message: 'Document not found' });
        }

        const content = typeof bidDocument.content === 'string' ? bidDocument.content : '';
        if (content.startsWith('http://') || content.startsWith('https://')) {
            return res.redirect(content);
        }

        const decoded = decodeStoredDocumentToBuffer(content, bidDocument.mimeType);
        if (!decoded) {
            return res.status(404).json({ message: 'Document content not found' });
        }

        res.setHeader('Content-Type', decoded.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${sanitizeFileName(bidDocument.name, 'proposal-document')}"`);
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.setHeader('X-Content-Type-Options', 'nosniff');

        return res.send(decoded.buffer);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
};

export const getTenderById = async (req, res) => {
    try {
        const tender = await Tender.findById(req.params.id).populate('createdBy', 'name');
        if (!tender) return res.status(404).json({ message: 'Tender not found' });

        // If user is Committee, check if tender is created by their assigned PO
        if (req.user?.role === 'Committee') {
            const user = await User.findById(req.user.id).select('managerPo');
            if (!user?.managerPo || String(tender.createdBy._id) !== String(user.managerPo)) {
                return res.status(403).json({ message: 'Forbidden: You can only view tenders from your assigned procurement officer' });
            }
        }

        res.json(tender);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

export const editTender = async (req, res) => {
    try {
        const tender = await Tender.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (tender) {
            queueTenderDocumentEmbeddings(tender).catch((error) => {
                console.error('Tender document embedding refresh failed:', error.message || error);
            });
        }
        res.json(tender);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

export const publishTender = async (req, res) => {
     try {
        const tender = await Tender.findById(req.params.id);
        if (!tender) return res.status(404).json({ message: 'Tender not found' });
        if (tender.status !== 'Draft') return res.status(400).json({ message: 'Only draft tender can be published' });
        if (!Array.isArray(tender.documents) || tender.documents.length === 0) {
            return res.status(400).json({ message: 'At least one tender document is required before publishing' });
        }
        tender.status = 'Published';
        await tender.save();
        res.json(tender);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

export const closeTender = async (req, res) => {
     try {
        const tender = await Tender.findById(req.params.id);
        if (!tender) return res.status(404).json({ message: 'Tender not found' });
        if (!['Published', 'Draft'].includes(tender.status)) return res.status(400).json({ message: 'Tender cannot be closed in current status' });
        tender.status = 'Closed';
        await tender.save();
        res.json(tender);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// --- BID SUBMISSION ---
export const submitBid = async (req, res) => {
    const startedAt = Date.now();
    try {
        const tender = await Tender.findById(req.params.id);
        if (!tender) return res.status(404).json({ message: 'Tender not found' });
        if (tender.status !== 'Published') return res.status(400).json({ message: 'Tender is not published' });
        if (new Date() > new Date(tender.finalSubmissionDate)) {
            return res.status(400).json({ message: 'Final submission date passed' });
        }

        const existingBid = tender.bids.find(b => b.vendorId.toString() === req.user.id);
        if(existingBid) return res.status(400).json({ message: 'Already bid on this tender' });

        if (!req.body.proposedAmount || Number(req.body.proposedAmount) <= 0) {
            return res.status(400).json({ message: 'Valid proposedAmount is required' });
        }
        const configuredDocuments = Array.isArray(tender.requiredDocuments) && tender.requiredDocuments.length > 0
            ? tender.requiredDocuments
            : buildRequiredDocumentsFromQcbs(tender.qcbsConfig);
        const requiredDocuments = ensureEligibilityProof(configuredDocuments);
        const submittedDocuments = Array.isArray(req.body.documents) ? req.body.documents : [];

        const documentsByLabel = new Map(
            submittedDocuments.map((item) => [String(item?.label || '').trim(), item?.document])
        );

        // Only Eligibility Proof and Commercial docs are mandatory for submission
        const mandatoryDocs = requiredDocuments.filter((d) =>
            d.category === 'Commercial' || String(d.label || '').trim().toLowerCase() === 'eligibility proof'
        );

        const missingMandatory = mandatoryDocs.filter((doc) => !documentsByLabel.get(doc.label));
        if (missingMandatory.length > 0) {
            return res.status(400).json({
                message: `Missing required documents: ${missingMandatory.map((doc) => doc.label).join(', ')}`,
            });
        }

        const vendor = await User.findById(req.user.id);
        if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

        const bidDocuments = [];
        const embeddingQueueDocuments = [];
        let commercialDocumentId = null;
        let commercialDocumentReference = '';

        // Process only the documents that were actually submitted. Technical docs are optional.
        for (const submitted of submittedDocuments) {
            const label = String(submitted?.label || '').trim();
            const rawDocument = submitted?.document;
            if (!label || !rawDocument) continue;

            const docMeta = requiredDocuments.find((d) => d.label === label) || { label, category: 'Technical' };

            const decoded = decodeStoredDocument(rawDocument, label);
            if (!decoded.content) {
                return res.status(400).json({ message: `Document content is invalid for ${label}` });
            }

            const storedBidDocument = await BidDocument.create({
                tenderId: tender._id,
                vendorId: req.user.id,
                name: decoded.name || label,
                content: decoded.content,
                mimeType: decoded.mimeType,
            });

            const documentUrl = buildBidDocumentAccessUrl(req, tender._id, storedBidDocument._id);
            const documentReference = buildProposalDocumentReference({
                name: decoded.name || label,
                contentUrl: documentUrl,
                mimeType: decoded.mimeType,
            });

            bidDocuments.push({
                label: docMeta.label,
                category: docMeta.category,
                documentId: storedBidDocument._id,
                document: documentReference,
            });
            embeddingQueueDocuments.push({
                documentId: storedBidDocument._id,
                label: docMeta.label,
                name: decoded.name || label,
                document: decoded.content,
                mimeType: decoded.mimeType,
            });

            if (docMeta.category === 'Commercial' && !commercialDocumentReference) {
                commercialDocumentId = storedBidDocument._id;
                commercialDocumentReference = documentReference;
            }
        }

        if (!commercialDocumentReference) {
            return res.status(400).json({ message: 'Commercial bid document is required' });
        }

        tender.bids.push({
            vendorId: req.user.id,
            vendorName: vendor.name,
            proposedAmount: req.body.proposedAmount,
            bidDocuments,
            proposalDocumentId: commercialDocumentId,
            proposalDocument: commercialDocumentReference,
        });

        try {
            await tender.save();
        } catch (saveError) {
            await Promise.all(
                bidDocuments.map((doc) =>
                    BidDocument.findByIdAndDelete(doc.documentId).catch(() => {
                        // Ignore cleanup errors; keep original save error response.
                    })
                )
            );
            throw saveError;
        }

        queueBidDocumentEmbeddings({
            tenderId: tender._id,
            bidId: tender.bids[tender.bids.length - 1]?._id,
            vendorId: req.user.id,
            documents: embeddingQueueDocuments,
            proposalDocument: commercialDocumentId
                ? {
                    documentId: commercialDocumentId,
                    label: 'Commercial Bid Document',
                    name: embeddingQueueDocuments.find((item) => String(item.documentId) === String(commercialDocumentId))?.name || 'Commercial Bid Document',
                    document: embeddingQueueDocuments.find((item) => String(item.documentId) === String(commercialDocumentId))?.document || '',
                    mimeType: embeddingQueueDocuments.find((item) => String(item.documentId) === String(commercialDocumentId))?.mimeType,
                }
                : null,
        }).catch((error) => {
            console.error('Bid document embedding queue failed:', error.message || error);
        });

        scheduleTenderAiScoring(tender._id);

        void recordResearchMetric({
            eventType: 'bid-submission',
            actorId: req.user.id,
            actorRole: 'Vendor',
            actorName: vendor.name,
            tenderId: tender._id,
            bidId: tender.bids[tender.bids.length - 1]?._id,
            durationMs: Date.now() - startedAt,
            status: 'success',
            metricName: 'bid_submission_time',
            value: 1,
            note: 'Bid submitted successfully',
            metadata: {
                documentsSubmitted: submittedDocuments.length,
                mandatoryDocuments: mandatoryDocs.length,
            },
        });

        res.status(201).json({ message: 'Bid submitted' });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// A vendor may remove only their own unselected submission before award.
export const withdrawBid = async (req, res) => {
    try {
        const tender = await Tender.findById(req.params.id);
        if (!tender) return res.status(404).json({ message: 'Tender not found' });
        if (!['Published', 'Closed'].includes(tender.status)) {
            return res.status(400).json({ message: 'A submission cannot be withdrawn after the tender has been awarded' });
        }
        const bid = tender.bids.id(req.params.bidId);
        if (!bid) return res.status(404).json({ message: 'Bid not found' });
        if (String(bid.vendorId) !== String(req.user.id)) {
            return res.status(403).json({ message: 'You can withdraw only your own submission' });
        }
        if (bid.status === 'Selected') {
            return res.status(400).json({ message: 'A selected submission cannot be withdrawn' });
        }

        const documentIds = [
            ...(Array.isArray(bid.bidDocuments) ? bid.bidDocuments.map((item) => item?.documentId) : []),
            bid.proposalDocumentId,
        ].filter(Boolean).map((id) => String(id));
        const sourceKeys = documentIds.map((id) => `bid-document:${id}`);

        // Remove the embedded bid first so it immediately disappears from PO/AI reads.
        tender.bids.pull(bid._id);
        await tender.save();

        await Promise.all([
            documentIds.length
                ? BidDocument.deleteMany({ _id: { $in: documentIds }, tenderId: tender._id, vendorId: req.user.id })
                : Promise.resolve(),
            DocumentEmbeddingJob.deleteMany({
                $or: [{ bidId: bid._id }, ...(sourceKeys.length ? [{ sourceKey: { $in: sourceKeys } }] : [])],
            }),
            DocumentChunk.deleteMany({
                $or: [{ bidId: bid._id }, ...(sourceKeys.length ? [{ sourceKey: { $in: sourceKeys } }] : [])],
            }),
            AIBidSummary.deleteMany({ tenderId: tender._id, bidId: bid._id }),
            ResearchMetricEvent.deleteMany({ tenderId: tender._id, bidId: bid._id }),
        ]);

        return res.json({ message: 'Submission and its uploaded documents were withdrawn and deleted' });
    } catch (error) {
        return res.status(500).json({ message: error.message || 'Failed to withdraw submission' });
    }
};

export const getBidsByTender = async (req, res) => {
    try {
        const tender = await Tender.findById(req.params.id)
            .select('-documents')
            .populate(
            'bids.vendorId',
            'name email phone department specialization accountStatus'
        );
        if (!tender) return res.status(404).json({ message: 'Tender not found' });

        // If user is Committee, check if tender is created by their assigned PO
        if (req.user?.role === 'Committee') {
            const user = await User.findById(req.user.id).select('managerPo');
            if (!user?.managerPo || String(tender.createdBy) !== String(user.managerPo)) {
                return res.status(403).json({ message: 'Forbidden: You can only view bids from tenders created by your procurement officer' });
            }
        }

        if (!tender.bids || tender.bids.length === 0) {
            return res.json([]);
        }

        const enrichedBids = await enrichBidDocumentReferences(req, tender._id, tender.bids || []);
        const mappedBids = enrichedBids.map(mapBidWithVendorDetails);
        res.json(mappedBids);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// --- MANUAL EVALUATION ---
export const evaluateBid = async (req, res) => {
     const startedAt = Date.now();
     try {
        const tender = await Tender.findById(req.params.tenderId);
        if (!tender) return res.status(404).json({ message: 'Tender not found' });

        if (tender.status === 'Awarded' || tender.status === 'Completed') {
            return res.status(400).json({ message: 'Tender is finalized and cannot be edited' });
        }

        const bid = tender.bids.id(req.params.bidId); // Mongoose specific syntax to find subdocument
        if (!bid) return res.status(404).json({ message: 'Bid not found' });

        if (bid.status !== 'Pending' && bid.status !== 'Evaluated') {
            return res.status(400).json({ message: 'Bid is not in evaluatable state' });
        }

        const eligibilityChecked = req.body.eligibilityChecked !== false;
        const evaluationMethod = tender.evaluationMethod || 'QCBS';

        if (eligibilityChecked) {
            if (typeof req.body.technicalScore !== 'number') {
                return res.status(400).json({ message: 'technicalScore must be a number' });
            }

            if (evaluationMethod !== 'L1' && typeof req.body.financialScore !== 'number') {
                return res.status(400).json({ message: 'financialScore must be a number' });
            }
        }

        if (!Array.isArray(bid.committeeEvaluations)) {
            bid.committeeEvaluations = [];
        }

        const existingEvaluation = bid.committeeEvaluations.find(
            (evaluation) => evaluation.committeeMemberId?.toString() === req.user.id
        );

        const technicalScoreValue = eligibilityChecked ? Number(req.body.technicalScore || 0) : 0;
        const financialScoreValue = eligibilityChecked
            ? (evaluationMethod === 'L1' ? Number(bid.proposedAmount || 0) : Number(req.body.financialScore || 0))
            : 0;
        const criteriaScores = Array.isArray(req.body.criteriaScores)
            ? req.body.criteriaScores
                .map((item) => ({
                    criterion: String(item?.criterion || item?.documentLabel || '').trim(),
                    maxMarks: Number(item?.maxMarks || 0),
                    awardedMarks: Number(item?.awardedMarks || 0),
                    documentLabel: String(item?.documentLabel || item?.criterion || '').trim(),
                }))
                .filter((item) => item.criterion)
            : [];

        if (existingEvaluation) {
            existingEvaluation.technicalScore = technicalScoreValue;
            existingEvaluation.financialScore = financialScoreValue;
            existingEvaluation.eligibilityChecked = eligibilityChecked;
            existingEvaluation.criteriaScores = criteriaScores;
            existingEvaluation.comments = req.body.comments || '';
            existingEvaluation.evaluatedDate = new Date();
        } else {
            bid.committeeEvaluations.push({
                committeeMemberId: req.user.id,
                technicalScore: technicalScoreValue,
                financialScore: financialScoreValue,
                eligibilityChecked,
                criteriaScores,
                comments: req.body.comments || '',
                evaluatedDate: new Date(),
            });
        }

        const hasIneligibleEvaluation = bid.committeeEvaluations.some(
            (evaluation) => evaluation.eligibilityChecked === false
        );
        if (hasIneligibleEvaluation) {
            bid.technicalScore = 0;
            bid.financialScore = 0;
            bid.comments = req.body.comments || '';
            bid.status = 'Rejected';
            bid.evaluatedBy = req.user.id;
            bid.evaluatedDate = new Date();

            await tender.save();
            void recordResearchMetric({
                eventType: 'committee-evaluation',
                actorId: req.user.id,
                actorRole: 'Committee',
                tenderId: tender._id,
                bidId: bid._id,
                durationMs: Date.now() - startedAt,
                status: 'warning',
                metricName: 'committee_evaluation_time',
                value: 1,
                note: 'Bid marked ineligible by committee',
                metadata: {
                    committeeEvaluations: bid.committeeEvaluations.length,
                    eligibilityChecked: false,
                },
            });
            return res.json({ message: 'Bid marked ineligible', bid });
        }

        const evaluationCount = bid.committeeEvaluations.length || 1;
        const technicalTotal = bid.committeeEvaluations.reduce(
            (sum, evaluation) => sum + Number(evaluation.technicalScore || 0),
            0
        );
        const financialTotal = bid.committeeEvaluations.reduce(
            (sum, evaluation) => sum + Number(evaluation.financialScore || 0),
            0
        );

        bid.technicalScore = Number((technicalTotal / evaluationCount).toFixed(2));
        bid.financialScore = Number((financialTotal / evaluationCount).toFixed(2));
        bid.comments = req.body.comments || '';
        bid.status = 'Evaluated';
        bid.evaluatedBy = req.user.id;
        bid.evaluatedDate = new Date();

        await tender.save();
        void recordResearchMetric({
            eventType: 'committee-evaluation',
            actorId: req.user.id,
            actorRole: 'Committee',
            tenderId: tender._id,
            bidId: bid._id,
            durationMs: Date.now() - startedAt,
            status: 'success',
            metricName: 'committee_evaluation_time',
            value: 1,
            note: 'Committee completed bid evaluation',
            metadata: {
                committeeEvaluations: bid.committeeEvaluations.length,
                averageTechnicalScore: bid.technicalScore,
                averageFinancialScore: bid.financialScore,
                eligibilityChecked,
            },
        });
        res.json({ message: 'Bid evaluated', bid });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// --- BID COMPARISON & AWARD ---
export const getEvaluatedBids = async (req, res) => {
   try {
        const tender = await Tender.findById(req.params.id);
        if (!tender) return res.status(404).json({ message: 'Tender not found' });
        const evaluatedBids = tender.bids.filter(
            (b) => b.status === 'Evaluated' || b.status === 'Selected' || b.status === 'Rejected'
        );

        const evaluationMethod = tender.evaluationMethod || 'QCBS';

        if (evaluationMethod === 'L1') {
            const technicalCutoff = Number(tender.l1Config?.technicalCutoff || 0);
            const withScore = evaluatedBids.map((bid) => {
                const evaluatedPrice = Number(bid.proposedAmount || bid.financialScore || 0);
                const technicalScore = Number(bid.technicalScore || 0);
                const isQualified = bid.status !== 'Rejected' && technicalScore >= technicalCutoff;

                return {
                    ...(bid.toObject?.() || bid),
                    computedScore: Number(technicalScore.toFixed(2)),
                    evaluatedPrice,
                    technicalCutoff,
                    isQualified,
                };
            });

            const lowestQualifiedPrice = withScore
                .filter((bid) => bid.isQualified)
                .reduce((lowest, bid) => (lowest === null || bid.evaluatedPrice < lowest ? bid.evaluatedPrice : lowest), null);

            withScore.forEach((bid) => {
                bid.isLowestQualified = bid.isQualified && lowestQualifiedPrice !== null && bid.evaluatedPrice === lowestQualifiedPrice;
            });

            withScore.sort((a, b) => {
                if (a.isQualified !== b.isQualified) {
                    return a.isQualified ? -1 : 1;
                }
                if ((a.evaluatedPrice || 0) !== (b.evaluatedPrice || 0)) {
                    return (a.evaluatedPrice || 0) - (b.evaluatedPrice || 0);
                }
                return String(a._id || '').localeCompare(String(b._id || ''));
            });
            return res.json(withScore);
        }

        const technicalCriteria = tender.qcbsConfig?.technicalCriteria || [];
        const maxTechnical = technicalCriteria.reduce((sum, criterion) => sum + Number(criterion.maxMarks || 0), 0) || 0;
        const techWeight = Number(tender.qcbsConfig?.technicalWeight || 0);
        const commercialWeight = Number(tender.qcbsConfig?.commercialWeight || 0);

        const evaluatedPrices = evaluatedBids
            .map((bid) => Number(bid.financialScore || bid.proposedAmount || 0))
            .filter((value) => Number.isFinite(value) && value > 0);
        const lowestPrice = evaluatedPrices.length ? Math.min(...evaluatedPrices) : 0;

        const withScore = evaluatedBids.map((bid) => {
            const technicalScore = Number(bid.technicalScore || 0);
            const price = Number(bid.financialScore || bid.proposedAmount || 0);

            const technicalNormalized = maxTechnical > 0 ? (technicalScore / maxTechnical) * 100 : 0;
            const commercialNormalized = lowestPrice > 0 && price > 0 ? (lowestPrice / price) * 100 : 0;
            const computedScore = (technicalNormalized * (techWeight / 100)) + (commercialNormalized * (commercialWeight / 100));

            return {
                ...(bid.toObject?.() || bid),
                computedScore: Number(computedScore.toFixed(2)),
                evaluatedPrice: price,
            };
        });

        withScore.sort((a, b) => (b.computedScore || 0) - (a.computedScore || 0));
        res.json(withScore);
    } catch (e) { res.status(500).json({ error: e.message }); } 
};

export const selectWinner = async (req, res) => {
    try {
        const tender = await Tender.findById(req.params.tenderId);
        if (!tender) return res.status(404).json({ message: 'Tender not found' });
        
        const winningBid = tender.bids.id(req.params.bidId);
        if (!winningBid) return res.status(404).json({ message: 'Bid not found' });

        if (winningBid.status !== 'Evaluated') {
            return res.status(400).json({ message: 'Only evaluated bid can be selected as winner' });
        }

        if ((tender.evaluationMethod || 'QCBS') === 'L1') {
            const technicalCutoff = Number(tender.l1Config?.technicalCutoff || 0);
            const qualifiedBids = tender.bids.filter((bid) => {
                const technicalScore = Number(bid.technicalScore || 0);
                return bid.status === 'Evaluated' && technicalScore >= technicalCutoff;
            });

            if (!qualifiedBids.length) {
                return res.status(400).json({ message: 'No evaluated bids meet the L1 technical cutoff' });
            }

            const lowestQualifiedPrice = Math.min(...qualifiedBids.map((bid) => Number(bid.proposedAmount || bid.financialScore || 0)));
            const winningPrice = Number(winningBid.proposedAmount || winningBid.financialScore || 0);

            if (Number(winningBid.technicalScore || 0) < technicalCutoff) {
                return res.status(400).json({ message: 'Selected bid does not meet the L1 technical cutoff' });
            }

            if (winningPrice !== lowestQualifiedPrice) {
                return res.status(400).json({ message: 'Selected bid is not the lowest qualified commercial bid' });
            }
        }

        tender.status = 'Awarded';
        
        tender.bids.forEach(bid => {
            if(bid._id.toString() === req.params.bidId) {
                bid.status = 'Selected';
            } else {
                bid.status = 'Rejected';
            }
        });

        await tender.save();

        // Convert draft milestones from tender to contract milestones
        const contractMilestones = (tender.draftMilestones || []).map(dm => ({
            title: dm.title,
            description: dm.description || '',
            plannedStartDate: dm.plannedStartDate,
            plannedEndDate: dm.plannedEndDate,
            status: 'Not Started',
            progress: 0,
            checklist: (dm.checklistItems || []).map(item => ({ label: item, checked: false })),
            remarks: '',
            documents: [],
            images: []
        }));

        // Calculate timeline dates from milestones
        let timelineStartDate = null;
        let timelineEndDate = null;
        
        if (contractMilestones.length > 0) {
            const startDates = contractMilestones.map(m => new Date(m.plannedStartDate)).sort((a, b) => a - b);
            const endDates = contractMilestones.map(m => new Date(m.plannedEndDate)).sort((a, b) => b - a);
            timelineStartDate = startDates[0];
            timelineEndDate = endDates[0];
        }

        const contract = await Contract.create({
            tenderId: tender._id,
            vendorId: winningBid.vendorId,
            status: 'Awarded',
            milestones: contractMilestones,
            timelineDefined: contractMilestones.length > 0,
            timelineStartDate,
            timelineEndDate
        });

        res.json({ message: 'Winner selected and contract created', tenderId: tender._id, contractId: contract._id });
    } catch (e) { res.status(500).json({ error: e.message }); }
};
