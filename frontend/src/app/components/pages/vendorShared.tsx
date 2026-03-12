import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../api";
import { getStoredDocumentName, getStoredDocumentUrl } from "../../document-utils";

export type BidStatus = "Pending" | "Evaluated" | "Selected" | "Rejected";
export type ContractStatus = "Awarded" | "Signed" | "Completed";

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
};

export type TenderRecord = {
  _id: string;
  title: string;
  description: string;
  category?: string;
  budget: number;
  deadline: string;
  status: "Draft" | "Published" | "Closed" | "Awarded";
  documents?: string[];
  bids?: TenderBid[];
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
    deadline?: string;
    documents?: string[];
  };
  milestones?: MilestoneSummary[];
  progressReports?: Array<{ _id: string }>;
};

export type BidView = {
  tenderId: string;
  title: string;
  category: string;
  amount: number;
  status: BidStatus;
  submittedAt?: string;
  submittedDate: string;
  proposalDocument?: string;
  comments?: string;
  technicalScore?: number;
  financialScore?: number;
};

export function useVendorData(vendorId?: string) {
  const [tenders, setTenders] = useState<TenderRecord[]>([]);
  const [contracts, setContracts] = useState<ContractRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [tenderData, contractData] = await Promise.all([
        apiRequest<TenderRecord[]>("/api/tenders"),
        apiRequest<ContractRecord[]>("/api/contracts"),
      ]);

      setTenders(tenderData || []);
      setContracts(contractData || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load vendor data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const publishedTenders = useMemo(
    () =>
      tenders
        .filter((tender) => tender.status === "Published")
        .slice()
        .sort((left, right) => new Date(left.deadline).getTime() - new Date(right.deadline).getTime()),
    [tenders]
  );

  const myBids = useMemo<BidView[]>(() => {
    if (!vendorId) return [];

    return tenders
      .flatMap((tender) =>
        (tender.bids || [])
          .filter((bid) => resolveBidVendorId(bid.vendorId) === vendorId)
          .map((bid) => ({
            tenderId: tender._id,
            title: tender.title,
            category: tender.category || "General",
            amount: Number(bid.proposedAmount),
            status: bid.status,
            submittedAt: bid.createdAt,
            submittedDate: formatDate(bid.createdAt),
            proposalDocument: bid.proposalDocument,
            comments: bid.comments,
            technicalScore: bid.technicalScore,
            financialScore: bid.financialScore,
          }))
      )
      .sort((left, right) => new Date(right.submittedAt || 0).getTime() - new Date(left.submittedAt || 0).getTime());
  }, [tenders, vendorId]);

  const ongoingContracts = useMemo(
    () =>
      contracts
        .filter((contract) => contract.status !== "Completed")
        .slice()
        .sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime()),
    [contracts]
  );

  const completedContracts = useMemo(
    () =>
      contracts
        .filter((contract) => contract.status === "Completed")
        .slice()
        .sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime()),
    [contracts]
  );

  const stats = useMemo(
    () => ({
      publishedTenders: publishedTenders.length,
      submittedBids: myBids.length,
      activeContracts: ongoingContracts.length,
      completedContracts: completedContracts.length,
    }),
    [completedContracts.length, myBids.length, ongoingContracts.length, publishedTenders.length]
  );

  return {
    tenders,
    contracts,
    loading,
    error,
    reload,
    publishedTenders,
    myBids,
    ongoingContracts,
    completedContracts,
    stats,
  };
}

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
  if (status === "Signed") return "bg-blue-100 text-blue-800";
  return "bg-yellow-100 text-yellow-800";
}

export function DocumentLinks({ documents, emptyLabel }: { documents?: string[]; emptyLabel: string }) {
  if (!documents?.length) {
    return <p className="text-sm text-gray-500">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {documents.map((document, index) => {
        const name = getStoredDocumentName(document, `Document ${index + 1}`);
        const url = getStoredDocumentUrl(document);

        return url ? (
          <a
            key={`${name}-${index}`}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-[#1D4E89] hover:underline"
          >
            {name}
          </a>
        ) : (
          <span key={`${name}-${index}`} className="text-sm text-gray-700">
            {name}
          </span>
        );
      })}
    </div>
  );
}
