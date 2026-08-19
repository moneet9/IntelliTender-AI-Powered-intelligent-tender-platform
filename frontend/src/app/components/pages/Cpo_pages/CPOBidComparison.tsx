import { Sidebar } from "../../layout/Sidebar";
import { Header } from "../../layout/Header";
import { AIAssistant } from "../../AIAssistant";
import { useEffect, useMemo, useState } from "react";
import { Award } from "lucide-react";
import { apiRequest, getAuthUser } from "../../../api";

export function CPOBidComparison() {
  const authUser = getAuthUser();
  const [tenders, setTenders] = useState<any[]>([]);
  const [selectedTenderId, setSelectedTenderId] = useState("");
  const [evaluatedBids, setEvaluatedBids] = useState<any[]>([]);
  const [aiSummaries, setAiSummaries] = useState<any[]>([]);
  const [tenderSearch, setTenderSearch] = useState("");
  const [tenderStatusFilter, setTenderStatusFilter] = useState("All");
  const [tenderSort, setTenderSort] = useState<"title-asc" | "title-desc" | "status">("title-asc");
  const [bidSearch, setBidSearch] = useState("");
  const [bidStatusFilter, setBidStatusFilter] = useState("All");
  const [bidSort, setBidSort] = useState<"vendor" | "technical-desc" | "financial-desc" | "amount-asc" | "amount-desc">("vendor");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  const filteredTenders = useMemo(() => {
    const q = tenderSearch.trim().toLowerCase();
    const filtered = tenders.filter((t) => {
      const matchSearch =
        !q ||
        (t.title || "").toLowerCase().includes(q) ||
        String(t._id || "").slice(-6).toLowerCase().includes(q);
      const matchStatus = tenderStatusFilter === "All" || t.status === tenderStatusFilter;
      return matchSearch && matchStatus;
    });

    const sorted = [...filtered];
    sorted.sort((left, right) => {
      if (tenderSort === "title-desc") {
        return String(right.title || "").localeCompare(String(left.title || ""));
      }
      if (tenderSort === "status") {
        return String(left.status || "").localeCompare(String(right.status || ""));
      }
      return String(left.title || "").localeCompare(String(right.title || ""));
    });

    return sorted;
  }, [tenders, tenderSearch, tenderStatusFilter, tenderSort]);

  const filteredBids = useMemo(() => {
    const q = bidSearch.trim().toLowerCase();
    const filtered = evaluatedBids.filter((bid) => {
      const vendorName = (bid.vendorName || bid.vendorDetails?.name || "").toLowerCase();
      const matchSearch = !q || vendorName.includes(q);
      const matchStatus = bidStatusFilter === "All" || bid.status === bidStatusFilter;
      return matchSearch && matchStatus;
    });

    const sorted = [...filtered];
    sorted.sort((left, right) => {
      if (bidSort === "technical-desc") {
        return Number(right.technicalScore || 0) - Number(left.technicalScore || 0);
      }
      if (bidSort === "financial-desc") {
        return Number(right.financialScore || 0) - Number(left.financialScore || 0);
      }
      if (bidSort === "amount-asc") {
        return Number(left.proposedAmount || 0) - Number(right.proposedAmount || 0);
      }
      if (bidSort === "amount-desc") {
        return Number(right.proposedAmount || 0) - Number(left.proposedAmount || 0);
      }
      return String(left.vendorName || left.vendorDetails?.name || "").localeCompare(
        String(right.vendorName || right.vendorDetails?.name || "")
      );
    });

    return sorted;
  }, [evaluatedBids, bidSearch, bidStatusFilter, bidSort]);

  const selectedTender = useMemo(
    () => tenders.find((tender) => tender._id === selectedTenderId) || null,
    [tenders, selectedTenderId]
  );

  const aiSummaryMap = useMemo(() => {
    const map = new Map<string, any>();
    aiSummaries.forEach((summary) => {
      map.set(summary.bidId, summary);
    });
    return map;
  }, [aiSummaries]);

  const aiRanking = useMemo(() => {
    return [...evaluatedBids]
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
  }, [evaluatedBids, aiSummaryMap]);

  const aiRankMap = useMemo(() => {
    return new Map(aiRanking.map((item) => [item.bidId, item.rank]));
  }, [aiRanking]);

  const evaluationMethod = selectedTender?.evaluationMethod || "QCBS";

  const loadTenders = async () => {
    try {
      const data = await apiRequest<any[]>("/api/tenders?summary=true");
      setTenders(data);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to load tenders");
    }
  };

  const loadEvaluatedBids = async (tenderId: string) => {
    setSelectedTenderId(tenderId);
    setActionError("");
    setActionSuccess("");
    setBidSearch("");
    setBidStatusFilter("All");
    setBidSort("vendor");
    if (!tenderId) {
      setEvaluatedBids([]);
      setAiSummaries([]);
      return;
    }
    try {
      const data = await apiRequest<any[]>(`/api/tenders/${tenderId}/evaluated-bids`);
      setEvaluatedBids(data);
      const aiData = await apiRequest<any[]>(`/api/ai/evaluations/tenders/${tenderId}`);
      setAiSummaries(aiData || []);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to load evaluated bids");
    }
  };

  const selectWinner = async (bidId: string) => {
    if (!selectedTenderId) return;
    setActionError("");
    setActionSuccess("");
    try {
      await apiRequest(`/api/tenders/${selectedTenderId}/bids/${bidId}/select`, { method: "PUT" });
      setActionSuccess("Winner selected successfully.");
      await loadTenders();
      await loadEvaluatedBids(selectedTenderId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to select winner");
    }
  };

  useEffect(() => {
    loadTenders();
  }, []);

  const statusBadgeClass = (status?: string) => {
    if (status === "Selected") return "bg-green-100 text-green-700";
    if (status === "Rejected") return "bg-red-100 text-red-700";
    if (status === "Evaluated") return "bg-blue-100 text-blue-700";
    return "bg-gray-100 text-gray-600";
  };

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="cpo" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="cpo" userName={authUser?.name || ""} />
        <div className="flex-1 overflow-auto p-6">
        <div className="mb-6">
          <h1 className="text-2xl text-[#0B3C5D] mb-1">Bid Comparison</h1>
          <p className="text-sm text-gray-600">Compare evaluated bids and approve final winner selection</p>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <input
              type="text"
              value={tenderSearch}
              onChange={(e) => setTenderSearch(e.target.value)}
              placeholder="Search tender by title or ID…"
              className="flex-1 min-w-[200px] max-w-sm px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
            <select
              value={tenderStatusFilter}
              onChange={(e) => setTenderStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[170px] bg-white"
            >
              <option value="All">All Tender Statuses</option>
              <option value="Draft">Draft</option>
              <option value="Published">Published</option>
              <option value="Closed">Closed</option>
              <option value="Awarded">Awarded</option>
              <option value="Completed">Completed</option>
            </select>
            <select
              value={tenderSort}
              onChange={(e) => setTenderSort(e.target.value as "title-asc" | "title-desc" | "status")}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[170px] bg-white"
            >
              <option value="title-asc">Sort: Title A-Z</option>
              <option value="title-desc">Sort: Title Z-A</option>
              <option value="status">Sort: Status</option>
            </select>
            <select
              value={selectedTenderId}
              onChange={(e) => loadEvaluatedBids(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[220px]"
            >
              <option value="">Select tender ({filteredTenders.length})</option>
              {filteredTenders.map((tender) => (
                <option key={tender._id} value={tender._id}>
                  {tender.title} ({tender.status})
                </option>
              ))}
            </select>
            <span className="text-xs text-gray-400 self-center">{filteredTenders.length} of {tenders.length}</span>
            {(tenderSearch || tenderStatusFilter !== "All" || tenderSort !== "title-asc") && (
              <button
                onClick={() => {
                  setTenderSearch("");
                  setTenderStatusFilter("All");
                  setTenderSort("title-asc");
                }}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
              >
                Clear
              </button>
            )}
          </div>

          {actionError && <p className="text-sm text-red-600 mb-3">{actionError}</p>}
          {actionSuccess && <p className="text-sm text-green-600 mb-3">{actionSuccess}</p>}

          {selectedTenderId && !evaluatedBids.length && (
            <p className="text-sm text-gray-500 py-6 text-center">No evaluated bids found for this tender.</p>
          )}
          {!selectedTenderId && (
            <p className="text-sm text-gray-400 py-6 text-center">Select a tender above to view evaluated bids.</p>
          )}

          {!!selectedTenderId && (
            <div className="flex flex-wrap items-center gap-3 mb-4 border-t border-gray-100 pt-4">
              <input
                type="text"
                value={bidSearch}
                onChange={(e) => setBidSearch(e.target.value)}
                placeholder="Search by vendor name…"
                className="flex-1 min-w-[200px] max-w-sm px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <select
                value={bidStatusFilter}
                onChange={(e) => setBidStatusFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[170px] bg-white"
              >
                <option value="All">All Bid Statuses</option>
                <option value="Pending">Pending</option>
                <option value="Evaluated">Evaluated</option>
                <option value="Selected">Selected</option>
                <option value="Rejected">Rejected</option>
              </select>
              <select
                value={bidSort}
                onChange={(e) => setBidSort(e.target.value as "vendor" | "technical-desc" | "financial-desc" | "amount-asc" | "amount-desc")}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm min-w-[190px] bg-white"
              >
                <option value="vendor">Sort: Vendor A-Z</option>
                <option value="technical-desc">Sort: Technical High-Low</option>
                <option value="financial-desc">Sort: Financial High-Low</option>
                <option value="amount-asc">Sort: Amount Low-High</option>
                <option value="amount-desc">Sort: Amount High-Low</option>
              </select>
              <span className="text-xs text-gray-400 self-center">{filteredBids.length} of {evaluatedBids.length}</span>
              {(bidSearch || bidStatusFilter !== "All" || bidSort !== "vendor") && (
                <button
                  onClick={() => {
                    setBidSearch("");
                    setBidStatusFilter("All");
                    setBidSort("vendor");
                  }}
                  className="text-xs text-gray-500 hover:text-gray-700 underline"
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {!!selectedTenderId && !evaluatedBids.length && (
            <p className="text-sm text-gray-500 py-2 text-center">No evaluated bids found for this tender.</p>
          )}
          {!!selectedTenderId && !!evaluatedBids.length && !filteredBids.length && (
            <p className="text-sm text-gray-400 py-2 text-center">No bids match your filters.</p>
          )}

          {!!selectedTenderId && !!evaluatedBids.length && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 mb-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-lg text-[#0B3C5D]">Committee vs AI Selection Table</h3>
                  <p className="text-sm text-gray-500">Committee marks, AI marks, vendor document rationale, and final rank</p>
                </div>
                <span className="text-xs text-gray-400">{evaluatedBids.length} bid(s)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs text-gray-600 uppercase">Vendor</th>
                      <th className="px-4 py-3 text-left text-xs text-gray-600 uppercase">Committee Avg</th>
                      <th className="px-4 py-3 text-left text-xs text-gray-600 uppercase">AI Tech</th>
                      <th className="px-4 py-3 text-left text-xs text-gray-600 uppercase">AI Fin</th>
                      <th className="px-4 py-3 text-left text-xs text-gray-600 uppercase">AI Total</th>
                      <th className="px-4 py-3 text-left text-xs text-gray-600 uppercase">AI Rank</th>
                      <th className="px-4 py-3 text-left text-xs text-gray-600 uppercase">AI Comment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredBids.map((bid) => {
                      const ai = aiSummaryMap.get(bid._id);
                      const committeeAvg = Array.isArray(bid.committeeEvaluations) && bid.committeeEvaluations.length
                        ? Math.round(
                            bid.committeeEvaluations.reduce((sum: number, item: any) => sum + Number(item.technicalScore || 0), 0) /
                              bid.committeeEvaluations.length
                          )
                        : Number(bid.technicalScore || 0);
                      const rank = aiRankMap.get(bid._id) || "-";
                      const eligibilityPassed = ai?.eligibility?.passed;
                      const eligibilityReason = ai?.eligibility?.reasons?.[0] || "";
                      const scoreSummary = [
                        `Tech ${Number(ai?.aiScores?.technicalScore || 0).toFixed(2)}`,
                        `Fin ${Number(ai?.aiScores?.financialScore || 0).toFixed(2)}`,
                        `Total ${Number(ai?.aiScores?.overallScore || 0).toFixed(2)}`,
                      ].join(" · ");
                      return (
                        <tr key={bid._id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div className="font-medium text-[#0B3C5D]">{bid.vendorName || bid.vendorDetails?.name || "Vendor"}</div>
                            <div className="text-xs text-gray-500">₹{Number(bid.proposedAmount || 0).toLocaleString()}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium">{committeeAvg}</div>
                            <div className="text-xs text-gray-400">{(bid.committeeEvaluations || []).length} review(s)</div>
                          </td>
                          <td className="px-4 py-3">{Number(ai?.aiScores?.technicalScore || 0).toFixed(2)}</td>
                          <td className="px-4 py-3">{Number(ai?.aiScores?.financialScore || 0).toFixed(2)}</td>
                          <td className="px-4 py-3 font-medium">{Number(ai?.aiScores?.overallScore || 0).toFixed(2)}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-800 px-2 py-1 text-xs">
                              <Award className="w-3.5 h-3.5" />
                              #{rank}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-600 max-w-[320px]">
                            <div className="space-y-2">
                              <p>{ai?.summary || ai?.rationale?.join(" ") || "AI analysis pending"}</p>
                              <p className="text-[11px] text-gray-500">{scoreSummary}</p>
                              <div className="flex flex-wrap gap-1">
                                <span className={`rounded-full px-2 py-0.5 text-[11px] ${eligibilityPassed === false ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
                                  {eligibilityPassed === false ? "Eligibility failed" : "Eligibility passed"}
                                </span>
                                {eligibilityReason ? (
                                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                                    {eligibilityReason}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {evaluationMethod === "L1" && selectedTender?.l1Config?.technicalCutoff !== undefined && (
            <p className="text-xs text-gray-500 mb-3">L1 cutoff: {selectedTender.l1Config.technicalCutoff}% technical marks. Only the lowest commercial bid among qualified bids can be approved.</p>
          )}

          <div className="space-y-3">
            {filteredBids.map((bid) => (
              <div
                key={bid._id}
                className="flex flex-col md:flex-row md:items-center md:justify-between border border-gray-200 rounded-md p-4 gap-3"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <p className="text-sm font-medium text-[#0B3C5D]">{bid.vendorName || bid.vendorDetails?.name || "Vendor"}</p>
                    <span className={`px-2 py-1 rounded-full text-xs ${statusBadgeClass(bid.status)}`}>
                      {bid.status || "Pending"}
                    </span>
                    {evaluationMethod === "L1" && bid.isQualified && (
                      <span className="px-2 py-1 rounded-full text-xs bg-green-100 text-green-700">Qualified</span>
                    )}
                    {evaluationMethod === "L1" && bid.isQualified === false && (
                      <span className="px-2 py-1 rounded-full text-xs bg-red-100 text-red-700">Below cutoff</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-4 mt-1">
                    <span className="text-xs text-gray-600">
                      Technical: <strong>{bid.technicalScore ?? 0}</strong>
                    </span>
                    <span className="text-xs text-gray-600">
                      Financial: <strong>{bid.financialScore ?? 0}</strong>
                    </span>
                    <span className="text-xs text-gray-600">
                      Amount: <strong>₹{Number(bid.proposedAmount).toLocaleString()}</strong>
                    </span>
                    {evaluationMethod === "L1" && bid.isLowestQualified && (
                      <span className="text-xs text-green-700 font-medium">Lowest qualified commercial bid</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => selectWinner(bid._id)}
                  disabled={evaluationMethod === "L1" && !bid.isLowestQualified}
                  className={`px-5 py-2 rounded-md text-sm text-white ${evaluationMethod === "L1" && !bid.isLowestQualified ? "bg-gray-400 cursor-not-allowed" : "bg-[#2E8B57] hover:bg-[#267347]"}`}
                >
                  {evaluationMethod === "L1" ? "Approve Lowest Qualified Bid" : "Approve & Select Winner"}
                </button>
              </div>
            ))}
          </div>
        </div>
        </div>
        <AIAssistant role="cpo" />
      </div>
    </div>
  );
}

