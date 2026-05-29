import { Sidebar } from "../../layout/Sidebar";
import { Header } from "../../layout/Header";
import { AIAssistant } from "../../AIAssistant";
import { useEffect, useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { apiRequest, getAuthUser } from "../../../api";
import { getStoredDocumentName, getStoredDocumentUrl } from "../../../document-utils";

type Tender = {
  _id: string;
  title: string;
  status: "Draft" | "Published" | "Closed" | "Awarded" | "Completed";
  evaluationMethod?: "L1" | "QCBS";
  qcbsConfig?: {
    technicalWeight?: number;
    commercialWeight?: number;
    technicalCriteria?: Array<{ name: string; maxMarks: number }>;
  };
  requiredDocuments?: Array<{ label: string; category: "Technical" | "Commercial" }>;
  bids?: Array<{ _id: string }>;
};

type VendorDetails = {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  department?: string;
  specialization?: string;
  accountStatus?: string;
};

type Bid = {
  _id: string;
  vendorId?: string;
  vendorName?: string;
  vendorDetails?: VendorDetails | null;
  proposedAmount: number;
  bidDocuments?: Array<{
    label: string;
    category: "Technical" | "Commercial";
    documentId?: string;
    document?: string;
  }>;
  proposalDocumentId?: string;
  proposalDocument?: string;
  status: "Pending" | "Evaluated" | "Selected" | "Rejected";
  committeeEvaluations?: Array<{
    committeeMemberId?: string;
    technicalScore?: number;
    financialScore?: number;
    eligibilityChecked?: boolean;
    comments?: string;
    evaluatedDate?: string;
  }>;
  technicalScore?: number;
  financialScore?: number;
  comments?: string;
  evaluatedBy?: string;
  evaluatedDate?: string;
  createdAt?: string;
  updatedAt?: string;
};

export function CommitteeDashboard() {
  const authUser = getAuthUser();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [selectedTenderId, setSelectedTenderId] = useState<string>("");
  const [bids, setBids] = useState<Bid[]>([]);
  const [technicalScore, setTechnicalScore] = useState<Record<string, string>>({});
  const [technicalDocScores, setTechnicalDocScores] = useState<Record<string, Record<string, string>>>({});
  const [financialScore, setFinancialScore] = useState<Record<string, string>>({});
  const [eligibilityChecked, setEligibilityChecked] = useState<Record<string, boolean>>({});
  const [showEvaluation, setShowEvaluation] = useState<Record<string, boolean>>({});
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

  const selectedTender = useMemo(
    () => tenders.find((tender) => tender._id === selectedTenderId) || null,
    [tenders, selectedTenderId]
  );

  const technicalCriteriaMap = useMemo(() => {
    const criteria = selectedTender?.qcbsConfig?.technicalCriteria || [];
    return new Map(criteria.map((criterion) => [criterion.name, criterion.maxMarks]));
  }, [selectedTender]);

  const technicalRequirements = useMemo(
    () =>
      (selectedTender?.requiredDocuments || []).filter(
        (doc) =>
          doc.category === "Technical" &&
          doc.label.trim().toLowerCase() !== "eligibility proof"
      ),
    [selectedTender]
  );

  const maxTechnicalMarks = useMemo(
    () => (selectedTender?.qcbsConfig?.technicalCriteria || []).reduce(
      (sum, criterion) => sum + Number(criterion.maxMarks || 0),
      0
    ),
    [selectedTender]
  );

  const getBidDocumentUrl = (doc: Bid["bidDocuments"][number]) => {
    if (doc.documentId && selectedTenderId) {
      return `/api/tenders/${selectedTenderId}/bid-documents/${doc.documentId}`;
    }

    return getStoredDocumentUrl(doc.document);
  };

  const resolveBidDocument = (bid: Bid, label: string) => {
    const normalized = label.trim().toLowerCase();
    return (bid.bidDocuments || []).find(
      (doc) => doc.label.trim().toLowerCase() === normalized
    );
  };

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
      if (Array.isArray(data)) {
        setBids(data);
      } else {
        setBids([]);
        setError("Invalid response format from server");
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to load bids";
      setError(errorMsg);
      console.error('Error loading bids:', err);
      setBids([]);
    }
  };

  const submitEvaluation = async (bidId: string) => {
    if (!selectedTenderId) return;
    if (selectedTender?.status === "Awarded" || selectedTender?.status === "Completed") return;

    const evaluationMethod = selectedTender?.evaluationMethod || "QCBS";
    const eligibilityValue = eligibilityChecked[bidId] !== false;

    const technicalTotal = technicalRequirements.reduce(
      (sum, doc) => sum + Number(technicalDocScores[bidId]?.[doc.label] || 0),
      0
    );
    const technicalScoreValue = evaluationMethod === "QCBS"
      ? (technicalRequirements.length ? technicalTotal : Number(technicalScore[bidId] || 0))
      : 0;
    const financialScoreValue = Number(financialScore[bidId] || 0);

    setSubmittingBidId(bidId);
    setError("");
    setSuccess("");

    try {
      await apiRequest(`/api/tenders/${selectedTenderId}/bids/${bidId}/evaluate`, {
        method: "PUT",
        body: {
          eligibilityChecked: eligibilityValue,
          technicalScore: eligibilityValue ? technicalScoreValue : 0,
          financialScore: eligibilityValue ? financialScoreValue : 0,
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
    if (!bids.length) return;
    setEligibilityChecked((prev) => {
      const next = { ...prev };
      bids.forEach((bid) => {
        if (typeof next[bid._id] === "undefined") {
          const evaluation = getCommitteeMemberEvaluation(bid);
          next[bid._id] = evaluation?.eligibilityChecked ?? true;
        }
      });
      return next;
    });
    setShowEvaluation((prev) => {
      const next = { ...prev };
      bids.forEach((bid) => {
        if (typeof next[bid._id] === "undefined") {
          next[bid._id] = true;
        }
      });
      return next;
    });
  }, [bids]);

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
                    const technicalTotal = technicalRequirements.reduce(
                      (sum, doc) => sum + Number(technicalDocScores[bid._id]?.[doc.label] || 0),
                      0
                    );
                    const eligibilityValue = eligibilityChecked[bid._id] !== false;
                    const evaluationMethod = selectedTender?.evaluationMethod || "QCBS";
                    const isFinalized = selectedTender?.status === "Awarded" || selectedTender?.status === "Completed";

                    const evaluatedPrices = bids
                      .map((entry) => Number(financialScore[entry._id] || entry.financialScore || entry.proposedAmount || 0))
                      .filter((value) => Number.isFinite(value) && value > 0);
                    const lowestPrice = evaluatedPrices.length ? Math.min(...evaluatedPrices) : 0;
                    const technicalNormalized = maxTechnicalMarks > 0 ? (technicalTotal / maxTechnicalMarks) * 100 : 0;
                    const priceValue = Number(financialScore[bid._id] || bid.financialScore || bid.proposedAmount || 0);
                    const commercialNormalized = lowestPrice > 0 && priceValue > 0 ? (lowestPrice / priceValue) * 100 : 0;
                    const technicalWeight = Number(selectedTender?.qcbsConfig?.technicalWeight || 0);
                    const commercialWeight = Number(selectedTender?.qcbsConfig?.commercialWeight || 0);
                    const weightedTechnical = technicalNormalized * (technicalWeight / 100);
                    const weightedCommercial = commercialNormalized * (commercialWeight / 100);
                    const qcbsFinal = weightedTechnical + weightedCommercial;

                    return (
                      <div key={bid._id} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <h4 className="text-sm text-[#0B3C5D]">{bid.vendorName || "Vendor"}</h4>
                            <p className="text-xs text-gray-500 mt-1">
                              {evaluationMethod === "QCBS"
                                ? `Aggregated score: Technical ${Number.isFinite(weightedTechnical) ? weightedTechnical.toFixed(2) : "-"} | Commercial ${Number.isFinite(weightedCommercial) ? weightedCommercial.toFixed(2) : "-"} | QCBS ${Number.isFinite(qcbsFinal) ? qcbsFinal.toFixed(2) : "-"}`
                                : `Aggregated score: Commercial ${Number.isFinite(priceValue) && priceValue > 0 ? priceValue.toLocaleString() : "-"}`}
                            </p>
                          </div>
                          <div className="text-right">
                            <span className="text-sm text-gray-600">₹{Number(bid.proposedAmount).toLocaleString()}</span>
                            <p className="text-xs text-gray-500 mt-1">{evaluationCount} committee review(s)</p>
                          </div>
                        </div>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-sm text-gray-600">Evaluation Form</p>
                            <button
                              type="button"
                              onClick={() =>
                                setShowEvaluation((prev) => ({
                                  ...prev,
                                  [bid._id]: !(prev[bid._id] ?? true),
                                }))
                              }
                              className="text-xs text-[#1D4E89] hover:underline"
                            >
                              {(showEvaluation[bid._id] ?? true) ? "Hide evaluation" : "Show evaluation"}
                            </button>
                          </div>
                          {(showEvaluation[bid._id] ?? true) && (
                            <>
                              <div className="grid grid-cols-1 gap-2">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs font-semibold text-gray-500">
                                  <span>Field</span>
                                  <span>Document Uploaded</span>
                                  <span>Marking</span>
                                </div>

                            {(() => {
                              const eligibilityDoc = resolveBidDocument(bid, "Eligibility Proof");
                              const eligibilityUrl = eligibilityDoc ? getBidDocumentUrl(eligibilityDoc) : "";
                              const eligibilityName = eligibilityDoc
                                ? getStoredDocumentName(eligibilityDoc.document, eligibilityDoc.label)
                                : "Not uploaded";

                              return (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center border border-gray-200 rounded-md p-3">
                                  <span className="text-sm text-[#0B3C5D]">Eligibility Proof</span>
                                  <span className="text-sm">
                                    {eligibilityUrl ? (
                                      <a href={eligibilityUrl} target="_blank" rel="noreferrer" className="text-[#1D4E89] hover:underline">
                                        {eligibilityName}
                                      </a>
                                    ) : (
                                      <span className="text-gray-400">{eligibilityName}</span>
                                    )}
                                  </span>
                                  <label className="inline-flex items-center gap-2 text-sm">
                                    <input
                                      type="checkbox"
                                      checked={eligibilityValue}
                                      onChange={(e) =>
                                        setEligibilityChecked((prev) => ({
                                          ...prev,
                                          [bid._id]: e.target.checked,
                                        }))
                                      }
                                      disabled={isFinalized}
                                      className="h-4 w-4 text-[#1D4E89]"
                                    />
                                    Eligible
                                  </label>
                                </div>
                              );
                            })()}

                            {eligibilityValue && evaluationMethod === "QCBS" && technicalRequirements.map((doc) => {
                              const maxMarks = technicalCriteriaMap.get(doc.label) ?? 0;
                              const value = technicalDocScores[bid._id]?.[doc.label] ?? "";
                              const bidDoc = resolveBidDocument(bid, doc.label);
                              const docUrl = bidDoc ? getBidDocumentUrl(bidDoc) : "";
                              const docName = bidDoc ? getStoredDocumentName(bidDoc.document, doc.label) : "Not uploaded";

                              return (
                                <div key={doc.label} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center border border-gray-200 rounded-md p-3">
                                  <span className="text-sm text-[#0B3C5D]">{doc.label}</span>
                                  <span className="text-sm">
                                    {docUrl ? (
                                      <a href={docUrl} target="_blank" rel="noreferrer" className="text-[#1D4E89] hover:underline">
                                        {docName}
                                      </a>
                                    ) : (
                                      <span className="text-gray-400">{docName}</span>
                                    )}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="number"
                                      min="0"
                                      max={maxMarks}
                                      value={value}
                                      onChange={(e) => {
                                        const nextValue = e.target.value;
                                        const maxAllowed = Number.isFinite(maxMarks) ? maxMarks : 0;
                                        const parsed = nextValue === "" ? "" : Math.min(Math.max(Number(nextValue), 0), maxAllowed);
                                        setTechnicalDocScores((prev) => ({
                                          ...prev,
                                          [bid._id]: { ...(prev[bid._id] || {}), [doc.label]: String(parsed) },
                                        }));
                                      }}
                                      disabled={isFinalized}
                                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                                      placeholder={`0 - ${maxMarks}`}
                                    />
                                    <span className="text-xs text-gray-500">/ {maxMarks}</span>
                                  </div>
                                </div>
                              );
                            })}

                            {eligibilityValue && (
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center border border-gray-200 rounded-md p-3">
                                <span className="text-sm text-[#0B3C5D]">Commercial Bid Document</span>
                                <span className="text-sm">
                                  {(() => {
                                    const commercialDoc = resolveBidDocument(bid, "Commercial Bid Document");
                                    const commercialUrl = commercialDoc ? getBidDocumentUrl(commercialDoc) : "";
                                    const commercialName = commercialDoc
                                      ? getStoredDocumentName(commercialDoc.document, commercialDoc.label)
                                      : "Not uploaded";
                                    return commercialUrl ? (
                                      <a href={commercialUrl} target="_blank" rel="noreferrer" className="text-[#1D4E89] hover:underline">
                                        {commercialName}
                                      </a>
                                    ) : (
                                      <span className="text-gray-400">{commercialName}</span>
                                    );
                                  })()}
                                </span>
                                <input
                                  type="number"
                                  value={financialScore[bid._id] ?? String(myEvaluation?.financialScore ?? "")}
                                  onChange={(e) => setFinancialScore({ ...financialScore, [bid._id]: e.target.value })}
                                  disabled={isFinalized}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                                  placeholder="Enter price"
                                />
                              </div>
                            )}
                          </div>

                              {eligibilityValue && evaluationMethod === "QCBS" && (
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-gray-600">
                                  <div>
                                    <p>Technical total</p>
                                    <p className="text-sm text-[#0B3C5D] font-medium">{technicalTotal}</p>
                                  </div>
                                  <div>
                                    <p>QCBS score</p>
                                    <p className="text-sm text-[#0B3C5D] font-medium">{Number.isFinite(qcbsFinal) ? qcbsFinal.toFixed(2) : "-"}</p>
                                  </div>
                                  <div>
                                    <p>Commercial price</p>
                                    <p className="text-sm text-[#0B3C5D] font-medium">₹{priceValue ? priceValue.toLocaleString() : "-"}</p>
                                  </div>
                                </div>
                              )}

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <input
                                  type="text"
                                  value={comments[bid._id] ?? myEvaluation?.comments ?? ""}
                                  onChange={(e) => setComments({ ...comments, [bid._id]: e.target.value })}
                                  disabled={isFinalized}
                                  className="px-3 py-2 border border-gray-300 rounded-md"
                                  placeholder="Comments"
                                />
                              </div>
                            </>
                          )}
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
                            disabled={isSubmitting || isFinalized}
                            className={`px-4 py-2 rounded-md text-sm text-white ${
                              isSubmitting ? "bg-[#7aa0c5] cursor-not-allowed" : "bg-[#1D4E89] hover:bg-[#154068]"
                            }`}
                          >
                            {isSubmitting ? "Saving..." : myEvaluation ? "Update Evaluation" : "Mark Evaluated"}
                          </button>
                        </div>
                        {isFinalized && (
                          <p className="text-xs text-gray-500 mt-2">Tender finalized; editing disabled.</p>
                        )}
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
