import { Sidebar } from "../../layout/Sidebar";
import { Header } from "../../layout/Header";
import { AIAssistant } from "../../AIAssistant";
import { getAuthUser } from "../../../api";
import {
  formatDate,
  getContractProgress,
  getContractStatusClass,
  getCurrentMilestone,
  type ContractRecord,
  type MilestoneSummary,
} from "./vendorHelpers";
import { DocumentLinks } from "./vendorShared";
import { useVendorData } from "./vendorData";

export function VendorContracts() {
  const authUser = getAuthUser();
  const { loading, error, ongoingContracts, completedContracts } = useVendorData(authUser?._id);

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="vendor" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="vendor" userName={authUser?.name || ""} />
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl text-[#0B3C5D] mb-1">Contracts</h1>
            <p className="text-sm text-gray-600">Track delivery progress, milestones, and closed work history.</p>
          </div>

          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100 mb-6">
            <h2 className="text-lg text-[#0B3C5D] mb-4">Active Contracts</h2>
            {loading && <p className="text-sm text-gray-600">Loading active contracts...</p>}
            {!loading && !ongoingContracts.length && <p className="text-sm text-gray-600">No active awarded contracts yet.</p>}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {ongoingContracts.map((contract: ContractRecord) => {
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
            <h2 className="text-lg text-[#0B3C5D] mb-4">Completed Work History</h2>
            {loading && <p className="text-sm text-gray-600">Loading completed contracts...</p>}
            {!loading && !completedContracts.length && (
              <p className="text-sm text-gray-600">Completed contracts will appear here once they are closed by the procurement team.</p>
            )}
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
                    {completedContracts.map((contract: ContractRecord) => (
                      <tr key={contract._id} className="hover:bg-gray-50">
                        <td className="px-4 py-4 text-sm text-[#0B3C5D]">{contract.tenderId?.title || "Untitled Tender"}</td>
                        <td className="px-4 py-4 text-sm text-gray-700">{contract.tenderId?.category || "General"}</td>
                        <td className="px-4 py-4 text-sm text-gray-700">
                          {formatDate(contract.timelineStartDate)} to {formatDate(contract.timelineEndDate)}
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-700">
                          {(contract.milestones || []).filter((milestone: MilestoneSummary) => milestone.status === "Completed").length}/
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
        </div>
      </div>
      <AIAssistant role="vendor" />
    </div>
  );
}

