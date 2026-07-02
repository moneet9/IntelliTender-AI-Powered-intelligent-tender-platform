import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle, FileText, ShieldCheck } from "lucide-react";
import { Sidebar } from "../../layout/Sidebar";
import { Header } from "../../layout/Header";
import { AIAssistant } from "../../AIAssistant";
import { apiRequest, getAuthUser } from "../../../api";
import { getStoredDocumentName, getStoredDocumentUrl } from "../../../document-utils";

type TenderStatus = "Draft" | "Published" | "Closed" | "Awarded" | "Completed";

type TenderRecord = {
  _id: string;
  title: string;
  description?: string;
  status: TenderStatus;
  category?: string;
  budget?: number;
  finalSubmissionDate?: string;
  evaluationMethod?: "L1" | "QCBS";
  l1Config?: {
    technicalCutoff?: number;
  };
  qcbsConfig?: {
    technicalWeight?: number;
    commercialWeight?: number;
    technicalCriteria?: Array<{ name: string; maxMarks: number }>;
  };
  requiredDocuments?: Array<{ label: string; category: "Technical" | "Commercial" }>;
  createdBy?: { _id?: string; name?: string } | string;
  bids?: Array<{ _id: string }>;
};

type BidRecord = {
  _id: string;
  vendorName?: string;
  vendorDetails?: {
    name?: string;
    email?: string;
    phone?: string;
    department?: string;
    specialization?: string;
  } | null;
  proposedAmount: number;
  proposalDocument?: string;
  bidDocuments?: Array<{
    label: string;
    category: "Technical" | "Commercial";
    documentId?: string;
    document?: string;
  }>;
  status: "Pending" | "Evaluated" | "Selected" | "Rejected";
  technicalScore?: number;
  financialScore?: number;
  comments?: string;
  committeeEvaluations?: Array<{
    committeeMemberId?: string;
    technicalScore?: number;
    financialScore?: number;
    eligibilityChecked?: boolean;
    criteriaScores?: Array<{
      criterion: string;
      maxMarks?: number;
      awardedMarks?: number;
      documentLabel?: string;
    }>;
    comments?: string;
    evaluatedDate?: string;
  }>;
};

type AiSummary = {
  _id: string;
  tenderId: string;
  bidId: string;
  status: "pending" | "success" | "failed";
  summary?: string;
  rationale?: string[];
  eligibility?: {
    passed?: boolean;
    reasons?: string[];
  };
  criteriaScores?: Array<{
    criterion: string;
    maxMarks?: number;
    awardedMarks?: number;
    evidence?: string[];
  }>;
  commercialAnalysis?: {
    rationale?: string;
    risks?: string[];
  };
  aiScores?: {
    technicalScore?: number;
    financialScore?: number;
    overallScore?: number;
  };
};

type BidDocumentEntry = NonNullable<BidRecord["bidDocuments"]>[number];

