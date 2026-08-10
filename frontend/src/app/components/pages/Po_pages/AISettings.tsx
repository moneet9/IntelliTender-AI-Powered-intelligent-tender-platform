import { useEffect, useState } from "react";
import { BrainCircuit, FileText, RefreshCw, Settings2, Sparkles, ShieldAlert, type LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { Sidebar } from "../../layout/Sidebar";
import { Header } from "../../layout/Header";
import { AIAssistant } from "../../AIAssistant";
import { apiRequest, getAuthUser } from "../../../api";

type AiStatus = {
  online?: boolean;
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
    title: "Tender documents",
    description: "Re-embed purchase order tender files, add fresh chunks, and keep tender-level search sharp.",
    helper: "Best after you upload or edit tender attachments.",
    accent: "from-[#1D4E89] to-[#0B3C5D]",
    icon: FileText,
  },
  {
    scope: "bid",
    title: "Vendor bid documents",
    description: "Refresh the proposal and bid document index so vendor submissions are easier to retrieve.",
    helper: "Useful when vendors upload new bid files or revised attachments.",
    accent: "from-[#2E8B57] to-[#1F6A43]",
    icon: Sparkles,
  },
  {
    scope: "committee",
    title: "Committee reports",
    description: "Re-embed milestone reports, committee notes, and review attachments for stronger context.",
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
  }, []);

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
        `${result.message || "Document embeddings rebuilt"} for ${scope}. ` +
          `${stats?.completed || 0} job${stats?.completed === 1 ? "" : "s"} completed, ` +
          `${stats?.failed || 0} failed.`
      );
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rebuild embeddings");
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
            <h1 className="text-2xl text-[#0B3C5D] mb-1">Document Embedding Controls</h1>
            <p className="text-sm text-gray-600 max-w-3xl">
              Keep tender files, vendor bids, and committee reports indexed separately so search stays fast and answers stay relevant.
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
                  {aiStatus.online ? "Online" : "Not reachable"}
                </span>
              </div>
              <p className="mt-2 text-sm text-gray-600">
                The embedding worker will only run when LM Studio responds on the local API.
              </p>
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
                  <p className="mt-2 text-sm text-gray-600">PO uploads are re-embedded into the tender document store.</p>
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

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-6">
            {scopeCards.map((card) => {
              const Icon = card.icon;
              const running = runningScope === card.scope;

              return (
                <div key={card.scope} className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
                  <div className={`bg-gradient-to-r ${card.accent} p-5 text-white`}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-white/70">Manual re-embed</p>
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
                      {running ? "Re-embedding..." : `Re-embed ${card.scope}`}
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
                <p>- Tender documents are indexed first for PO uploads and tender attachments.</p>
                <p>- Vendor bids are kept separate, so bid search does not mix with tender text.</p>
                <p>- Committee reports and progress notes are stored in their own embedding stream.</p>
                <p>- Tender numbers, vendor names, and report metadata are kept in the index for stronger matching.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
      <AIAssistant role="po" />
    </div>
  );
}
