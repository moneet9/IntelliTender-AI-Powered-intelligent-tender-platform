import { useState } from "react";
import { Sidebar } from "../../layout/Sidebar";
import { Header } from "../../layout/Header";
import { AIAssistant } from "../../AIAssistant";
import { Download, Filter } from "lucide-react";

const auditLogs = [
  {
    timestamp: "2026-03-01 14:32:15",
    tender: "TND-2026-048",
    action: "Tender Created",
    officer: "Rajesh Kumar (PO)",
    details: "IT Infrastructure Upgrade - Budget ₹3.75 Cr",
  },
  {
    timestamp: "2026-03-01 10:15:42",
    tender: "TND-2026-047",
    action: "AI Evaluation Completed",
    officer: "System (AI)",
    details: "4 bidders evaluated, 2 flagged as medium risk",
  },
  {
    timestamp: "2026-02-28 16:45:22",
    tender: "TND-2026-047",
    action: "Manual Override Applied",
    officer: "Rajesh Kumar (PO)",
    details: "Override justification: Bidder has strong references from previous contracts",
  },
  {
    timestamp: "2026-02-28 14:20:18",
    tender: "TND-2026-046",
    action: "Committee Evaluation Submitted",
    officer: "Anil Verma (Committee)",
    details: "Recommended bidder: Tata Consultancy Services with score 87.5",
  },
  {
    timestamp: "2026-02-28 11:30:45",
    tender: "TND-2026-045",
    action: "Final Award Approved",
    officer: "Priya Sharma (CPO)",
    details: "Contract awarded to Infosys Technologies - Value ₹21.3 Lakh",
  },
  {
    timestamp: "2026-02-27 09:15:33",
    tender: "TND-2026-045",
    action: "Penalty Imposed",
    officer: "Priya Sharma (CPO)",
    details: "Late delivery penalty: ₹90,000 applied to contractor Wipro Solutions",
  },
  {
    timestamp: "2026-02-26 15:42:10",
    tender: "TND-2026-044",
    action: "Bid Submitted",
    officer: "Bharti Enterprises (Bidder)",
    details: "Technical and financial proposals uploaded",
  },
  {
    timestamp: "2026-02-26 13:25:55",
    tender: "TND-2026-043",
    action: "AI Risk Flag",
    officer: "System (AI)",
    details: "Duplicate documents detected in submission by Tech Mahindra",
  },
];

export function AuditLog() {
  const [filters, setFilters] = useState({
    tender: "",
    officer: "",
    dateFrom: "",
    dateTo: "",
  });

  const handleExport = (format: "pdf" | "csv") => {
    alert(`Exporting audit log as ${format.toUpperCase()}...`);
  };

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="cpo" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="cpo" userName="Priya Sharma" />
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl text-[#0B3C5D] mb-1">Audit & Transparency Log</h1>
            <p className="text-sm text-gray-600">Complete Activity Timeline & Compliance Record</p>
          </div>

          {/* Filters */}
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="w-5 h-5 text-[#0B3C5D]" />
              <h3 className="text-lg text-[#0B3C5D]">Filters</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm text-gray-700 mb-2">Tender ID</label>
                <input
                  type="text"
                  value={filters.tender}
                  onChange={(e) => setFilters({ ...filters, tender: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89] bg-white"
                  placeholder="e.g., TND-2026-047"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-2">Officer/User</label>
                <input
                  type="text"
                  value={filters.officer}
                  onChange={(e) => setFilters({ ...filters, officer: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89] bg-white"
                  placeholder="e.g., Rajesh Kumar"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-2">Date From</label>
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89] bg-white"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-2">Date To</label>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89] bg-white"
                />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button className="px-4 py-2 bg-[#1D4E89] hover:bg-[#154068] text-white rounded-md text-sm transition-colors">
                Apply Filters
              </button>
              <button
                onClick={() => setFilters({ tender: "", officer: "", dateFrom: "", dateTo: "" })}
                className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 text-sm transition-colors"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Export Buttons */}
          <div className="mb-6 flex items-center gap-3">
            <button
              onClick={() => handleExport("pdf")}
              className="px-4 py-2 bg-white border border-gray-300 rounded-md hover:bg-gray-50 text-sm transition-colors flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export PDF
            </button>
            <button
              onClick={() => handleExport("csv")}
              className="px-4 py-2 bg-white border border-gray-300 rounded-md hover:bg-gray-50 text-sm transition-colors flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          </div>

          {/* Audit Log Table */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-lg text-[#0B3C5D]">Activity Timeline</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Timestamp</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Tender ID</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Action</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">User/Officer</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {auditLogs.map((log, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-600 whitespace-nowrap">{log.timestamp}</td>
                      <td className="px-6 py-4 text-sm text-[#1D4E89]">{log.tender}</td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-3 py-1 rounded-full text-xs ${
                            log.action.includes("Approved") || log.action.includes("Completed")
                              ? "bg-green-100 text-green-800"
                              : log.action.includes("Override") || log.action.includes("Flag")
                              ? "bg-yellow-100 text-yellow-800"
                              : log.action.includes("Penalty")
                              ? "bg-red-100 text-red-800"
                              : "bg-blue-100 text-blue-800"
                          }`}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700">{log.officer}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Summary Stats */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">Total Actions</p>
              <p className="text-3xl text-[#0B3C5D]">{auditLogs.length}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">AI Recommendations</p>
              <p className="text-3xl text-[#1D4E89]">
                {auditLogs.filter((log) => log.officer.includes("AI")).length}
              </p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">Manual Overrides</p>
              <p className="text-3xl text-[#F4A300]">
                {auditLogs.filter((log) => log.action.includes("Override")).length}
              </p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">Penalties Imposed</p>
              <p className="text-3xl text-[#B22222]">
                {auditLogs.filter((log) => log.action.includes("Penalty")).length}
              </p>
            </div>
          </div>
        </div>
      </div>
      <AIAssistant role="cpo" />
    </div>
  );
}
