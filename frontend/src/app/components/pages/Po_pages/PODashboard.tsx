import { useEffect, useMemo, useState } from "react";
import { Calendar, CheckCircle, FileText, Users } from "lucide-react";
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

export function PODashboard() {
  const [tenders, setTenders] = useState<TenderRecord[]>([]);
  const [contracts, setContracts] = useState<ContractRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = async () => {
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
