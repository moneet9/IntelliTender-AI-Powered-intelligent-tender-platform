import { Sidebar } from "../../layout/Sidebar";
import { Header } from "../../layout/Header";
import { AIAssistant } from "../../AIAssistant";
import { useNavigate } from "react-router";
import {
  FileText,
  ClipboardCheck,
  Award,
  AlertTriangle,
  Clock,
  IndianRupee,
  Clock3,
  Sparkles,
  ShieldAlert,
  Zap,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useEffect, useState } from "react";
import { apiRequest, getAuthUser } from "../../../api";

const statsData = [
  { label: "Total Active Tenders", value: "42", icon: FileText, color: "bg-[#1D4E89]" },
  { label: "Under Evaluation", value: "18", icon: ClipboardCheck, color: "bg-[#F4A300]" },
  { label: "Contracts Awarded", value: "127", icon: Award, color: "bg-[#2E8B57]" },
  { label: "High Risk Bidders", value: "5", icon: AlertTriangle, color: "bg-[#B22222]" },
  { label: "Delayed Projects", value: "8", icon: Clock, color: "bg-[#F4A300]" },
  { label: "Total Value (Cr)", value: "₹18.5", icon: IndianRupee, color: "bg-[#0B3C5D]" },
];

const aiFlags = [
  { type: "Duplicate Documents", count: 3, severity: "high" },
  { type: "Abnormally Low Bids", count: 7, severity: "medium" },
  { type: "Shell Company Pattern", count: 2, severity: "high" },
  { type: "Missing Credentials", count: 5, severity: "low" },
];

const recentAudits = [
  { tender: "TND-2026-045", action: "Final Award Approved", officer: "Priya Sharma", time: "2 hours ago" },
  { tender: "TND-2026-043", action: "AI Override - Justified", officer: "Rajesh Kumar", time: "5 hours ago" },
  { tender: "TND-2026-042", action: "Penalty Imposed", officer: "Amit Singh", time: "1 day ago" },
];

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

