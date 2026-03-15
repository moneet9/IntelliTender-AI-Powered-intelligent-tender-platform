import { Sidebar } from "../layout/Sidebar";
import { Header } from "../layout/Header";
import { AIAssistant } from "../AIAssistant";
import { useEffect, useMemo, useState } from "react";
import { apiRequest, getAuthUser } from "../../api";

type Tender = {
  _id: string;
  title: string;
  status: "Draft" | "Published" | "Closed" | "Awarded" | "Completed";
  bids?: Array<{ _id: string }>;
};

type Bid = {
  _id: string;
  vendorName?: string;
  proposedAmount: number;
  status: "Pending" | "Evaluated" | "Selected" | "Rejected";
  committeeEvaluations?: Array<{
    committeeMemberId?: string;
    technicalScore?: number;
    financialScore?: number;
    comments?: string;
    evaluatedDate?: string;
  }>;
  technicalScore?: number;
  financialScore?: number;
  comments?: string;
};

export function CommitteeDashboard() {
  const authUser = getAuthUser();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [selectedTenderId, setSelectedTenderId] = useState<string>("");
  const [bids, setBids] = useState<Bid[]>([]);
  const [technicalScore, setTechnicalScore] = useState<Record<string, string>>({});
  const [financialScore, setFinancialScore] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [submittingBidId, setSubmittingBidId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [tenderSearch, setTenderSearch] = useState("");
  const [tenderStatusFilter, setTenderStatusFilter] = useState("All");
  const [tenderSort, setTenderSort] = useState<"title" | "bids" | "status">("title");

  const filteredTenders = useMemo(() => {
    let result = tenders.filter((t) => {
      const q = tenderSearch.trim().toLowerCase();
      const matchSearch = !q ||
        t.title.toLowerCase().includes(q) ||
        t._id.slice(-6).toLowerCase().includes(q);
      const matchStatus = tenderStatusFilter === "All" || t.status === tenderStatusFilter;
      return matchSearch && matchStatus;
    });
    return [...result].sort((a, b) => {
      if (tenderSort === "bids") return (b.bids?.length || 0) - (a.bids?.length || 0);
      if (tenderSort === "status") return a.status.localeCompare(b.status);
      return a.title.localeCompare(b.title);
    });
  }, [tenders, tenderSearch, tenderStatusFilter, tenderSort]);

  const loadTenders = async () => {
    setLoading(true);
    setError("");
    setSuccess("");
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
    setSuccess("");
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

    setSubmittingBidId(bidId);
    setError("");
    setSuccess("");

    try {
      await apiRequest(`/api/tenders/${selectedTenderId}/bids/${bidId}/evaluate`, {
        method: "PUT",
        body: {
          technicalScore: Number(technicalScore[bidId] || 0),
          financialScore: Number(financialScore[bidId] || 0),
          comments: comments[bidId] || "",
        },
      });

      setSuccess("Evaluation saved. Other committee members can also submit their reviews for the same tender.");
      await loadTenderBids(selectedTenderId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to evaluate bid");
    } finally {
      setSubmittingBidId("");
    }
  };

  const getCommitteeMemberEvaluation = (bid: Bid) => {
    if (!authUser?._id) return null;

    return (bid.committeeEvaluations || []).find(
      (evaluation) => evaluation.committeeMemberId === authUser._id
    ) || null;
  };

  useEffect(() => {
    loadTenders();
  }, []);

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="committee" />
      <div className="flex-1 overflow-auto p-6">
          <Header role="committee" userName={authUser?.name || ""} />
          <div className="mb-6">
            <h1 className="text-2xl text-[#0B3C5D] mb-1">Committee Dashboard</h1>
            <p className="text-sm text-gray-600">Technical Evaluation</p>
          </div>

          <>
              {/* Assigned Tenders */}
              <div className="bg-white rounded-lg shadow-sm mb-6 border border-gray-100">
                <div className="p-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-lg text-[#0B3C5D]">Assigned Tenders</h3>
                  <span className="text-xs text-gray-400">{filteredTenders.length} of {tenders.length} tender(s)</span>
                </div>
                <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex flex-wrap gap-3 items-center">
                  <input
                    type="text"
                    value={tenderSearch}
                    onChange={(e) => setTenderSearch(e.target.value)}
                    placeholder="Search by title or ID…"
                    className="flex-1 min-w-[180px] max-w-sm px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
                  />
                  <select
                    value={tenderStatusFilter}
                    onChange={(e) => setTenderStatusFilter(e.target.value)}
                    className="px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
                  >
                    <option value="All">All Statuses</option>
                    <option value="Published">Published</option>
                    <option value="Closed">Closed</option>
                    <option value="Awarded">Awarded</option>
                    <option value="Completed">Completed</option>
                  </select>
                  <select
                    value={tenderSort}
                    onChange={(e) => setTenderSort(e.target.value as "title" | "bids" | "status")}
                    className="px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
                  >
                    <option value="title">Sort: Title A–Z</option>
                    <option value="bids">Sort: Most Bids</option>
                    <option value="status">Sort: Status</option>
                  </select>
                  {(tenderSearch || tenderStatusFilter !== "All") && (
                    <button
                      onClick={() => { setTenderSearch(""); setTenderStatusFilter("All"); }}
                      className="text-xs text-gray-500 hover:text-gray-700 underline"
                    >
                      Clear
                    </button>
                  )}
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
                      {!loading && !filteredTenders.length && (
                        <tr>
                          <td colSpan={5} className="px-6 py-8 text-sm text-gray-400 text-center">No tenders match your search.</td>
                        </tr>
                      )}
                      {!loading && filteredTenders.map((tender) => (
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
                                  : tender.status === "Completed"
                                  ? "bg-green-100 text-green-800"
                                  : tender.status === "Awarded"
                                  ? "bg-purple-100 text-purple-800"
                                  : "bg-gray-100 text-gray-700"
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
              {success && <p className="text-sm text-green-700 mb-4">{success}</p>}

              {/* Bid Evaluation */}
              <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
                <h3 className="text-lg text-[#0B3C5D] mb-4">Manual Bid Evaluation</h3>
                {!selectedTenderId && <p className="text-sm text-gray-600">Select a tender to review submissions.</p>}
                {!!selectedTenderId && !bids.length && <p className="text-sm text-gray-600">No bids found for selected tender.</p>}
                <div className="space-y-4">
                  {bids.map((bid) => {
                    const myEvaluation = getCommitteeMemberEvaluation(bid);
                    const evaluationCount = bid.committeeEvaluations?.length || (bid.status === "Evaluated" ? 1 : 0);
                    const isSubmitting = submittingBidId === bid._id;

                    return (
                      <div key={bid._id} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <h4 className="text-sm text-[#0B3C5D]">{bid.vendorName || "Vendor"}</h4>
                            <p className="text-xs text-gray-500 mt-1">
                              Aggregated score: Technical {bid.technicalScore ?? "-"} | Financial {bid.financialScore ?? "-"}
                            </p>
                          </div>
                          <div className="text-right">
                            <span className="text-sm text-gray-600">₹{Number(bid.proposedAmount).toLocaleString()}</span>
                            <p className="text-xs text-gray-500 mt-1">{evaluationCount} committee review(s)</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <input
                            type="number"
                            value={technicalScore[bid._id] ?? String(myEvaluation?.technicalScore ?? "")}
                            onChange={(e) => setTechnicalScore({ ...technicalScore, [bid._id]: e.target.value })}
                            className="px-3 py-2 border border-gray-300 rounded-md"
                            placeholder="Technical score"
                          />
                          <input
                            type="number"
                            value={financialScore[bid._id] ?? String(myEvaluation?.financialScore ?? "")}
                            onChange={(e) => setFinancialScore({ ...financialScore, [bid._id]: e.target.value })}
                            className="px-3 py-2 border border-gray-300 rounded-md"
                            placeholder="Financial score"
                          />
                          <input
                            type="text"
                            value={comments[bid._id] ?? myEvaluation?.comments ?? ""}
                            onChange={(e) => setComments({ ...comments, [bid._id]: e.target.value })}
                            className="px-3 py-2 border border-gray-300 rounded-md"
                            placeholder="Comments"
                          />
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          {myEvaluation ? (
                            <p className="text-xs text-green-700">
                              Your evaluation recorded
                              {myEvaluation.evaluatedDate
                                ? ` on ${new Date(myEvaluation.evaluatedDate).toLocaleString()}`
                                : ""}
                            </p>
                          ) : (
                            <span />
                          )}
                          <button
                            onClick={() => submitEvaluation(bid._id)}
                            disabled={isSubmitting}
                            className={`px-4 py-2 rounded-md text-sm text-white ${
                              isSubmitting ? "bg-[#7aa0c5] cursor-not-allowed" : "bg-[#1D4E89] hover:bg-[#154068]"
                            }`}
                          >
                            {isSubmitting ? "Saving..." : myEvaluation ? "Update Evaluation" : "Mark Evaluated"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
          </>
        <AIAssistant role="committee" />
      </div>
    </div>
  );
}