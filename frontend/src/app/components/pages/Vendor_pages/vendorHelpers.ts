export type BidStatus = "Pending" | "Evaluated" | "Selected" | "Rejected";
export type ContractStatus = "Awarded" | "Signed" | "Completed" | "Cancelled";

export type TenderBid = {
  _id: string;
  vendorId?: string | { _id?: string };
  proposedAmount: number;
  proposalDocument?: string;
  status: BidStatus;
  createdAt?: string;
  technicalScore?: number;
  financialScore?: number;
  comments?: string;
  proposalDocumentId?: string;
  bidDocuments?: BidDocumentReference[];
  committeeEvaluations?: CommitteeEvaluation[];
  aiEvaluation?: AIEvaluation;
  evaluationSummary?: EvaluationSummary;
};

export type CommitteeEvaluation = {
  committeeMemberId?: string | { name?: string };
  technicalScore?: number;
  financialScore?: number;
  criteriaScores?: Array<{ criterion?: string; documentLabel?: string; maxMarks?: number; awardedMarks?: number }>;
  comments?: string;
  evaluatedDate?: string;
};

export type AIEvaluation = {
  status?: string;
  eligibility?: { passed?: boolean; reasons?: string[] };
  criteriaScores?: Array<{ criterion?: string; documentLabel?: string; maxMarks?: number; awardedMarks?: number; evidence?: string[] }>;
  aiScores?: { technicalScore?: number; financialScore?: number; overallScore?: number };
  summary?: string;
  rationale?: string[];
  generatedAt?: string;
};

export type BidDocumentReference = {
  label?: string;
  category?: "Technical" | "Commercial";
  documentId?: string;
};

export type EvaluationSummary = {
  technicalScore?: number;
  financialScore?: number;
  overallScore?: number;
  technicalWeight?: number;
  commercialWeight?: number;
};

export type TenderRecord = {
  _id: string;
  title: string;
  description: string;
  category?: string;
  budget: number;
  finalSubmissionDate: string;
  status: "Draft" | "Published" | "Closed" | "Awarded" | "Completed";
  documents?: string[];
  bids?: TenderBid[];
  qcbsConfig?: { technicalWeight?: number; commercialWeight?: number };
  requiredDocuments?: Array<{ label: string; category: "Technical" | "Commercial" }>;
};

export const requiredDocumentsForDisplay = (
  documents?: TenderRecord["requiredDocuments"]
) => {
  const configuredDocuments = documents?.length
    ? documents
    : [{ label: "Commercial Bid Document", category: "Commercial" as const }];
  const hasEligibilityProof = configuredDocuments.some(
    (document) => document.label.trim().toLowerCase() === "eligibility proof"
  );

  return hasEligibilityProof
    ? configuredDocuments
    : [{ label: "Eligibility Proof", category: "Technical" as const }, ...configuredDocuments];
};

export type MilestoneSummary = {
  _id: string;
  title: string;
  status: "Not Started" | "In Progress" | "Completed" | "Delayed";
  progress: number;
  plannedEndDate?: string;
  actualEndDate?: string;
};

export type ContractRecord = {
  _id: string;
  status: ContractStatus;
  timelineDefined?: boolean;
  timelineStartDate?: string;
  timelineEndDate?: string;
  createdAt?: string;
  updatedAt?: string;
  tenderId?: {
    title?: string;
    description?: string;
    category?: string;
    budget?: number;
    finalSubmissionDate?: string;
    documents?: string[];
  };
  milestones?: MilestoneSummary[];
  progressReports?: Array<{ _id: string }>;
};

export type BidView = {
  bidId: string;
  tenderId: string;
  title: string;
  category: string;
  amount: number;
  status: BidStatus;
  submittedAt?: string;
  submittedDate: string;
  proposalDocument?: string;
  comments?: string;
  proposalDocumentId?: string;
  bidDocuments?: BidDocumentReference[];
  technicalScore?: number;
  financialScore?: number;
  committeeEvaluations?: CommitteeEvaluation[];
  aiEvaluation?: AIEvaluation | null;
  technicalWeight?: number;
  commercialWeight?: number;
  evaluationSummary?: EvaluationSummary;
};

export function resolveBidVendorId(vendorId?: string | { _id?: string }): string {
  if (!vendorId) return "";
  return typeof vendorId === "string" ? vendorId : vendorId._id || "";
}

export function hasExistingBid(tender: TenderRecord, vendorId?: string): boolean {
  if (!vendorId) return false;
  return (tender.bids || []).some((bid) => resolveBidVendorId(bid.vendorId) === vendorId);
}

export function getContractProgress(contract: ContractRecord): number {
  const milestones = contract.milestones || [];
  if (!milestones.length) return contract.status === "Completed" ? 100 : 0;

  return Math.round(milestones.reduce((sum, milestone) => sum + (milestone.progress || 0), 0) / milestones.length);
}

export function getCurrentMilestone(contract: ContractRecord): MilestoneSummary | null {
  const milestones = contract.milestones || [];
  return milestones.find((milestone) => milestone.status !== "Completed") || milestones[milestones.length - 1] || null;
}

export function formatDate(value?: string): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString();
}

export function formatDateTime(value?: string): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

export function formatCurrency(value?: number): string {
  return `₹${Number(value || 0).toLocaleString()}`;
}

export function getBidStatusClass(status: BidStatus): string {
  if (status === "Selected") return "bg-green-100 text-green-800";
  if (status === "Rejected") return "bg-red-100 text-red-800";
  if (status === "Evaluated") return "bg-yellow-100 text-yellow-800";
  return "bg-blue-100 text-blue-800";
}

export function getContractStatusClass(status: ContractStatus): string {
  if (status === "Completed") return "bg-green-100 text-green-800";
  if (status === "Cancelled") return "bg-red-100 text-red-800";
  if (status === "Signed") return "bg-blue-100 text-blue-800";
  return "bg-yellow-100 text-yellow-800";
}
