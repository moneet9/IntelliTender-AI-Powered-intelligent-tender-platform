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
  status: "pending" | "running" | "success" | "failed";
  summary?: string;
  rationale?: string[];
  eligibility?: {
    passed?: boolean;
    reasons?: string[];
  };
  eligibilityOverride?: boolean;
  criteriaScores?: Array<{
    criterion: string;
    maxMarks?: number;
    awardedMarks?: number;
    documentLabel?: string;
    evidence?: string[];
  }>;
  commercialAnalysis?: {
    statedValue?: number;
    adjustedValue?: number;
    rationale?: string;
    risks?: string[];
  };
  aiScores?: {
    technicalScore?: number;
    financialScore?: number;
    overallScore?: number;
  };
  aiRank?: number | null;
  error?: string;
  inferenceTelemetry?: {
    totalTokens?: number;
    promptTokens?: number;
    completionTokens?: number;
    tokensPerSecond?: number;
    averageGpuPowerWatts?: number | null;
    estimatedEnergyJoules?: number | null;
    usageAvailable?: boolean;
    telemetrySource?: string;
    tokenCountSource?: string;
    generationTimeSeconds?: number;
    evaluationDurationSeconds?: number;
    timeToFirstTokenSeconds?: number;
  };
  evaluationTrace?: {
    inspectedTenderDocuments?: Array<{ name?: string; readableCharacters?: number }>;
    inspectedBidDocuments?: Array<{ label?: string; category?: string; readableCharacters?: number }>;
    evaluationOrder?: string[];
    source?: string;
    scoreCalculation?: string;
  };
};

type AiEvaluationState = {
  status: "idle" | "running" | "paused" | "completed" | "failed";
  action: "start" | "resume" | "pause" | "auto";
  startedAt?: string | null;
  updatedAt?: string | null;
  pausedAt?: string | null;
  completedAt?: string | null;
  currentBidId?: string | null;
  currentVendorName?: string;
  nextBidIndex?: number;
  totalBids?: number;
  completedBids?: number;
  lastError?: string;
  force?: boolean;
};

type BidDocumentEntry = NonNullable<BidRecord["bidDocuments"]>[number];

const formatElapsed = (seconds?: number) => {
  const totalSeconds = Math.max(0, Math.round(Number(seconds || 0)));
  if (!totalSeconds) return "-";
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return minutes ? `${minutes}m ${String(remainder).padStart(2, "0")}s` : `${remainder}s`;
};

