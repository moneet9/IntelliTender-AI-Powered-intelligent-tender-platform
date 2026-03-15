import { Contract, Tender } from '../models/model.js';

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
            .populate('tenderId', 'title description category budget deadline documents')
            .populate('vendorId', 'name email phone department specialization accountStatus')
            .populate('milestones.verifiedBy', 'name role')
            .populate('milestones.history.updatedBy', 'name role')
            .populate('progressReports.reportedBy', 'name role')
            .sort({ createdAt: -1 });
        res.json(contracts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const getContractById = async (req, res) => {
    try {
        const contract = await Contract.findById(req.params.id)
            .populate('tenderId', 'title description category budget deadline documents')
            .populate('vendorId', 'name email phone department specialization accountStatus')
            .populate('milestones.verifiedBy', 'name role')
            .populate('milestones.history.updatedBy', 'name role')
            .populate('progressReports.reportedBy', 'name role');

        if (!contract) return res.status(404).json({ message: 'Contract not found' });

        if (req.user?.role === 'Vendor' && String(contract.vendorId?._id || contract.vendorId) !== String(req.user.id)) {
            return res.status(403).json({ message: 'Forbidden: Insufficient privileges' });
        }

        res.json(contract);
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
            milestone.documents = Array.isArray(documents) ? documents : [];
        }

        if (images !== undefined) {
            milestone.images = Array.isArray(images) ? images : [];
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

        const report = {
            milestoneId: milestoneId || undefined,
            milestoneTitle: resolvedMilestoneTitle || undefined,
            completionDate: toDateOrNull(completionDate) || undefined,
            description: description || '',
            observations: observations || '',
            attachments: Array.isArray(attachments) ? attachments : [],
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
