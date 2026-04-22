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
    comments: { type: String, default: '' },
    evaluatedDate: { type: Date, default: Date.now },
}, { _id: false });

const bidSchema = new mongoose.Schema({
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    vendorName: { type: String },
    proposedAmount: { type: Number, required: true },
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

const tenderSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    category: {
        type: String,
        enum: ['Supply', 'Work', 'Service', 'General'],
        default: 'General',
    },
    budget: { type: Number, required: true },
    deadline: { type: Date, required: true },
    status: { type: String, enum: ['Draft', 'Published', 'Closed', 'Awarded', 'Completed'], default: 'Published' },
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

const bidDocumentSchema = new mongoose.Schema({
    tenderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tender', required: true, index: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    content: { type: String, required: true },
    mimeType: { type: String },
}, { timestamps: true });

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