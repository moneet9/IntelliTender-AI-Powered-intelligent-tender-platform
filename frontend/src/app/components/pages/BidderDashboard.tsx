import { useState } from "react";
import { Sidebar } from "../layout/Sidebar";
import { Header } from "../layout/Header";
import { AIAssistant } from "../AIAssistant";
import { FileText, CheckCircle, Clock, Award, Upload } from "lucide-react";
import { useEffect, useMemo } from "react";
import { apiRequest, getAuthUser } from "../../api";

export function BidderDashboard() {
  const [showSubmissionForm, setShowSubmissionForm] = useState(false);
  const [selectedTender, setSelectedTender] = useState<string | null>(null);
  const [declaration, setDeclaration] = useState(false);
  const [proposedAmount, setProposedAmount] = useState("");
  const [proposalDocument, setProposalDocument] = useState("");
  const [proposalFileName, setProposalFileName] = useState("");
  const [tenders, setTenders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const authUser = getAuthUser();

  const fileToBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });

  const loadTenders = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest<any[]>("/api/tenders");
      setTenders(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tenders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTenders();
  }, []);

  const availableTenders = useMemo(
    () => tenders.filter((t) => t.status === "Published"),
    [tenders]
  );

  const myBids = useMemo(() => {
    if (!authUser?._id) return [] as any[];
    return tenders
      .filter((tender) => tender.bids?.some((bid: any) => bid.vendorId === authUser._id))
      .map((tender) => {
        const bid = tender.bids.find((item: any) => item.vendorId === authUser._id);
        return {
          id: tender._id,
          title: tender.title,
          status: bid?.status || "Pending",
          submittedDate: bid?.createdAt ? new Date(bid.createdAt).toLocaleDateString() : "-",
        };
      });
  }, [authUser?._id, tenders]);

  const stats = useMemo(
    () => [
      { label: "Available Tenders", value: String(availableTenders.length), icon: FileText, color: "bg-[#1D4E89]" },
      { label: "Submitted Bids", value: String(myBids.length), icon: CheckCircle, color: "bg-[#2E8B57]" },
      { label: "Under Evaluation", value: String(myBids.filter((b) => b.status === "Evaluated").length), icon: Clock, color: "bg-[#F4A300]" },
      { label: "Contracts Won", value: String(myBids.filter((b) => b.status === "Selected").length), icon: Award, color: "bg-[#2E8B57]" },
    ],
    [availableTenders.length, myBids]
  );

  const handleSubmitBid = async () => {
    if (!declaration || !selectedTender) return;
    if (!proposalDocument) {
      setError("Please upload a proposal document before submitting");
      return;
    }
    try {
      await apiRequest(`/api/tenders/${selectedTender}/bids`, {
        method: "POST",
        body: {
          proposedAmount: Number(proposedAmount),
          proposalDocument,
        },
      });
      setShowSubmissionForm(false);
      setDeclaration(false);
      setProposedAmount("");
      setProposalDocument("");
      setProposalFileName("");
      await loadTenders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bid submission failed");
    }
  };

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="bidder" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="bidder" userName="ABC Corporation" />
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl text-[#0B3C5D] mb-1">Bidder Dashboard</h1>
            <p className="text-sm text-gray-600">Tender Participation & Performance</p>
          </div>

          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

          {/* Stats */}
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

          {/* Performance Score */}
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100 mb-6">
            <h3 className="text-lg text-[#0B3C5D] mb-4">Your Performance Score</h3>
            <div className="flex items-center gap-6">
              <div className="flex-1">
                <div className="flex items-end gap-3 mb-2">
                  <span className="text-4xl text-[#2E8B57]">87.5</span>
                  <span className="text-sm text-gray-600 mb-2">/100</span>
                </div>
                <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-[#2E8B57]" style={{ width: "87.5%" }}></div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-600">Successful Deliveries</p>
                  <p className="text-[#0B3C5D]">12/13</p>
                </div>
                <div>
                  <p className="text-gray-600">Avg. Quality Rating</p>
                  <p className="text-[#0B3C5D]">4.6/5.0</p>
                </div>
              </div>
            </div>
          </div>

          {/* Available Tenders */}
          <div className="bg-white rounded-lg shadow-sm mb-6 border border-gray-100">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-lg text-[#0B3C5D]">Available Tenders</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Tender ID</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Title</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Category</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Budget</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Deadline</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading && (
                    <tr>
                      <td className="px-6 py-4 text-sm text-gray-600" colSpan={6}>Loading tenders...</td>
                    </tr>
                  )}
                  {!loading && availableTenders.map((tender) => (
                    <tr key={tender._id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-[#1D4E89]">{tender._id.slice(-6).toUpperCase()}</td>
                      <td className="px-6 py-4 text-sm text-gray-800">{tender.title}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">General</td>
                      <td className="px-6 py-4 text-sm text-gray-700">₹{Number(tender.budget).toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{new Date(tender.deadline).toLocaleDateString()}</td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => {
                            setSelectedTender(tender._id);
                            setShowSubmissionForm(true);
                          }}
                          className="text-sm text-[#1D4E89] hover:underline"
                        >
                          Submit Bid
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!loading && !availableTenders.length && (
                    <tr>
                      <td className="px-6 py-4 text-sm text-gray-600" colSpan={6}>No published tenders available.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* My Submissions */}
          <div className="bg-white rounded-lg shadow-sm mb-6 border border-gray-100">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-lg text-[#0B3C5D]">My Submissions</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Tender ID</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Title</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Submitted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {myBids.map((bid) => (
                    <tr key={bid.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-[#1D4E89]">{bid.id.slice(-6).toUpperCase()}</td>
                      <td className="px-6 py-4 text-sm text-gray-800">{bid.title}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 rounded-full text-xs ${
                            bid.status === "Selected"
                              ? "bg-green-100 text-green-800"
                              : bid.status === "Evaluated"
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-blue-100 text-blue-800"
                          }`}
                        >
                          {bid.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">{bid.submittedDate}</td>
                    </tr>
                  ))}
                  {!myBids.length && (
                    <tr>
                      <td className="px-6 py-4 text-sm text-gray-600" colSpan={4}>No submissions yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bid Submission Form Modal */}
          {showSubmissionForm && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b border-gray-100">
                  <h3 className="text-lg text-[#0B3C5D]">Submit Bid - {selectedTender}</h3>
                </div>
                <div className="p-6 space-y-4">
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
                    <label className="block text-sm text-gray-700 mb-2">Proposal Document</label>
                    <label className="block border-2 border-dashed border-gray-300 rounded-lg p-5 text-center hover:border-[#1D4E89] transition-colors cursor-pointer">
                      <Upload className="w-7 h-7 text-gray-400 mx-auto mb-2" />
                      <p className="text-sm text-gray-600 mb-1">Click to upload proposal document</p>
                      <p className="text-xs text-gray-500">PDF, DOC, DOCX (Max 10MB)</p>
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.doc,.docx"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          if (file.size > 10 * 1024 * 1024) {
                            setError("File size must be 10MB or less");
                            return;
                          }
                          try {
                            setError("");
                            const encoded = await fileToBase64(file);
                            setProposalDocument(encoded);
                            setProposalFileName(file.name);
                          } catch {
                            setError("Failed to process selected file");
                          }
                        }}
                      />
                    </label>
                    {proposalFileName && (
                      <p className="text-xs text-green-700 mt-2">Uploaded: {proposalFileName}</p>
                    )}
                  </div>
                  <div className="pt-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={declaration}
                        onChange={(e) => setDeclaration(e.target.checked)}
                        className="mt-1 w-5 h-5 rounded border-gray-300 text-[#1D4E89] focus:ring-[#1D4E89]"
                      />
                      <span className="text-sm text-gray-700">
                        I declare that all information provided is accurate and complete. I understand that any false information may result in disqualification.
                      </span>
                    </label>
                  </div>
                </div>
                <div className="p-6 border-t border-gray-100 flex items-center gap-3">
                  <button
                    onClick={handleSubmitBid}
                    disabled={!declaration}
                    className={`px-6 py-2 rounded-md transition-colors ${
                      declaration
                        ? "bg-[#1D4E89] hover:bg-[#154068] text-white"
                        : "bg-gray-300 text-gray-500 cursor-not-allowed"
                    }`}
                  >
                    Submit Bid
                  </button>
                  <button
                    onClick={() => {
                      setShowSubmissionForm(false);
                      setDeclaration(false);
                      setProposalDocument("");
                      setProposalFileName("");
                    }}
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
      <AIAssistant role="bidder" />
    </div>
  );
}