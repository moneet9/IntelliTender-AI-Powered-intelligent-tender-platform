import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../../api";
import { formatDate, resolveBidVendorId, type BidView, type ContractRecord, type TenderRecord } from "./vendorHelpers";

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
        apiRequest<TenderRecord[]>("/api/tenders?summary=true"),
        apiRequest<ContractRecord[]>("/api/contracts?summary=true"),
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
            bidId: bid._id,
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
