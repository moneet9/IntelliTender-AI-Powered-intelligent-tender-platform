import { Link } from "react-router";
import { Award, CheckCircle, Clock, FileText } from "lucide-react";
import { Sidebar } from "../../layout/Sidebar";
import { Header } from "../../layout/Header";
import { AIAssistant } from "../../AIAssistant";
import { getAuthUser } from "../../../api";
import {
  formatCurrency,
  formatDate,
  getBidStatusClass,
  getContractProgress,
  getContractStatusClass,
  useVendorData,
} from "./vendorShared";

export function VendorDashboard() {
  const authUser = getAuthUser();
  const { loading, error, publishedTenders, myBids, ongoingContracts, stats } = useVendorData(authUser?._id);

  const upcomingTenders = publishedTenders.slice(0, 5);
  const recentBids = myBids.slice(0, 5);
  const activeContracts = ongoingContracts.slice(0, 3);

  const statCards = [
    { label: "Published Tenders", value: stats.publishedTenders, icon: FileText, color: "bg-[#1D4E89]" },
    { label: "Submitted Bids", value: stats.submittedBids, icon: CheckCircle, color: "bg-[#2E8B57]" },
    { label: "Active Contracts", value: stats.activeContracts, icon: Clock, color: "bg-[#F4A300]" },
    { label: "Completed Contracts", value: stats.completedContracts, icon: Award, color: "bg-[#0B3C5D]" },
  ];

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="vendor" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="vendor" userName={authUser?.name || ""} />
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl text-[#0B3C5D] mb-1">Vendor Dashboard</h1>
            <p className="text-sm text-gray-600">Track key opportunities, bid activity, and delivery status from one place.</p>
          </div>

          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            {statCards.map((stat) => (
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="bg-white rounded-lg border border-gray-100 shadow-sm">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-base text-[#0B3C5D]">Upcoming Tenders</h2>
                <Link to="/vendor/contract-search" className="text-sm text-[#1D4E89] hover:underline">
                  View all
                </Link>
              </div>
              <div className="p-5 space-y-3">
                {loading && <p className="text-sm text-gray-600">Loading tenders...</p>}
                {!loading && !upcomingTenders.length && <p className="text-sm text-gray-600">No published tenders available.</p>}
                {!loading &&
                  upcomingTenders.map((tender) => (
                    <div key={tender._id} className="p-3 rounded-md border border-gray-200">
                      <p className="text-sm text-[#0B3C5D]">{tender.title}</p>
                      <p className="text-xs text-gray-600 mt-1">
                        Deadline: {formatDate(tender.deadline)} | Budget: {formatCurrency(tender.budget)}
                      </p>
                    </div>
                  ))}
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-100 shadow-sm">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-base text-[#0B3C5D]">Recent Bid Status</h2>
                <Link to="/vendor/bids" className="text-sm text-[#1D4E89] hover:underline">
                  View all
                </Link>
              </div>
              <div className="p-5 space-y-3">
                {loading && <p className="text-sm text-gray-600">Loading bids...</p>}
                {!loading && !recentBids.length && <p className="text-sm text-gray-600">No bids submitted yet.</p>}
                {!loading &&
                  recentBids.map((bid) => (
                    <div key={`${bid.tenderId}-${bid.submittedAt || bid.title}`} className="p-3 rounded-md border border-gray-200">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-[#0B3C5D]">{bid.title}</p>
                        <span className={`inline-flex px-3 py-1 rounded-full text-xs ${getBidStatusClass(bid.status)}`}>
                          {bid.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 mt-1">
                        Submitted: {bid.submittedDate} | Amount: {formatCurrency(bid.amount)}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-100 shadow-sm">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base text-[#0B3C5D]">Active Contract Snapshot</h2>
              <Link to="/vendor/contracts" className="text-sm text-[#1D4E89] hover:underline">
                Manage contracts
              </Link>
            </div>
            <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
              {loading && <p className="text-sm text-gray-600">Loading contracts...</p>}
              {!loading && !activeContracts.length && <p className="text-sm text-gray-600">No active contracts yet.</p>}
              {!loading &&
                activeContracts.map((contract) => {
                  const progress = getContractProgress(contract);
                  return (
                    <div key={contract._id} className="border border-gray-200 rounded-md p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-[#0B3C5D]">{contract.tenderId?.title || "Untitled Tender"}</p>
                        <span className={`inline-flex px-3 py-1 rounded-full text-xs ${getContractStatusClass(contract.status)}`}>
                          {contract.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 mt-1">Progress: {progress}%</p>
                      <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden mt-2">
                        <div className="h-full bg-[#1D4E89]" style={{ width: `${progress}%` }}></div>
                      </div>
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

