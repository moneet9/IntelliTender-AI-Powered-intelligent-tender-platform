import { Sidebar } from "../layout/Sidebar";
import { Header } from "../layout/Header";
import { AIAssistant } from "../AIAssistant";
import { FileText, Users, CheckCircle, AlertCircle, TrendingUp } from "lucide-react";
import { Link } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../api";

const alerts = [
  { type: "warning", message: "TND-2026-047: AI flagged 2 high-risk bidders", time: "1 hour ago" },
  { type: "info", message: "TND-2026-046: Committee evaluation completed", time: "3 hours ago" },
  { type: "success", message: "TND-2026-045: Contract successfully awarded", time: "1 day ago" },
];

export function PODashboard() {
  const [tenders, setTenders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadTenders = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest<any[]>("/api/tenders");
      setTenders(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tenders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTenders();
  }, []);

  const stats = useMemo(() => {
    const active = tenders.filter((t) => t.status === "Published").length;
    const totalSubmissions = tenders.reduce((sum, t) => sum + (t.bids?.length || 0), 0);
    const completed = tenders.filter((t) => t.status === "Awarded").length;
    const pending = tenders.filter((t) => t.status === "Draft").length;
    return [
      { label: "Active Tenders", value: String(active), icon: FileText, color: "bg-[#1D4E89]" },
      { label: "Total Submissions", value: String(totalSubmissions), icon: Users, color: "bg-[#2E8B57]" },
      { label: "Completed Evaluations", value: String(completed), icon: CheckCircle, color: "bg-[#2E8B57]" },
      { label: "Pending Reviews", value: String(pending), icon: AlertCircle, color: "bg-[#F4A300]" },
    ];
  }, [tenders]);

  const updateTenderStatus = async (id: string, action: "publish" | "close") => {
    try {
      await apiRequest(`/api/tenders/${id}/${action}`, { method: "PUT" });
      await loadTenders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    }
  };

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="po" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="po" userName="Rajesh Kumar" />
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl text-[#0B3C5D] mb-1">Procurement Dashboard</h1>
            <p className="text-sm text-gray-600">Operational Management & Tender Creation</p>
          </div>

          {/* Stats */}
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

          {/* Active Tenders Table */}
          <div className="bg-white rounded-lg shadow-sm mb-6 border border-gray-100">
            <div className="p-6 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-lg text-[#0B3C5D]">Active Tenders</h3>
              <Link
                to="/po/create-tender"
                className="px-4 py-2 bg-[#1D4E89] hover:bg-[#154068] text-white rounded-md transition-colors text-sm"
              >
                + Create New Tender
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Tender ID</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Title</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Submissions</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Deadline</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading && (
                    <tr>
                      <td className="px-6 py-4 text-sm text-gray-600" colSpan={6}>Loading tenders...</td>
                    </tr>
                  )}
                  {!loading && tenders.map((tender) => (
                    <tr key={tender._id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-[#1D4E89]">{tender._id.slice(-6).toUpperCase()}</td>
                      <td className="px-6 py-4 text-sm text-gray-800">{tender.title}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{tender.bids?.length || 0}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 rounded-full text-xs ${
                            tender.status === "Published"
                              ? "bg-blue-100 text-blue-800"
                              : tender.status === "Draft"
                              ? "bg-yellow-100 text-yellow-800"
                              : tender.status === "Closed"
                              ? "bg-gray-100 text-gray-800"
                              : "bg-green-100 text-green-800"
                          }`}
                        >
                          {tender.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">{new Date(tender.deadline).toLocaleDateString()}</td>
                      <td className="px-6 py-4">
                        {tender.status === "Draft" && (
                          <button
                            onClick={() => updateTenderStatus(tender._id, "publish")}
                            className="text-sm text-[#1D4E89] hover:underline"
                          >
                            Publish
                          </button>
                        )}
                        {tender.status === "Published" && (
                          <button
                            onClick={() => updateTenderStatus(tender._id, "close")}
                            className="text-sm text-gray-600 hover:text-[#1D4E89]"
                          >
                            Close
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!loading && !tenders.length && (
                    <tr>
                      <td className="px-6 py-4 text-sm text-gray-600" colSpan={6}>No tenders found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

          {/* Alerts Panel */}
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
            <h3 className="text-lg text-[#0B3C5D] mb-4">Recent Alerts</h3>
            <div className="space-y-3">
              {alerts.map((alert, index) => (
                <div key={index} className="flex items-start gap-3 p-3 bg-gray-50 rounded-md">
                  <div
                    className={`mt-0.5 w-2 h-2 rounded-full ${
                      alert.type === "warning"
                        ? "bg-[#F4A300]"
                        : alert.type === "success"
                        ? "bg-[#2E8B57]"
                        : "bg-[#1D4E89]"
                    }`}
                  ></div>
                  <div className="flex-1">
                    <p className="text-sm text-gray-700">{alert.message}</p>
                    <p className="text-xs text-gray-500 mt-1">{alert.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <AIAssistant role="po" />
    </div>
  );
}