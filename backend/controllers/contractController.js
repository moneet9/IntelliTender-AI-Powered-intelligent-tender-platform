import { Contract, Tender, MilestoneAsset } from '../models/model.js';

const MILESTONE_STATUSES = ['Not Started', 'In Progress', 'Completed', 'Delayed'];

const toDateOrNull = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeChecklist = (input = []) => {
    if (Array.isArray(input)) {
        return input
            .filter((item) => item && typeof item.label === 'string' && item.label.trim())
            .map((item) => ({ label: item.label.trim(), checked: Boolean(item.checked) }));
    }
    return [];
};

const objectIdRegex = /^[a-fA-F0-9]{24}$/;

const sanitizeFileName = (value, fallback = 'document') => {
    const normalized = typeof value === 'string' && value.trim() ? value.trim() : fallback;
    return normalized.replace(/[^a-zA-Z0-9._-]/g, '_');
};

const looksLikeBase64Content = (value) => {
    if (typeof value !== 'string') return false;

    const normalized = value.trim().replace(/\s+/g, '');
    if (!normalized || normalized.length < 16 || normalized.length % 4 !== 0) {
        return false;
    }

    return /^[A-Za-z0-9+/=]+$/.test(normalized);
};

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
        name: fallbackName,
        content: value,
        mimeType: undefined,
    };
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

const buildContractAssetAccessUrl = (req, contractId, assetId) => {
    const forwardedProto = typeof req.headers['x-forwarded-proto'] === 'string'
        ? req.headers['x-forwarded-proto'].split(',')[0].trim()
        : '';
    const protocol = forwardedProto || req.protocol || 'http';

    return `${protocol}://${req.get('host')}/api/contracts/${contractId}/assets/${assetId}`;
};

const buildAssetReference = ({ name, contentUrl, mimeType }) => JSON.stringify({
    name: name || 'Attachment',
    content: contentUrl,
    mimeType,
});

const resolveAssetIds = async ({
    values,
    contractId,
    milestoneId,
    uploadedBy,
    assetType,
    fallbackName,
}) => {
    if (!Array.isArray(values)) return [];

    const resolved = [];

    for (const value of values) {
        if (typeof value !== 'string' || !value.trim()) continue;

        const fromValue = extractObjectId(value);
        if (fromValue) {
            resolved.push(fromValue);
            continue;
        }

        const decoded = decodeStoredDocument(value, fallbackName);
        const fromDecodedContent = extractObjectId(decoded.content);
        if (fromDecodedContent) {
            resolved.push(fromDecodedContent);
            continue;
        }

        if (!decoded.content) continue;

        const storedAsset = await MilestoneAsset.create({
            contractId,
            milestoneId,
            uploadedBy,
            assetType,
            name: decoded.name || fallbackName,
            content: decoded.content,
            mimeType: decoded.mimeType,
        });

        resolved.push(String(storedAsset._id));
    }

    return resolved;
};

const enrichContractAssetReferences = async (req, contractDoc) => {
    const contract = contractDoc && typeof contractDoc.toObject === 'function'
        ? contractDoc.toObject()
        : contractDoc;

    if (!contract || !contract._id) return contract;

    const assetIds = new Set();
    const milestones = Array.isArray(contract.milestones) ? contract.milestones : [];
    const progressReports = Array.isArray(contract.progressReports) ? contract.progressReports : [];

    milestones.forEach((milestone) => {
        (Array.isArray(milestone.documents) ? milestone.documents : []).forEach((value) => {
            const id = extractObjectId(String(value || ''));
            if (id) assetIds.add(id);
        });
        (Array.isArray(milestone.images) ? milestone.images : []).forEach((value) => {
            const id = extractObjectId(String(value || ''));
            if (id) assetIds.add(id);
        });
    });

    progressReports.forEach((report) => {
        (Array.isArray(report.attachments) ? report.attachments : []).forEach((value) => {
            const id = extractObjectId(String(value || ''));
            if (id) assetIds.add(id);
        });
    });

    if (!assetIds.size) return contract;

    const assets = await MilestoneAsset.find({
        _id: { $in: Array.from(assetIds) },
        contractId: contract._id,
    }).select('_id name mimeType').lean();

    const assetsById = new Map(assets.map((asset) => [String(asset._id), asset]));
    const toReference = (value) => {
        const id = extractObjectId(String(value || ''));
        if (!id) return value;

        const asset = assetsById.get(id);
        if (!asset) return value;

        return buildAssetReference({
            name: asset.name,
            contentUrl: buildContractAssetAccessUrl(req, contract._id, id),
            mimeType: asset.mimeType,
        });
    };

    contract.milestones = milestones.map((milestone) => ({
        ...milestone,
        documents: (Array.isArray(milestone.documents) ? milestone.documents : []).map(toReference),
        images: (Array.isArray(milestone.images) ? milestone.images : []).map(toReference),
    }));

    contract.progressReports = progressReports.map((report) => ({
        ...report,
        attachments: (Array.isArray(report.attachments) ? report.attachments : []).map(toReference),
    }));

    return contract;
};

