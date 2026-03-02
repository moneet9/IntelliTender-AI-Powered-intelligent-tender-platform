import { Sidebar } from "../layout/Sidebar";
import { Header } from "../layout/Header";
import { AIAssistant } from "../AIAssistant";
import { Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { apiRequest } from "../../api";

type Tender = {
  _id: string;
  title: string;
  status: "Draft" | "Published" | "Closed" | "Awarded";
  bids?: Array<{ _id: string }>;
};

type Bid = {
  _id: string;
  vendorName?: string;
  proposedAmount: number;
  status: "Pending" | "Evaluated" | "Selected" | "Rejected";
  technicalScore?: number;
  financialScore?: number;
  comments?: string;
};

export function CommitteeDashboard() {
  const [activeTab, setActiveTab] = useState<"evaluation" | "monitoring">("evaluation");
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [selectedTenderId, setSelectedTenderId] = useState<string>("");
  const [bids, setBids] = useState<Bid[]>([]);
  const [technicalScore, setTechnicalScore] = useState<Record<string, string>>({});
  const [financialScore, setFinancialScore] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Supply contract monitoring
  const [supplyChecklist, setSupplyChecklist] = useState({
    quantityVerified: false,
    qualityVerified: false,
    documentsUploaded: false,
    deliveryComplete: false,
  });

  // Work contract monitoring
  const [workProgress, setWorkProgress] = useState({
    milestoneTitle: "",
    completionDate: "",
    description: "",
    observations: "",
  });

  const loadTenders = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest<Tender[]>("/api/tenders");
      setTenders(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tenders");
    } finally {
      setLoading(false);
    }
  };

  const loadTenderBids = async (tenderId: string) => {
    setError("");
    setSelectedTenderId(tenderId);
    try {
      const data = await apiRequest<Bid[]>(`/api/tenders/${tenderId}/bids`);
      setBids(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load bids");
    }
  };

  const submitEvaluation = async (bidId: string) => {
    if (!selectedTenderId) return;
    try {
      await apiRequest(`/api/tenders/${selectedTenderId}/bids/${bidId}/evaluate`, {
        method: "PUT",
        body: {
          technicalScore: Number(technicalScore[bidId] || 0),
          financialScore: Number(financialScore[bidId] || 0),
          comments: comments[bidId] || "",
        },
      });
      await loadTenderBids(selectedTenderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to evaluate bid");
    }
  };

  useEffect(() => {
    loadTenders();
  }, []);

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="committee" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="committee" userName="Anil Verma" />
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl text-[#0B3C5D] mb-1">Committee Dashboard</h1>
            <p className="text-sm text-gray-600">Technical Evaluation & Contract Monitoring</p>
          </div>

          {/* Tab Navigation */}
          <div className="mb-6 border-b border-gray-200">
            <div className="flex gap-6">
              <button
                onClick={() => setActiveTab("evaluation")}
                className={`pb-3 px-1 text-sm transition-colors ${
                  activeTab === "evaluation"
                    ? "border-b-2 border-[#1D4E89] text-[#1D4E89]"
                    : "text-gray-600 hover:text-gray-800"
                }`}
              >
                Evaluation
              </button>
              <button
                onClick={() => setActiveTab("monitoring")}
                className={`pb-3 px-1 text-sm transition-colors ${
                  activeTab === "monitoring"
                    ? "border-b-2 border-[#1D4E89] text-[#1D4E89]"
                    : "text-gray-600 hover:text-gray-800"
                }`}
              >
                Contract Monitoring
              </button>
            </div>
          </div>

          {activeTab === "evaluation" && (
            <>
              {/* Assigned Tenders */}
              <div className="bg-white rounded-lg shadow-sm mb-6 border border-gray-100">
                <div className="p-6 border-b border-gray-100">
                  <h3 className="text-lg text-[#0B3C5D]">Assigned Tenders</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">
                          Tender ID
                        </th>
                        <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">
                          Title
                        </th>
                        <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">
                          Bidders
                        </th>
                        <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {loading && (
                        <tr>
                          <td colSpan={5} className="px-6 py-4 text-sm text-gray-600">Loading tenders...</td>
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
                                  : "bg-green-100 text-green-800"
                              }`}
                            >
                              {tender.status}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <button
                              onClick={() => loadTenderBids(tender._id)}
                              className="text-sm text-[#1D4E89] hover:underline"
                            >
                              Review Submissions
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

              {/* Bid Evaluation */}
              <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
                <h3 className="text-lg text-[#0B3C5D] mb-4">Manual Bid Evaluation</h3>
                {!selectedTenderId && <p className="text-sm text-gray-600">Select a tender to review submissions.</p>}
                {!!selectedTenderId && !bids.length && <p className="text-sm text-gray-600">No bids found for selected tender.</p>}
                <div className="space-y-4">
                  {bids.map((bid) => (
                    <div key={bid._id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm text-[#0B3C5D]">{bid.vendorName || "Vendor"}</h4>
                        <span className="text-sm text-gray-600">₹{Number(bid.proposedAmount).toLocaleString()}</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <input
                          type="number"
                          value={technicalScore[bid._id] ?? String(bid.technicalScore ?? "")}
                          onChange={(e) => setTechnicalScore({ ...technicalScore, [bid._id]: e.target.value })}
                          className="px-3 py-2 border border-gray-300 rounded-md"
                          placeholder="Technical score"
                        />
                        <input
                          type="number"
                          value={financialScore[bid._id] ?? String(bid.financialScore ?? "")}
                          onChange={(e) => setFinancialScore({ ...financialScore, [bid._id]: e.target.value })}
                          className="px-3 py-2 border border-gray-300 rounded-md"
                          placeholder="Financial score"
                        />
                        <input
                          type="text"
                          value={comments[bid._id] ?? bid.comments ?? ""}
                          onChange={(e) => setComments({ ...comments, [bid._id]: e.target.value })}
                          className="px-3 py-2 border border-gray-300 rounded-md"
                          placeholder="Comments"
                        />
                      </div>
                      <div className="mt-3">
                        <button
                          onClick={() => submitEvaluation(bid._id)}
                          className="px-4 py-2 bg-[#1D4E89] hover:bg-[#154068] text-white rounded-md text-sm"
                        >
                          Mark Evaluated
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {activeTab === "monitoring" && (
            <div className="space-y-6">
              {/* Supply Contract Monitoring */}
              <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
                <h3 className="text-lg text-[#0B3C5D] mb-4">Supply Contract Monitoring</h3>
                <p className="text-sm text-gray-600 mb-4">Contract: CNT-2026-032 - Office Furniture Supply</p>
                <div className="space-y-3">
                  {Object.entries(supplyChecklist).map(([key, checked]) => (
                    <label key={key} className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setSupplyChecklist({ ...supplyChecklist, [key]: e.target.checked })
                        }
                        className="w-5 h-5 rounded border-gray-300 text-[#1D4E89] focus:ring-[#1D4E89]"
                      />
                      <span className="text-sm text-gray-700 capitalize">
                        {key.replace(/([A-Z])/g, " $1").trim()}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                  <p className="text-sm text-blue-800">
                    Timestamp will be automatically captured upon completion
                  </p>
                </div>
              </div>

              {/* Work Contract Monitoring */}
              <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
                <h3 className="text-lg text-[#0B3C5D] mb-4">Work Contract Progress Report</h3>
                <p className="text-sm text-gray-600 mb-4">Contract: CNT-2026-028 - Road Construction Project</p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Milestone Title</label>
                    <input
                      type="text"
                      value={workProgress.milestoneTitle}
                      onChange={(e) =>
                        setWorkProgress({ ...workProgress, milestoneTitle: e.target.value })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                      placeholder="e.g., Foundation Work Completed"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Completion Date</label>
                    <input
                      type="date"
                      value={workProgress.completionDate}
                      onChange={(e) =>
                        setWorkProgress({ ...workProgress, completionDate: e.target.value })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Description</label>
                    <textarea
                      value={workProgress.description}
                      onChange={(e) =>
                        setWorkProgress({ ...workProgress, description: e.target.value })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                      rows={3}
                      placeholder="Describe the milestone progress..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Observations</label>
                    <textarea
                      value={workProgress.observations}
                      onChange={(e) =>
                        setWorkProgress({ ...workProgress, observations: e.target.value })
                      }
                      className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                      rows={3}
                      placeholder="Any observations or issues..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Upload Files/Images</label>
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-[#1D4E89] transition-colors cursor-pointer">
                      <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                      <p className="text-sm text-gray-600">Upload progress photos and documents</p>
                    </div>
                  </div>
                  <button className="w-full px-4 py-3 bg-[#1D4E89] hover:bg-[#154068] text-white rounded-md transition-colors">
                    Submit Progress Report
                  </button>
                </div>
              </div>

              {/* AI Delay Analysis */}
              <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
                <h3 className="text-lg text-[#0B3C5D] mb-4">AI Delay Analysis</h3>
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-md mb-4">
                  <p className="text-sm text-yellow-800 mb-2">
                    <span className="font-medium">⚠️ Delay Detected:</span> Project is 12 days behind schedule
                  </p>
                  <p className="text-sm text-yellow-700">
                    Based on contract timeline and progress reports, the current milestone should have been completed by February 18, 2026.
                  </p>
                </div>
                <div className="p-4 bg-red-50 border border-red-200 rounded-md">
                  <h4 className="text-sm text-[#B22222] mb-2">Recommended Penalty</h4>
                  <p className="text-sm text-gray-700">
                    According to Clause 7.3 of the contract: <span className="font-medium">₹18,000/day</span> for delays exceeding 10 days.
                  </p>
                  <p className="text-sm text-gray-700 mt-2">
                    <span className="font-medium">Total Penalty: ₹2,16,000</span> (12 days × ₹18,000)
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <AIAssistant role="committee" />
    </div>
  );
}