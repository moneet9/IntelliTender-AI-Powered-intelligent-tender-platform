import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle, ChevronDown, ChevronUp, FileText } from "lucide-react";
import { Sidebar } from "../../layout/Sidebar";
import { Header } from "../../layout/Header";
import { AIAssistant } from "../../AIAssistant";
import { apiRequest } from "../../../api";
import { getStoredDocumentName, getStoredDocumentUrl } from "../../../document-utils";

type TenderStatus = "Draft" | "Published" | "Closed" | "Awarded" | "Completed";
type BidStatus = "Pending" | "Evaluated" | "Selected" | "Rejected";

type TenderRecord = {
  _id: string;
  title: string;
  description?: string;
  status: TenderStatus;
  category?: string;
  budget?: number;
  finalSubmissionDate?: string;
  documents?: string[];
};

type BidRecord = {
  _id: string;
  vendorName?: string;
  vendorDetails?: {
    name?: string;
    email?: string;
    phone?: string;
    department?: string;
    specialization?: string;
  } | null;
  proposedAmount: number;
  proposalDocument?: string;
  bidDocuments?: Array<{
    label: string;
    category: "Technical" | "Commercial";
    documentId?: string;
    document?: string;
  }>;
  status: BidStatus;
  technicalScore?: number;
  financialScore?: number;
  comments?: string;
};

