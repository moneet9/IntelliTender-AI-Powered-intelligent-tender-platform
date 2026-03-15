import { Sidebar } from "../layout/Sidebar";
import { AIAssistant } from "../AIAssistant";
import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../api";

export function CPOBidComparison() {
  const [tenders, setTenders] = useState<any[]>([]);
  const [selectedTenderId, setSelectedTenderId] = useState("");
  const [evaluatedBids, setEvaluatedBids] = useState<any[]>([]);
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

  const loadTenders = async () => {
    try {
      const data = await apiRequest<any[]>("/api/tenders");
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
      return;
    }
    try {
      const data = await apiRequest<any[]>(`/api/tenders/${tenderId}/evaluated-bids`);
      setEvaluatedBids(data);
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
                  </div>
                </div>
                <button
                  onClick={() => selectWinner(bid._id)}
                  className="px-5 py-2 bg-[#2E8B57] hover:bg-[#267347] text-white rounded-md text-sm"
                >
                  Approve & Select Winner
                </button>
              </div>
            ))}
          </div>
        </div>
        <AIAssistant role="cpo" />
      </div>
    </div>
  );
}
