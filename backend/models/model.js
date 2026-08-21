import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['CPO', 'PO', 'Committee', 'Vendor'], required: true },
    phone: { type: String },
    department: { type: String },
    specialization: { type: String },
    designation: { type: String },
    managerPo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    accountStatus: { type: String, enum: ['Active', 'Frozen', 'Suspended', 'Deleted'], default: 'Active' },
    frozenUntil: { type: Date },
    passwordResetOtp: { type: String },
    passwordResetOtpExpiresAt: { type: Date },
    changePasswordOtp: { type: String },
    changePasswordOtpExpiresAt: { type: Date },
    pendingPasswordHash: { type: String },
}, { timestamps: true });

const committeeEvaluationSchema = new mongoose.Schema({
    committeeMemberId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    technicalScore: { type: Number, required: true },
    financialScore: { type: Number, required: true },
    eligibilityChecked: { type: Boolean, default: true },
    criteriaScores: {
        type: [{
            criterion: { type: String, required: true },
            maxMarks: { type: Number, default: 0 },
            awardedMarks: { type: Number, default: 0 },
            documentLabel: { type: String, default: '' },
        }],
        default: [],
    },
    comments: { type: String, default: '' },
    evaluatedDate: { type: Date, default: Date.now },
}, { _id: false });

const bidDocumentEntrySchema = new mongoose.Schema({
    label: { type: String, required: true },
    category: { type: String, enum: ['Technical', 'Commercial'], required: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'BidDocument' },
    document: { type: String },
}, { _id: false });

const bidSchema = new mongoose.Schema({
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    vendorName: { type: String },
    proposedAmount: { type: Number, required: true },
    bidDocuments: { type: [bidDocumentEntrySchema], default: [] },
    proposalDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: 'BidDocument' },
    proposalDocument: { type: String }, // Can be a URL, base64 string, or just mock string
    status: { type: String, enum: ['Pending', 'Evaluated', 'Selected', 'Rejected'], default: 'Pending' },
    committeeEvaluations: { type: [committeeEvaluationSchema], default: [] },
    technicalScore: { type: Number },
    financialScore: { type: Number },
    comments: { type: String },
    evaluatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    evaluatedDate: { type: Date }
}, { timestamps: true });

const qcbsCriterionSchema = new mongoose.Schema({
    name: { type: String, required: true },
    maxMarks: { type: Number, required: true },
}, { _id: false });

const requiredDocumentSchema = new mongoose.Schema({
    label: { type: String, required: true },
    category: { type: String, enum: ['Technical', 'Commercial'], required: true },
}, { _id: false });

const tenderSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    category: {
        type: String,
        enum: ['Supply', 'Work', 'Service', 'General'],
        default: 'General',
    },
    budget: { type: Number, required: true },
    preBidDate: { type: Date, required: true },
    finalSubmissionDate: { type: Date, required: true },
    evaluationMethod: { type: String, enum: ['L1', 'QCBS'], default: 'QCBS' },
    l1Config: {
        technicalCutoff: { type: Number },
    },
    qcbsConfig: {
        technicalWeight: { type: Number },
        commercialWeight: { type: Number },
        technicalCriteria: { type: [qcbsCriterionSchema], default: [] },
    },
    requiredDocuments: { type: [requiredDocumentSchema], default: [] },
    status: { type: String, enum: ['Draft', 'Published', 'Closed', 'Awarded', 'Completed'], default: 'Published' },
    aiEvaluationState: {
        status: {
            type: String,
            enum: ['idle', 'running', 'paused', 'completed', 'failed'],
            default: 'idle',
        },
        action: {
            type: String,
            enum: ['start', 'resume', 'pause', 'auto'],
            default: 'start',
        },
        startedAt: { type: Date },
        updatedAt: { type: Date },
        pausedAt: { type: Date },
        completedAt: { type: Date },
        currentBidId: { type: mongoose.Schema.Types.ObjectId },
        currentVendorName: { type: String, default: '' },
        nextBidIndex: { type: Number, default: 0 },
        totalBids: { type: Number, default: 0 },
        completedBids: { type: Number, default: 0 },
        lastError: { type: String, default: '' },
        force: { type: Boolean, default: false },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    documents: [{ type: String }],
    bids: [bidSchema], // Embed bid array directly in Tender as requested
    draftMilestones: [{
        title: { type: String, required: true },
        description: { type: String, default: '' },
        plannedStartDate: { type: Date, required: true },
        plannedEndDate: { type: Date, required: true },
        checklistItems: [{ type: String }]
    }]
}, { timestamps: true });