export function AIEvaluation() {
  const authUser = getAuthUser();
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
  const [tenders, setTenders] = useState<TenderRecord[]>([]);
  const [selectedTenderId, setSelectedTenderId] = useState("");
  const [bids, setBids] = useState<BidRecord[]>([]);
  const [aiSummaries, setAiSummaries] = useState<AiSummary[]>([]);
  const [loadingTenders, setLoadingTenders] = useState(false);
  const [loadingBids, setLoadingBids] = useState(false);
  const [loadingAi, setLoadingAi] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const getTenderOwnerId = (tender: TenderRecord) => {
    if (!tender.createdBy) return "";
    if (typeof tender.createdBy === "string") return tender.createdBy;
    return tender.createdBy._id || "";
  };

  const loadTenders = useCallback(async () => {
    setLoadingTenders(true);
    setError("");
    try {
      const data = await apiRequest<TenderRecord[]>("/api/tenders");
      const createdByMe = (data || []).filter((tender) => String(getTenderOwnerId(tender)) === String(authUser?._id || ""));
      const visible = createdByMe.filter((tender) => tender.status !== "Draft");
      setTenders(visible);
      setSelectedTenderId((previousId) => {
        if (previousId && visible.some((item) => item._id === previousId)) {
          return previousId;
        }
        return visible[0]?._id || "";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tenders");
    } finally {
      setLoadingTenders(false);
    }
  }, [authUser?._id]);

  const loadBids = useCallback(async (tenderId: string) => {
    if (!tenderId) {
      setBids([]);
      return;
    }

    setLoadingBids(true);
    setError("");
    try {
      const data = await apiRequest<BidRecord[]>(`/api/tenders/${tenderId}/bids`);
      setBids(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load submissions");
    } finally {
      setLoadingBids(false);
    }
  }, []);

  const loadAiSummaries = useCallback(async (tenderId: string) => {
    if (!tenderId) {
      setAiSummaries([]);
      return;
    }

    setLoadingAi(true);
    try {
      const data = await apiRequest<AiSummary[]>(`/api/ai/evaluations/tenders/${tenderId}`);
      setAiSummaries(data || []);
    } catch {
      setAiSummaries([]);
    } finally {
      setLoadingAi(false);
    }
  }, []);

  const selectWinner = async (bidId: string) => {
    if (!selectedTenderId) return;

    setError("");
    setSuccess("");
    try {
      await apiRequest(`/api/tenders/${selectedTenderId}/bids/${bidId}/select`, { method: "PUT" });
      setSuccess("Winner selected successfully.");
      await loadTenders();
      await loadBids(selectedTenderId);
      await loadAiSummaries(selectedTenderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to select winner");
    }
  };

  useEffect(() => {
    void loadTenders();
  }, [loadTenders]);

  useEffect(() => {
    void loadBids(selectedTenderId);
  }, [loadBids, selectedTenderId]);

  useEffect(() => {
    void loadAiSummaries(selectedTenderId);
  }, [loadAiSummaries, selectedTenderId]);

  const selectedTender = useMemo(
    () => tenders.find((tender) => tender._id === selectedTenderId) || null,
    [tenders, selectedTenderId]
  );

  const filteredTenders = useMemo(() => {
    return [...tenders].sort((a, b) => {
      const aDate = new Date(a.finalSubmissionDate || 0).getTime();
      const bDate = new Date(b.finalSubmissionDate || 0).getTime();
      return aDate - bDate;
    });
  }, [tenders]);

  const aiSummaryMap = useMemo(() => {
    const map = new Map<string, AiSummary>();
    aiSummaries.forEach((summary) => {
      map.set(summary.bidId, summary);
    });
    return map;
  }, [aiSummaries]);

  const aiRanking = useMemo(() => {
    return bids
      .map((bid) => ({
        bidId: bid._id,
        score: Number(aiSummaryMap.get(bid._id)?.aiScores?.overallScore || aiSummaryMap.get(bid._id)?.aiScores?.technicalScore || 0),
      }))
      .sort((left, right) => right.score - left.score)
      .map((item, index) => ({ ...item, rank: index + 1 }));
  }, [bids, aiSummaryMap]);

  const committeeStats = useMemo(() => {
    return bids.map((bid) => {
      const evaluations = Array.isArray(bid.committeeEvaluations) ? bid.committeeEvaluations : [];
      const reviewCount = evaluations.length;
      const committeeTechnical = reviewCount
        ? evaluations.reduce((sum, item) => sum + Number(item.technicalScore || 0), 0) / reviewCount
        : Number(bid.technicalScore || 0);
      const committeeFinancial = reviewCount
        ? evaluations.reduce((sum, item) => sum + Number(item.financialScore || 0), 0) / reviewCount
        : Number(bid.financialScore || 0);

      return {
        bidId: bid._id,
        reviewCount,
        committeeTechnical: Number(committeeTechnical.toFixed(2)),
        committeeFinancial: Number(committeeFinancial.toFixed(2)),
      };
    });
  }, [bids]);

  const selectedTenderStatus = selectedTender
    ? (selectedTender.status === "Awarded" || selectedTender.status === "Completed" ? "Finalized" : "In review")
    : "No tender selected";

  const getTenderStateLabel = (tender: TenderRecord) => {
    if (tender.status === "Awarded" || tender.status === "Completed") {
      return "Final results";
    }
    if (tender.status === "Closed") {
      return "AI + committee review ready";
    }
    return "Evaluation in progress";
  };

  const getApiUrl = (path: string) => `${apiBaseUrl}${path}`;

  const getBidDocumentUrl = (doc: BidDocumentEntry) => {
    if (doc.documentId && selectedTenderId) {
      return getApiUrl(`/api/tenders/${selectedTenderId}/bid-documents/${doc.documentId}`);
    }

    return getStoredDocumentUrl(doc.document);
  };

  const getBidDocumentByLabel = (bid: BidRecord, label: string) => {
    const normalized = label.trim().toLowerCase();
    return (bid.bidDocuments || []).find((doc) => doc.label.trim().toLowerCase() === normalized);
  };

  const getCriteriaMaxMarks = (label: string) => {
    const criterion = selectedTender?.qcbsConfig?.technicalCriteria?.find(
      (item) => item.name.trim().toLowerCase() === label.trim().toLowerCase()
    );
    return Number(criterion?.maxMarks || 0);
  };

  const normalizeLabel = (value: string) => value.trim().toLowerCase();

  const getStatusBadgeClass = (status: BidRecord["status"]) => {
    if (status === "Selected") return "bg-green-100 text-green-800";
    if (status === "Rejected") return "bg-red-100 text-red-800";
    if (status === "Evaluated") return "bg-blue-100 text-blue-800";
    return "bg-yellow-100 text-yellow-800";
  };

  const getCommitteeMemberLabel = (committeeMemberId?: string, index?: number) => {
    if (committeeMemberId) {
      return `Member ${String(committeeMemberId).slice(-6).toUpperCase()}`;
    }

    return `Member ${typeof index === "number" ? index + 1 : 1}`;
  };

  const formatScore = (value?: number | null) => {
    if (value === undefined || value === null || Number.isNaN(Number(value))) return "-";
    return Number(value).toFixed(2);
  };

  const rankedBidIds = useMemo(() => {
    return new Map(aiRanking.map((item) => [item.bidId, item.rank]));
  }, [aiRanking]);

  const lowestQualifiedBidId = useMemo(() => {
    if (!selectedTender || selectedTender.evaluationMethod !== "L1") return null;

    const technicalCutoff = Number(selectedTender.l1Config?.technicalCutoff || 0);
    const qualified = bids.filter((bid) => bid.status === "Evaluated" && Number(bid.technicalScore || 0) >= technicalCutoff);
    if (!qualified.length) return null;

    const lowestPrice = Math.min(...qualified.map((bid) => Number(bid.proposedAmount || bid.financialScore || 0)));
    const winningBid = qualified.find((bid) => Number(bid.proposedAmount || bid.financialScore || 0) === lowestPrice);
    return winningBid?._id || null;
  }, [bids, selectedTender]);

  const committeeStatsByBidId = useMemo(() => {
    return new Map(committeeStats.map((item) => [item.bidId, item]));
  }, [committeeStats]);

  const buildCriterionRows = useCallback((bid: BidRecord) => {
    type RowCommitteeEntry = {
      memberLabel: string;
      score: number;
      comments: string;
      evaluatedDate?: string;
      eligible: boolean;
    };

    type CriterionRow = {
      key: string;
      label: string;
      maxMarks: number;
      committeeEntries: RowCommitteeEntry[];
      aiScore?: number;
      aiEvidence: string[];
      document?: BidDocumentEntry;
    };

    const rowMap = new Map<string, CriterionRow>();
    const ensureRow = (rawLabel: string, rawMaxMarks?: number) => {
      const label = rawLabel.trim();
      if (!label) return null;

      const key = normalizeLabel(label);
      const existing = rowMap.get(key);
      if (existing) {
        if (Number.isFinite(Number(rawMaxMarks)) && Number(rawMaxMarks || 0) > existing.maxMarks) {
          existing.maxMarks = Number(rawMaxMarks || 0);
        }
        return existing;
      }

      const row: CriterionRow = {
        key,
        label,
        maxMarks: Number(rawMaxMarks || getCriteriaMaxMarks(label) || 0),
        committeeEntries: [],
        aiEvidence: [],
      };

      rowMap.set(key, row);
      return row;
    };

    const committeeReviews = Array.isArray(bid.committeeEvaluations) ? bid.committeeEvaluations : [];
    committeeReviews.forEach((review, reviewIndex) => {
      const memberLabel = getCommitteeMemberLabel(review.committeeMemberId, reviewIndex);
      const criteriaScores = Array.isArray(review.criteriaScores) ? review.criteriaScores : [];

      criteriaScores.forEach((criteriaScore) => {
        const label = String(criteriaScore?.documentLabel || criteriaScore?.criterion || "").trim();
        if (!label) return;

        const row = ensureRow(label, Number(criteriaScore?.maxMarks || 0));
        if (!row) return;

        row.maxMarks = Math.max(row.maxMarks, Number(criteriaScore?.maxMarks || 0), getCriteriaMaxMarks(label));
        row.committeeEntries.push({
          memberLabel,
          score: Number(criteriaScore?.awardedMarks || 0),
          comments: String(review.comments || ""),
          evaluatedDate: review.evaluatedDate,
          eligible: review.eligibilityChecked !== false,
        });
      });
    });

    const aiCriteriaScores = aiSummaryMap.get(bid._id)?.criteriaScores || [];
    aiCriteriaScores.forEach((criteriaScore) => {
      const label = String(criteriaScore?.criterion || "").trim();
      if (!label) return;

      const row = ensureRow(label, Number(criteriaScore?.maxMarks || 0));
      if (!row) return;

      row.maxMarks = Math.max(row.maxMarks, Number(criteriaScore?.maxMarks || 0), getCriteriaMaxMarks(label));
      row.aiScore = Number(criteriaScore?.awardedMarks || 0);
      row.aiEvidence = Array.isArray(criteriaScore?.evidence)
        ? criteriaScore.evidence.map((item) => String(item))
        : [];
    });

    const tenderCriteria = selectedTender?.qcbsConfig?.technicalCriteria || [];
    tenderCriteria.forEach((criterion) => {
      ensureRow(criterion.name, criterion.maxMarks);
    });

    const requiredTechnicalDocs = (selectedTender?.requiredDocuments || []).filter(
      (doc) =>
        doc.category === "Technical" &&
        doc.label.trim().toLowerCase() !== "eligibility proof"
    );
    requiredTechnicalDocs.forEach((doc) => {
      ensureRow(doc.label, getCriteriaMaxMarks(doc.label));
    });

    return Array.from(rowMap.values())
      .map((row) => ({
        ...row,
        committeeAverage: row.committeeEntries.length
          ? row.committeeEntries.reduce((sum, entry) => sum + Number(entry.score || 0), 0) / row.committeeEntries.length
          : null,
        document: getBidDocumentByLabel(bid, row.label),
      }))
      .sort((left, right) => {
        const leftIndex = tenderCriteria.findIndex((item) => normalizeLabel(item.name) === normalizeLabel(left.label));
        const rightIndex = tenderCriteria.findIndex((item) => normalizeLabel(item.name) === normalizeLabel(right.label));

        if (leftIndex !== -1 || rightIndex !== -1) {
          return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
        }

        return left.label.localeCompare(right.label);
      });
  }, [aiSummaryMap, getCriteriaMaxMarks, getBidDocumentByLabel, selectedTender?.qcbsConfig?.technicalCriteria, selectedTender?.requiredDocuments]);

  const sortedBids = useMemo(() => {
    return [...bids].sort((left, right) => {
      const leftRank = rankedBidIds.get(left._id) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = rankedBidIds.get(right._id) ?? Number.MAX_SAFE_INTEGER;

      if (leftRank !== rightRank) return leftRank - rightRank;

      if (left.status !== right.status) {
        const priority = (status: BidRecord["status"]) => {
          if (status === "Selected") return 0;
          if (status === "Evaluated") return 1;
          if (status === "Pending") return 2;
          return 3;
        };
        return priority(left.status) - priority(right.status);
      }

      return String(left.vendorName || left.vendorDetails?.name || "").localeCompare(
        String(right.vendorName || right.vendorDetails?.name || "")
      );
    });
  }, [bids, rankedBidIds]);

  const isFinalized = selectedTender?.status === "Awarded" || selectedTender?.status === "Completed";

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="po" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="po" userName={authUser?.name || ""} />
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl text-[#0B3C5D] mb-1">AI Evaluation Results</h1>
            <p className="text-sm text-gray-600">
              Read-only comparison of committee marks and AI scoring for your tenders.
            </p>
          </div>

          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
          {success && <p className="text-sm text-green-700 mb-4">{success}</p>}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">My Tenders</p>
              <p className="text-3xl text-[#0B3C5D]">{tenders.length}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">Selected Tender</p>
              <p className="text-3xl text-[#1D4E89]">{selectedTender ? "1" : "0"}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">AI Summaries</p>
              <p className="text-3xl text-[#2E8B57]">{aiSummaries.filter((item) => item.status === "success").length}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">Committee Reviews</p>
              <p className="text-3xl text-[#F4A300]">
                {bids.reduce((sum, bid) => sum + (bid.committeeEvaluations?.length || 0), 0)}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 mb-6">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-lg text-[#0B3C5D]">Choose a Tender</h3>
                <p className="text-sm text-gray-500">
                  Switch between your published, closed, awarded, and completed tenders to inspect the results.
                </p>
              </div>
              {loadingTenders && <span className="text-xs text-gray-400">Loading tenders...</span>}
            </div>

            <select
              value={selectedTenderId}
              onChange={(e) => setSelectedTenderId(e.target.value)}
              className="w-full md:w-[520px] px-3 py-2 border border-gray-300 rounded-md bg-white"
            >
              <option value="">Choose a tender ({filteredTenders.length} match{filteredTenders.length !== 1 ? "es" : ""})</option>
              {filteredTenders.map((tender) => (
                <option key={tender._id} value={tender._id}>
                  {tender.title} ({tender.status})
                </option>
              ))}
            </select>

            {loadingTenders && <p className="text-sm text-gray-500 mt-2">Loading tenders...</p>}
            {!loadingTenders && tenders.length === 0 && (
              <p className="text-sm text-amber-700 mt-2">No tenders created by you were found.</p>
            )}
          </div>

          {selectedTender && (
            <>
              <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 mb-6">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-lg text-[#0B3C5D]">{selectedTender.title}</h3>
                    <p className="text-sm text-gray-500">Status: {selectedTenderStatus}</p>
                  </div>
                  <span className="inline-flex items-center gap-2 rounded-full bg-blue-50 text-blue-700 px-3 py-1 text-xs">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {getTenderStateLabel(selectedTender)}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                  <div className="bg-gray-50 rounded-md p-3">
                    <p className="text-xs text-gray-500">Category</p>
                    <p className="text-sm text-[#0B3C5D] mt-0.5">{selectedTender.category || "General"}</p>
                  </div>
                  <div className="bg-gray-50 rounded-md p-3">
                    <p className="text-xs text-gray-500">Budget</p>
                    <p className="text-sm text-[#0B3C5D] mt-0.5">
                      {selectedTender.budget ? `INR ${Number(selectedTender.budget).toLocaleString()}` : "-"}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-md p-3">
                    <p className="text-xs text-gray-500">Submission Deadline</p>
                    <p className="text-sm text-[#0B3C5D] mt-0.5">
                      {selectedTender.finalSubmissionDate ? new Date(selectedTender.finalSubmissionDate).toLocaleString() : "-"}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-md p-3">
                    <p className="text-xs text-gray-500">Evaluation Method</p>
                    <p className="text-sm text-[#0B3C5D] mt-0.5">{selectedTender.evaluationMethod || "QCBS"}</p>
                  </div>
                </div>

                {selectedTender.description && <p className="text-sm text-gray-700">{selectedTender.description}</p>}
                <p className="text-sm text-gray-500 mt-3">
                  This page only shows the final or in-progress results. To trigger scoring manually, use the AI Queue page.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                  <p className="text-sm text-gray-600 mb-1">Submissions</p>
                  <p className="text-3xl text-[#0B3C5D]">{bids.length}</p>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                  <p className="text-sm text-gray-600 mb-1">Awarded</p>
                  <p className="text-3xl text-[#2E8B57]">{bids.filter((bid) => bid.status === "Selected").length}</p>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                  <p className="text-sm text-gray-600 mb-1">AI Success</p>
                  <p className="text-3xl text-[#1D4E89]">{aiSummaries.filter((item) => item.status === "success").length}</p>
                </div>
                <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                  <p className="text-sm text-gray-600 mb-1">Ranked Bids</p>
                  <p className="text-3xl text-[#F4A300]">{aiRanking.length}</p>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-lg text-[#0B3C5D]">Vendor Comparison</h3>
                    <p className="text-sm text-gray-500">
                      Each vendor opens into a document-by-document view showing committee marks, AI marks, documents, and evidence.
                    </p>
                  </div>
                  {loadingAi && <span className="text-xs text-gray-400">Loading AI summaries...</span>}
                </div>

                {!sortedBids.length ? (
                  <p className="text-sm text-gray-500">No submissions were received for this tender yet.</p>
                ) : (
                  <div className="space-y-4">
                    {sortedBids.map((bid) => {
                      const summary = aiSummaryMap.get(bid._id);
                      const committee = committeeStatsByBidId.get(bid._id);
                      const rank = rankedBidIds.get(bid._id) || "-";
                      const proposalName = getStoredDocumentName(bid.proposalDocument, "Proposal document");
                      const committeeReviews = Array.isArray(bid.committeeEvaluations) ? bid.committeeEvaluations : [];
                      const criteriaRows = buildCriterionRows(bid);
                      const latestCommitteeComment = committeeReviews.find((review) => review.comments)?.comments || "";
                      const committeeNotes = committeeReviews
                        .map((review, reviewIndex) => ({
                          label: getCommitteeMemberLabel(review.committeeMemberId, reviewIndex),
                          comment: review.comments || "",
                          date: review.evaluatedDate || "",
                        }))
                        .filter((item) => item.comment);
                      const eligibleCount = committeeReviews.filter((review) => review.eligibilityChecked !== false).length;
                      const ineligibleCount = committeeReviews.filter((review) => review.eligibilityChecked === false).length;

                      return (
                        <details key={bid._id} className="group rounded-2xl border border-gray-200 bg-white shadow-sm" open={rank === 1}>
                          <summary className="list-none cursor-pointer px-5 py-4">
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h4 className="text-lg text-[#0B3C5D]">
                                    {bid.vendorName || bid.vendorDetails?.name || "Vendor"}
                                  </h4>
                                  <span className={`rounded-full px-2.5 py-1 text-xs ${getStatusBadgeClass(bid.status)}`}>
                                    {bid.status}
                                  </span>
                                  {bid.status === "Selected" && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs text-green-700">
                                      <CheckCircle className="h-3.5 w-3.5" />
                                      Winner
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm text-gray-500">
                                  {bid.vendorDetails?.email || "No email"} - INR {Number(bid.proposedAmount || 0).toLocaleString()}
                                </p>
                                <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                                  <span className="rounded-full bg-gray-100 px-2.5 py-1">
                                    Committee reviews: {committee?.reviewCount || 0}
                                  </span>
                                  <span className="rounded-full bg-gray-100 px-2.5 py-1">
                                    Eligible: {eligibleCount}
                                  </span>
                                  {ineligibleCount > 0 && (
                                    <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">
                                      Ineligible: {ineligibleCount}
                                    </span>
                                  )}
                                  <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">
                                    AI rank #{rank}
                                  </span>
                                </div>
                              </div>

                              <div className="grid min-w-[280px] grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                                <div className="rounded-xl bg-gray-50 p-3">
                                  <p className="text-[11px] uppercase tracking-wide text-gray-500">Committee tech</p>
                                  <p className="mt-1 text-lg text-[#0B3C5D]">{formatScore(committee?.committeeTechnical)}</p>
                                </div>
                                <div className="rounded-xl bg-emerald-50 p-3">
                                  <p className="text-[11px] uppercase tracking-wide text-emerald-700">AI tech</p>
                                  <p className="mt-1 text-lg text-[#0B3C5D]">{formatScore(summary?.aiScores?.technicalScore)}</p>
                                </div>
                                <div className="rounded-xl bg-gray-50 p-3">
                                  <p className="text-[11px] uppercase tracking-wide text-gray-500">Committee fin</p>
                                  <p className="mt-1 text-lg text-[#0B3C5D]">{formatScore(committee?.committeeFinancial)}</p>
                                </div>
                                <div className="rounded-xl bg-blue-50 p-3">
                                  <p className="text-[11px] uppercase tracking-wide text-blue-700">AI fin</p>
                                  <p className="mt-1 text-lg text-[#0B3C5D]">{formatScore(summary?.aiScores?.financialScore)}</p>
                                </div>
                                <div className="rounded-xl bg-blue-50 p-3">
                                  <p className="text-[11px] uppercase tracking-wide text-blue-700">AI total</p>
                                  <p className="mt-1 text-lg text-[#0B3C5D]">{formatScore(summary?.aiScores?.overallScore)}</p>
                                </div>
                              </div>
                            </div>
                          </summary>

                          <div className="border-t border-gray-100 px-5 py-5">
                            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 px-4 py-3">
                              <div>
                                <p className="text-sm font-medium text-[#0B3C5D]">Final award</p>
                                <p className="text-xs text-gray-600">
                                  {selectedTender?.evaluationMethod === "L1"
                                    ? "Only the lowest qualified commercial bid can be awarded after technical cutoff review."
                                    : "Approve the bid that best fits the committee and AI review for this tender."}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => void selectWinner(bid._id)}
                                disabled={isFinalized || (selectedTender?.evaluationMethod === "L1" && lowestQualifiedBidId !== bid._id)}
                                className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm text-white transition-colors ${
                                  isFinalized || (selectedTender?.evaluationMethod === "L1" && lowestQualifiedBidId !== bid._id)
                                    ? "cursor-not-allowed bg-gray-400"
                                    : "bg-[#2E8B57] hover:bg-[#267347]"
                                }`}
                              >
                                <CheckCircle className="h-4 w-4" />
                                {bid.status === "Selected" ? "Winner selected" : selectedTender?.evaluationMethod === "L1" ? "Approve lowest qualified bid" : "Approve and award"}
                              </button>
                            </div>

                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                              <div className="rounded-2xl bg-slate-50 p-4">
                                <p className="text-xs uppercase tracking-wide text-gray-500">AI notes</p>
                                <p className="mt-2 text-sm text-gray-700">
                                  {summary?.summary || summary?.rationale?.join(" ") || "AI summary pending."}
                                </p>
                                {summary?.eligibility?.reasons?.length ? (
                                  <div className="mt-3 space-y-1">
                                    {summary.eligibility.reasons.slice(0, 3).map((reason, index) => (
                                      <p key={`${bid._id}-reason-${index}`} className="text-xs text-gray-500">
                                        {reason}
                                      </p>
                                    ))}
                                  </div>
                                ) : null}
                              </div>

                              <div className="rounded-2xl bg-slate-50 p-4">
                                <p className="text-xs uppercase tracking-wide text-gray-500">Committee notes</p>
                                <p className="mt-2 text-sm text-gray-700">
                                  {latestCommitteeComment || "No committee comments recorded."}
                                </p>
                                <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
                                  <span className="rounded-full bg-white px-2.5 py-1">
                                    Reviews: {committeeReviews.length}
                                  </span>
                                  <span className="rounded-full bg-white px-2.5 py-1">
                                    Documents: {bid.bidDocuments?.length || 0}
                                  </span>
                                  <span className="rounded-full bg-white px-2.5 py-1">
                                    Proposal: {proposalName}
                                  </span>
                                </div>
                              </div>

                              <div className="rounded-2xl bg-slate-50 p-4">
                                <p className="text-xs uppercase tracking-wide text-gray-500">Document coverage</p>
                                <p className="mt-2 text-sm text-gray-700">
                                  {criteriaRows.length
                                    ? `${criteriaRows.length} criteria rows matched against documents and AI evidence.`
                                    : "No criteria rows were captured for this bid yet."}
                                </p>
                                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                                  <span className="rounded-full bg-white px-2.5 py-1 text-gray-600">
                                    AI rows: {summary?.criteriaScores?.length || 0}
                                  </span>
                                  <span className="rounded-full bg-white px-2.5 py-1 text-gray-600">
                                    Committee rows: {committeeReviews.reduce((sum, review) => sum + (review.criteriaScores?.length || 0), 0)}
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="mt-5 overflow-hidden rounded-2xl border border-gray-200">
                              <table className="w-full text-sm">
                                <thead className="bg-[#0B3C5D] text-white">
                                  <tr>
                                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wide">Criterion / Document</th>
                                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wide">Max</th>
                                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wide">Committee</th>
                                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wide">AI</th>
                                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wide">Gap</th>
                                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wide">Evidence</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 bg-white">
                                  {criteriaRows.length ? (
                                    criteriaRows.map((row) => {
                                      const committeeAverage = row.committeeAverage;
                                      const aiScore = typeof row.aiScore === "number" ? row.aiScore : null;
                                      const gap = committeeAverage !== null && aiScore !== null ? aiScore - committeeAverage : null;
                                      const documentName = row.document ? getStoredDocumentName(row.document.document, row.document.label) : "";

                                      return (
                                        <tr key={`${bid._id}-${row.key}`} className="align-top hover:bg-gray-50">
                                          <td className="px-4 py-4 min-w-[220px]">
                                            <p className="font-medium text-[#0B3C5D]">{row.label}</p>
                                            {documentName ? (
                                              <p className="mt-1 text-xs text-gray-500">{documentName}</p>
                                            ) : (
                                              <p className="mt-1 text-xs text-gray-400">No uploaded document matched</p>
                                            )}
                                          </td>
                                          <td className="px-4 py-4 whitespace-nowrap text-gray-600">
                                            {row.maxMarks || "-"}
                                          </td>
                                          <td className="px-4 py-4 min-w-[220px]">
                                            <div className="flex items-end gap-3">
                                              <div>
                                                <p className="text-lg text-[#0B3C5D]">
                                                  {committeeAverage !== null ? formatScore(committeeAverage) : "-"}
                                                </p>
                                                <p className="text-xs text-gray-500">
                                                  {row.committeeEntries.length} committee mark{row.committeeEntries.length === 1 ? "" : "s"}
                                                </p>
                                              </div>
                                              <div className="flex flex-wrap gap-1">
                                                {row.committeeEntries.slice(0, 3).map((entry, index) => (
                                                  <span
                                                    key={`${row.key}-committee-${index}`}
                                                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                                                      entry.eligible ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                                                    }`}
                                                  >
                                                    {entry.memberLabel}: {formatScore(entry.score)}
                                                  </span>
                                                ))}
                                                {row.committeeEntries.length > 3 && (
                                                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                                                    +{row.committeeEntries.length - 3} more
                                                  </span>
                                                )}
                                              </div>
                                            </div>
                                          </td>
                                          <td className="px-4 py-4 min-w-[180px]">
                                            <p className="text-lg text-[#0B3C5D]">
                                              {aiScore !== null ? formatScore(aiScore) : "-"}
                                            </p>
                                            <p className="text-xs text-gray-500">
                                              {summary?.status === "success" ? "AI completed" : "AI pending"}
                                            </p>
                                          </td>
                                          <td className="px-4 py-4 whitespace-nowrap">
                                            {gap !== null ? (
                                              <span
                                                className={`rounded-full px-2.5 py-1 text-xs ${
                                                  gap > 0 ? "bg-emerald-50 text-emerald-700" : gap < 0 ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-700"
                                                }`}
                                              >
                                                {gap > 0 ? "+" : ""}
                                                {formatScore(gap)}
                                              </span>
                                            ) : (
                                              <span className="text-xs text-gray-400">-</span>
                                            )}
                                          </td>
                                          <td className="px-4 py-4 min-w-[280px]">
                                            <div className="space-y-2">
                                              {row.aiEvidence.length ? (
                                                <div className="flex flex-wrap gap-2">
                                                  {row.aiEvidence.slice(0, 3).map((evidence, index) => (
                                                    <span
                                                      key={`${row.key}-evidence-${index}`}
                                                      className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] text-blue-700"
                                                    >
                                                      {evidence}
                                                    </span>
                                                  ))}
                                                  {row.aiEvidence.length > 3 && (
                                                    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] text-blue-700">
                                                      +{row.aiEvidence.length - 3} more
                                                    </span>
                                                  )}
                                                </div>
                                              ) : (
                                                <p className="text-xs text-gray-400">No AI evidence returned.</p>
                                              )}

                                              {row.document && getBidDocumentUrl(row.document) && (
                                                <a
                                                  href={getBidDocumentUrl(row.document)}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                  className="inline-flex items-center gap-1 text-xs text-[#1D4E89] hover:underline"
                                                >
                                                  <FileText className="h-3.5 w-3.5" />
                                                  Open source document
                                                </a>
                                              )}
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })
                                  ) : (
                                    <tr>
                                      <td className="px-4 py-5 text-sm text-gray-500" colSpan={6}>
                                        No document-by-document scores were found for this vendor yet.
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>

                            <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                                <p className="text-sm font-medium text-[#0B3C5D]">Uploaded documents</p>
                                <div className="mt-3 space-y-2">
                                  {bid.bidDocuments?.length ? (
                                    bid.bidDocuments.map((doc) => {
                                      const name = getStoredDocumentName(doc.document, doc.label);
                                      const url = getBidDocumentUrl(doc);

                                      return (
                                        <div
                                          key={`${bid._id}-${doc.label}`}
                                          className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3"
                                        >
                                          <div className="flex items-center gap-2">
                                            <FileText className="h-4 w-4 text-[#1D4E89]" />
                                            <div>
                                              <p className="text-sm text-[#0B3C5D]">{doc.label}</p>
                                              <p className="text-xs text-gray-500">{name}</p>
                                            </div>
                                          </div>
                                          {url ? (
                                            <a
                                              href={url}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="text-xs text-[#1D4E89] hover:underline"
                                            >
                                              Open
                                            </a>
                                          ) : (
                                            <span className="text-xs text-gray-400">Unavailable</span>
                                          )}
                                        </div>
                                      );
                                    })
                                  ) : (
                                    <p className="text-sm text-gray-400">No documents uploaded.</p>
                                  )}
                                </div>
                              </div>

                              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                                <p className="text-sm font-medium text-[#0B3C5D]">Committee review notes</p>
                                <div className="mt-3 space-y-3">
                                  {committeeNotes.length ? (
                                    committeeNotes.map((note, index) => (
                                      <div key={`${bid._id}-note-${index}`} className="rounded-xl bg-gray-50 p-3">
                                        <div className="flex items-center justify-between gap-3">
                                          <p className="text-sm text-[#0B3C5D]">{note.label}</p>
                                          <p className="text-xs text-gray-400">
                                            {note.date ? new Date(note.date).toLocaleString() : "No date"}
                                          </p>
                                        </div>
                                        <p className="mt-2 text-xs text-gray-600">{note.comment}</p>
                                      </div>
                                    ))
                                  ) : (
                                    <p className="text-sm text-gray-400">No committee member comments recorded yet.</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </details>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <AIAssistant role="po" />
    </div>
  );
}
