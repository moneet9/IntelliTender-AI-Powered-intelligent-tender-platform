import { useEffect, useMemo, useState } from "react";
import { BrainCircuit, FileText, RefreshCw, Settings2, Sparkles, ShieldAlert, Filter, type LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { Sidebar } from "../../layout/Sidebar";
import { Header } from "../../layout/Header";
import { AIAssistant } from "../../AIAssistant";
import { apiRequest, getAuthUser } from "../../../api";

type AiStatus = {
  online?: boolean;
  endpoint?: string;
  modelCount?: number;
};

type RebuildResult = {
  message?: string;
  scope?: string;
  result?: {
    online?: boolean;
    processed?: number;
    completed?: number;
    failed?: number;
  };
};

type DocumentScope = "tender" | "bid" | "committee";

type ProcessingDocument = {
  id: string;
  sourceKey: string;
  sourceKind: "tender-document" | "bid-document" | "committee-report";
  sourceName: string;
  tenderTitle?: string;
  jobStatus: "pending" | "running" | "completed" | "failed";
  chunkStatus: string;
  embeddingStatus: string;
  chunkCount: number;
  savedChunks: number;
  embeddedChunks: number;
  pendingEmbeddings: number;
  attempts: number;
  lastError?: string;
  updatedAt?: string;
};

type ScopeConfig = {
  scope: DocumentScope;
  title: string;
  description: string;
  helper: string;
  accent: string;
  icon: LucideIcon;
};

const scopeCards: ScopeConfig[] = [
  {
    scope: "tender",
    title: "Tender document prep",
    description: "Refresh purchase order tender files, add fresh text chunks, and keep tender-level search sharp.",
    helper: "Best after you upload or edit tender attachments.",
    accent: "from-[#1D4E89] to-[#0B3C5D]",
    icon: FileText,
  },
  {
    scope: "bid",
    title: "Vendor bid prep",
    description: "Refresh the proposal and bid document store so vendor submissions are easier to retrieve.",
    helper: "Useful when vendors upload new bid files or revised attachments.",
    accent: "from-[#2E8B57] to-[#1F6A43]",
    icon: Sparkles,
  },
  {
    scope: "committee",
    title: "Committee report prep",
    description: "Refresh milestone reports, committee notes, and review attachments for stronger context.",
    helper: "Useful when committee members add new progress notes or attachments.",
    accent: "from-[#A16207] to-[#7C4A03]",
    icon: ShieldAlert,
  },
];

export function AISettings() {
  const authUser = getAuthUser();
  const [aiStatus, setAiStatus] = useState<AiStatus>({});
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [runningScope, setRunningScope] = useState<DocumentScope | "all" | "">("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [documents, setDocuments] = useState<ProcessingDocument[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [runningDocumentAction, setRunningDocumentAction] = useState("");

  const loadStatus = async () => {
    setLoadingStatus(true);
    setError("");
    try {
      const data = await apiRequest<AiStatus>("/api/ai/documents/status");
      setAiStatus(data || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load AI status");
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    void loadStatus();
    const timer = window.setInterval(() => void loadStatus(), 10000);
    return () => window.clearInterval(timer);
  }, []);

  const loadDocuments = async () => {
    setLoadingDocuments(true);
    try {
      const data = await apiRequest<ProcessingDocument[]>("/api/ai/documents/dashboard");
      setDocuments(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load document processing status");
    } finally {
      setLoadingDocuments(false);
    }
  };

  useEffect(() => {
    void loadDocuments();
    const timer = window.setInterval(() => void loadDocuments(), 10000);
    return () => window.clearInterval(timer);
  }, []);

  const restartDocuments = async (stage: "chunk" | "embedding", sourceKey = "") => {
    const actionKey = `${stage}:${sourceKey || "all"}`;
    setRunningDocumentAction(actionKey);
    setError("");
    setSuccess("");
    try {
      const result = await apiRequest<{ restarted?: number }>("/api/ai/documents/restart", {
        method: "POST",
        body: { stage, sourceKey },
      });
      setSuccess(`${stage === "chunk" ? "Chunking" : "Embedding"} restart queued for ${result.restarted || 0} document${result.restarted === 1 ? "" : "s"}.`);
      await loadDocuments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restart document processing");
    } finally {
      setRunningDocumentAction("");
    }
  };

  const filteredDocuments = useMemo(() => {
    if (statusFilter === "all") return documents;
    return documents.filter((document) => document.chunkStatus === statusFilter || document.embeddingStatus === statusFilter || document.jobStatus === statusFilter);
  }, [documents, statusFilter]);

  const chunkDocuments = filteredDocuments;
  const embeddingDocuments = filteredDocuments;

  const statusClass = (status: string) => {
    if (status === "completed") return "bg-emerald-100 text-emerald-700";
    if (status === "running") return "bg-blue-100 text-blue-700";
    if (status === "failed") return "bg-red-100 text-red-700";
    return "bg-amber-100 text-amber-700";
  };

  const rebuildScope = async (scope: DocumentScope) => {
    setRunningScope(scope);
    setError("");
    setSuccess("");
    try {
      const result = await apiRequest<RebuildResult>("/api/ai/documents/rebuild", {
        method: "POST",
        body: { scope },
      });
      const stats = result.result;
      setSuccess(
        `${result.message || "Document prep refreshed"} for ${scope}. ` +
          `${stats?.completed || 0} job${stats?.completed === 1 ? "" : "s"} completed, ` +
          `${stats?.failed || 0} failed.`
      );
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh document prep");
    } finally {
      setRunningScope("");
    }
  };

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="po" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="po" userName={authUser?.name || ""} />
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <div className="inline-flex items-center gap-2 rounded-full bg-[#0B3C5D] px-3 py-1 text-xs text-white mb-3">
              <Settings2 className="h-3.5 w-3.5" />
              AI Settings
            </div>
            <h1 className="text-2xl text-[#0B3C5D] mb-1">Document Comparison Controls</h1>
            <p className="text-sm text-gray-600 max-w-3xl">
              Keep tender files, vendor bids, and committee reports prepared separately so search stays fast and answers stay relevant.
            </p>
          </div>

          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
          {success && <p className="text-sm text-green-700 mb-4">{success}</p>}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <p className="text-sm text-gray-500 mb-1">Local AI status</p>
              <div className="flex items-center gap-2">
                <BrainCircuit className={`h-5 w-5 ${aiStatus.online ? "text-emerald-600" : "text-amber-600"}`} />
                <span className={`text-lg ${aiStatus.online ? "text-emerald-700" : "text-amber-700"}`}>
                  {loadingStatus ? "Checking…" : aiStatus.online ? "Online" : "Not reachable"}
                </span>
              </div>
              <p className="mt-2 text-sm text-gray-600">
                The document prep worker will only run when LM Studio responds on the local API.
              </p>
              {aiStatus.online && (
                <p className="mt-1 text-xs text-emerald-700">
                  {aiStatus.modelCount || 0} model{aiStatus.modelCount === 1 ? "" : "s"} detected. Status refreshes automatically.
                </p>
              )}
              <button
                type="button"
                onClick={() => void loadStatus()}
                disabled={loadingStatus}
                className="mt-4 inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-4 py-2 text-sm text-[#0B3C5D] hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${loadingStatus ? "animate-spin" : ""}`} />
                Refresh status
              </button>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm lg:col-span-2">
              <p className="text-sm text-gray-500 mb-1">What this page controls</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-sm font-medium text-[#0B3C5D]">Tender indexing</p>
                  <p className="mt-2 text-sm text-gray-600">PO uploads are parsed into the tender document store for direct comparison.</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-sm font-medium text-[#0B3C5D]">Vendor indexing</p>
                  <p className="mt-2 text-sm text-gray-600">Bid submissions stay separate from tender files for cleaner search.</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-sm font-medium text-[#0B3C5D]">Committee indexing</p>
                  <p className="mt-2 text-sm text-gray-600">Milestone reports and committee notes remain a distinct source.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm mb-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg text-[#0B3C5D]">Document processing dashboard</h2>
                <p className="text-sm text-gray-600">Chunking and embedding are tracked separately for every document in your workspace.</p>
              </div>
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-gray-500" />
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                  <option value="all">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="running">Running</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>
                <button type="button" onClick={() => void loadDocuments()} disabled={loadingDocuments} className="rounded-md border border-gray-200 px-3 py-2 text-sm text-[#0B3C5D] hover:bg-gray-50 disabled:opacity-60">
                  <RefreshCw className={`h-4 w-4 ${loadingDocuments ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              {[
                { title: "Chunking", subtitle: "OCR/text extraction → MongoDB chunks", stage: "chunk" as const, items: chunkDocuments, field: "chunkStatus" as const },
                { title: "Embeddings", subtitle: "MongoDB chunks → LM Studio vectors", stage: "embedding" as const, items: embeddingDocuments, field: "embeddingStatus" as const },
              ].map((panel) => (
                <div key={panel.title} className="rounded-xl border border-gray-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <h3 className="font-medium text-[#0B3C5D]">{panel.title}</h3>
                      <p className="text-xs text-gray-500 mt-1">{panel.subtitle}</p>
                    </div>
                    <button type="button" onClick={() => void restartDocuments(panel.stage)} disabled={Boolean(runningDocumentAction)} className="rounded-md bg-[#0B3C5D] px-3 py-2 text-xs text-white hover:bg-[#09415f] disabled:opacity-60">
                      {runningDocumentAction === `${panel.stage}:all` ? "Queued..." : `Restart all ${panel.title.toLowerCase()}`}
                    </button>
                  </div>
                  <div className="space-y-2 max-h-[480px] overflow-auto pr-1">
                    {panel.items.length === 0 && <p className="rounded-md border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">{loadingDocuments ? "Loading documents..." : "No documents found."}</p>}
                    {panel.items.map((document) => {
                      const status = document[panel.field];
                      const actionKey = `${panel.stage}:${document.sourceKey}`;
                      return (
                        <div key={`${panel.title}-${document.sourceKey}`} className="rounded-lg border border-gray-200 bg-white p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-[#0B3C5D]" title={document.sourceName}>{document.sourceName}</p>
                              <p className="truncate text-[11px] text-gray-500" title={document.tenderTitle}>{document.tenderTitle || document.sourceKind}</p>
                            </div>
                            <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${statusClass(status)}`}>{status}</span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-600">
                            <span>Chunks: {document.savedChunks}/{document.chunkCount || "-"}</span>
                            <span>Vectors: {document.embeddedChunks}/{document.savedChunks || "-"}</span>
                            {document.pendingEmbeddings > 0 && <span className="text-amber-700">{document.pendingEmbeddings} pending</span>}
                          </div>
                          {document.lastError && <p className="mt-2 text-xs text-red-600">{document.lastError}</p>}
                          <button type="button" onClick={() => void restartDocuments(panel.stage, document.sourceKey)} disabled={Boolean(runningDocumentAction)} className="mt-2 inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-[#0B3C5D] hover:bg-gray-50 disabled:opacity-60">
                            <RefreshCw className={`h-3.5 w-3.5 ${runningDocumentAction === actionKey ? "animate-spin" : ""}`} />
                            {runningDocumentAction === actionKey ? "Queued..." : `Restart ${panel.title.toLowerCase()}`}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-6">
            {scopeCards.map((card) => {
              const Icon = card.icon;
              const running = runningScope === card.scope;

              return (
                <div key={card.scope} className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
                  <div className={`bg-gradient-to-r ${card.accent} p-5 text-white`}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-white/70">Manual refresh</p>
                        <h2 className="mt-2 text-xl font-medium">{card.title}</h2>
                      </div>
                      <Icon className="h-8 w-8 text-white/90" />
                    </div>
                    <p className="mt-4 text-sm text-white/85">{card.description}</p>
                  </div>

                  <div className="p-5">
                    <p className="text-sm text-gray-600">{card.helper}</p>
                    <button
                      type="button"
                      onClick={() => void rebuildScope(card.scope)}
                      disabled={Boolean(runningScope)}
                      className="mt-4 inline-flex items-center gap-2 rounded-md bg-[#0B3C5D] px-4 py-2.5 text-sm text-white hover:bg-[#09415f] disabled:cursor-not-allowed disabled:bg-gray-400"
                    >
                      <RefreshCw className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
                      {running ? "Refreshing..." : `Refresh ${card.scope}`}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <h3 className="text-lg text-[#0B3C5D]">Quick AI Pages</h3>
              <p className="mt-1 text-sm text-gray-600">Jump to the rest of the AI workspace from here.</p>
              <div className="mt-4 space-y-3">
                <Link
                  to="/po/ai-evaluation"
                  className="flex items-center justify-between rounded-xl border border-gray-200 bg-slate-50 px-4 py-3 text-sm text-[#0B3C5D] hover:border-[#1D4E89] hover:bg-white"
                >
                  <span>AI Queue</span>
                  <span className="text-xs text-gray-500">Run and pause scoring</span>
                </Link>
                <Link
                  to="/po/evaluation"
                  className="flex items-center justify-between rounded-xl border border-gray-200 bg-slate-50 px-4 py-3 text-sm text-[#0B3C5D] hover:border-[#1D4E89] hover:bg-white"
                >
                  <span>AI Results</span>
                  <span className="text-xs text-gray-500">Compare committee and AI marks</span>
                </Link>
                <Link
                  to="/po/ai-alerts"
                  className="flex items-center justify-between rounded-xl border border-gray-200 bg-slate-50 px-4 py-3 text-sm text-[#0B3C5D] hover:border-[#1D4E89] hover:bg-white"
                >
                  <span>AI Alerts</span>
                  <span className="text-xs text-gray-500">Milestone and risk notices</span>
                </Link>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <h3 className="text-lg text-[#0B3C5D]">Search quality notes</h3>
              <div className="mt-4 space-y-3 text-sm text-gray-600">
                <p>- Tender documents are prepared first for PO uploads and tender attachments.</p>
                <p>- Vendor bids are kept separate, so bid search does not mix with tender text.</p>
                <p>- Committee reports and progress notes are stored in their own document stream.</p>
                <p>- Tender numbers, vendor names, and report metadata are used for stronger matching.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <AIAssistant role="po" />
    </div>
  );
}
