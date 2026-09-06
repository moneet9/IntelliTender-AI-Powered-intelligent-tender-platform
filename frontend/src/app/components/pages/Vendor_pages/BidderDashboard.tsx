import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "../../layout/Sidebar";
import { Header } from "../../layout/Header";
import { AIAssistant } from "../../AIAssistant";
import { ChangePassword } from "./ChangePassword";
import { FileText, CheckCircle, Clock, Award, Upload } from "lucide-react";
import { apiRequest, getAuthUser } from "../../../api";
import {
  encodeFileToStoredDocument,
  getStoredDocumentName,
  getStoredDocumentUrl,
} from "../../../document-utils";
import { requiredDocumentsForDisplay } from "./vendorHelpers";
import { DocumentLink } from "./vendorShared";

type BidStatus = "Pending" | "Evaluated" | "Selected" | "Rejected";
type ContractStatus = "Awarded" | "Signed" | "Completed" | "Cancelled";

type TenderBid = {
  _id: string;
  vendorId?: string | { _id?: string };
  proposedAmount: number;
  proposalDocument?: string;
  status: BidStatus;
  createdAt?: string;
  technicalScore?: number;
  financialScore?: number;
  comments?: string;
};

type RequiredDocument = {
  label: string;
  category: "Technical" | "Commercial";
};

type TenderRecord = {
  _id: string;
  title: string;
  description: string;
  category?: string;
  budget: number;
  finalSubmissionDate: string;
  status: "Draft" | "Published" | "Closed" | "Awarded" | "Completed";
  documents?: string[];
  bids?: TenderBid[];
  requiredDocuments?: RequiredDocument[];
};

type MilestoneSummary = {
  _id: string;
  title: string;
  status: "Not Started" | "In Progress" | "Completed" | "Delayed";
  progress: number;
  plannedEndDate?: string;
  actualEndDate?: string;
};

type ContractRecord = {
  _id: string;
  status: ContractStatus;
  timelineDefined?: boolean;
  timelineStartDate?: string;
  timelineEndDate?: string;
  createdAt?: string;
  updatedAt?: string;
  tenderId?: {
    title?: string;
    description?: string;
    category?: string;
    budget?: number;
    finalSubmissionDate?: string;
    documents?: string[];
  };
  milestones?: MilestoneSummary[];
  progressReports?: Array<{ _id: string }>;
};

type BidView = {
  tenderId: string;
  title: string;
  category: string;
  amount: number;
  status: BidStatus;
  submittedDate: string;
  proposalDocument?: string;
  proposalDocumentId?: string;
  comments?: string;
  technicalScore?: number;
  financialScore?: number;
};

