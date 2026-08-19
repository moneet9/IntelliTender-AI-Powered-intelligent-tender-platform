import { useEffect, useMemo, useState } from "react";
import { Calendar, CheckCircle, Clock3, FileText, ShieldAlert, Sparkles, Users, Zap } from "lucide-react";
import { Sidebar } from "../../layout/Sidebar";
import { Header } from "../../layout/Header";
import { AIAssistant } from "../../AIAssistant";
import { apiRequest } from "../../../api";

type TenderStatus = "Draft" | "Published" | "Closed" | "Awarded" | "Completed";
type ContractStatus = "Awarded" | "Signed" | "Completed" | "Cancelled";

type TenderRecord = {
  _id: string;
  status: TenderStatus;
  bids?: Array<{ _id: string }>;
};

type MilestoneSummary = {
  _id: string;
  status: "Not Started" | "In Progress" | "Completed" | "Delayed";
};

type ContractRecord = {
  _id: string;
  status: ContractStatus;
  timelineDefined?: boolean;
  milestones?: MilestoneSummary[];
};

type ResearchLog = {
  id: string;
  eventType: string;
  actorRole: string;
  actorName: string;
  durationMs: number;
  status: string;
  note: string;
  metricName: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export function PODashboard() {
  const [tenders, setTenders] = useState<TenderRecord[]>([]);
  const [contracts, setContracts] = useState<ContractRecord[]>([]);
  const [researchMetrics, setResearchMetrics] = useState<{
    dashboard?: { publishedTenders: number; totalSubmissions: number; committeeCount: number };
    metrics?: {
      aiEvaluationAvgMs: number;
      committeeEvaluationAvgMs: number;
      chatQueryAvgMs: number;
      bidsProcessedPerHour: number;
      scoreConsistency: number;
      errorCount: number;
      riskyItemsDetected: number;
    };
    qwenResearch?: {
      sampleCount: number;
      averageResponseMs: number;
      averageTokens: number;
      tokensPerSecond: number;
      averageGpuPowerWatts: number | null;
      estimatedEnergyJoules: number | null;
      energyPer1000Tokens: number | null;
    };
    logs?: ResearchLog[];
  }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = async () => {
    setLoading(true);
    setError("");
    try {
      const [tenderData, contractData, researchData] = await Promise.all([
        apiRequest<TenderRecord[]>("/api/tenders?summary=true"),
        apiRequest<ContractRecord[]>("/api/contracts?summary=true"),
        apiRequest<typeof researchMetrics>("/api/admin/analytics/po"),
      ]);
      setTenders(tenderData || []);
      setContracts(contractData || []);
      setResearchMetrics(researchData || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const stats = useMemo(() => {
    const publishedTenders = tenders.filter((tender) => tender.status === "Published").length;
    const totalSubmissions = tenders.reduce((sum, tender) => sum + (tender.bids?.length || 0), 0);
    const timelineReadyContracts = contracts.filter((contract) => contract.timelineDefined).length;
    const completedContracts = contracts.filter((contract) => contract.status === "Completed").length;

    return [
      { label: "Published Tenders", value: String(publishedTenders), icon: FileText, color: "bg-[#1D4E89]" },
      { label: "Vendor Submissions", value: String(totalSubmissions), icon: Users, color: "bg-[#2E8B57]" },
      { label: "Timelines Defined", value: String(timelineReadyContracts), icon: Calendar, color: "bg-[#F4A300]" },
      { label: "Completed Contracts", value: String(completedContracts), icon: CheckCircle, color: "bg-[#0B3C5D]" },
    ];
  }, [contracts, tenders]);

  const tenderBreakdown = useMemo(() => {
    const counts: Record<string, number> = { Draft: 0, Published: 0, Closed: 0, Awarded: 0, Completed: 0 };
    tenders.forEach((t) => {
      if (counts[t.status] !== undefined) counts[t.status]++;
    });
    return counts;
  }, [tenders]);

  const contractBreakdown = useMemo(() => {
    const counts: Record<string, number> = { Awarded: 0, Signed: 0, Completed: 0 };
    contracts.forEach((c) => {
      if (counts[c.status] !== undefined) counts[c.status]++;
    });
    return counts;
  }, [contracts]);

  const awaitingSignature = contracts.filter((c) => c.status === "Awarded").length;
  const readyToComplete = contracts.filter((c) => {
    const milestones = c.milestones || [];
    return c.status === "Signed" && milestones.length > 0 && milestones.every((m) => m.status === "Completed");
  }).length;

  const researchCards = useMemo(() => {
    const metrics = researchMetrics.metrics;
    return [
      { label: "AI Bid Time", value: metrics?.aiEvaluationAvgMs ? `${metrics.aiEvaluationAvgMs} ms` : "-", icon: Sparkles, color: "bg-[#1D4E89]" },
      { label: "Committee Time", value: metrics?.committeeEvaluationAvgMs ? `${metrics.committeeEvaluationAvgMs} ms` : "-", icon: Clock3, color: "bg-[#2E8B57]" },
      { label: "Chat Time", value: metrics?.chatQueryAvgMs ? `${metrics.chatQueryAvgMs} ms` : "-", icon: FileText, color: "bg-[#F4A300]" },
      { label: "Bids / Hour", value: metrics?.bidsProcessedPerHour ? String(metrics.bidsProcessedPerHour) : "-", icon: Users, color: "bg-[#0B3C5D]" },
      { label: "Score Consistency", value: metrics?.scoreConsistency ? `${metrics.scoreConsistency}%` : "-", icon: CheckCircle, color: "bg-[#2E8B57]" },
      { label: "Risk Flags", value: metrics?.riskyItemsDetected ? String(metrics.riskyItemsDetected) : "-", icon: ShieldAlert, color: "bg-[#B22222]" },
      { label: "Qwen Energy / 1k Tokens", value: researchMetrics.qwenResearch?.energyPer1000Tokens !== null && researchMetrics.qwenResearch?.energyPer1000Tokens !== undefined ? `${researchMetrics.qwenResearch.energyPer1000Tokens} J` : "-", icon: Zap, color: "bg-[#8B5CF6]" },
      { label: "Qwen GPU Power", value: researchMetrics.qwenResearch?.averageGpuPowerWatts !== null && researchMetrics.qwenResearch?.averageGpuPowerWatts !== undefined ? `${researchMetrics.qwenResearch.averageGpuPowerWatts} W` : "-", icon: Zap, color: "bg-[#D97706]" },
    ];
  }, [researchMetrics.metrics]);

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="po" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="po" />
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl text-[#0B3C5D] mb-1">Procurement Dashboard</h1>
            <p className="text-sm text-gray-500">Overview of tenders, submissions, timelines, and contracts</p>
          </div>

          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
          {loading && <p className="text-sm text-gray-500 mb-4">Loading...</p>}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {stats.map((stat) => (
              <div key={stat.label} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-gray-600 mb-1">{stat.label}</p>
                    <p className="text-3xl text-[#0B3C5D]">{stat.value}</p>
                  </div>
                  <div className={`${stat.color} p-3 rounded-lg`}>
                    <stat.icon className="w-6 h-6 text-white" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-medium text-[#0B3C5D]">Research Metrics</h3>
              </div>
              <div className="text-xs px-3 py-1 rounded-full bg-gray-100 text-gray-600">
                {researchMetrics.dashboard?.committeeCount || 0} committee members in scope
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {researchCards.map((stat) => (
                <div key={stat.label} className="rounded-lg border border-gray-100 p-4 bg-[#F9FBFD]">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm text-gray-600">{stat.label}</p>
                      <p className="text-2xl text-[#0B3C5D] mt-1">{stat.value}</p>
                    </div>
                    <div className={`${stat.color} p-2 rounded-lg`}>
                      <stat.icon className="w-5 h-5 text-white" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="bg-white rounded-lg border border-gray-100 p-5">
              <h3 className="text-sm font-medium text-[#0B3C5D] mb-4">Tender Status Breakdown</h3>
              <div className="space-y-3">
                {Object.entries(tenderBreakdown).map(([label, count]) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="text-sm text-gray-600 w-20">{label}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#1D4E89]"
                        style={{ width: tenders.length ? `${(count / tenders.length) * 100}%` : "0%" }}
                      />
                    </div>
                    <span className="text-sm font-medium text-[#0B3C5D] w-6 text-right">{count}</span>
                  </div>
                ))}
                {!tenders.length && <p className="text-sm text-gray-400">No tenders yet</p>}
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-100 p-5">
              <h3 className="text-sm font-medium text-[#0B3C5D] mb-4">Contract Status Breakdown</h3>
              <div className="space-y-3">
                {Object.entries(contractBreakdown).map(([label, count]) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="text-sm text-gray-600 w-20">{label}</span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#2E8B57]"
                        style={{ width: contracts.length ? `${(count / contracts.length) * 100}%` : "0%" }}
                      />
                    </div>
                    <span className="text-sm font-medium text-[#0B3C5D] w-6 text-right">{count}</span>
                  </div>
                ))}
                {!contracts.length && <p className="text-sm text-gray-400">No contracts yet</p>}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100 mb-6">
            <h3 className="text-base font-medium text-[#0B3C5D] mb-4">Recent Research Logs</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-100">
                    <th className="py-2 pr-4">Time</th>
                    <th className="py-2 pr-4">Event</th>
                    <th className="py-2 pr-4">Role</th>
                    <th className="py-2 pr-4">Duration</th>
                    <th className="py-2 pr-4">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {(researchMetrics.logs || []).map((log) => (
                    <tr key={log.id} className="border-b border-gray-50 last:border-0">
                      <td className="py-3 pr-4 text-gray-500">{new Date(log.createdAt).toLocaleString()}</td>
                      <td className="py-3 pr-4 text-[#1D4E89]">{log.eventType}</td>
                      <td className="py-3 pr-4 text-gray-700">{log.actorRole}</td>
                      <td className="py-3 pr-4 text-gray-700">{log.durationMs} ms</td>
                      <td className="py-3 pr-4 text-gray-600">{log.note}</td>
                    </tr>
                  ))}
                  {!researchMetrics.logs?.length && (
                    <tr>
                      <td className="py-3 text-gray-400" colSpan={5}>No research logs yet</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {(awaitingSignature > 0 || readyToComplete > 0) && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
              <p className="text-sm font-medium text-amber-800 mb-2">Action Required</p>
              <div className="flex flex-wrap gap-4 text-sm text-amber-700">
                {awaitingSignature > 0 && (
                  <span>• {awaitingSignature} contract{awaitingSignature > 1 ? "s" : ""} awaiting signature</span>
                )}
                {readyToComplete > 0 && (
                  <span>• {readyToComplete} contract{readyToComplete > 1 ? "s" : ""} ready to declare complete</span>
                )}
              </div>
            </div>
          )}

          <AIAssistant role="po" />
        </div>
      </div>
    </div>
  );
}