const createDelayAnalysis = (contract) => {
    const now = new Date();
    const delayedMilestones = [];

    (contract.milestones || []).forEach((milestone) => {
        const plannedEnd = milestone.plannedEndDate ? new Date(milestone.plannedEndDate) : null;
        if (!plannedEnd) return;

        const isCompleted = milestone.status === 'Completed';
        const baselineDate = isCompleted && milestone.actualEndDate ? new Date(milestone.actualEndDate) : now;
        const delayMs = baselineDate.getTime() - plannedEnd.getTime();

        if (delayMs > 0) {
            delayedMilestones.push({
                milestoneId: milestone._id,
                title: milestone.title,
                plannedEndDate: milestone.plannedEndDate,
                status: milestone.status,
                delayedDays: Math.ceil(delayMs / (1000 * 60 * 60 * 24)),
            });
        }
    });

    const timelineEndDate = contract.timelineEndDate ? new Date(contract.timelineEndDate) : null;
    const contractDelayMs = timelineEndDate ? now.getTime() - timelineEndDate.getTime() : 0;
    const contractDelayed = Boolean(timelineEndDate && contract.status !== 'Completed' && contractDelayMs > 0);

    return {
        delayedMilestones,
        totalDelayedMilestones: delayedMilestones.length,
        overallDelayedDays: delayedMilestones.reduce((sum, item) => sum + item.delayedDays, 0),
        contractDelayed,
        contractDelayDays: contractDelayed ? Math.ceil(contractDelayMs / (1000 * 60 * 60 * 24)) : 0,
    };
};

