import { useState, useEffect, useMemo } from "react";
import { Sidebar } from "../../layout/Sidebar";
import { Header } from "../../layout/Header";
import { AIAssistant } from "../../AIAssistant";
import { Search, Filter, X, Calendar, FileText, SlidersHorizontal, Upload, Check } from "lucide-react";
import { apiRequest, getAuthUser } from "../../../api";
import { encodeFileToStoredDocument } from "../../../document-utils";
import { DocumentLinks, formatDateTime, hasExistingBid, TenderRecord } from "./vendorShared";

export function ContractSearch() {
  const authUser = getAuthUser();
  const isRestrictedAccount = authUser?.accountStatus && authUser.accountStatus !== "Active";
  const [tenders, setTenders] = useState<TenderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  // Filter and search state
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [budgetRange, setBudgetRange] = useState<[number, number]>([0, 100000000]);
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState<"finalSubmission" | "budget" | "name">("finalSubmission");
  
  // Bid submission state
  const [showSubmissionForm, setShowSubmissionForm] = useState(false);
  const [selectedTenderId, setSelectedTenderId] = useState("");
  const [declaration, setDeclaration] = useState(false);
  const [proposedAmount, setProposedAmount] = useState("");
  const [documentUploads, setDocumentUploads] = useState<Record<string, string>>({});
  const [documentNames, setDocumentNames] = useState<Record<string, string>>({});
  const [submittingBid, setSubmittingBid] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  
  // View Details modal state
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedDetailsId, setSelectedDetailsId] = useState("");

  // Load tenders from backend
  useEffect(() => {
    const loadTenders = async () => {
      try {
        setLoading(true);
        const data = await apiRequest<TenderRecord[]>("/api/tenders");
        setTenders(Array.isArray(data) ? data : []);
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load tenders");
        setTenders([]);
      } finally {
        setLoading(false);
      }
    };
    
    loadTenders();
  }, []);

  const selectedTender = useMemo(
    () => tenders.find((tender) => tender._id === selectedTenderId) || null,
    [tenders, selectedTenderId]
  );

  const detailedTender = useMemo(
    () => tenders.find((tender) => tender._id === selectedDetailsId) || null,
    [tenders, selectedDetailsId]
  );

  const openDetailsModal = (tenderId: string) => {
    setSelectedDetailsId(tenderId);
    setShowDetailsModal(true);
  };

  const closeDetailsModal = () => {
    setShowDetailsModal(false);
    setSelectedDetailsId("");
  };

  const openBidModal = (tenderId: string) => {
    setSelectedTenderId(tenderId);
    setShowSubmissionForm(true);
    setFormError("");
    setSuccess("");
    setDeclaration(false);
    setProposedAmount("");
    setDocumentUploads({});
    setDocumentNames({});
  };

  const closeBidModal = () => {
    setShowSubmissionForm(false);
    setSelectedTenderId("");
    setDeclaration(false);
    setProposedAmount("");
    setDocumentUploads({});
    setDocumentNames({});
  };

  const handleSubmitBid = async () => {
    if (isRestrictedAccount) return;
    if (!selectedTenderId || !declaration) return;

    if (!proposedAmount || Number(proposedAmount) <= 0) {
      setFormError("Enter a valid proposed amount before submitting the bid");
      return;
    }
    const requiredDocs = (selectedTender?.requiredDocuments || []).length
      ? selectedTender?.requiredDocuments || []
      : [{ label: "Commercial Bid Document", category: "Commercial" }];
    const missingDocs = requiredDocs.filter((doc) => !documentUploads[doc.label]);
    if (missingDocs.length > 0) {
      setFormError(`Upload all required documents: ${missingDocs.map((doc) => doc.label).join(", ")}`);
      return;
    }

    setSubmittingBid(true);
    setFormError("");
    setSuccess("");

    try {
      await apiRequest(`/api/tenders/${selectedTenderId}/bids`, {
        method: "POST",
        body: {
          proposedAmount: Number(proposedAmount),
          documents: requiredDocs.map((doc) => ({
            label: doc.label,
            document: documentUploads[doc.label],
          })),
        },
      });

      setSuccess("Bid submitted successfully");
      closeBidModal();
      // Reload tenders to reflect new bid status
      const data = await apiRequest<TenderRecord[]>("/api/tenders");
      setTenders(Array.isArray(data) ? data : []);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Bid submission failed");
    } finally {
      setSubmittingBid(false);
    }
  };

  // Filter tenders - only show published tenders to vendors
  const filteredTenders = tenders.filter(tender => {
    const matchesSearch = tender.title.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === "all" || tender.category === selectedCategory;
    const matchesStatus = selectedStatus === "all" || tender.status === selectedStatus;
    const matchesBudget = tender.budget >= budgetRange[0] && tender.budget <= budgetRange[1];
    const isPublished = tender.status === "Published";

    return isPublished && matchesSearch && matchesCategory && matchesStatus && matchesBudget;
  });

  // Sort tenders
  const sortedTenders = useMemo(() => {
    return [...filteredTenders].sort((a, b) => {
      if (sortBy === "finalSubmission") {
        return new Date(a.finalSubmissionDate).getTime() - new Date(b.finalSubmissionDate).getTime();
      }
      if (sortBy === "budget") return b.budget - a.budget;
      return a.title.localeCompare(b.title);
    });
  }, [filteredTenders, sortBy]);

  const clearFilters = () => {
    setSearchTerm("");
    setSelectedCategory("all");
    setSelectedStatus("all");
    setBudgetRange([0, 100000000]);
    setSortBy("finalSubmission");
  };

  const activeFiltersCount = [
    selectedCategory !== "all",
    selectedStatus !== "all",
    budgetRange[0] !== 0 || budgetRange[1] !== 100000000
  ].filter(Boolean).length;

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="vendor" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="vendor" userName={authUser?.name || "Vendor"} />
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl text-[#0B3C5D] mb-1">Tender Search</h1>
            <p className="text-sm text-gray-600">Search and filter available tenders by category, budget, and final submission time.</p>
          </div>

          {isRestrictedAccount && (
            <div className="mb-4 p-4 rounded-lg border border-yellow-200 bg-yellow-50 text-yellow-900 text-sm">
              Your account is suspended or frozen. Tender search is read-only and bid submission is disabled.
            </div>
          )}

          {/* Search and Filter Bar */}
          <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by tender name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                />
              </div>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-2 text-sm"
              >
                <SlidersHorizontal className="w-4 h-4" />
                Filters
                {activeFiltersCount > 0 && (
                  <span className="bg-[#1D4E89] text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                    {activeFiltersCount}
                  </span>
                )}
              </button>
            </div>

            {/* Filter Panel */}
            {showFilters && (
              <div className="pt-4 border-t border-gray-200 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Category Filter */}
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Category</label>
                    <select
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89] text-sm"
                    >
                      <option value="all">All Categories</option>
                      <option value="Supply">Supply</option>
                      <option value="Work">Work</option>
                      <option value="Service">Service</option>
                    </select>
                  </div>

                  {/* Sort By */}
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Status</label>
                    <select
                      value={selectedStatus}
                      onChange={(e) => setSelectedStatus(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89] text-sm"
                    >
                      <option value="all">All Statuses</option>
                      <option value="Published">Published</option>
                      <option value="Closed">Closed</option>
                      <option value="Awarded">Awarded</option>
                    </select>
                  </div>

                  {/* Sort By */}
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Sort By</label>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as any)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89] text-sm"
                    >
                      <option value="finalSubmission">Final Submission (Soonest)</option>
                      <option value="budget">Budget (Highest)</option>
                      <option value="name">Name (A-Z)</option>
                    </select>
                  </div>
                </div>

                {/* Budget Range */}
                <div>
                  <label className="block text-sm text-gray-700 mb-2">
                    Budget Range: ₹{budgetRange[0].toLocaleString()} - ₹{budgetRange[1].toLocaleString()}
                  </label>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="0"
                      max="100000000"
                      step="1000000"
                      value={budgetRange[0]}
                      onChange={(e) => setBudgetRange([parseInt(e.target.value), budgetRange[1]])}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#1D4E89]"
                    />
                    <input
                      type="range"
                      min="0"
                      max="100000000"
                      step="1000000"
                      value={budgetRange[1]}
                      onChange={(e) => setBudgetRange([budgetRange[0], parseInt(e.target.value)])}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#1D4E89]"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={clearFilters}
                    className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors text-sm flex items-center gap-2"
                  >
                    <X className="w-4 h-4" />
                    Clear Filters
                  </button>
                  <span className="text-sm text-gray-600">
                    {sortedTenders.length} tenders found
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Results Summary */}
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-gray-600">
              {loading ? "Loading tenders..." : `Showing ${sortedTenders.length} of ${tenders.length} tenders`}
            </p>
          </div>

          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
          {success && <p className="text-sm text-green-700 mb-4">{success}</p>}

          {/* Tender Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {loading && (
              <div className="col-span-full text-center py-8 text-gray-600">
                Loading tenders...
              </div>
            )}
            {!loading && sortedTenders.map((tender) => {
              const alreadySubmitted = hasExistingBid(tender, authUser?._id);
              return (
                <div key={tender._id} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="text-[#0B3C5D] mb-1 font-semibold">{tender.title}</h3>
                    </div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs whitespace-nowrap ${
                        tender.status === "Published"
                          ? "bg-green-100 text-green-800"
                          : tender.status === "Awarded"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {tender.status}
                    </span>
                  </div>

                  <p className="text-xs text-gray-600 mb-3">{tender.description}</p>

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <FileText className="w-4 h-4" />
                      <span>{tender.category || "General"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <span className="text-lg font-semibold">₹</span>
                      <span>{tender.budget.toLocaleString()}</span>
                    </div>
                    <div className="text-sm text-gray-600">
                      <span className="font-medium">Final Submission: </span>
                      {formatDateTime(tender.finalSubmissionDate)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openDetailsModal(tender._id)}
                      className="flex-1 px-4 py-2 bg-[#1D4E89] hover:bg-[#154068] text-white rounded-md text-sm transition-colors"
                    >
                      View Details
                    </button>
                    {alreadySubmitted ? (
                      <button disabled className="flex-1 px-4 py-2 bg-green-100 text-green-800 rounded-md text-sm flex items-center justify-center gap-2">
                        <Check className="w-4 h-4" />
                        Bid Submitted
                      </button>
                    ) : (
                      <button
                        onClick={() => openBidModal(tender._id)}
                        className="flex-1 px-4 py-2 border border-[#1D4E89] text-[#1D4E89] rounded-md text-sm hover:bg-blue-50 transition-colors"
                      >
                        Submit Bid
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {!loading && sortedTenders.length === 0 && (
            <div className="bg-white rounded-lg shadow-sm p-12 border border-gray-100 text-center">
              <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg text-gray-700 mb-2">No tenders found</h3>
              <p className="text-sm text-gray-500 mb-4">
                Try adjusting your search criteria or filters
              </p>
              <button
                onClick={clearFilters}
                className="px-4 py-2 bg-[#1D4E89] hover:bg-[#154068] text-white rounded-md text-sm transition-colors"
              >
                Clear All Filters
              </button>
            </div>
          )}

          {/* Bid Submission Modal */}
          {showSubmissionForm && selectedTender && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg shadow-lg max-w-md w-full max-h-screen overflow-y-auto">
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <h2 className="text-xl font-semibold text-[#0B3C5D]">Submit Bid</h2>
                    <button
                      onClick={closeBidModal}
                      className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
                    >
                      ×
                    </button>
                  </div>

                  {/* Tender Summary */}
                  <div className="bg-blue-50 p-4 rounded-md mb-4">
                    <p className="text-sm font-semibold text-[#0B3C5D] mb-2">{selectedTender.title}</p>
                    <div className="text-xs text-gray-600 space-y-1">
                      <p><span className="font-medium">Budget:</span> ₹{selectedTender.budget.toLocaleString()}</p>
                      <p><span className="font-medium">Final Submission:</span> {formatDateTime(selectedTender.finalSubmissionDate)}</p>
                      <p><span className="font-medium">Category:</span> {selectedTender.category || "General"}</p>
                    </div>
                  </div>

                  {formError && <p className="text-sm text-red-600 mb-4">{formError}</p>}
                  {success && <p className="text-sm text-green-700 mb-4">{success}</p>}

                  <div className="space-y-4">
                    {/* Proposed Amount */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Proposed Amount (₹)</label>
                      <input
                        type="number"
                        value={proposedAmount}
                        onChange={(e) => setProposedAmount(e.target.value)}
                        placeholder="Enter your bid amount"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                      />
                    </div>

                    {/* Document Upload */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Required Documents (PDF)</label>
                      <div className="space-y-3">
                        {(selectedTender?.requiredDocuments || [{ label: "Commercial Bid Document", category: "Commercial" }]).map(
                          (doc) => {
                            const displayCategory =
                              doc.label.trim().toLowerCase() === "eligibility proof" ? "Eligibility" : doc.category;

                            return (
                              <div key={doc.label} className="border border-gray-200 rounded-md p-3">
                                <p className="text-xs text-gray-600 mb-2">
                                  {doc.label} <span className="text-gray-400">({displayCategory})</span>
                                </p>
                                <label className="w-full px-4 py-2 border-2 border-dashed border-gray-300 rounded-md cursor-pointer hover:border-[#1D4E89] transition-colors flex items-center justify-center gap-2 text-sm text-gray-600">
                                  <Upload className="w-4 h-4" />
                                  {documentNames[doc.label] || "Click to upload PDF"}
                                  <input
                                    type="file"
                                    accept=".pdf"
                                    className="hidden"
                                    onChange={async (event) => {
                                      const file = event.target.files?.[0];
                                      if (!file) return;

                                      if (file.type !== "application/pdf") {
                                        setFormError("Please upload a PDF file");
                                        return;
                                      }

                                      if (file.size > 10 * 1024 * 1024) {
                                        setFormError("File size must be less than 10MB");
                                        return;
                                      }

                                      try {
                                        setFormError("");
                                        const encoded = await encodeFileToStoredDocument(file);
                                        setDocumentUploads((prev) => ({ ...prev, [doc.label]: encoded }));
                                        setDocumentNames((prev) => ({ ...prev, [doc.label]: file.name }));
                                      } catch (err) {
                                        setFormError(err instanceof Error ? err.message : "File upload failed");
                                      }
                                    }}
                                  />
                                </label>
                              </div>
                            );
                          }
                        )}
                      </div>
                    </div>

                    {/* Declaration Checkbox */}
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        id="declaration"
                        checked={declaration}
                        onChange={(e) => setDeclaration(e.target.checked)}
                        className="w-4 h-4 text-[#1D4E89] rounded focus:ring-2 focus:ring-[#1D4E89] mt-1"
                      />
                      <label htmlFor="declaration" className="text-xs text-gray-600">
                        I declare that the information provided is accurate and I meet all eligibility criteria for this tender.
                      </label>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3 pt-4 border-t border-gray-200">
                      <button
                        onClick={closeBidModal}
                        className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSubmitBid}
                        disabled={submittingBid || !declaration}
                        className="flex-1 px-4 py-2 bg-[#1D4E89] hover:bg-[#154068] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md transition-colors text-sm"
                      >
                        {submittingBid ? "Submitting..." : "Submit Bid"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* View Details Modal */}
          {showDetailsModal && detailedTender && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-screen overflow-y-auto">
                <div className="p-6">
                  <div className="flex items-start justify-between mb-6">
                    <div>
                      <h2 className="text-2xl font-semibold text-[#0B3C5D]">{detailedTender.title}</h2>
                    </div>
                    <button
                      onClick={closeDetailsModal}
                      className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
                    >
                      ×
                    </button>
                  </div>

                  {/* Status Badge */}
                  <div className="mb-6">
                    <span
                      className={`px-4 py-2 rounded-full text-sm font-medium ${
                        detailedTender.status === "Published"
                          ? "bg-green-100 text-green-800"
                          : detailedTender.status === "Awarded"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {detailedTender.status}
                    </span>
                  </div>

                  {/* Description */}
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">Description</h3>
                    <p className="text-sm text-gray-600">{detailedTender.description}</p>
                  </div>

                  {/* Key Details */}
                  <div className="grid grid-cols-3 gap-4 mb-6 p-4 bg-gray-50 rounded-lg">
                    <div>
                      <p className="text-xs text-gray-600 uppercase tracking-wide">Category</p>
                      <p className="text-sm font-semibold text-[#0B3C5D] mt-1">{detailedTender.category || "General"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600 uppercase tracking-wide">Budget</p>
                      <p className="text-sm font-semibold text-[#0B3C5D] mt-1 flex items-center gap-1">
                        <span className="text-lg">₹</span>
                        {detailedTender.budget.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600 uppercase tracking-wide">Final Submission</p>
                      <p className="text-sm font-semibold text-[#0B3C5D] mt-1">
                        {formatDateTime(detailedTender.finalSubmissionDate)}
                      </p>
                    </div>
                  </div>

                  {/* Documents Section */}
                  {detailedTender.documents && detailedTender.documents.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-sm font-semibold text-gray-700 mb-3">Specification Documents</h3>
                      <div className="bg-blue-50 p-4 rounded-lg">
                        <DocumentLinks documents={detailedTender.documents} emptyLabel="No documents" numbered />
                      </div>
                    </div>
                  )}

                  {/* Close Button */}
                  <div className="flex gap-3 pt-4 border-t border-gray-200">
                    <button
                      onClick={closeDetailsModal}
                      className="flex-1 px-4 py-2 bg-[#1D4E89] hover:bg-[#154068] text-white rounded-md transition-colors text-sm font-medium"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <AIAssistant role="vendor" />
    </div>
  );
}
