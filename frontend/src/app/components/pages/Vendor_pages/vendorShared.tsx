import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { apiRequest } from "../../../api";
import { getStoredDocumentName, getStoredDocumentReference, getStoredDocumentUrl } from "../../../document-utils";

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
  requiredDocuments?: Array<{ label: string; category: "Technical" | "Commercial" }>;
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
        .sort(
          (left, right) =>
            new Date(left.finalSubmissionDate).getTime() - new Date(right.finalSubmissionDate).getTime()
        ),
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
  if (status === "Cancelled") return "bg-red-100 text-red-800";
  if (status === "Signed") return "bg-blue-100 text-blue-800";
  return "bg-yellow-100 text-yellow-800";
}

type NavigableDocumentUrl = {
  url: string;
  revokeAfterOpen: boolean;
};

function isWebOrBlobUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^blob:/i.test(value);
}

function looksLikeBase64Content(value: string): boolean {
  const normalized = value.trim().replace(/\s+/g, "");
  if (!normalized || normalized.length < 16 || normalized.length % 4 !== 0) {
    return false;
  }

  return /^[A-Za-z0-9+/=]+$/.test(normalized);
}

function base64ToBlobUrl(base64Content: string, mimeType?: string): string | null {
  try {
    const normalized = base64Content.trim().replace(/\s+/g, "");
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const blob = new Blob([bytes], { type: mimeType || "application/octet-stream" });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

async function toNavigableDocumentUrl(content: string, mimeType?: string): Promise<NavigableDocumentUrl | null> {
  const normalized = content.trim();
  if (!normalized) return null;

  if (isWebOrBlobUrl(normalized)) {
    return {
      url: normalized,
      revokeAfterOpen: false,
    };
  }

  if (normalized.startsWith("data:")) {
    try {
      const response = await fetch(normalized);
      const blob = await response.blob();
      return {
        url: URL.createObjectURL(blob),
        revokeAfterOpen: true,
      };
    } catch {
      return null;
    }
  }

  if (looksLikeBase64Content(normalized)) {
    const blobUrl = base64ToBlobUrl(normalized, mimeType);
    if (!blobUrl) return null;

    return {
      url: blobUrl,
      revokeAfterOpen: true,
    };
  }

  return null;
}

function openPendingDocumentWindow(): Window | null {
  const pendingWindow = window.open("", "_blank");
  if (!pendingWindow) return null;

  try {
    pendingWindow.document.write(
      '<p style="font-family:Arial,sans-serif;padding:16px;">Opening document...</p>'
    );
    pendingWindow.document.close();
    pendingWindow.opener = null;
  } catch {
    // Ignore browser-specific write restrictions.
  }

  return pendingWindow;
}

async function navigateWindowToDocument(targetWindow: Window, content: string, mimeType?: string): Promise<boolean> {
  const navigable = await toNavigableDocumentUrl(content, mimeType);
  if (!navigable) return false;

  targetWindow.location.replace(navigable.url);

  if (navigable.revokeAfterOpen) {
    window.setTimeout(() => {
      URL.revokeObjectURL(navigable.url);
    }, 60_000);
  }

  return true;
}

export function DocumentLinks({
  documents,
  emptyLabel,
  numbered = false,
}: {
  documents?: string[];
  emptyLabel: string;
  numbered?: boolean;
}) {
  const [loadingDocumentKey, setLoadingDocumentKey] = useState("");

  const openLazyDocument = async (
    event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>,
    document: string,
    fallbackName: string
  ) => {
    const reference = getStoredDocumentReference(document);
    if (!reference) return;

    event.preventDefault();
    const pendingWindow = openPendingDocumentWindow();
    if (!pendingWindow) return;

    const cacheKey = `tender-doc:${reference.tenderId}:${reference.docIndex}`;
    let mimeType = reference.mimeType;

    let cachedContent = "";
    try {
      cachedContent = sessionStorage.getItem(cacheKey) || "";
    } catch {
      cachedContent = "";
    }

    if (!cachedContent) {
      setLoadingDocumentKey(cacheKey);
      try {
        const payload = await apiRequest<{ name?: string; content?: string; mimeType?: string }>(
          `/api/tenders/${reference.tenderId}/documents/${reference.docIndex}`
        );

        if (!payload?.content) {
          throw new Error("Document content unavailable");
        }

        cachedContent = payload.content;
        mimeType = payload.mimeType || mimeType;
        try {
          sessionStorage.setItem(cacheKey, cachedContent);
        } catch {
          // Ignore storage limits and still open in a new tab.
        }
      } catch {
        pendingWindow.close();
        return;
      } finally {
        setLoadingDocumentKey("");
      }
    }

    const opened = await navigateWindowToDocument(pendingWindow, cachedContent, mimeType);
    if (!opened) {
      pendingWindow.close();
    }
  };

  const openStoredDocument = async (
    event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>,
    documentContent: string,
    mimeType?: string
  ) => {
    event.preventDefault();
    const pendingWindow = openPendingDocumentWindow();
    if (!pendingWindow) return;

    const opened = await navigateWindowToDocument(pendingWindow, documentContent, mimeType);
    if (!opened) {
      pendingWindow.close();
    }
  };

  if (!documents?.length) {
    return <p className="text-sm text-gray-500">{emptyLabel}</p>;
  }

  const links = documents.map((document, index) => {
    const name = getStoredDocumentName(document, `Document ${index + 1}`);
    const url = getStoredDocumentUrl(document);
    const reference = getStoredDocumentReference(document);
    const cacheKey = reference ? `tender-doc:${reference.tenderId}:${reference.docIndex}` : "";
    const isLoading = cacheKey && loadingDocumentKey === cacheKey;

    if (url) {
      const useDirectAnchor = isWebOrBlobUrl(url);
      return {
        key: `${name}-${index}`,
        node: useDirectAnchor ? (
          <a href={url} target="_blank" rel="noreferrer" className="text-sm text-[#1D4E89] hover:underline">
            {name}
          </a>
        ) : (
          <button
            type="button"
            onClick={(event) => {
              void openStoredDocument(event, url, reference?.mimeType);
            }}
            className="text-sm text-[#1D4E89] hover:underline text-left"
          >
            {name}
          </button>
        ),
      };
    }

    if (reference) {
      return {
        key: `${name}-${index}`,
        node: (
          <button
            type="button"
            onClick={(event) => {
              void openLazyDocument(event, document, name);
            }}
            className="text-sm text-[#1D4E89] hover:underline text-left"
          >
            {isLoading ? `Opening ${fallbackNameWithEllipsis(name)}` : name}
          </button>
        ),
      };
    }

    return {
      key: `${name}-${index}`,
      node: <span className="text-sm text-gray-700">{name}</span>,
    };
  });

  if (numbered) {
    return (
      <ol className="list-decimal list-inside space-y-2">
        {links.map((item) => (
          <li key={item.key} className="text-sm text-gray-700">
            {item.node}
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {links.map((item) => (
        <span key={item.key}>{item.node}</span>
      ))}
    </div>
  );
}

function fallbackNameWithEllipsis(name: string): string {
  return name.length > 28 ? `${name.slice(0, 28)}...` : `${name}...`;
}