export const getContracts = async (req, res) => {
    try {
        const filter = req.user?.role === 'Vendor' ? { vendorId: req.user.id } : {};
        const contracts = await Contract.find(filter)
            .populate('tenderId', 'title description category budget preBidDate finalSubmissionDate documents')
            .populate('vendorId', 'name email phone department specialization accountStatus')
            .populate('milestones.verifiedBy', 'name role')
            .populate('milestones.history.updatedBy', 'name role')
            .populate('progressReports.reportedBy', 'name role')
            .sort({ createdAt: -1 });

        const enrichedContracts = await Promise.all(
            contracts.map((contract) => enrichContractAssetReferences(req, contract))
        );
        res.json(enrichedContracts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const getContractById = async (req, res) => {
    try {
        const contract = await Contract.findById(req.params.id)
            .populate('tenderId', 'title description category budget preBidDate finalSubmissionDate documents')
            .populate('vendorId', 'name email phone department specialization accountStatus')
            .populate('milestones.verifiedBy', 'name role')
            .populate('milestones.history.updatedBy', 'name role')
            .populate('progressReports.reportedBy', 'name role');

        if (!contract) return res.status(404).json({ message: 'Contract not found' });

        if (req.user?.role === 'Vendor' && String(contract.vendorId?._id || contract.vendorId) !== String(req.user.id)) {
            return res.status(403).json({ message: 'Forbidden: Insufficient privileges' });
        }

        const enrichedContract = await enrichContractAssetReferences(req, contract);
        res.json(enrichedContract);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const updateContractStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!['Awarded', 'Signed', 'Completed', 'Cancelled'].includes(status)) {
            return res.status(400).json({ message: 'Invalid contract status' });
        }

        const contract = await Contract.findById(req.params.id);

        if (!contract) return res.status(404).json({ message: 'Contract not found' });

        if (status === 'Completed') {
            if (!contract.timelineDefined || !contract.milestones.length) {
                return res.status(400).json({
                    message: 'Define the contract timeline before declaring completion',
                });
            }

            const incompleteMilestones = contract.milestones.filter(
                (milestone) => milestone.status !== 'Completed'
            );

            if (incompleteMilestones.length) {
                return res.status(400).json({
                    message: 'All milestones must be completed before declaring the contract complete',
                });
            }
        }

        contract.status = status;
        await contract.save();

        // Sync tender status to reflect contract state
        if (contract.tenderId) {
            const tenderStatus = status === 'Completed' ? 'Completed' : status === 'Cancelled' ? 'Closed' : null;
            if (tenderStatus) {
                await Tender.findByIdAndUpdate(contract.tenderId, { status: tenderStatus });
            }
        }

        res.json(contract);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const defineContractTimeline = async (req, res) => {
    try {
        const { timelineStartDate, timelineEndDate, milestones } = req.body;

        const startDate = toDateOrNull(timelineStartDate);
        const endDate = toDateOrNull(timelineEndDate);

        if (!startDate || !endDate || startDate > endDate) {
            return res.status(400).json({ message: 'Valid timelineStartDate and timelineEndDate are required' });
        }

        if (!Array.isArray(milestones) || !milestones.length) {
            return res.status(400).json({ message: 'At least one milestone is required' });
        }

        const mappedMilestones = [];
        for (const milestone of milestones) {
            const milestoneStart = toDateOrNull(milestone.plannedStartDate);
            const milestoneEnd = toDateOrNull(milestone.plannedEndDate);

            if (!milestone.title || !milestoneStart || !milestoneEnd || milestoneStart > milestoneEnd) {
                return res.status(400).json({
                    message: 'Each milestone requires title, plannedStartDate, and plannedEndDate',
                });
            }

            const initialChecklist = Array.isArray(milestone.checklistItems) && milestone.checklistItems.length
                ? milestone.checklistItems.filter((s) => s && String(s).trim()).map((s) => ({ label: String(s).trim(), checked: false }))
                : normalizeChecklist(milestone.checklist || []);

            mappedMilestones.push({
                title: milestone.title,
                description: milestone.description || '',
                plannedStartDate: milestoneStart,
                plannedEndDate: milestoneEnd,
                assignedTo: milestone.assignedTo || '',
                status: 'Not Started',
                progress: 0,
                checklist: initialChecklist,
                documents: Array.isArray(milestone.documents) ? milestone.documents : [],
                images: Array.isArray(milestone.images) ? milestone.images : [],
                remarks: milestone.remarks || '',
            });
        }

        const contract = await Contract.findById(req.params.id);
        if (!contract) return res.status(404).json({ message: 'Contract not found' });

        contract.timelineStartDate = startDate;
        contract.timelineEndDate = endDate;
        contract.timelineDefined = true;
        contract.milestones = mappedMilestones;
        await contract.save();

        res.json({ message: 'Contract timeline defined', contract });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const updateMilestone = async (req, res) => {
    try {
        const contract = await Contract.findById(req.params.id);
        if (!contract) return res.status(404).json({ message: 'Contract not found' });

        const milestone = contract.milestones.id(req.params.milestoneId);
        if (!milestone) return res.status(404).json({ message: 'Milestone not found' });

        const {
            status,
            progress,
            assignedTo,
            actualStartDate,
            actualEndDate,
            checklist,
            remarks,
            documents,
            images,
        } = req.body;

        if (status !== undefined) {
            if (!MILESTONE_STATUSES.includes(status)) {
                return res.status(400).json({ message: 'Invalid milestone status' });
            }
            milestone.status = status;
        }

        if (progress !== undefined) {
            if (typeof progress !== 'number' || progress < 0 || progress > 100) {
                return res.status(400).json({ message: 'progress must be a number between 0 and 100' });
            }
            milestone.progress = progress;

            if (progress > 0 && progress < 100 && milestone.status === 'Not Started') {
                milestone.status = 'In Progress';
            }
        }

        if (assignedTo !== undefined) {
            milestone.assignedTo = assignedTo;
        }

        if (actualStartDate !== undefined) {
            const parsedActualStart = toDateOrNull(actualStartDate);
            if (actualStartDate && !parsedActualStart) {
                return res.status(400).json({ message: 'actualStartDate is invalid' });
            }
            milestone.actualStartDate = parsedActualStart;
        }

        if (actualEndDate !== undefined) {
            const parsedActualEnd = toDateOrNull(actualEndDate);
            if (actualEndDate && !parsedActualEnd) {
                return res.status(400).json({ message: 'actualEndDate is invalid' });
            }
            milestone.actualEndDate = parsedActualEnd;
        }

        if (checklist !== undefined) {
            milestone.checklist = normalizeChecklist(checklist);
        }

        if (remarks !== undefined) {
            milestone.remarks = remarks;
        }

        if (documents !== undefined) {
            milestone.documents = await resolveAssetIds({
                values: documents,
                contractId: contract._id,
                milestoneId: milestone._id,
                uploadedBy: req.user?.id,
                assetType: 'milestone-document',
                fallbackName: `${milestone.title || 'Milestone'} document`,
            });
        }

        if (images !== undefined) {
            milestone.images = await resolveAssetIds({
                values: images,
                contractId: contract._id,
                milestoneId: milestone._id,
                uploadedBy: req.user?.id,
                assetType: 'milestone-image',
                fallbackName: `${milestone.title || 'Milestone'} image`,
            });
        }

        if (milestone.progress === 100 && milestone.status !== 'Completed') {
            milestone.status = 'Completed';
        }

        if (milestone.status === 'Completed' && !milestone.actualEndDate) {
            milestone.actualEndDate = new Date();
        }

        if (['Committee', 'PO', 'CPO'].includes(req.user?.role || '')) {
            milestone.verifiedBy = req.user.id;
            milestone.verifiedAt = new Date();
        }

        // Append accountability history entry
        if (req.user?.id) {
            milestone.history.push({
                updatedBy: req.user.id,
                updatedAt: new Date(),
                status: milestone.status,
                progress: milestone.progress,
                remarks: milestone.remarks || '',
                checklistSnapshot: (milestone.checklist || []).map((item) => ({ label: item.label, checked: item.checked })),
            });
        }

        await contract.save();

        res.json({
            message: 'Milestone updated successfully',
            milestone,
            delayAnalysis: createDelayAnalysis(contract),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const submitProgressReport = async (req, res) => {
    try {
        const contract = await Contract.findById(req.params.id);
        if (!contract) return res.status(404).json({ message: 'Contract not found' });

        const {
            milestoneId,
            milestoneTitle,
            completionDate,
            description,
            observations,
            attachments,
            reportType,
        } = req.body;

        if (!description && !observations) {
            return res.status(400).json({ message: 'description or observations is required' });
        }

        let resolvedMilestoneTitle = milestoneTitle;
        if (milestoneId) {
            const milestone = contract.milestones.id(milestoneId);
            if (!milestone) return res.status(404).json({ message: 'Milestone not found' });
            resolvedMilestoneTitle = milestone.title;
        }

        const validReportType = ['Checklist', 'WorkProgress', 'General'].includes(reportType)
            ? reportType
            : 'General';

        const attachmentIds = await resolveAssetIds({
            values: attachments,
            contractId: contract._id,
            milestoneId: milestoneId || undefined,
            uploadedBy: req.user?.id,
            assetType: 'progress-report-attachment',
            fallbackName: `${resolvedMilestoneTitle || 'Progress report'} attachment`,
        });

        const report = {
            milestoneId: milestoneId || undefined,
            milestoneTitle: resolvedMilestoneTitle || undefined,
            completionDate: toDateOrNull(completionDate) || undefined,
            description: description || '',
            observations: observations || '',
            attachments: attachmentIds,
            reportType: validReportType,
            reportedBy: req.user.id,
        };

        contract.progressReports.push(report);
        await contract.save();

        const createdReport = contract.progressReports[contract.progressReports.length - 1];
        res.status(201).json({ message: 'Progress report submitted', report: createdReport });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const getContractDelayAnalysis = async (req, res) => {
    try {
        const contract = await Contract.findById(req.params.id);
        if (!contract) return res.status(404).json({ message: 'Contract not found' });

        res.json(createDelayAnalysis(contract));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const getContractAsset = async (req, res) => {
    try {
        const asset = await MilestoneAsset.findOne({
            _id: req.params.assetId,
            contractId: req.params.id,
        }).select('name content mimeType');

        if (!asset) {
            return res.status(404).json({ message: 'Asset not found' });
        }

        const content = typeof asset.content === 'string' ? asset.content : '';
        if (content.startsWith('http://') || content.startsWith('https://')) {
            return res.redirect(content);
        }

        const decoded = decodeStoredDocumentToBuffer(content, asset.mimeType);
        if (!decoded) {
            return res.status(404).json({ message: 'Asset content not found' });
        }

        res.setHeader('Content-Type', decoded.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${sanitizeFileName(asset.name, 'attachment')}"`);
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.setHeader('X-Content-Type-Options', 'nosniff');

        return res.send(decoded.buffer);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
};
