import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['CPO', 'PO', 'Committee', 'Vendor'], required: true },
    phone: { type: String },
    department: { type: String },
    specialization: { type: String },
    managerPo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    accountStatus: { type: String, enum: ['Active', 'Frozen', 'Deleted'], default: 'Active' },
    frozenUntil: { type: Date },
    passwordResetOtp: { type: String },
    passwordResetOtpExpiresAt: { type: Date },
}, { timestamps: true });

const bidSchema = new mongoose.Schema({
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    vendorName: { type: String },
    proposedAmount: { type: Number, required: true },
    proposalDocument: { type: String }, // Can be a URL, base64 string, or just mock string
    status: { type: String, enum: ['Pending', 'Evaluated', 'Selected', 'Rejected'], default: 'Pending' },
    technicalScore: { type: Number },
    financialScore: { type: Number },
    comments: { type: String },
    evaluatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    evaluatedDate: { type: Date }
}, { timestamps: true });

const tenderSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    budget: { type: Number, required: true },
    deadline: { type: Date, required: true },
    status: { type: String, enum: ['Draft', 'Published', 'Closed', 'Awarded'], default: 'Draft' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    bids: [bidSchema] // Embed bid array directly in Tender as requested
}, { timestamps: true });

const contractSchema = new mongoose.Schema({
    tenderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tender', required: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['Awarded', 'Signed', 'Completed'], default: 'Awarded' },
}, { timestamps: true });

export const User = mongoose.model('User', userSchema);
export const Tender = mongoose.model('Tender', tenderSchema);
export const Contract = mongoose.model('Contract', contractSchema);