tenderSchema.index({ createdBy: 1, status: 1, createdAt: -1 });
tenderSchema.index({ status: 1, finalSubmissionDate: -1 });

const bidDocumentSchema = new mongoose.Schema({
    tenderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tender', required: true, index: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    content: { type: String, required: true },
    mimeType: { type: String },
}, { timestamps: true });

const aiCriteriaScoreSchema = new mongoose.Schema({
    criterion: { type: String, required: true },
    maxMarks: { type: Number, required: true },
    awardedMarks: { type: Number, required: true },
    ruleType: { type: String, enum: ['binary', 'ratio', 'numeric', 'textual'], default: 'textual' },
    evidence: { type: [String], default: [] },
    documentLabel: { type: String, default: '' },
}, { _id: false });

const aiBidSummarySchema = new mongoose.Schema({
    tenderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tender', required: true, index: true },
    bidId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    evaluationMethod: { type: String, enum: ['L1', 'QCBS'], required: true },
    status: { type: String, enum: ['pending', 'running', 'success', 'failed'], default: 'pending' },
    model: { type: String },
    promptVersion: { type: String, default: 'v1' },
    generatedAt: { type: Date, default: Date.now },
    eligibility: {
        passed: { type: Boolean, default: false },
        reasons: { type: [String], default: [] },
    },
    eligibilityOverride: { type: Boolean, default: false },
    criteriaScores: { type: [aiCriteriaScoreSchema], default: [] },
    commercialAnalysis: {
        statedValue: { type: Number },
        adjustedValue: { type: Number },
        rationale: { type: String },
        risks: { type: [String], default: [] },
    },
    genuityChecks: {
        warnings: { type: [String], default: [] },
        confidence: { type: Number },
    },
    aiScores: {
        technicalScore: { type: Number },
        financialScore: { type: Number },
        overallScore: { type: Number },
    },
    aiRank: { type: Number },
    summary: { type: String },
    rationale: { type: [String], default: [] },
    // Structured, human-readable audit trail for PO review and research.
    evaluationTrace: { type: mongoose.Schema.Types.Mixed, default: {} },
    // One aggregate inference record for this bid; never one record per chunk.
    inferenceTelemetry: { type: mongoose.Schema.Types.Mixed, default: {} },
    rawResponse: { type: mongoose.Schema.Types.Mixed },
    error: { type: String },
}, { timestamps: true });

aiBidSummarySchema.index({ tenderId: 1, bidId: 1 }, { unique: true });

const aiMilestoneReportSchema = new mongoose.Schema({
    contractId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', required: true, index: true },
    milestoneId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    tenderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tender', required: true, index: true },
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    committeeReport: { type: mongoose.Schema.Types.Mixed },
    aiAssessment: { type: mongoose.Schema.Types.Mixed },
    status: { type: String, enum: ['success', 'failed'], default: 'success' },
    model: { type: String },
    promptVersion: { type: String, default: 'v1' },
    generatedAt: { type: Date, default: Date.now },
    timeline: {
        plannedStartDate: { type: Date },
        plannedEndDate: { type: Date },
        actualStartDate: { type: Date },
        actualEndDate: { type: Date },
        delayedDays: { type: Number, default: 0 },
        status: { type: String },
    },
    checklistSummary: { type: [String], default: [] },
    observations: { type: [String], default: [] },
    alerts: { type: [String], default: [] },
    severity: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
    penaltyEstimate: { type: Number },
    summary: { type: String },
    rawResponse: { type: mongoose.Schema.Types.Mixed },
    error: { type: String },
}, { timestamps: true });

aiMilestoneReportSchema.index({ contractId: 1, milestoneId: 1 }, { unique: true });

const aiNotificationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['milestone-alert', 'ai-evaluation'], default: 'milestone-alert' },
    title: { type: String, required: true },
    message: { type: String, required: true },
    severity: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
    link: { type: String },
    read: { type: Boolean, default: false },
}, { timestamps: true });

const aiChatMessageSchema = new mongoose.Schema({
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    meta: { type: mongoose.Schema.Types.Mixed },
}, { _id: false });

const aiChatSessionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['CPO', 'PO', 'Committee', 'Vendor'], required: true },
    title: { type: String, default: 'New chat' },
    messages: { type: [aiChatMessageSchema], default: [] },
    lastMessageAt: { type: Date, default: Date.now },
}, { timestamps: true });

aiChatSessionSchema.index({ userId: 1, lastMessageAt: -1 });

const researchMetricEventSchema = new mongoose.Schema({
    eventType: {
        type: String,
        required: true,
        index: true,
    },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    actorRole: {
        type: String,
        enum: ['CPO', 'PO', 'Committee', 'Vendor', 'System'],
        default: 'System',
        index: true,
    },
    actorName: { type: String, default: '' },
    tenderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tender', index: true },
    bidId: { type: mongoose.Schema.Types.ObjectId, index: true },
    contractId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', index: true },
    milestoneId: { type: mongoose.Schema.Types.ObjectId, index: true },
    chatId: { type: mongoose.Schema.Types.ObjectId, index: true },
    durationMs: { type: Number, default: 0 },
    status: { type: String, enum: ['success', 'failed', 'warning'], default: 'success', index: true },
    metricName: { type: String, default: '' },
    value: { type: Number, default: 0 },
    note: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

researchMetricEventSchema.index({ eventType: 1, createdAt: -1 });
researchMetricEventSchema.index({ actorRole: 1, createdAt: -1 });
researchMetricEventSchema.index({ tenderId: 1, createdAt: -1 });

const documentEmbeddingJobSchema = new mongoose.Schema({
    sourceKind: {
        type: String,
        enum: ['tender-document', 'bid-document', 'committee-report'],
        required: true,
        index: true,
    },
    sourceKey: { type: String, required: true, unique: true, index: true },
    tenderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tender', index: true },
    contractId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', index: true },
    milestoneId: { type: mongoose.Schema.Types.ObjectId, index: true },
    bidId: { type: mongoose.Schema.Types.ObjectId, index: true },
    reportId: { type: mongoose.Schema.Types.ObjectId, index: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    sourceIndex: { type: Number, default: 0 },
    sourceName: { type: String, required: true },
    mimeType: { type: String },
    rawContent: { type: String, required: true },
    contentHash: { type: String, index: true },
    status: {
        type: String,
        enum: ['pending', 'running', 'completed', 'failed'],
        default: 'pending',
        index: true,
    },
    attempts: { type: Number, default: 0 },
    chunkCount: { type: Number, default: 0 },
    embeddingModel: { type: String, default: '' },
    lastError: { type: String, default: '' },
    queuedAt: { type: Date, default: Date.now },
    startedAt: { type: Date },
    processedAt: { type: Date },
    sourceMeta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

documentEmbeddingJobSchema.index({ status: 1, queuedAt: 1 });

const documentChunkSchema = new mongoose.Schema({
    sourceKind: {
        type: String,
        enum: ['tender-document', 'bid-document', 'committee-report'],
        required: true,
        index: true,
    },
    sourceKey: { type: String, required: true, index: true },
    tenderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tender', index: true },
    contractId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', index: true },
    milestoneId: { type: mongoose.Schema.Types.ObjectId, index: true },
    bidId: { type: mongoose.Schema.Types.ObjectId, index: true },
    reportId: { type: mongoose.Schema.Types.ObjectId, index: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    sourceIndex: { type: Number, default: 0 },
    chunkIndex: { type: Number, required: true },
    chunkText: { type: String, required: true },
    chunkHash: { type: String, required: true, index: true },
    contentHash: { type: String, index: true },
    mimeType: { type: String },
    ocrUsed: { type: Boolean, default: false },
    tokenCount: { type: Number, default: 0 },
    embedding: { type: [Number], default: [] },
    embeddingModel: { type: String, required: true },
    sourceName: { type: String, required: true },
    sourceMeta: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

documentChunkSchema.index({ sourceKey: 1, chunkIndex: 1 }, { unique: true });
documentChunkSchema.index({ sourceKind: 1, tenderId: 1, createdAt: -1 });
documentChunkSchema.index({ sourceKind: 1, contractId: 1, createdAt: -1 });
documentChunkSchema.index({ sourceKind: 1, vendorId: 1, createdAt: -1 });

const milestoneChecklistItemSchema = new mongoose.Schema({
    label: { type: String, required: true },
    checked: { type: Boolean, default: false },
}, { _id: false });

const milestoneHistoryEntrySchema = new mongoose.Schema({
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedAt: { type: Date, default: Date.now },
    status: { type: String },
    progress: { type: Number },
    remarks: { type: String, default: '' },
    checklistSnapshot: { type: [milestoneChecklistItemSchema], default: [] },
    committeeReport: { type: mongoose.Schema.Types.Mixed },
}, { _id: false });

const contractMilestoneSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, default: '' },
    plannedStartDate: { type: Date, required: true },
    plannedEndDate: { type: Date, required: true },
    actualStartDate: { type: Date },
    actualEndDate: { type: Date },
    status: {
        type: String,
        enum: ['Not Started', 'In Progress', 'Completed', 'Delayed'],
        default: 'Not Started',
    },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    assignedTo: { type: String, default: '' },
    checklist: { type: [milestoneChecklistItemSchema], default: [] },
    remarks: { type: String, default: '' },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: { type: Date },
    documents: [{ type: String }],
    images: [{ type: String }],
    history: { type: [milestoneHistoryEntrySchema], default: [] },
}, { timestamps: true });

const progressReportSchema = new mongoose.Schema({
    milestoneId: { type: mongoose.Schema.Types.ObjectId },
    milestoneTitle: { type: String },
    completionDate: { type: Date },
    description: { type: String, default: '' },
    observations: { type: String, default: '' },
    attachments: [{ type: String }],
    reportType: {
        type: String,
        enum: ['Checklist', 'WorkProgress', 'General'],
        default: 'General',
    },
    reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

const milestoneAssetSchema = new mongoose.Schema({
    contractId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', required: true, index: true },
    milestoneId: { type: mongoose.Schema.Types.ObjectId },
    reportId: { type: mongoose.Schema.Types.ObjectId },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assetType: {
        type: String,
        enum: ['milestone-document', 'milestone-image', 'progress-report-attachment'],
        required: true,
    },
    name: { type: String, required: true },
    content: { type: String, required: true },
    mimeType: { type: String },
}, { timestamps: true });

const contractSchema = new mongoose.Schema({
    tenderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tender', required: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['Awarded', 'Signed', 'Completed', 'Cancelled'], default: 'Awarded' },
    timelineDefined: { type: Boolean, default: false },
    timelineStartDate: { type: Date },
    timelineEndDate: { type: Date },
    milestones: [contractMilestoneSchema],
    progressReports: [progressReportSchema],
}, { timestamps: true });

export const User = mongoose.model('User', userSchema);
export const Tender = mongoose.model('Tender', tenderSchema);
export const Contract = mongoose.model('Contract', contractSchema);
export const BidDocument = mongoose.model('BidDocument', bidDocumentSchema);
export const MilestoneAsset = mongoose.model('MilestoneAsset', milestoneAssetSchema);
export const AIBidSummary = mongoose.model('AIBidSummary', aiBidSummarySchema);
export const AIMilestoneReport = mongoose.model('AIMilestoneReport', aiMilestoneReportSchema);
export const AINotification = mongoose.model('AINotification', aiNotificationSchema);
export const AIChatSession = mongoose.model('AIChatSession', aiChatSessionSchema);
export const ResearchMetricEvent = mongoose.model('ResearchMetricEvent', researchMetricEventSchema);
export const DocumentEmbeddingJob = mongoose.model('DocumentEmbeddingJob', documentEmbeddingJobSchema);
export const DocumentChunk = mongoose.model('DocumentChunk', documentChunkSchema);