export function AIEvaluation() {
  const [tenders, setTenders] = useState<TenderRecord[]>([]);
  const [selectedTenderId, setSelectedTenderId] = useState("");
  const [bids, setBids] = useState<BidRecord[]>([]);
  const [expandedBidId, setExpandedBidId] = useState<string | null>(null);
  const [loadingTenders, setLoadingTenders] = useState(false);
  const [loadingBids, setLoadingBids] = useState(false);
  const [selectingBidId, setSelectingBidId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Tender search & filter
  const [tenderSearch, setTenderSearch] = useState("");
  const [tenderStatusFilter, setTenderStatusFilter] = useState("All");
  const [tenderCategoryFilter, setTenderCategoryFilter] = useState("All");

  // Bid search & filter
  const [bidSearch, setBidSearch] = useState("");
  const [bidStatusFilter, setBidStatusFilter] = useState("All");

  const loadTenders = useCallback(async () => {
    setLoadingTenders(true);
    setError("");
    try {
      const data = await apiRequest<TenderRecord[]>("/api/tenders");
      const eligibleStatuses = new Set(["published", "closed", "awarded", "completed"]);
      const eligible = (data || []).filter((tender) => {
        const normalizedStatus = String(tender.status || "").trim().toLowerCase();
        return eligibleStatuses.has(normalizedStatus);
      });

      setTenders(eligible);
      setSelectedTenderId((previousId) => {
        if (previousId && eligible.some((item) => item._id === previousId)) {
          return previousId;
        }
        return eligible[0]?._id || "";
      });
      setExpandedBidId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tenders");
    } finally {
      setLoadingTenders(false);
    }
  }, []);

  useEffect(() => {
    void loadTenders();
  }, [loadTenders]);

  const loadBids = useCallback(async (tenderId: string) => {
    if (!tenderId) {
      setBids([]);
      return;
    }

    setLoadingBids(true);
    setError("");
    try {
      const data = await apiRequest<BidRecord[]>(`/api/tenders/${tenderId}/bids`);
      setBids(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load submissions");
    } finally {
      setLoadingBids(false);
    }
  }, []);

  useEffect(() => {
    void loadBids(selectedTenderId);
  }, [loadBids, selectedTenderId]);

  const selectedTender = useMemo(
    () => tenders.find((tender) => tender._id === selectedTenderId) || null,
    [tenders, selectedTenderId]
  );

  const filteredTenders = useMemo(() => {
    return tenders.filter((t) => {
      const q = tenderSearch.trim().toLowerCase();
      const matchSearch = !q ||
        t.title.toLowerCase().includes(q) ||
        t._id.slice(-6).toLowerCase().includes(q);
      const matchStatus = tenderStatusFilter === "All" || t.status === tenderStatusFilter;
      const matchCategory = tenderCategoryFilter === "All" || (t.category || "General") === tenderCategoryFilter;
      return matchSearch && matchStatus && matchCategory;
    });
  }, [tenders, tenderSearch, tenderStatusFilter, tenderCategoryFilter]);

  const tenderCategories = useMemo(() => {
    const cats = new Set(tenders.map((t) => t.category || "General"));
    return Array.from(cats).sort();
  }, [tenders]);

  const filteredBids = useMemo(() => {
    return bids.filter((b) => {
      const q = bidSearch.trim().toLowerCase();
      const matchSearch = !q ||
        (b.vendorName || b.vendorDetails?.name || "").toLowerCase().includes(q);
      const matchStatus = bidStatusFilter === "All" || b.status === bidStatusFilter;
      return matchSearch && matchStatus;
    });
  }, [bids, bidSearch, bidStatusFilter]);

  const stats = useMemo(() => {
    const total = bids.length;
    const pending = bids.filter((b) => b.status === "Pending").length;
    const evaluated = bids.filter((b) => b.status === "Evaluated").length;
    const selected = bids.filter((b) => b.status === "Selected").length;
    return { total, pending, evaluated, selected };
  }, [bids]);

  const selectWinner = async (bidId: string) => {
    if (!selectedTenderId) return;

    setSelectingBidId(bidId);
    setError("");
    setSuccess("");

    try {
      await apiRequest(`/api/tenders/${selectedTenderId}/bids/${bidId}/select`, { method: "PUT" });
      setSuccess("Winner selected successfully. Tender has been awarded.");
      await Promise.all([loadTenders(), loadBids(selectedTenderId)]);
      setExpandedBidId(bidId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to select winner");
    } finally {
      setSelectingBidId("");
    }
  };

  const getBidDocumentUrl = (doc: BidRecord["bidDocuments"][number]) => {
    if (doc.documentId && selectedTenderId) {
      return `/api/tenders/${selectedTenderId}/bid-documents/${doc.documentId}`;
    }

    return getStoredDocumentUrl(doc.document);
  };

  return (
    <>
      <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="po" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="po" userName="Rajesh Kumar" />
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl text-[#0B3C5D] mb-1">Tender Evaluation</h1>
            <p className="text-sm text-gray-600">Select a tender and review vendor submissions with uploaded proposal documents</p>
          </div>

          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
          {success && <p className="text-sm text-green-700 mb-4">{success}</p>}

          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 mb-6">
            <label className="block text-sm text-gray-700 mb-3">Select Tender</label>
            <div className="flex flex-wrap gap-3 mb-3">
              <input
                type="text"
                value={tenderSearch}
                onChange={(e) => setTenderSearch(e.target.value)}
                placeholder="Search by title or ID…"
                className="flex-1 min-w-[180px] max-w-xs px-3 py-2 border border-gray-300 rounded-md text-sm bg-white"
              />
              <select
                value={tenderStatusFilter}
                onChange={(e) => setTenderStatusFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white"
              >
                <option value="All">All Statuses</option>
                <option value="Published">Published</option>
                <option value="Closed">Closed</option>
                <option value="Awarded">Awarded</option>
                <option value="Completed">Completed</option>
              </select>
              <select
                value={tenderCategoryFilter}
                onChange={(e) => setTenderCategoryFilter(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white"
              >
                <option value="All">All Categories</option>
                {tenderCategories.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              {(tenderSearch || tenderStatusFilter !== "All" || tenderCategoryFilter !== "All") && (
                <button
                  onClick={() => { setTenderSearch(""); setTenderStatusFilter("All"); setTenderCategoryFilter("All"); }}
                  className="text-xs text-gray-500 hover:text-gray-700 underline self-center"
                >
                  Clear
                </button>
              )}
            </div>
            <select
              value={selectedTenderId}
              onChange={(e) => {
                setSelectedTenderId(e.target.value);
                setExpandedBidId(null);
                setBidSearch("");
                setBidStatusFilter("All");
              }}
              className="w-full md:w-[520px] px-3 py-2 border border-gray-300 rounded-md bg-white"
            >
              <option value="">Choose a tender ({filteredTenders.length} match{filteredTenders.length !== 1 ? "es" : ""})</option>
              {filteredTenders.map((tender) => (
                <option key={tender._id} value={tender._id}>
                  {tender.title} ({tender.status})
                </option>
              ))}
            </select>
            {loadingTenders && <p className="text-sm text-gray-500 mt-2">Loading tenders...</p>}
            {!loadingTenders && tenders.length === 0 && (
              <p className="text-sm text-amber-700 mt-2">No published/closed/awarded tenders found.</p>
            )}
            {!loadingTenders && tenders.length > 0 && filteredTenders.length === 0 && (
              <p className="text-sm text-gray-400 mt-2">No tenders match your filters.</p>
            )}
          </div>

          {selectedTender && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 mb-6">
              <h3 className="text-base text-[#0B3C5D] mb-3">{selectedTender.title}</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                <div className="bg-gray-50 rounded-md p-3">
                  <p className="text-xs text-gray-500">Category</p>
                  <p className="text-sm text-[#0B3C5D] mt-0.5">{selectedTender.category || "General"}</p>
                </div>
                <div className="bg-gray-50 rounded-md p-3">
                  <p className="text-xs text-gray-500">Budget</p>
                  <p className="text-sm text-[#0B3C5D] mt-0.5">
                    {selectedTender.budget ? `₹${Number(selectedTender.budget).toLocaleString()}` : "-"}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-md p-3">
                  <p className="text-xs text-gray-500">Final Submission</p>
                  <p className="text-sm text-[#0B3C5D] mt-0.5">
                    {selectedTender.finalSubmissionDate
                      ? new Date(selectedTender.finalSubmissionDate).toLocaleDateString()
                      : "-"}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-md p-3">
                  <p className="text-xs text-gray-500">Status</p>
                  <p className="text-sm text-[#0B3C5D] mt-0.5">{selectedTender.status}</p>
                </div>
              </div>
              {selectedTender.description && <p className="text-sm text-gray-700">{selectedTender.description}</p>}
              {selectedTender.status === "Awarded" && (
                <p className="text-sm text-green-700 mt-3">This tender has already been awarded to a selected vendor.</p>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">Total Submissions</p>
              <p className="text-3xl text-[#0B3C5D]">{stats.total}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">Pending</p>
              <p className="text-3xl text-[#F4A300]">{stats.pending}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">Evaluated</p>
              <p className="text-3xl text-[#1D4E89]">{stats.evaluated}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">Selected</p>
              <p className="text-3xl text-[#2E8B57]">{stats.selected}</p>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-100">
            <div className="p-5 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg text-[#0B3C5D]">Vendor Submissions</h3>
                <p className="text-sm text-gray-500 mt-1">Review submitted bid details and proposal documents for the selected tender</p>
              </div>
              {!!bids.length && (
                <span className="text-xs text-gray-400">{filteredBids.length} of {bids.length} bid(s)</span>
              )}
            </div>
            {!!bids.length && (
              <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex flex-wrap gap-3 items-center">
                <input
                  type="text"
                  value={bidSearch}
                  onChange={(e) => setBidSearch(e.target.value)}
                  placeholder="Search by vendor name…"
                  className="flex-1 min-w-[160px] max-w-xs px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
                />
                <select
                  value={bidStatusFilter}
                  onChange={(e) => setBidStatusFilter(e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
                >
                  <option value="All">All Bid Statuses</option>
                  <option value="Pending">Pending</option>
                  <option value="Evaluated">Evaluated</option>
                  <option value="Selected">Selected</option>
                  <option value="Rejected">Rejected</option>
                </select>
                {(bidSearch || bidStatusFilter !== "All") && (
                  <button
                    onClick={() => { setBidSearch(""); setBidStatusFilter("All"); }}
                    className="text-xs text-gray-500 hover:text-gray-700 underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}

            {loadingBids && <p className="text-sm text-gray-500 px-5 py-4">Loading submissions...</p>}
            {!loadingBids && !selectedTenderId && <p className="text-sm text-gray-500 px-5 py-4">Select a tender to view submissions.</p>}
            {!loadingBids && !!selectedTenderId && bids.length === 0 && <p className="text-sm text-gray-500 px-5 py-4">No submissions received for this tender yet.</p>}
            {!loadingBids && !!bids.length && filteredBids.length === 0 && <p className="text-sm text-gray-400 px-5 py-4">No bids match your search.</p>}

            <div className="divide-y divide-gray-100">
              {filteredBids.map((bid) => {
                const proposalName = getStoredDocumentName(bid.proposalDocument, "Proposal document");
                const isExpanded = expandedBidId === bid._id;
                const canSelectWinner = bid.status === "Evaluated" && selectedTender?.status !== "Awarded";
                const isSelectingWinner = selectingBidId === bid._id;

                return (
                  <div key={bid._id} className="p-5">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                      <div>
                        <p className="text-sm text-[#0B3C5D] font-medium">{bid.vendorName || bid.vendorDetails?.name || "Vendor"}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{bid.vendorDetails?.email || "No email"}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="text-sm text-[#0B3C5D]">₹{Number(bid.proposedAmount || 0).toLocaleString()}</p>
                        <span className={`px-2.5 py-1 rounded-full text-xs ${statusBadgeClass(bid.status)}`}>{bid.status}</span>
                        <button
                          onClick={() => setExpandedBidId(isExpanded ? null : bid._id)}
                          className="text-sm text-[#1D4E89] hover:underline flex items-center gap-1"
                        >
                          Review
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-4 p-4 bg-gray-50 border border-gray-100 rounded-lg space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-gray-500">Phone</p>
                            <p className="text-[#0B3C5D] mt-0.5">{bid.vendorDetails?.phone || "-"}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Department</p>
                            <p className="text-[#0B3C5D] mt-0.5">{bid.vendorDetails?.department || "-"}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Specialization</p>
                            <p className="text-[#0B3C5D] mt-0.5">{bid.vendorDetails?.specialization || "-"}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Scores</p>
                            <p className="text-[#0B3C5D] mt-0.5">Technical: {bid.technicalScore ?? "-"} | Financial: {bid.financialScore ?? "-"}</p>
                          </div>
                        </div>

                        <div>
                          <p className="text-sm text-gray-600 mb-2">Vendor Documents</p>
                          {!!bid.bidDocuments?.length ? (
                            <div className="space-y-2">
                              {bid.bidDocuments.map((doc) => {
                                const name = getStoredDocumentName(doc.document, doc.label);
                                const url = getBidDocumentUrl(doc);
                                return (
                                  <div key={doc.label} className="flex items-center justify-between gap-3 border border-gray-200 rounded-md p-3 bg-white">
                                    <div className="flex items-center gap-2">
                                      <FileText className="w-4 h-4 text-[#1D4E89]" />
                                      <div>
                                        <p className="text-sm text-[#0B3C5D]">{doc.label}</p>
                                        <p className="text-xs text-gray-500">{name}</p>
                                      </div>
                                    </div>
                                    {url ? (
                                      <a
                                        href={url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-xs text-[#1D4E89] hover:underline"
                                      >
                                        Open
                                      </a>
                                    ) : (
                                      <span className="text-xs text-gray-400">Unavailable</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-sm text-gray-400">No documents uploaded.</p>
                          )}
                        </div>

                        {bid.comments && (
                          <div className="p-3 bg-white rounded-md border border-gray-200">
                            <p className="text-xs text-gray-500 mb-1">Committee Comments</p>
                            <p className="text-sm text-gray-700">{bid.comments}</p>
                          </div>
                        )}

                        {canSelectWinner && (
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                void selectWinner(bid._id);
                              }}
                              disabled={isSelectingWinner}
                              className={`px-4 py-2 rounded-md text-sm text-white transition-colors ${
                                isSelectingWinner ? "bg-green-300 cursor-not-allowed" : "bg-[#2E8B57] hover:bg-[#267347]"
                              }`}
                            >
                              {isSelectingWinner ? "Selecting..." : "Select Winner"}
                            </button>
                          </div>
                        )}

                        {bid.status === "Selected" ? (
                          <div className="text-sm text-green-700 flex items-center gap-2">
                            <CheckCircle className="w-4 h-4" /> Winning bid for this tender
                          </div>
                        ) : bid.status === "Rejected" ? (
                          <div className="text-sm text-red-700 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" /> Rejected in final selection
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <AIAssistant role="po" />
      </div>
    </>
  );
}

function statusBadgeClass(status: BidStatus): string {
  if (status === "Selected") return "bg-green-100 text-green-800";
  if (status === "Rejected") return "bg-red-100 text-red-800";
  if (status === "Evaluated") return "bg-blue-100 text-blue-800";
  return "bg-yellow-100 text-yellow-800";
}
