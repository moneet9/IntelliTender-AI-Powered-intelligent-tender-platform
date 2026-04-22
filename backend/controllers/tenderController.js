import { Tender, Contract, User, BidDocument } from '../models/model.js';

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

const buildProposalDocumentReference = ({ name, contentUrl, mimeType }) => JSON.stringify({
    name: name || 'Proposal document',
    content: contentUrl,
    mimeType,
});

const enrichBidDocumentReferences = async (req, tenderId, bids) => {
    const plainBids = Array.isArray(bids)
        ? bids.map((bid) => (bid && typeof bid.toObject === 'function' ? bid.toObject() : bid))
        : [];

    if (!plainBids.length) return plainBids;

    const resolvedDocumentIdsByIndex = new Map();
    const uniqueDocumentIds = new Set();

    plainBids.forEach((bid, index) => {
        const documentId = resolveBidDocumentId(bid);
        if (!documentId) return;

        resolvedDocumentIdsByIndex.set(index, documentId);
        uniqueDocumentIds.add(documentId);
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
        if (!resolvedDocumentId) return bid;

        const document = documentsById.get(resolvedDocumentId);
        if (!document) return bid;

        const contentUrl = buildBidDocumentAccessUrl(req, tenderId, resolvedDocumentId);
        const decodedProposal = decodeStoredDocument(
            typeof bid.proposalDocument === 'string' ? bid.proposalDocument : '',
            'Proposal document'
        );

        return {
            ...bid,
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
        proposalDocumentId: bid.proposalDocumentId,
        proposalDocument: bid.proposalDocument,
        status: bid.status,
        committeeEvaluations: committeeEvaluations.map((evaluation) => ({
            committeeMemberId: evaluation.committeeMemberId,
            technicalScore: evaluation.technicalScore,
            financialScore: evaluation.financialScore,
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
        const { title, description, category, budget, deadline, documents, milestones } = req.body;
        const tender = await Tender.create({
            title,
            description,
            category: category || 'General',
            budget,
            deadline,
            status: 'Published',
            documents: Array.isArray(documents) ? documents : [],
            draftMilestones: Array.isArray(milestones) && milestones.length > 0 ? milestones : [],
            createdBy: req.user.id
        });
        res.status(201).json(tender);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

export const getTenders = async (req, res) => {
    try {
        const tenders = await Tender.find().populate('createdBy', 'name').lean();
        const minimized = await Promise.all(
            tenders.map(async (tender) => ({
                ...tender,
                documents: Array.isArray(tender.documents)
                    ? tender.documents.map((document, index) => toLazyDocumentReference(document, tender._id, index))
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
        const bidDocument = await BidDocument.findOne({
            _id: req.params.documentId,
            tenderId: req.params.id,
        }).select('name content mimeType');

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
        res.json(tender);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

export const editTender = async (req, res) => {
     try {
        const tender = await Tender.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json(tender);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

export const publishTender = async (req, res) => {
     try {
        const tender = await Tender.findById(req.params.id);
        if (!tender) return res.status(404).json({ message: 'Tender not found' });
        if (tender.status !== 'Draft') return res.status(400).json({ message: 'Only draft tender can be published' });
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
    try {
        const tender = await Tender.findById(req.params.id);
        if (!tender) return res.status(404).json({ message: 'Tender not found' });
        if (tender.status !== 'Published') return res.status(400).json({ message: 'Tender is not published' });
        if (new Date() > new Date(tender.deadline)) return res.status(400).json({ message: 'Deadline passed' });

        const existingBid = tender.bids.find(b => b.vendorId.toString() === req.user.id);
        if(existingBid) return res.status(400).json({ message: 'Already bid on this tender' });

        if (!req.body.proposedAmount || Number(req.body.proposedAmount) <= 0) {
            return res.status(400).json({ message: 'Valid proposedAmount is required' });
        }

        if (!req.body.proposalDocument || typeof req.body.proposalDocument !== 'string') {
            return res.status(400).json({ message: 'Proposal document upload is required' });
        }

        const vendor = await User.findById(req.user.id);
        if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

        const decodedProposal = decodeStoredDocument(req.body.proposalDocument, 'Proposal document');
        if (!decodedProposal.content) {
            return res.status(400).json({ message: 'Proposal document content is invalid' });
        }

        const storedBidDocument = await BidDocument.create({
            tenderId: tender._id,
            vendorId: req.user.id,
            name: decodedProposal.name || 'Proposal document',
            content: decodedProposal.content,
            mimeType: decodedProposal.mimeType,
        });

        const proposalDocumentUrl = buildBidDocumentAccessUrl(req, tender._id, storedBidDocument._id);
        const proposalDocumentReference = buildProposalDocumentReference({
            name: decodedProposal.name || 'Proposal document',
            contentUrl: proposalDocumentUrl,
            mimeType: decodedProposal.mimeType,
        });

        tender.bids.push({
            vendorId: req.user.id,
            vendorName: vendor.name,
            proposedAmount: req.body.proposedAmount,
            proposalDocumentId: storedBidDocument._id,
            proposalDocument: proposalDocumentReference
        });

        try {
            await tender.save();
        } catch (saveError) {
            await BidDocument.findByIdAndDelete(storedBidDocument._id).catch(() => {
                // Ignore cleanup errors; keep original save error response.
            });
            throw saveError;
        }

        res.status(201).json({ message: 'Bid submitted' });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

export const getBidsByTender = async (req, res) => {
    try {
        const tender = await Tender.findById(req.params.id).populate(
            'bids.vendorId',
            'name email phone department specialization accountStatus'
        );
        if (!tender) return res.status(404).json({ message: 'Tender not found' });

        const enrichedBids = await enrichBidDocumentReferences(req, tender._id, tender.bids || []);
        res.json(enrichedBids.map(mapBidWithVendorDetails));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// --- MANUAL EVALUATION ---
export const evaluateBid = async (req, res) => {
     try {
        const tender = await Tender.findById(req.params.tenderId);
        if (!tender) return res.status(404).json({ message: 'Tender not found' });

        const bid = tender.bids.id(req.params.bidId); // Mongoose specific syntax to find subdocument
        if (!bid) return res.status(404).json({ message: 'Bid not found' });

        if (bid.status !== 'Pending' && bid.status !== 'Evaluated') {
            return res.status(400).json({ message: 'Bid is not in evaluatable state' });
        }

        if (typeof req.body.technicalScore !== 'number' || typeof req.body.financialScore !== 'number') {
            return res.status(400).json({ message: 'technicalScore and financialScore must be numbers' });
        }

        if (!Array.isArray(bid.committeeEvaluations)) {
            bid.committeeEvaluations = [];
        }

        const existingEvaluation = bid.committeeEvaluations.find(
            (evaluation) => evaluation.committeeMemberId?.toString() === req.user.id
        );

        if (existingEvaluation) {
            existingEvaluation.technicalScore = req.body.technicalScore;
            existingEvaluation.financialScore = req.body.financialScore;
            existingEvaluation.comments = req.body.comments || '';
            existingEvaluation.evaluatedDate = new Date();
        } else {
            bid.committeeEvaluations.push({
                committeeMemberId: req.user.id,
                technicalScore: req.body.technicalScore,
                financialScore: req.body.financialScore,
                comments: req.body.comments || '',
                evaluatedDate: new Date(),
            });
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
        res.json({ message: 'Bid evaluated', bid });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// --- BID COMPARISON & AWARD ---
export const getEvaluatedBids = async (req, res) => {
   try {
        const tender = await Tender.findById(req.params.id);
        if (!tender) return res.status(404).json({ message: 'Tender not found' });
        const evaluatedBids = tender.bids.filter(b => b.status === 'Evaluated' || b.status === 'Selected' || b.status === 'Rejected');
        
        // Example: Sort by score descending then amount ascending
        evaluatedBids.sort((a,b) => (b.technicalScore||0) - (a.technicalScore||0) || a.proposedAmount - b.proposedAmount);

        res.json(evaluatedBids);
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