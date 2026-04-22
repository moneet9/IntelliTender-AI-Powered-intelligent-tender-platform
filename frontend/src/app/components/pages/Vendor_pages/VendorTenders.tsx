import { useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { Sidebar } from "../../layout/Sidebar";
import { Header } from "../../layout/Header";
import { AIAssistant } from "../../AIAssistant";
import { apiRequest, getAuthUser } from "../../../api";
import { encodeFileToStoredDocument } from "../../../document-utils";
import {
  DocumentLinks,
  formatCurrency,
  formatDate,
  hasExistingBid,
  useVendorData,
} from "./vendorShared";

export function VendorTenders() {
  const authUser = getAuthUser();
  const { loading, error, publishedTenders, reload } = useVendorData(authUser?._id);
  const isRestrictedAccount = authUser?.accountStatus && authUser.accountStatus !== "Active";

  const [showSubmissionForm, setShowSubmissionForm] = useState(false);
  const [selectedTenderId, setSelectedTenderId] = useState("");
  const [declaration, setDeclaration] = useState(false);
  const [proposedAmount, setProposedAmount] = useState("");
  const [proposalDocument, setProposalDocument] = useState("");
  const [proposalFileName, setProposalFileName] = useState("");
  const [submittingBid, setSubmittingBid] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedTender = useMemo(
    () => publishedTenders.find((tender) => tender._id === selectedTenderId) || null,
    [publishedTenders, selectedTenderId]
  );

  const openBidModal = (tenderId: string) => {
    setSelectedTenderId(tenderId);
    setShowSubmissionForm(true);
    setFormError("");
    setSuccess("");
    setDeclaration(false);
    setProposedAmount("");
    setProposalDocument("");
    setProposalFileName("");
  };

  const closeBidModal = () => {
    setShowSubmissionForm(false);
    setSelectedTenderId("");
    setDeclaration(false);
    setProposedAmount("");
    setProposalDocument("");
    setProposalFileName("");
  };

  const handleSubmitBid = async () => {
    if (isRestrictedAccount) return;
    if (!selectedTenderId || !declaration) return;

    if (!proposedAmount || Number(proposedAmount) <= 0) {
      setFormError("Enter a valid proposed amount before submitting the bid");
      return;
    }

    if (!proposalDocument) {
      setFormError("Upload the signed proposal PDF before submitting the bid");
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
          proposalDocument,
        },
      });

      setSuccess("Bid submitted successfully");
      closeBidModal();
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Bid submission failed");
    } finally {
      setSubmittingBid(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="vendor" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="vendor" userName={authUser?.name || ""} />
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl text-[#0B3C5D] mb-1">Published Tenders</h1>
            <p className="text-sm text-gray-600">Review tender documents and submit your proposal.</p>
          </div>

          {isRestrictedAccount && (
            <div className="mb-4 p-4 rounded-lg border border-yellow-200 bg-yellow-50 text-yellow-900 text-sm">
              Your account is suspended or frozen. You can only view tenders right now.
            </div>
          )}

          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
          {formError && <p className="text-sm text-red-600 mb-4">{formError}</p>}
          {success && <p className="text-sm text-green-700 mb-4">{success}</p>}

          <div className="bg-white rounded-lg shadow-sm border border-gray-100">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Tender</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Category</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Budget</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Deadline</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Documents</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading && (
                    <tr>
                      <td className="px-6 py-4 text-sm text-gray-600" colSpan={6}>
                        Loading tenders...
                      </td>
                    </tr>
                  )}
                  {!loading && !publishedTenders.length && (
                    <tr>
                      <td className="px-6 py-4 text-sm text-gray-600" colSpan={6}>
                        No published tenders available.
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    publishedTenders.map((tender) => {
                      const alreadySubmitted = hasExistingBid(tender, authUser?._id);

                      return (
                        <tr key={tender._id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 align-top">
                            <p className="text-sm text-[#0B3C5D]">{tender.title}</p>
                            <p className="text-xs text-gray-500 mt-1">{tender.description}</p>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-700 align-top">{tender.category || "General"}</td>
                          <td className="px-6 py-4 text-sm text-gray-700 align-top">{formatCurrency(tender.budget)}</td>
                          <td className="px-6 py-4 text-sm text-gray-700 align-top">{formatDate(tender.deadline)}</td>
                          <td className="px-6 py-4 align-top">
                            <DocumentLinks documents={tender.documents} emptyLabel="No tender documents" />
                          </td>
                          <td className="px-6 py-4 align-top">
                            {alreadySubmitted ? (
                              <span className="inline-flex px-3 py-1 rounded-full text-xs bg-green-100 text-green-800">
                                Bid Submitted
                              </span>
                            ) : isRestrictedAccount ? (
                              <span className="inline-flex px-3 py-1 rounded-full text-xs bg-gray-100 text-gray-700">
                                Restricted
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

          {showSubmissionForm && selectedTender && !isRestrictedAccount && (
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
                      <span>Budget: {formatCurrency(selectedTender.budget)}</span>
                      <span>Deadline: {formatDate(selectedTender.deadline)}</span>
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
                    <label className="block text-sm text-gray-700 mb-2">Proposal PDF</label>
                    <label className="block border-2 border-dashed border-gray-300 rounded-lg p-5 text-center hover:border-[#1D4E89] transition-colors cursor-pointer">
                      <Upload className="w-7 h-7 text-gray-400 mx-auto mb-2" />
                      <p className="text-sm text-gray-600 mb-1">Upload the vendor proposal document</p>
                      <p className="text-xs text-gray-500">PDF only, up to 10MB</p>
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,application/pdf"
                        onChange={async (event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;

                          if (!file.name.toLowerCase().endsWith(".pdf")) {
                            setFormError("Only PDF proposal documents are allowed");
                            return;
                          }

                          if (file.size > 10 * 1024 * 1024) {
                            setFormError("Proposal PDF size must be 10MB or less");
                            return;
                          }

                          try {
                            setFormError("");
                            const encoded = await encodeFileToStoredDocument(file);
                            setProposalDocument(encoded);
                            setProposalFileName(file.name);
                          } catch {
                            setFormError("Failed to process selected proposal document");
                          }
                        }}
                      />
                    </label>
                    {proposalFileName && <p className="text-xs text-green-700 mt-2">Uploaded: {proposalFileName}</p>}
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
        </div>
      </div>
      <AIAssistant role="vendor" />
    </div>
  );
}