export function CPODashboard() {
  const navigate = useNavigate();
  const authUser = getAuthUser();
  const [departmentPerformance, setDepartmentPerformance] = useState<any[]>([]);
  const [poPerformance, setPoPerformance] = useState<any[]>([]);
  const [researchMetrics, setResearchMetrics] = useState<{
    dashboard?: { tenderCount: number; poCount: number; committeeCount: number };
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
  const [actionError, setActionError] = useState("");

  const loadCpoAnalytics = async () => {
    try {
      const [data, researchData] = await Promise.all([
        apiRequest<{
        departmentPerformance: Array<{ department: string; totalTenders: number; awardedTenders: number }>;
        poPerformance: Array<{ poName: string; committeeCount: number; totalTenders: number; committeeEvaluations: number }>;
      }>("/api/admin/analytics/cpo"),
        apiRequest<typeof researchMetrics>("/api/admin/analytics/research"),
      ]);
      setDepartmentPerformance(data.departmentPerformance || []);
      setPoPerformance(data.poPerformance || []);
      setResearchMetrics(researchData || {});
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to load analytics");
    }
  };

  useEffect(() => {
    loadCpoAnalytics();
  }, []);

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="cpo" />
      <div className="flex-1 overflow-auto p-6">
          <Header role="cpo" userName={authUser?.name || ""} />
          <div className="mb-5">
            <h1 className="text-2xl text-[#0B3C5D] mb-1">CPO Dashboard</h1>
            <p className="text-sm text-gray-600">Oversight & Strategic Analytics</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100 mb-6">
            <h3 className="text-base font-medium text-[#0B3C5D] mb-3">Quick Actions</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <button
                onClick={() => navigate("/cpo/bid-comparison")}
                className="px-4 py-3 bg-[#2E8B57] hover:bg-[#267347] text-white rounded-md transition-colors text-sm"
              >
                Approve Final Award
              </button>
              <button
                onClick={() => navigate("/cpo/bidders")}
                className="px-4 py-3 bg-[#1D4E89] hover:bg-[#154068] text-white rounded-md transition-colors text-sm"
              >
                View Risk Analytics
              </button>
              <button
                onClick={() => navigate("/cpo/bid-comparison")}
                className="px-4 py-3 bg-[#F4A300] hover:bg-[#d89200] text-white rounded-md transition-colors text-sm"
              >
                Review Overrides
              </button>
              <button
                onClick={() => navigate("/cpo/contracts")}
                className="px-4 py-3 bg-[#0B3C5D] hover:bg-[#082a42] text-white rounded-md transition-colors text-sm"
              >
                Contract Status
              </button>
            </div>
          </div>
          {actionError && <p className="text-sm text-red-600 mb-4">{actionError}</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {statsData.map((stat) => (
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
                <p className="text-sm text-gray-500">CPO-wide timing and quality numbers</p>
              </div>
              <div className="text-xs px-3 py-1 rounded-full bg-gray-100 text-gray-600">
                {researchMetrics.dashboard?.tenderCount || 0} tenders in scope
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: "AI Bid Time", value: researchMetrics.metrics?.aiEvaluationAvgMs ? `${researchMetrics.metrics.aiEvaluationAvgMs} ms` : "-", icon: Sparkles, color: "bg-[#1D4E89]" },
                { label: "Committee Time", value: researchMetrics.metrics?.committeeEvaluationAvgMs ? `${researchMetrics.metrics.committeeEvaluationAvgMs} ms` : "-", icon: Clock3, color: "bg-[#2E8B57]" },
                { label: "Chat Time", value: researchMetrics.metrics?.chatQueryAvgMs ? `${researchMetrics.metrics.chatQueryAvgMs} ms` : "-", icon: FileText, color: "bg-[#F4A300]" },
                { label: "Bids / Hour", value: researchMetrics.metrics?.bidsProcessedPerHour ? String(researchMetrics.metrics.bidsProcessedPerHour) : "-", icon: Award, color: "bg-[#0B3C5D]" },
                { label: "Score Consistency", value: researchMetrics.metrics?.scoreConsistency ? `${researchMetrics.metrics.scoreConsistency}%` : "-", icon: ClipboardCheck, color: "bg-[#2E8B57]" },
                { label: "Risk Flags", value: researchMetrics.metrics?.riskyItemsDetected ? String(researchMetrics.metrics.riskyItemsDetected) : "-", icon: ShieldAlert, color: "bg-[#B22222]" },
                { label: "Qwen Energy / 1k Tokens", value: researchMetrics.qwenResearch?.energyPer1000Tokens !== null && researchMetrics.qwenResearch?.energyPer1000Tokens !== undefined ? `${researchMetrics.qwenResearch.energyPer1000Tokens} J` : "-", icon: Zap, color: "bg-[#8B5CF6]" },
                { label: "Qwen GPU Power", value: researchMetrics.qwenResearch?.averageGpuPowerWatts !== null && researchMetrics.qwenResearch?.averageGpuPowerWatts !== undefined ? `${researchMetrics.qwenResearch.averageGpuPowerWatts} W` : "-", icon: Zap, color: "bg-[#D97706]" },
              ].map((stat) => (
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

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Department Analytics */}
            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
              <h3 className="text-lg text-[#0B3C5D] mb-4">Department-wise Tender Performance</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={departmentPerformance}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="department" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="totalTenders" fill="#1D4E89" name="Total Tenders" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="awardedTenders" fill="#2E8B57" name="Awarded" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* PO & Committee Performance */}
            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
              <h3 className="text-lg text-[#0B3C5D] mb-4">PO and Committee Performance</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={poPerformance}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="poName" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="committeeCount" fill="#F4A300" name="Committee Members" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="committeeEvaluations" fill="#1D4E89" name="Committee Evaluations" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="totalTenders" fill="#2E8B57" name="PO Tenders" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* AI Flags and Audit Logs */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* AI Flag Summary */}
            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
              <h3 className="text-lg text-[#0B3C5D] mb-4">AI Flag Summary</h3>
              <div className="space-y-3">
                {aiFlags.map((flag, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-2 h-2 rounded-full ${
                          flag.severity === "high"
                            ? "bg-[#B22222]"
                            : flag.severity === "medium"
                            ? "bg-[#F4A300]"
                            : "bg-[#2E8B57]"
                        }`}
                      ></div>
                      <span className="text-sm text-gray-700">{flag.type}</span>
                    </div>
                    <span className="text-sm px-3 py-1 bg-white rounded-full border border-gray-200">
                      {flag.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Audit Actions */}
            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
              <h3 className="text-lg text-[#0B3C5D] mb-4">Recent Audit Actions</h3>
              <div className="space-y-3">
                {recentAudits.map((audit, index) => (
                  <div key={index} className="pb-3 border-b border-gray-100 last:border-0">
                    <div className="flex items-start justify-between mb-1">
                      <span className="text-sm text-[#1D4E89]">{audit.tender}</span>
                      <span className="text-xs text-gray-500">{audit.time}</span>
                    </div>
                    <p className="text-sm text-gray-700 mb-1">{audit.action}</p>
                    <p className="text-xs text-gray-500">by {audit.officer}</p>
                  </div>
                ))}
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

          <div className="mt-8 text-center text-xs text-gray-500 border-t border-gray-200 pt-6">
            © 2026 IntelliTender
          </div>
        <AIAssistant role="cpo" />
      </div>
    </div>
  );
}