export function AIEvaluation() {
  const authUser = getAuthUser();
  const apiBaseUrl = (import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL || "http://localhost:5000";
  const [tenders, setTenders] = useState<TenderRecord[]>([]);
  const [selectedTenderId, setSelectedTenderId] = useState("");
  const [bids, setBids] = useState<BidRecord[]>([]);
  const [aiSummaries, setAiSummaries] = useState<AiSummary[]>([]);
  const [aiEvaluationState, setAiEvaluationState] = useState<AiEvaluationState | null>(null);
  const [loadingTenders, setLoadingTenders] = useState(false);
  const [loadingBids, setLoadingBids] = useState(false);
  const [loadingAi, setLoadingAi] = useState(false);
  const [reEvaluatingBidId, setReEvaluatingBidId] = useState<string | null>(null);
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
      const data = await apiRequest<TenderRecord[]>("/api/tenders?summary=true&mine=true", { timeoutMs: 15000 });
      const allTenderRecords = Array.isArray(data) ? data : [];
      const createdByMe = allTenderRecords.filter((tender) => String(getTenderOwnerId(tender)) === String(authUser?._id || ""));
      const visibleCreatedByMe = createdByMe.filter((tender) => tender.status !== "Draft");
      const visible = visibleCreatedByMe;
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

  const loadAiEvaluationState = useCallback(async (tenderId: string) => {
    if (!tenderId) {
      setAiEvaluationState(null);
      return;
    }

    try {
      const data = await apiRequest<AiEvaluationState>(`/api/ai/evaluations/tenders/${tenderId}/state`);
      setAiEvaluationState(data || null);
    } catch {
      setAiEvaluationState(null);
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

  const reEvaluateBid = async (bidId: string, bypassEligibility = false) => {
    if (!selectedTenderId) return;

    setError("");
    setSuccess("");
    setReEvaluatingBidId(bidId);

    try {
      const result = await apiRequest<{ summary?: AiSummary }>(`/api/ai/evaluations/tenders/${selectedTenderId}/run?manual=true&force=true&bidId=${bidId}${bypassEligibility ? "&bypassEligibility=true" : ""}`, {
        method: "POST",
        body: { action: "start", bidId, bypassEligibility },
        // Local OCR/AI evaluation can legitimately take several minutes.
        // The default 20-second UI timeout was disconnecting LM Studio mid-prompt.
        timeoutMs: 10 * 60 * 1000,
      });
      if (result?.summary) {
        const summary = result.summary;
        setAiSummaries((previous) => [
          ...previous.filter((item) => item.bidId !== summary.bidId),
          summary,
        ]);
      }
      setSuccess(result?.summary?.status === "failed" ? "AI re-evaluation failed. See the AI notes for the reason." : "AI score and reasoning updated.");
      await loadAiSummaries(selectedTenderId);
      await loadAiEvaluationState(selectedTenderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to re-evaluate bid");
    } finally {
      setReEvaluatingBidId(null);
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

  useEffect(() => {
    void loadAiEvaluationState(selectedTenderId);
  }, [loadAiEvaluationState, selectedTenderId]);

  useEffect(() => {
    if (!selectedTenderId) return undefined;

    const timer = window.setInterval(() => {
      void loadAiSummaries(selectedTenderId);
      void loadAiEvaluationState(selectedTenderId);
    }, 10000);

    return () => window.clearInterval(timer);
  }, [loadAiEvaluationState, loadAiSummaries, selectedTenderId]);

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
      .filter((bid) => aiSummaryMap.get(bid._id)?.status === "success")
      .map((bid) => {
        const summary = aiSummaryMap.get(bid._id);
        const explicitRank = Number(summary?.aiRank || 0);
        return {
          bidId: bid._id,
          aiRank: Number.isFinite(explicitRank) && explicitRank > 0 ? explicitRank : null,
          score: Number(summary?.aiScores?.overallScore || summary?.aiScores?.technicalScore || 0),
        };
      })
      .sort((left, right) => {
        const leftRank = left.aiRank ?? Number.MAX_SAFE_INTEGER;
        const rightRank = right.aiRank ?? Number.MAX_SAFE_INTEGER;
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return String(left.bidId).localeCompare(String(right.bidId));
      })
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
      const technicalMaximum = (selectedTender?.qcbsConfig?.technicalCriteria || [])
        .reduce((sum, criterion) => sum + Number(criterion.maxMarks || 0), 0);
      const committeeTechnicalScore = technicalMaximum > 0
        ? Math.min(100, Math.max(0, (committeeTechnical / technicalMaximum) * 100))
        : Math.min(100, Math.max(0, committeeTechnical));

      const committeePrices = bids
        .map((item) => {
          const itemEvaluations = Array.isArray(item.committeeEvaluations) ? item.committeeEvaluations : [];
          return itemEvaluations.length
            ? itemEvaluations.reduce((sum, evaluation) => sum + Number(evaluation.financialScore || 0), 0) / itemEvaluations.length
            : Number(item.financialScore || 0);
        })
        .filter((amount) => Number.isFinite(amount) && amount > 0);
      const lowestCommitteePrice = committeePrices.length ? Math.min(...committeePrices) : 0;
      const committeeFinancialScore = lowestCommitteePrice > 0 && committeeFinancial > 0
        ? Math.min(100, (lowestCommitteePrice / committeeFinancial) * 100)
        : 0;
      const technicalWeight = Number(selectedTender?.qcbsConfig?.technicalWeight);
      const commercialWeight = Number(selectedTender?.qcbsConfig?.commercialWeight);
      const hasWeights = Number.isFinite(technicalWeight) && Number.isFinite(commercialWeight) && technicalWeight + commercialWeight > 0;
      const committeeTotal = (committeeTechnicalScore * (hasWeights ? technicalWeight : 50)
        + committeeFinancialScore * (hasWeights ? commercialWeight : 50))
        / (hasWeights ? technicalWeight + commercialWeight : 100);

      return {
        bidId: bid._id,
        reviewCount,
        committeeTechnical: Number(committeeTechnical.toFixed(2)),
        committeeFinancial: Number(committeeFinancial.toFixed(2)),
        committeeTechnicalScore: Number(committeeTechnicalScore.toFixed(2)),
        committeeFinancialScore: Number(committeeFinancialScore.toFixed(2)),
        committeeTotal: Number(committeeTotal.toFixed(2)),
      };
    });
  }, [bids, selectedTender]);

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
      documentLabel?: string;
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
      if (criteriaScore?.documentLabel) {
        row.documentLabel = String(criteriaScore.documentLabel).trim();
      }
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

  const getBidAiStage = (bid: BidRecord, summary?: AiSummary) => {
    if (summary?.status === "success") {
      if (summary?.eligibility?.passed === false) {
        return { label: "AI completed · ineligible", tone: "failed" as const };
      }
      return { label: "AI completed", tone: "success" as const };
    }
    if (summary?.status === "failed") {
      return { label: "AI failed", tone: "failed" as const };
    }
    if (summary?.status === "running") {
      return { label: "AI scoring now", tone: "running" as const };
    }

    if (aiEvaluationState?.status === "running") {
      if (aiEvaluationState.currentBidId && aiEvaluationState.currentBidId === bid._id) {
        return { label: "AI scoring now", tone: "running" as const };
      }

      const currentIndex = bids.findIndex((item) => item._id === bid._id);
      const nextIndex = Number(aiEvaluationState.nextBidIndex || 0);
      if (currentIndex >= 0 && currentIndex > nextIndex) {
        return { label: "AI queued", tone: "queued" as const };
      }
      return { label: "AI waiting", tone: "queued" as const };
    }

    if (aiEvaluationState?.status === "paused") {
      return { label: "AI paused", tone: "paused" as const };
    }

    if (aiEvaluationState?.status === "completed") {
      return { label: "AI not processed", tone: "queued" as const };
    }

    return { label: "AI not started", tone: "queued" as const };
  };

  const getBidAiStageClass = (tone: "success" | "failed" | "running" | "queued" | "paused") => {
    if (tone === "success") return "bg-emerald-50 text-emerald-700";
    if (tone === "failed") return "bg-red-50 text-red-700";
    if (tone === "running") return "bg-blue-50 text-blue-700";
    if (tone === "paused") return "bg-amber-50 text-amber-700";
    return "bg-gray-100 text-gray-600";
  };

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
                  This page shows live evaluation progress. AI scoring runs automatically after submission and updates as the queue moves.
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
                                  {(() => {
                                    const stage = getBidAiStage(bid, summary);
                                    return (
                                      <span className={`rounded-full px-2.5 py-1 text-xs ${getBidAiStageClass(stage.tone)}`}>
                                        {stage.label}
                                      </span>
                                    );
                                  })()}
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

                              <div className="grid min-w-[280px] grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                                <div className="rounded-xl bg-emerald-50 p-3">
                                  <p className="text-[11px] uppercase tracking-wide text-emerald-700">Committee tech</p>
                                  <p className="mt-1 text-lg text-[#0B3C5D]">{formatScore(committee?.committeeTechnicalScore)}</p>
                                </div>
                                <div className="rounded-xl bg-blue-50 p-3">
                                  <p className="text-[11px] uppercase tracking-wide text-blue-700">AI tech</p>
                                  <p className="mt-1 text-lg text-[#0B3C5D]">{formatScore(summary?.aiScores?.technicalScore)}</p>
                                </div>
                                <div className="rounded-xl bg-emerald-50 p-3">
                                  <p className="text-[11px] uppercase tracking-wide text-emerald-700">Committee fin</p>
                                  <p className="mt-1 text-lg text-[#0B3C5D]">{formatScore(committee?.committeeFinancialScore)}</p>
                                </div>
                                <div className="rounded-xl bg-blue-50 p-3">
                                  <p className="text-[11px] uppercase tracking-wide text-blue-700">AI fin</p>
                                  <p className="mt-1 text-lg text-[#0B3C5D]">{formatScore(summary?.aiScores?.financialScore)}</p>
                                </div>
                                <div className="rounded-xl bg-emerald-50 p-3">
                                  <p className="text-[11px] uppercase tracking-wide text-emerald-700">Committee total</p>
                                  <p className="mt-1 text-lg text-[#0B3C5D]">{formatScore(committee?.committeeTotal)}</p>
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
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => void reEvaluateBid(bid._id)}
                                  disabled={Boolean(reEvaluatingBidId) && reEvaluatingBidId !== bid._id}
                                  className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm text-white transition-colors ${
                                    reEvaluatingBidId === bid._id
                                      ? "cursor-wait bg-[#1D4E89] opacity-80"
                                      : Boolean(reEvaluatingBidId)
                                        ? "cursor-not-allowed bg-gray-400"
                                        : "bg-[#1D4E89] hover:bg-[#16386a]"
                                  }`}
                                >
                                  <FileText className="h-4 w-4" />
                                  {reEvaluatingBidId === bid._id ? "Re-evaluating..." : "Re-evaluate bid"}
                                </button>
                                {summary && summary.status !== "pending" && !summary.eligibilityOverride && (summary.status === "failed" || summary.eligibility?.passed === false) ? (
                                    <button
                                    type="button"
                                    onClick={() => void reEvaluateBid(bid._id, true)}
                                    disabled={Boolean(reEvaluatingBidId)}
                                    className="inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    Score with PO override
                                  </button>
                                ) : null}
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
                            </div>

                            <div className="grid grid-cols-1 gap-3">
                              <div className="rounded-2xl bg-slate-50 p-4">
                                <p className="text-xs uppercase tracking-wide text-gray-500">AI notes</p>
                                <p className="mt-2 text-sm text-gray-700">
                                  {summary?.summary || summary?.rationale?.join(" ") || "AI summary pending."}
                                </p>
                                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  <div className="rounded-xl border border-white bg-white/80 px-3 py-2">
                                    <p className="text-[11px] uppercase tracking-wide text-gray-500">Eligibility</p>
                                    <p className={`mt-1 text-sm font-medium ${!summary || summary.status === "failed" ? "text-gray-600" : summary.eligibility?.passed === false ? "text-red-700" : "text-emerald-700"}`}>
                                      {!summary ? "Not evaluated" : summary.status === "failed" ? "Evaluation failed" : summary.eligibility?.passed === false ? "Failed" : "Passed"}
                                    </p>
                                    <p className="mt-1 text-xs text-gray-500">
                                      {summary?.error || summary?.eligibility?.reasons?.[0] || (!summary ? "AI evaluation has not completed yet." : "Eligibility check completed from the uploaded documents.")}
                                    </p>
                                  </div>
                                  <div className="rounded-xl border border-white bg-white/80 px-3 py-2">
                                    <p className="text-[11px] uppercase tracking-wide text-gray-500">AI rank</p>
                                    <p className="mt-1 text-sm font-medium text-[#0B3C5D]">#{rank}</p>
                                    <p className="mt-1 text-xs text-gray-500">
                                      Technical, commercial, and eligibility checks combined.
                                    </p>
                                  </div>
                                </div>
                                {summary?.status === "success" && summary.eligibility?.passed === false ? (
                                  <div className="mt-3 rounded-xl border border-red-100 bg-red-50/70 px-3 py-2">
                                    <p className="text-[11px] font-medium uppercase tracking-wide text-red-700">{summary.eligibilityOverride ? "Eligibility failed · override scoring" : "Ineligible as per AI"}</p>
                                    <p className="mt-1 text-xs text-red-700">
                                      {summary.eligibilityOverride
                                        ? "Eligibility remains failed. The PO requested conditional technical and commercial scoring for review; this override does not make the bid legally eligible."
                                        : "The AI marked this bid ineligible, so the score rows below are shown as zero with the eligibility reason attached."}
                                    </p>
                                  </div>
                                ) : null}
                                {summary?.status === "failed" && summary?.error ? (
                                  <p className="mt-2 text-xs text-red-600">
                                    Failure reason: {summary.error}
                                  </p>
                                ) : null}
                                {summary?.eligibility?.reasons?.length ? (
                                  <div className="mt-3 space-y-1">
                                    {summary.eligibility.reasons.slice(0, 3).map((reason, index) => (
                                      <p key={`${bid._id}-reason-${index}`} className="text-xs text-gray-500">
                                        {reason}
                                      </p>
                                    ))}
                                  </div>
                                ) : null}
                                {summary?.evaluationTrace ? (
                                  <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2">
                                    <p className="text-[11px] font-medium uppercase tracking-wide text-blue-700">Evaluation evidence</p>
                                    <p className="mt-1 text-xs text-blue-800">
                                      Compared {summary.evaluationTrace.inspectedTenderDocuments?.length || 0} tender documents with {summary.evaluationTrace.inspectedBidDocuments?.length || 0} readable bid documents.
                                    </p>
                                    <p className="mt-1 text-[11px] text-blue-700">
                                      Order: {(summary.evaluationTrace.evaluationOrder || ["eligibility", "technical", "commercial"]).join(" → ")}
                                    </p>
                                  </div>
                                ) : null}
                                {summary?.inferenceTelemetry ? (
                                  <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/60 px-3 py-2">
                                    <p className="text-[11px] font-medium uppercase tracking-wide text-violet-700">Bid AI usage</p>
                                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-violet-800 sm:grid-cols-3">
                                      <span className="rounded-lg bg-violet-100 px-2.5 py-2 font-semibold">Time: {formatElapsed(summary.inferenceTelemetry.evaluationDurationSeconds || summary.inferenceTelemetry.generationTimeSeconds)}</span>
                                      <span className="rounded-full bg-white px-2.5 py-1">Tokens: {summary.inferenceTelemetry.usageAvailable ? (summary.inferenceTelemetry.totalTokens || 0).toLocaleString() : "unavailable"}</span>
                                      {summary.inferenceTelemetry.tokensPerSecond ? <span className="rounded-full bg-white px-2.5 py-1">Speed: {summary.inferenceTelemetry.tokensPerSecond.toFixed(1)} tok/s</span> : null}
                                      {summary.inferenceTelemetry.averageGpuPowerWatts !== null && summary.inferenceTelemetry.averageGpuPowerWatts !== undefined ? <span className="rounded-full bg-white px-2.5 py-1">GPU: {summary.inferenceTelemetry.averageGpuPowerWatts.toFixed(1)} W</span> : null}
                                      {summary.inferenceTelemetry.estimatedEnergyJoules !== null && summary.inferenceTelemetry.estimatedEnergyJoules !== undefined ? <span className="rounded-full bg-white px-2.5 py-1">Energy: {summary.inferenceTelemetry.estimatedEnergyJoules.toFixed(1)} J</span> : null}
                                      {summary.inferenceTelemetry.timeToFirstTokenSeconds ? <span className="rounded-full bg-white px-2.5 py-1">First output: {summary.inferenceTelemetry.timeToFirstTokenSeconds.toFixed(2)}s</span> : null}
                                    </div>
                                    <p className="mt-2 text-[11px] text-violet-700">Measured for this bid evaluation, not individual chunks. Source: {summary.inferenceTelemetry.tokenCountSource || "unavailable"}.</p>
                                  </div>
                                ) : null}
                                {summary?.status === "success" ? (
                                  <details className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                                    <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-slate-700">
                                      AI decision trace
                                    </summary>
                                    <div className="mt-3 space-y-3 text-xs text-gray-600">
                                      <div>
                                        <p className="font-medium text-slate-800">1. Eligibility</p>
                                        <p className="mt-1">{summary.eligibility?.passed ? "Passed; technical and commercial review was allowed." : summary.eligibilityOverride ? "Failed; PO override enabled conditional technical and commercial review." : "Failed; technical and commercial marks are zero."}</p>
                                        {(summary.eligibility?.reasons || []).map((reason, index) => (
                                          <p key={`${bid._id}-trace-eligibility-${index}`} className="mt-1 text-red-700">• {reason}</p>
                                        ))}
                                      </div>
                                      <div>
                                        <p className="font-medium text-slate-800">2. Technical comparison</p>
                                        {!summary.eligibility?.passed && !summary.eligibilityOverride ? (
                                          <p className="mt-1">Not scored because eligibility failed.</p>
                                        ) : summary.criteriaScores?.length ? (
                                          summary.criteriaScores.map((criterion, index) => (
                                            <p key={`${bid._id}-trace-technical-${index}`} className="mt-1">
                                              • {criterion.criterion}: {formatScore(criterion.awardedMarks)} / {formatScore(criterion.maxMarks)} — {criterion.documentLabel || "No matching document"}. {criterion.evidence?.[0] || "No evidence returned."}
                                            </p>
                                          ))
                                        ) : <p className="mt-1">No technical criteria were returned.</p>}
                                      </div>
                                      <div>
                                        <p className="font-medium text-slate-800">3. Commercial comparison</p>
                                        <p className="mt-1">{!summary.eligibility?.passed && !summary.eligibilityOverride ? "Not evaluated because eligibility failed." : summary.commercialAnalysis?.rationale || "No commercial rationale returned."}</p>
                                        {summary.evaluationTrace.scoreCalculation ? <p className="mt-1 text-blue-700">{summary.evaluationTrace.scoreCalculation}</p> : null}
                                      </div>
                                    </div>
                                  </details>
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

                            <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
                                <p className="text-xs uppercase tracking-wide text-emerald-700">Technical breakdown</p>
                                <div className="mt-3 grid grid-cols-3 gap-3">
                                  <div className="rounded-xl bg-white px-3 py-2">
                                    <p className="text-[11px] uppercase tracking-wide text-gray-500">AI technical</p>
                                    <p className="mt-1 text-lg text-[#0B3C5D]">{formatScore(summary?.aiScores?.technicalScore)}</p>
                                  </div>
                                  <div className="rounded-xl bg-white px-3 py-2">
                                    <p className="text-[11px] uppercase tracking-wide text-gray-500">AI commercial</p>
                                    <p className="mt-1 text-lg text-[#0B3C5D]">{formatScore(summary?.aiScores?.financialScore)}</p>
                                  </div>
                                  <div className="rounded-xl bg-white px-3 py-2">
                                    <p className="text-[11px] uppercase tracking-wide text-gray-500">Overall</p>
                                    <p className="mt-1 text-lg text-[#0B3C5D]">{formatScore(summary?.aiScores?.overallScore)}</p>
                                  </div>
                                </div>
                                <div className="mt-3 rounded-xl bg-white px-3 py-2">
                                  <p className="text-[11px] uppercase tracking-wide text-gray-500">Commercial analysis</p>
                                  <p className="mt-1 text-sm text-gray-700">
                                    {summary?.commercialAnalysis?.rationale || "No commercial rationale recorded."}
                                  </p>
                                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                                    {typeof summary?.commercialAnalysis?.statedValue === "number" && (
                                      <span className="rounded-full bg-gray-100 px-2.5 py-1">
                                        Stated: INR {Number(summary.commercialAnalysis.statedValue).toLocaleString()}
                                      </span>
                                    )}
                                    {typeof summary?.commercialAnalysis?.adjustedValue === "number" && (
                                      <span className="rounded-full bg-gray-100 px-2.5 py-1">
                                        Adjusted: INR {Number(summary.commercialAnalysis.adjustedValue).toLocaleString()}
                                      </span>
                                    )}
                                  </div>
                                  {summary?.commercialAnalysis?.risks?.length ? (
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {summary.commercialAnalysis.risks.slice(0, 3).map((risk, index) => (
                                        <span key={`${bid._id}-risk-${index}`} className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] text-amber-700">
                                          {risk}
                                        </span>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              </div>

                              <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4">
                                <p className="text-xs uppercase tracking-wide text-blue-700">Document-by-document marks</p>
                                <p className="mt-2 text-sm text-gray-700">
                                  Each row below ties the criterion back to the uploaded document, the AI mark, and the committee mark.
                                </p>
                                <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
                                  <span className="rounded-full bg-white px-2.5 py-1">
                                    AI criteria rows: {summary?.criteriaScores?.length || 0}
                                  </span>
                                  <span className="rounded-full bg-white px-2.5 py-1">
                                    Document labels: {new Set((summary?.criteriaScores || []).map((item) => item.documentLabel).filter(Boolean)).size}
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
                                        const documentUrl = row.document ? getBidDocumentUrl(row.document) : null;

                                      return (
                                        <tr key={`${bid._id}-${row.key}`} className="align-top hover:bg-gray-50">
                                          <td className="px-4 py-4 min-w-[220px]">
                                            <p className="font-medium text-[#0B3C5D]">{row.label}</p>
                                            {row.documentLabel ? (
                                              <p className="mt-1 text-xs text-blue-600">AI document: {row.documentLabel}</p>
                                            ) : null}
                                            {documentName ? (
                                              <p className="mt-1 text-xs text-gray-500">{documentName}</p>
                                            ) : (
                                              <p className="mt-1 text-xs text-gray-400">No uploaded document matched</p>
                                            )}
                                          </td>
                                          <td className="px-4 py-4 whitespace-nowrap text-gray-600">
                                            {row.maxMarks || "-"}
                                          </td>
                                          <td className="px-4 py-4 min-w-[180px]">
                                            <p className="text-lg text-[#0B3C5D]">
                                              {committeeAverage !== null ? formatScore(committeeAverage) : "-"}
                                            </p>
                                            <p className="text-xs text-gray-500">
                                              {row.committeeEntries.length} committee mark{row.committeeEntries.length === 1 ? "" : "s"}
                                            </p>
                                          </td>
                                          <td className="px-4 py-4 min-w-[180px]">
                                            <p className="text-lg text-[#0B3C5D]">
                                              {aiScore !== null ? formatScore(aiScore) : "-"}
                                            </p>
                                            <p className="text-xs text-gray-500">
                                              {getBidAiStage(bid, summary).label}
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
                                              ) : summary?.eligibility?.passed === false && summary?.eligibility?.reasons?.length ? (
                                                <div className="flex flex-wrap gap-2">
                                                  <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] text-red-700">
                                                    Ineligible as per AI
                                                  </span>
                                                  {summary.eligibility.reasons.slice(0, 3).map((reason, index) => (
                                                    <span
                                                      key={`${row.key}-eligibility-${index}`}
                                                      className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] text-red-700"
                                                    >
                                                      {reason}
                                                    </span>
                                                  ))}
                                                </div>
                                              ) : (
                                                <p className="text-xs text-gray-400">No AI evidence returned.</p>
                                              )}

                                              {documentUrl && (
                                                <a
                                                  href={documentUrl}
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
                                      const url = getBidDocumentUrl(doc) || undefined;

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
