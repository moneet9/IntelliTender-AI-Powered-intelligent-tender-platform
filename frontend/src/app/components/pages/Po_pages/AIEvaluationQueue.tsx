import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock3, FileText, PlayCircle } from "lucide-react";
import { Sidebar } from "../../layout/Sidebar";
import { Header } from "../../layout/Header";
import { AIAssistant } from "../../AIAssistant";
import { apiRequest, getAuthUser } from "../../../api";

type TenderStatus = "Draft" | "Published" | "Closed" | "Awarded" | "Completed";

type AiEvaluationState = {
  status?: "idle" | "running" | "paused" | "completed" | "failed";
  action?: "start" | "resume" | "pause" | "auto";
  startedAt?: string;
  updatedAt?: string;
  pausedAt?: string;
  completedAt?: string;
  currentBidId?: string | null;
  currentVendorName?: string;
  nextBidIndex?: number;
  totalBids?: number;
  completedBids?: number;
  lastError?: string;
  force?: boolean;
};

type TenderRecord = {
  _id: string;
  title: string;
  description?: string;
  status: TenderStatus;
  category?: string;
  budget?: number;
  finalSubmissionDate?: string;
  createdBy?: { _id?: string; name?: string } | string;
  bids?: Array<{ _id: string }>;
  aiEvaluationState?: AiEvaluationState;
};

type AiSummary = {
  _id: string;
  tenderId: string;
  bidId: string;
  status: "pending" | "success" | "failed";
  generatedAt?: string;
};

