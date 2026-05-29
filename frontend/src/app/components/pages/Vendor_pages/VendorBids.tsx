import { Sidebar } from "../../layout/Sidebar";
import { Header } from "../../layout/Header";
import { AIAssistant } from "../../AIAssistant";
import { getAuthUser } from "../../../api";
import { getStoredDocumentName, getStoredDocumentUrl } from "../../../document-utils";
import {
  formatCurrency,
  getBidStatusClass,
} from "./vendorHelpers";
import { useVendorData } from "./vendorData";

export function VendorBids() {
  const authUser = getAuthUser();
  const { loading, error, myBids } = useVendorData(authUser?._id);

  const total = myBids.length;
  const pending = myBids.filter((bid) => bid.status === "Pending").length;
  const selected = myBids.filter((bid) => bid.status === "Selected").length;
  const rejected = myBids.filter((bid) => bid.status === "Rejected").length;

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="vendor" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="vendor" userName={authUser?.name || ""} />
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl text-[#0B3C5D] mb-1">My Bids</h1>
            <p className="text-sm text-gray-600">Monitor submission status, evaluation comments, and scoring updates.</p>
          </div>

          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg border border-gray-100 p-4">
              <p className="text-sm text-gray-600">Total</p>
              <p className="text-2xl text-[#0B3C5D]">{total}</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 p-4">
              <p className="text-sm text-gray-600">Pending</p>
              <p className="text-2xl text-blue-700">{pending}</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 p-4">
              <p className="text-sm text-gray-600">Selected</p>
              <p className="text-2xl text-green-700">{selected}</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 p-4">
              <p className="text-sm text-gray-600">Rejected</p>
              <p className="text-2xl text-red-700">{rejected}</p>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
            {loading && <p className="text-sm text-gray-600">Loading bid activity...</p>}
            {!loading && !myBids.length && <p className="text-sm text-gray-600">No bid submissions yet.</p>}

            <div className="space-y-4">
              {myBids.map((bid) => {
                const proposalUrl = getStoredDocumentUrl(bid.proposalDocument);
                const proposalName = getStoredDocumentName(bid.proposalDocument, "Proposal PDF");

                return (
                  <div key={`${bid.tenderId}-${bid.submittedAt || bid.title}`} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                      <div>
                        <p className="text-sm text-[#0B3C5D]">{bid.title}</p>
                        <p className="text-xs text-gray-600 mt-1">
                          {bid.category} | Submitted {bid.submittedDate}
                        </p>
                      </div>
                      <div className="text-left lg:text-right">
                        <p className="text-base text-[#1D4E89]">{formatCurrency(bid.amount)}</p>
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
                        {proposalUrl ? (
                          <a href={proposalUrl} target="_blank" rel="noreferrer" className="text-[#1D4E89] hover:underline mt-1 inline-block">
                            {proposalName}
                          </a>
                        ) : (
                          <p className="text-[#0B3C5D] mt-1">{proposalName}</p>
                        )}
                      </div>
                    </div>

                    {bid.comments && (
                      <div className="mt-4 p-3 rounded-md bg-blue-50 border border-blue-100">
                        <p className="text-sm text-[#0B3C5D]">Committee Comment</p>
                        <p className="text-sm text-gray-700 mt-1">{bid.comments}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <AIAssistant role="vendor" />
    </div>
  );
}

