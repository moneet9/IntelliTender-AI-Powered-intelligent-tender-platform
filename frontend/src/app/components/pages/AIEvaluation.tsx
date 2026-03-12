import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle, ChevronDown, ChevronUp, FileText } from "lucide-react";
import { Sidebar } from "../layout/Sidebar";
import { Header } from "../layout/Header";
import { AIAssistant } from "../AIAssistant";
import { apiRequest } from "../../api";
import { getStoredDocumentName, getStoredDocumentUrl } from "../../document-utils";

type TenderStatus = "Draft" | "Published" | "Closed" | "Awarded";
type BidStatus = "Pending" | "Evaluated" | "Selected" | "Rejected";

type TenderRecord = {
  _id: string;
  title: string;
  description?: string;
  status: TenderStatus;
  category?: string;
  budget?: number;
  deadline?: string;
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
  const [error, setError] = useState("");

  useEffect(() => {
    const loadTenders = async () => {
      setLoadingTenders(true);
      setError("");
      try {
        const data = await apiRequest<TenderRecord[]>("/api/tenders");
        const eligible = (data || []).filter((tender) =>
          tender.status === "Published" || tender.status === "Closed" || tender.status === "Awarded"
        );
        setTenders(eligible);
        if (eligible.length) {
          setSelectedTenderId(eligible[0]._id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load tenders");
      } finally {
        setLoadingTenders(false);
      }
    };

    loadTenders();
  }, []);

  useEffect(() => {
    if (!selectedTenderId) {
      setBids([]);
      return;
    }

    const loadBids = async () => {
      setLoadingBids(true);
      setError("");
      try {
        const data = await apiRequest<BidRecord[]>(`/api/tenders/${selectedTenderId}/bids`);
        setBids(data || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load submissions");
      } finally {
        setLoadingBids(false);
      }
    };

    loadBids();
  }, [selectedTenderId]);

  const selectedTender = useMemo(
    () => tenders.find((tender) => tender._id === selectedTenderId) || null,
    [tenders, selectedTenderId]
  );

  const stats = useMemo(() => {
    const total = bids.length;
    const pending = bids.filter((b) => b.status === "Pending").length;
    const evaluated = bids.filter((b) => b.status === "Evaluated").length;
    const selected = bids.filter((b) => b.status === "Selected").length;
    return { total, pending, evaluated, selected };
  }, [bids]);

  return (
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

          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 mb-6">
            <label className="block text-sm text-gray-700 mb-2">Select Tender</label>
            <select
              value={selectedTenderId}
              onChange={(e) => {
                setSelectedTenderId(e.target.value);
                setExpandedBidId(null);
              }}
              className="w-full md:w-[520px] px-3 py-2 border border-gray-300 rounded-md bg-white"
            >
              <option value="">Choose a tender</option>
              {tenders.map((tender) => (
                <option key={tender._id} value={tender._id}>
                  {tender.title} ({tender.status})
                </option>
              ))}
            </select>
            {loadingTenders && <p className="text-sm text-gray-500 mt-2">Loading tenders...</p>}
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
                  <p className="text-xs text-gray-500">Deadline</p>
                  <p className="text-sm text-[#0B3C5D] mt-0.5">
                    {selectedTender.deadline ? new Date(selectedTender.deadline).toLocaleDateString() : "-"}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-md p-3">
                  <p className="text-xs text-gray-500">Status</p>
                  <p className="text-sm text-[#0B3C5D] mt-0.5">{selectedTender.status}</p>
                </div>
              </div>
              {selectedTender.description && <p className="text-sm text-gray-700">{selectedTender.description}</p>}
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
            <div className="p-5 border-b border-gray-100">
              <h3 className="text-lg text-[#0B3C5D]">Vendor Submissions</h3>
              <p className="text-sm text-gray-500 mt-1">Review submitted bid details and proposal documents for the selected tender</p>
            </div>

            {loadingBids && <p className="text-sm text-gray-500 px-5 py-4">Loading submissions...</p>}
            {!loadingBids && !selectedTenderId && <p className="text-sm text-gray-500 px-5 py-4">Select a tender to view submissions.</p>}
            {!loadingBids && !!selectedTenderId && bids.length === 0 && <p className="text-sm text-gray-500 px-5 py-4">No submissions received for this tender yet.</p>}

            <div className="divide-y divide-gray-100">
              {bids.map((bid) => {
                const proposalUrl = getStoredDocumentUrl(bid.proposalDocument);
                const proposalName = getStoredDocumentName(bid.proposalDocument, "Proposal document");
                const isExpanded = expandedBidId === bid._id;

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
                          <p className="text-sm text-gray-600 mb-2">Vendor Uploaded Proposal</p>
                          {proposalUrl ? (
                            <a
                              href={proposalUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-blue-50 border border-blue-100 text-[#1D4E89] hover:bg-blue-100"
                            >
                              <FileText className="w-4 h-4" />
                              {proposalName}
                            </a>
                          ) : (
                            <p className="text-sm text-gray-400">No proposal document available.</p>
                          )}
                        </div>

                        {bid.comments && (
                          <div className="p-3 bg-white rounded-md border border-gray-200">
                            <p className="text-xs text-gray-500 mb-1">Committee Comments</p>
                            <p className="text-sm text-gray-700">{bid.comments}</p>
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
  );
}

function statusBadgeClass(status: BidStatus): string {
  if (status === "Selected") return "bg-green-100 text-green-800";
  if (status === "Rejected") return "bg-red-100 text-red-800";
  if (status === "Evaluated") return "bg-blue-100 text-blue-800";
  return "bg-yellow-100 text-yellow-800";
}