export function AIEvaluationQueue() {
  const authUser = getAuthUser();
  const [tenders, setTenders] = useState<TenderRecord[]>([]);
  const [selectedTenderId, setSelectedTenderId] = useState("");
  const [aiSummaries, setAiSummaries] = useState<AiSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingAi, setLoadingAi] = useState(false);
  const [runningTenderId, setRunningTenderId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const getTenderOwnerId = (tender: TenderRecord) => {
    if (!tender.createdBy) return "";
    if (typeof tender.createdBy === "string") return tender.createdBy;
    return tender.createdBy._id || "";
  };

  const isOwnTender = useCallback(
    (tender: TenderRecord) => {
      if (!authUser?._id) return false;
      return getTenderOwnerId(tender) === authUser._id;
    },
    [authUser?._id]
  );

  const isDeadlinePassed = (tender: TenderRecord) => {
    if (!tender.finalSubmissionDate) return false;
    const deadline = new Date(tender.finalSubmissionDate);
    return !Number.isNaN(deadline.getTime()) && deadline <= new Date();
  };

  const loadTenders = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest<TenderRecord[]>("/api/tenders");
      const queueItems = (data || []).filter((tender) => {
        return isOwnTender(tender);
      });

      setTenders(queueItems);
      setSelectedTenderId((previousId) => {
        if (previousId && queueItems.some((item) => item._id === previousId)) {
          return previousId;
        }
        return queueItems[0]?._id || "";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tenders");
    } finally {
      setLoading(false);
    }
  }, [isOwnTender]);

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

  const refreshTenderState = useCallback(async (tenderId: string) => {
    if (!tenderId) return;

    try {
      const state = await apiRequest<AiEvaluationState>(`/api/ai/evaluations/tenders/${tenderId}/state`);
      setTenders((previous) => previous.map((tender) => (tender._id === tenderId ? { ...tender, aiEvaluationState: state } : tender)));
    } catch {
      // Best-effort refresh only.
    }
  }, []);

  useEffect(() => {
    void loadTenders();
  }, [loadTenders]);

  useEffect(() => {
    void loadAiSummaries(selectedTenderId);
  }, [loadAiSummaries, selectedTenderId]);

  const selectedTender = useMemo(
    () => tenders.find((tender) => tender._id === selectedTenderId) || null,
    [tenders, selectedTenderId]
  );

  useEffect(() => {
    const selectedState = selectedTender?.aiEvaluationState?.status;
    if (!selectedTenderId || (selectedState !== "running" && selectedState !== "paused")) {
      return;
    }

    void refreshTenderState(selectedTenderId);
    const intervalId = window.setInterval(() => {
      void refreshTenderState(selectedTenderId);
    }, 3000);

    return () => window.clearInterval(intervalId);
  }, [refreshTenderState, selectedTenderId, selectedTender?.aiEvaluationState?.status]);

  const filteredTenders = useMemo(() => {
    return [...tenders].sort((left, right) => {
      const leftDate = new Date(left.finalSubmissionDate || 0).getTime();
      const rightDate = new Date(right.finalSubmissionDate || 0).getTime();
      return leftDate - rightDate;
    });
  }, [tenders]);

  const queueSummary = useMemo(() => {
    const total = tenders.length;
    const ready = tenders.filter((tender) => isDeadlinePassed(tender)).length;
    const waiting = total - ready;
    const running = tenders.filter((tender) => tender.aiEvaluationState?.status === "running").length;
    const paused = tenders.filter((tender) => tender.aiEvaluationState?.status === "paused").length;
    return { total, ready, waiting, running, paused };
  }, [tenders]);

  const runAiEvaluation = async (tenderId: string) => {
    const tender = tenders.find((item) => item._id === tenderId);
    if (!tender) return;
    const queueState = tender.aiEvaluationState?.status || "idle";
    const action = queueState === "paused" ? "resume" : "start";

    if (action === "start" && !isDeadlinePassed(tender)) {
      setError("AI evaluation starts automatically after the submission deadline. This tender is not ready yet.");
      return;
    }

    setRunningTenderId(tenderId);
    setError("");
    setSuccess("");
    try {
      await apiRequest(`/api/ai/evaluations/tenders/${tenderId}/run?manual=true`, {
        method: "POST",
        body: { action, manual: true, force: false },
      });
      setSuccess(action === "resume" ? `AI evaluation resumed for "${tender.title}".` : `AI evaluation started for "${tender.title}".`);
      await loadAiSummaries(tenderId);
      await loadTenders();
      await refreshTenderState(tenderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run AI evaluation");
    } finally {
      setRunningTenderId("");
    }
  };

  const pauseAiEvaluation = async (tenderId: string) => {
    const tender = tenders.find((item) => item._id === tenderId);
    if (!tender) return;

    setError("");
    setSuccess("");
    try {
      await apiRequest(`/api/ai/evaluations/tenders/${tenderId}/run`, {
        method: "POST",
        body: { action: "pause", manual: true },
      });
      setSuccess(`AI evaluation paused for "${tender.title}".`);
      await loadTenders();
      await refreshTenderState(tenderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pause AI evaluation");
    }
  };

  const selectedTenderSummaries = useMemo(() => {
    return aiSummaries.reduce(
      (acc, summary) => {
        acc[summary.status] += 1;
        return acc;
      },
      { success: 0, pending: 0, failed: 0 }
    );
  }, [aiSummaries]);

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="po" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="po" userName={authUser?.name || ""} />
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl text-[#0B3C5D] mb-1">AI Evaluation Queue</h1>
            <p className="text-sm text-gray-600">
              Review your own tenders, start AI scoring early if needed, or let the system run it automatically after the deadline.
            </p>
          </div>

          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
          {success && <p className="text-sm text-green-700 mb-4">{success}</p>}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">My Tenders</p>
              <p className="text-3xl text-[#0B3C5D]">{queueSummary.total}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">Ready Now</p>
              <p className="text-3xl text-[#1D4E89]">{queueSummary.ready}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">Waiting</p>
              <p className="text-3xl text-[#2E8B57]">{queueSummary.waiting}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">AI on Selected</p>
              <p className="text-3xl text-[#F4A300]">
                {selectedTenderSummaries.success + selectedTenderSummaries.pending + selectedTenderSummaries.failed}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 mb-6">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-lg text-[#0B3C5D]">Your Tender List</h3>
                <p className="text-sm text-gray-500">
                  All tenders created by you are listed here. You can pre-start AI scoring before the deadline, and it will also run automatically once the deadline passes.
                </p>
              </div>
              {loading && <span className="text-xs text-gray-400">Loading tenders...</span>}
            </div>

            {!loading && filteredTenders.length === 0 && (
              <div className="rounded-md border border-dashed border-gray-200 bg-gray-50 p-5 text-sm text-gray-500">
                No tenders created by you were found.
              </div>
            )}

            <div className="space-y-3">
              {filteredTenders.map((tender) => {
                const deadlinePassed = isDeadlinePassed(tender);
                const isRunning = runningTenderId === tender._id;
                const queueState = tender.aiEvaluationState?.status || "idle";
                const processedCount = tender.aiEvaluationState?.completedBids || 0;
                const totalCount = tender.aiEvaluationState?.totalBids || tender.bids?.length || 0;
                const currentVendor = tender.aiEvaluationState?.currentVendorName || "";

                return (
                  <div key={tender._id} className="border border-gray-200 rounded-lg p-4 bg-white">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-medium text-[#0B3C5D]">{tender.title}</h4>
                          <span className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-700">{tender.status}</span>
                          <span className={`px-2 py-1 rounded-full text-xs ${deadlinePassed ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                            {deadlinePassed ? "Ready for AI" : "Waiting for deadline"}
                          </span>
                          {queueState === "running" && (
                            <span className="px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-700">Running</span>
                          )}
                          {queueState === "paused" && (
                            <span className="px-2 py-1 rounded-full text-xs bg-orange-100 text-orange-700">Paused</span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <FileText className="w-3.5 h-3.5" />
                            {tender.bids?.length || 0} submission(s)
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock3 className="w-3.5 h-3.5" />
                            Deadline: {tender.finalSubmissionDate ? new Date(tender.finalSubmissionDate).toLocaleString() : "-"}
                          </span>
                        </div>
                        {tender.status === "Draft" && (
                          <p className="text-xs text-gray-500">Draft tenders are listed for visibility, but AI evaluation waits until the tender is published and the deadline passes.</p>
                        )}
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTenderId(tender._id);
                            void runAiEvaluation(tender._id);
                          }}
                        disabled={isRunning || queueState === "running"}
                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm text-white transition-colors ${
                          isRunning || queueState === "running"
                            ? "bg-gray-400 cursor-not-allowed"
                            : "bg-[#1D4E89] hover:bg-[#154068]"
                        }`}
                      >
                        <PlayCircle className="w-4 h-4" />
                          {queueState === "paused"
                            ? "Resume AI"
                            : isRunning || queueState === "running"
                              ? "Running..."
                              : deadlinePassed
                                ? "Run AI"
                                : "Pre-start AI"}
                        </button>
                        {queueState === "running" && (
                          <button
                            type="button"
                            onClick={() => void pauseAiEvaluation(tender._id)}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm border border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100"
                          >
                            Pause
                          </button>
                        )}
                      </div>
                    </div>

                    {tender.description && (
                      <p className="text-sm text-gray-600 mt-3">{tender.description}</p>
                    )}
                    <p className="text-xs text-amber-700 mt-3 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {deadlinePassed
                        ? "The deadline has passed, so AI can run now or be resumed from the queue."
                        : "You can pre-start AI now, and it will also trigger automatically once the submission deadline passes."}
                    </p>
                    {queueState !== "idle" && (
                      <div className="mt-3 text-xs text-gray-600 flex flex-wrap gap-3">
                        <span>Processed: {processedCount}/{totalCount}</span>
                        {currentVendor && <span>Current vendor: {currentVendor}</span>}
                        {tender.aiEvaluationState?.lastError && <span className="text-red-600">Last error: {tender.aiEvaluationState.lastError}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {selectedTender && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-lg text-[#0B3C5D]">{selectedTender.title}</h3>
                  <p className="text-sm text-gray-500">AI queue details for the selected tender</p>
                </div>
                {loadingAi && <span className="text-xs text-gray-400">Loading current AI status...</span>}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
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
                  <p className="text-xs text-gray-500">Deadline</p>
                  <p className="text-sm text-[#0B3C5D] mt-0.5">
                    {selectedTender.finalSubmissionDate ? new Date(selectedTender.finalSubmissionDate).toLocaleString() : "-"}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-md p-3">
                  <p className="text-xs text-gray-500">AI Results</p>
                  <p className="text-sm text-[#0B3C5D] mt-0.5">
                    {selectedTenderSummaries.success} success, {selectedTenderSummaries.pending} pending, {selectedTenderSummaries.failed} failed
                  </p>
                </div>
              </div>

              {selectedTender.aiEvaluationState && (
                <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-4 mb-4 text-sm text-[#0B3C5D]">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">AI queue status: {selectedTender.aiEvaluationState.status}</p>
                      <p className="text-gray-600">
                        {selectedTender.aiEvaluationState.completedBids || 0}/{selectedTender.aiEvaluationState.totalBids || bids.length || 0} vendors processed
                        {selectedTender.aiEvaluationState.currentVendorName ? `, currently at ${selectedTender.aiEvaluationState.currentVendorName}` : ""}
                      </p>
                    </div>
                    {selectedTender.aiEvaluationState.lastError && (
                      <p className="text-red-600 max-w-[520px]">{selectedTender.aiEvaluationState.lastError}</p>
                    )}
                  </div>
                </div>
              )}

              <p className="text-sm text-gray-600">
                {isDeadlinePassed(selectedTender)
                  ? "This tender can be processed now, or you can let the automatic deadline job pick it up."
                  : "The tender is still open. You can pre-start AI scoring now, and the automatic deadline job will also pick it up later."}
            </p>
          </div>
          )}
        </div>
      </div>
      <AIAssistant role="po" />
    </div>
  );
}