export function BidderDashboard() {
  const authUser = getAuthUser();
  const [activeTab, setActiveTab] = useState<"dashboard" | "settings">("dashboard");
  const [showSubmissionForm, setShowSubmissionForm] = useState(false);
  const [selectedTenderId, setSelectedTenderId] = useState("");
  const [declaration, setDeclaration] = useState(false);
  const [proposedAmount, setProposedAmount] = useState("");
  const [documentUploads, setDocumentUploads] = useState<Record<string, string[]>>({});
  const [documentNames, setDocumentNames] = useState<Record<string, string[]>>({});
  const [tenders, setTenders] = useState<TenderRecord[]>([]);
  const [contracts, setContracts] = useState<ContractRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submittingBid, setSubmittingBid] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadDashboard = async () => {
    setLoading(true);
    setError("");

    try {
      const [tenderData, contractData] = await Promise.all([
        apiRequest<TenderRecord[]>("/api/tenders?summary=true"),
        apiRequest<ContractRecord[]>("/api/contracts?summary=true"),
      ]);

      setTenders(tenderData || []);
      setContracts(contractData || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load vendor dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const selectedTender = useMemo(
    () => tenders.find((tender) => tender._id === selectedTenderId) || null,
    [selectedTenderId, tenders]
  );

  const publishedTenders = useMemo(
    () =>
      tenders
        .filter((tender) => tender.status === "Published")
        .slice()
        .sort(
          (left, right) =>
            new Date(left.finalSubmissionDate).getTime() - new Date(right.finalSubmissionDate).getTime()
        ),
    [tenders]
  );

  const myBids = useMemo<BidView[]>(() => {
    if (!authUser?._id) return [];

    return tenders
      .flatMap((tender) =>
        (tender.bids || [])
          .filter((bid) => resolveBidVendorId(bid.vendorId) === authUser._id)
          .map((bid) => ({
            tenderId: tender._id,
            title: tender.title,
            category: tender.category || "General",
            amount: Number(bid.proposedAmount),
            status: bid.status,
            submittedDate: formatDate(bid.createdAt),
            proposalDocument: bid.proposalDocument,
            comments: bid.comments,
            technicalScore: bid.technicalScore,
            financialScore: bid.financialScore,
          }))
      )
      .sort((left, right) => right.submittedDate.localeCompare(left.submittedDate));
  }, [authUser?._id, tenders]);

  const ongoingContracts = useMemo(
    () =>
      contracts
        .filter((contract) => contract.status !== "Completed")
        .slice()
        .sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime()),
    [contracts]
  );

  const completedContracts = useMemo(
    () =>
      contracts
        .filter((contract) => contract.status === "Completed")
        .slice()
        .sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime()),
    [contracts]
  );

  const stats = useMemo(
    () => [
      { label: "Published Tenders", value: String(publishedTenders.length), icon: FileText, color: "bg-[#1D4E89]" },
      { label: "Submitted Bids", value: String(myBids.length), icon: CheckCircle, color: "bg-[#2E8B57]" },
      { label: "Ongoing Contracts", value: String(ongoingContracts.length), icon: Clock, color: "bg-[#F4A300]" },
      { label: "Completed Work", value: String(completedContracts.length), icon: Award, color: "bg-[#0B3C5D]" },
    ],
    [completedContracts.length, myBids.length, ongoingContracts.length, publishedTenders.length]
  );

  const openBidModal = (tenderId: string) => {
    const tender = tenders.find((item) => item._id === tenderId);
    if (tender && hasExistingBid(tender, authUser?._id)) {
      setFormError("You have already submitted a bid for this tender");
      return;
    }

    setSelectedTenderId(tenderId);
    setShowSubmissionForm(true);
    setError("");
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
    if (!selectedTenderId || !declaration) return;

    if (!proposedAmount || Number(proposedAmount) <= 0) {
      setError("Enter a valid proposed amount before submitting the bid");
      return;
    }
    const requiredDocs = requiredDocumentsForDisplay(selectedTender?.requiredDocuments);

    // Only Eligibility Proof and Commercial are mandatory
    const mandatoryDocs = requiredDocs.filter(
      (d) => d.category === "Commercial" || (d.label || "").trim().toLowerCase() === "eligibility proof"
    );

    const missingDocs = mandatoryDocs.filter((doc) => !(documentUploads[doc.label] || []).length);
    if (missingDocs.length > 0) {
      setError(`Upload required documents: ${missingDocs.map((doc) => doc.label).join(", ")}`);
      return;
    }

    setSubmittingBid(true);
    setError("");
    setSuccess("");

    try {
      await apiRequest(`/api/tenders/${selectedTenderId}/bids`, {
        method: "POST",
        body: {
          proposedAmount: Number(proposedAmount),
          documents: Object.entries(documentUploads).flatMap(([label, documents]) => documents.map((document) => ({ label, document }))),
        },
      });

      setSuccess("Bid submitted successfully");
      closeBidModal();
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bid submission failed");
    } finally {
      setSubmittingBid(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="bidder" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="bidder" userName={authUser?.name || ""} />
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl text-[#0B3C5D] mb-4">Vendor Dashboard</h1>
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab("dashboard")}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === "dashboard"
                    ? "bg-[#0B3C5D] text-white"
                    : "bg-white text-[#0B3C5D] border border-gray-300 hover:bg-gray-50"
                }`}
              >
                Dashboard
              </button>
              <button
                onClick={() => setActiveTab("settings")}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  activeTab === "settings"
                    ? "bg-[#0B3C5D] text-white"
                    : "bg-white text-[#0B3C5D] border border-gray-300 hover:bg-gray-50"
                }`}
              >
                Settings
              </button>
            </div>
          </div>

          {activeTab === "settings" && <ChangePassword />}

          {activeTab === "dashboard" && (
            <>
              <p className="text-sm text-gray-600 mb-6">Bid on available tenders and track contract status</p>
              <p className="text-sm text-gray-600">Published tenders, bid submissions, ongoing delivery, and completed work history</p>

              {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
              {success && <p className="text-sm text-green-700 mb-4">{success}</p>}

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

          <div className="bg-white rounded-lg shadow-sm mb-6 border border-gray-100">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-lg text-[#0B3C5D]">Published Tenders</h3>
              <p className="text-sm text-gray-600 mt-1">Review every published tender, download tender documents, and upload your proposal PDF</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Tender</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Category</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Budget</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Final Submission</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Documents</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading && (
                    <tr>
                      <td className="px-6 py-4 text-sm text-gray-600" colSpan={6}>Loading tenders...</td>
                    </tr>
                  )}
                  {!loading && !publishedTenders.length && (
                    <tr>
                      <td className="px-6 py-4 text-sm text-gray-600" colSpan={6}>No published tenders available.</td>
                    </tr>
                  )}
                  {!loading && publishedTenders.map((tender) => {
                    const alreadySubmitted = hasExistingBid(tender, authUser?._id);

                    return (
                      <tr key={tender._id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 align-top">
                          <p className="text-sm text-[#0B3C5D]">{tender.title}</p>
                          <p className="text-xs text-gray-500 mt-1">{tender.description}</p>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-700 align-top">{tender.category || "General"}</td>
                        <td className="px-6 py-4 text-sm text-gray-700 align-top">₹{Number(tender.budget).toLocaleString()}</td>
                        <td className="px-6 py-4 text-sm text-gray-700 align-top">
                          {formatDate(tender.finalSubmissionDate)}
                        </td>
                        <td className="px-6 py-4 align-top">
                          <DocumentLinks documents={tender.documents} emptyLabel="No tender documents" />
                        </td>
                        <td className="px-6 py-4 align-top">
                          {alreadySubmitted ? (
                            <span className="inline-flex px-3 py-1 rounded-full text-xs bg-green-100 text-green-800">
                              Bid Submitted
                            </span>
                          ) : (
                            <button
                              onClick={() => openBidModal(tender._id)}
                              className="text-sm text-[#1D4E89] hover:underline"
                            >
                              Submit Bid
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100 mb-6">
            <h3 className="text-lg text-[#0B3C5D] mb-4">My Bid Pipeline</h3>
            {!myBids.length && <p className="text-sm text-gray-600">No bid submissions yet.</p>}
            <div className="space-y-4">
              {myBids.map((bid) => {
                const proposalUrl = getStoredDocumentUrl(bid.proposalDocument);
                const proposalName = getStoredDocumentName(bid.proposalDocument, "Proposal PDF");

                return (
                  <div key={`${bid.tenderId}-${bid.status}`} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                      <div>
                        <p className="text-sm text-[#0B3C5D]">{bid.title}</p>
                        <p className="text-xs text-gray-600 mt-1">
                          {bid.category} | Submitted {bid.submittedDate}
                        </p>
                      </div>
                      <div className="text-left lg:text-right">
                        <p className="text-base text-[#1D4E89]">₹{bid.amount.toLocaleString()}</p>
                        <span className={`inline-flex mt-2 px-3 py-1 rounded-full text-xs ${getBidStatusClass(bid.status)}`}>
                          {bid.status}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 text-sm">
                      <div className="p-3 rounded-md bg-gray-50 border border-gray-100">
                        <p className="text-gray-500">Technical Score</p>
                        <p className="text-[#0B3C5D] mt-1">{bid.technicalScore ?? "Pending"}</p>
                      </div>
                      <div className="p-3 rounded-md bg-gray-50 border border-gray-100">
                        <p className="text-gray-500">Financial Score</p>
                        <p className="text-[#0B3C5D] mt-1">{bid.financialScore ?? "Pending"}</p>
                      </div>
                      <div className="p-3 rounded-md bg-gray-50 border border-gray-100">
                        <p className="text-gray-500">Uploaded Proposal</p>
                        <div className="mt-1"><DocumentLink documentContent={bid.proposalDocumentId ? `/api/tenders/${bid.tenderId}/bid-documents/${bid.proposalDocumentId}` : proposalUrl} name={proposalName} /></div>
                      </div>
                    </div>

                    {bid.comments && (
                      <div className="mt-4 p-3 rounded-md bg-blue-50 border border-blue-100">
                        <p className="text-sm text-[#0B3C5D]">Committee comment</p>
                        <p className="text-sm text-gray-700 mt-1">{bid.comments}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100 mb-6">
            <h3 className="text-lg text-[#0B3C5D] mb-4">Ongoing Contracts</h3>
            {!ongoingContracts.length && <p className="text-sm text-gray-600">No active awarded contracts yet.</p>}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {ongoingContracts.map((contract) => {
                const progress = getContractProgress(contract);
                const currentMilestone = getCurrentMilestone(contract);

                return (
                  <div key={contract._id} className="border border-gray-200 rounded-lg p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-base text-[#0B3C5D]">{contract.tenderId?.title || "Untitled Tender"}</p>
                        <p className="text-sm text-gray-600 mt-1">{contract.tenderId?.category || "General"}</p>
                      </div>
                      <span className={`inline-flex px-3 py-1 rounded-full text-xs ${getContractStatusClass(contract.status)}`}>
                        {contract.status}
                      </span>
                    </div>

                    <div className="mt-4">
                      <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
                        <span>Delivery progress</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                        <div className="h-full bg-[#1D4E89]" style={{ width: `${progress}%` }}></div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 text-sm">
                      <div className="p-3 rounded-md bg-gray-50 border border-gray-100">
                        <p className="text-gray-500">Timeline</p>
                        <p className="text-[#0B3C5D] mt-1">
                          {contract.timelineDefined
                            ? `${formatDate(contract.timelineStartDate)} to ${formatDate(contract.timelineEndDate)}`
                            : "Timeline not defined yet"}
                        </p>
                      </div>
                      <div className="p-3 rounded-md bg-gray-50 border border-gray-100">
                        <p className="text-gray-500">Current Step</p>
                        <p className="text-[#0B3C5D] mt-1">
                          {currentMilestone ? `${currentMilestone.title} (${currentMilestone.progress || 0}%)` : "Awaiting schedule update"}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4">
                      <p className="text-sm text-gray-600 mb-2">Tender Documents</p>
                      <DocumentLinks documents={contract.tenderId?.documents} emptyLabel="No contract documents attached" />
                    </div>

                    <p className="text-xs text-gray-500 mt-4">
                      {contract.progressReports?.length || 0} progress report(s) submitted for this contract.
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
            <h3 className="text-lg text-[#0B3C5D] mb-4">Completed Work History</h3>
            {!completedContracts.length && <p className="text-sm text-gray-600">Completed contracts will appear here once they are closed by the procurement team.</p>}
            {!!completedContracts.length && (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Tender</th>
                      <th className="px-4 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Category</th>
                      <th className="px-4 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Timeline</th>
                      <th className="px-4 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Milestones</th>
                      <th className="px-4 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Documents</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {completedContracts.map((contract) => (
                      <tr key={contract._id} className="hover:bg-gray-50">
                        <td className="px-4 py-4 text-sm text-[#0B3C5D]">{contract.tenderId?.title || "Untitled Tender"}</td>
                        <td className="px-4 py-4 text-sm text-gray-700">{contract.tenderId?.category || "General"}</td>
                        <td className="px-4 py-4 text-sm text-gray-700">
                          {formatDate(contract.timelineStartDate)} to {formatDate(contract.timelineEndDate)}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-700">
                          {(contract.milestones || []).filter((milestone) => milestone.status === "Completed").length}/
                          {(contract.milestones || []).length}
                        </td>
                        <td className="px-4 py-4">
                          <DocumentLinks documents={contract.tenderId?.documents} emptyLabel="No documents" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {showSubmissionForm && selectedTender && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b border-gray-100">
                  <h3 className="text-lg text-[#0B3C5D]">Submit Bid</h3>
                  <p className="text-sm text-gray-600 mt-1">{selectedTender.title}</p>
                </div>
                <div className="p-6 space-y-4">
                  <div className="p-4 rounded-md bg-gray-50 border border-gray-100">
                    <p className="text-sm text-[#0B3C5D]">{selectedTender.description}</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 text-sm text-gray-600">
                      <span>Category: {selectedTender.category || "General"}</span>
                      <span>Budget: ₹{Number(selectedTender.budget).toLocaleString()}</span>
                      <span>Final Submission: {formatDate(selectedTender.finalSubmissionDate)}</span>
                      <span>Documents: {(selectedTender.documents || []).length}</span>
                    </div>
                    <div className="mt-3">
                      <DocumentLinks documents={selectedTender.documents} emptyLabel="No tender documents attached" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Proposed Amount</label>
                    <input
                      type="number"
                      value={proposedAmount}
                      onChange={(e) => setProposedAmount(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-md"
                      placeholder="Enter amount"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Required Documents</label>
                    <div className="space-y-3">
                      {requiredDocumentsForDisplay(selectedTender?.requiredDocuments).map((doc) => (
                        <div key={doc.label} className="border border-gray-200 rounded-lg p-3">
                          <p className="text-xs text-gray-600 mb-2">
                            {doc.label} <span className="text-gray-400">({doc.category})</span>
                          </p>
                          <label className="block border-2 border-dashed border-gray-300 rounded-lg p-4 text-center hover:border-[#1D4E89] transition-colors cursor-pointer">
                            <Upload className="w-6 h-6 text-gray-400 mx-auto mb-2" />
                            <p className="text-sm text-gray-600 mb-1">
                              {documentNames[doc.label]?.length ? `${documentNames[doc.label].length} file(s) selected` : "Upload file(s)"}
                            </p>
                            <p className="text-xs text-gray-500">PDF, JPG, or PNG only, up to 10MB</p>
                            <input
                              type="file"
                              multiple
                              className="hidden"
                              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                              onChange={async (event) => {
                                const files = Array.from(event.target.files || []);
                                if (!files.length) return;

                                const allowedTypes = ["application/pdf", "image/jpeg", "image/png"];
                                const allowedExtensions = [".pdf", ".jpg", ".jpeg", ".png"];
                                if (files.some((file) => !allowedTypes.includes(file.type) && !allowedExtensions.some((extension) => file.name.toLowerCase().endsWith(extension)))) {
                                  setError("Only PDF, JPG, or PNG files are allowed");
                                  return;
                                }

                                if (files.some((file) => file.size > 10 * 1024 * 1024)) {
                                  setError("Document size must be 10MB or less");
                                  return;
                                }

                                try {
                                  setError("");
                                  const encoded = await Promise.all(files.map(encodeFileToStoredDocument));
                                  setDocumentUploads((prev) => ({ ...prev, [doc.label]: [...(prev[doc.label] || []), ...encoded] }));
                                  setDocumentNames((prev) => ({ ...prev, [doc.label]: [...(prev[doc.label] || []), ...files.map((file) => file.name)] }));
                                } catch {
                                  setError("Failed to process selected document");
                                }
                              }}
                            />
                          </label>
                          {documentNames[doc.label]?.length > 0 && (
                            <div className="mt-2 flex items-center justify-between text-xs">
                              <span className="text-green-700">Uploaded: {documentNames[doc.label].join(", ")}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setDocumentUploads((prev) => {
                                    const next = { ...prev };
                                    delete next[doc.label];
                                    return next;
                                  });
                                  setDocumentNames((prev) => {
                                    const next = { ...prev };
                                    delete next[doc.label];
                                    return next;
                                  });
                                }}
                                className="text-red-600 hover:underline"
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-2">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={declaration}
                        onChange={(e) => setDeclaration(e.target.checked)}
                        className="mt-1 w-5 h-5 rounded border-gray-300 text-[#1D4E89] focus:ring-[#1D4E89]"
                      />
                      <span className="text-sm text-gray-700">
                        I confirm that the uploaded proposal, rates, and supporting details are complete and accurate.
                      </span>
                    </label>
                  </div>
                </div>
                <div className="p-6 border-t border-gray-100 flex items-center gap-3">
                  <button
                    onClick={handleSubmitBid}
                    disabled={!declaration || submittingBid}
                    className={`px-6 py-2 rounded-md transition-colors ${
                      declaration && !submittingBid
                        ? "bg-[#1D4E89] hover:bg-[#154068] text-white"
                        : "bg-gray-300 text-gray-500 cursor-not-allowed"
                    }`}
                  >
                    {submittingBid ? "Submitting..." : "Submit Bid"}
                  </button>
                  <button
                    onClick={closeBidModal}
                    className="px-6 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
          </>
          )}
        </div>
      </div>
      <AIAssistant role="bidder" />
    </div>
  );
}

function resolveBidVendorId(vendorId?: string | { _id?: string }): string {
  if (!vendorId) return "";
  return typeof vendorId === "string" ? vendorId : vendorId._id || "";
}

function hasExistingBid(tender: TenderRecord, vendorId?: string): boolean {
  if (!vendorId) return false;
  return (tender.bids || []).some((bid) => resolveBidVendorId(bid.vendorId) === vendorId);
}

function getContractProgress(contract: ContractRecord): number {
  const milestones = contract.milestones || [];
  if (!milestones.length) return contract.status === "Completed" ? 100 : 0;

  return Math.round(milestones.reduce((sum, milestone) => sum + (milestone.progress || 0), 0) / milestones.length);
}

function getCurrentMilestone(contract: ContractRecord): MilestoneSummary | null {
  const milestones = contract.milestones || [];
  return milestones.find((milestone) => milestone.status !== "Completed") || milestones[milestones.length - 1] || null;
}

function formatDate(value?: string): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString();
}

function getBidStatusClass(status: BidStatus): string {
  if (status === "Selected") return "bg-green-100 text-green-800";
  if (status === "Rejected") return "bg-red-100 text-red-800";
  if (status === "Evaluated") return "bg-yellow-100 text-yellow-800";
  return "bg-blue-100 text-blue-800";
}

function getContractStatusClass(status: ContractStatus): string {
  if (status === "Completed") return "bg-green-100 text-green-800";
  if (status === "Cancelled") return "bg-red-100 text-red-800";
  if (status === "Signed") return "bg-blue-100 text-blue-800";
  return "bg-yellow-100 text-yellow-800";
}

function DocumentLinks({ documents, emptyLabel }: { documents?: string[]; emptyLabel: string }) {
  if (!documents?.length) {
    return <p className="text-sm text-gray-500">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {documents.map((document, index) => {
        const name = getStoredDocumentName(document, `Document ${index + 1}`);
        const url = getStoredDocumentUrl(document);

        return url ? (
          <a
            key={`${name}-${index}`}
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-[#1D4E89] hover:underline"
          >
            {name}
          </a>
        ) : (
          <span key={`${name}-${index}`} className="text-sm text-gray-700">
            {name}
          </span>
        );
      })}
    </div>
  );
}
