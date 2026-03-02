import { useState } from "react";
import { Sidebar } from "../layout/Sidebar";
import { Header } from "../layout/Header";
import { AIAssistant } from "../AIAssistant";
import { Search, Filter, X, Calendar, DollarSign, FileText, SlidersHorizontal } from "lucide-react";

interface Contract {
  id: string;
  title: string;
  category: "Supply" | "Work" | "Service";
  budget: number;
  deadline: string;
  department: string;
  status: "Open" | "Closing Soon" | "Closed";
  requiredDocs: number;
}

const allContracts: Contract[] = [
  { id: "TND-2026-048", title: "IT Infrastructure Upgrade", category: "Supply", budget: 500000, deadline: "2026-03-15", department: "IT", status: "Open", requiredDocs: 5 },
  { id: "TND-2026-049", title: "Hospital Equipment Supply", category: "Supply", budget: 750000, deadline: "2026-03-18", department: "Health", status: "Open", requiredDocs: 6 },
  { id: "TND-2026-050", title: "Bridge Construction", category: "Work", budget: 2500000, deadline: "2026-03-20", department: "Infrastructure", status: "Open", requiredDocs: 8 },
  { id: "TND-2026-051", title: "Road Maintenance Services", category: "Service", budget: 450000, deadline: "2026-03-10", department: "Transport", status: "Closing Soon", requiredDocs: 4 },
  { id: "TND-2026-052", title: "Office Furniture Supply", category: "Supply", budget: 350000, deadline: "2026-03-25", department: "Administration", status: "Open", requiredDocs: 5 },
  { id: "TND-2026-053", title: "School Building Construction", category: "Work", budget: 3200000, deadline: "2026-03-30", department: "Education", status: "Open", requiredDocs: 10 },
  { id: "TND-2026-054", title: "Medical Supplies Package", category: "Supply", budget: 650000, deadline: "2026-03-12", department: "Health", status: "Closing Soon", requiredDocs: 6 },
  { id: "TND-2026-055", title: "IT Support Services", category: "Service", budget: 280000, deadline: "2026-03-22", department: "IT", status: "Open", requiredDocs: 4 },
  { id: "TND-2026-056", title: "Water Treatment Plant", category: "Work", budget: 5500000, deadline: "2026-04-05", department: "Utilities", status: "Open", requiredDocs: 12 },
  { id: "TND-2026-057", title: "Cybersecurity Assessment", category: "Service", budget: 320000, deadline: "2026-03-28", department: "IT", status: "Open", requiredDocs: 5 },
  { id: "TND-2026-045", title: "Solar Panel Installation", category: "Work", budget: 1800000, deadline: "2026-02-28", department: "Energy", status: "Closed", requiredDocs: 8 },
  { id: "TND-2026-044", title: "Laboratory Equipment", category: "Supply", budget: 420000, deadline: "2026-02-25", department: "Education", status: "Closed", requiredDocs: 6 },
];

export function ContractSearch() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [budgetRange, setBudgetRange] = useState<[number, number]>([0, 10000000]);
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState<"deadline" | "budget" | "name">("deadline");

  // Extract unique departments
  const departments = Array.from(new Set(allContracts.map(c => c.department))).sort();

  // Filter contracts
  const filteredContracts = allContracts.filter(contract => {
    const matchesSearch = contract.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          contract.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === "all" || contract.category === selectedCategory;
    const matchesDepartment = selectedDepartment === "all" || contract.department === selectedDepartment;
    const matchesStatus = selectedStatus === "all" || contract.status === selectedStatus;
    const matchesBudget = contract.budget >= budgetRange[0] && contract.budget <= budgetRange[1];

    return matchesSearch && matchesCategory && matchesDepartment && matchesStatus && matchesBudget;
  });

  // Sort contracts
  const sortedContracts = [...filteredContracts].sort((a, b) => {
    if (sortBy === "deadline") return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    if (sortBy === "budget") return b.budget - a.budget;
    return a.title.localeCompare(b.title);
  });

  const clearFilters = () => {
    setSearchTerm("");
    setSelectedCategory("all");
    setSelectedDepartment("all");
    setSelectedStatus("all");
    setBudgetRange([0, 10000000]);
    setSortBy("deadline");
  };

  const activeFiltersCount = [
    selectedCategory !== "all",
    selectedDepartment !== "all",
    selectedStatus !== "all",
    budgetRange[0] !== 0 || budgetRange[1] !== 10000000
  ].filter(Boolean).length;

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="bidder" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="bidder" userName="ABC Corporation" />
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl text-[#0B3C5D] mb-1">Contract Search</h1>
            <p className="text-sm text-gray-600">Search and filter available tenders and contracts</p>
          </div>

          {/* Search and Filter Bar */}
          <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by contract name or ID..."
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
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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

                  {/* Department Filter */}
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Department</label>
                    <select
                      value={selectedDepartment}
                      onChange={(e) => setSelectedDepartment(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89] text-sm"
                    >
                      <option value="all">All Departments</option>
                      {departments.map(dept => (
                        <option key={dept} value={dept}>{dept}</option>
                      ))}
                    </select>
                  </div>

                  {/* Status Filter */}
                  <div>
                    <label className="block text-sm text-gray-700 mb-2">Status</label>
                    <select
                      value={selectedStatus}
                      onChange={(e) => setSelectedStatus(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89] text-sm"
                    >
                      <option value="all">All Statuses</option>
                      <option value="Open">Open</option>
                      <option value="Closing Soon">Closing Soon</option>
                      <option value="Closed">Closed</option>
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
                      <option value="deadline">Deadline (Soonest)</option>
                      <option value="budget">Budget (Highest)</option>
                      <option value="name">Name (A-Z)</option>
                    </select>
                  </div>
                </div>

                {/* Budget Range */}
                <div>
                  <label className="block text-sm text-gray-700 mb-2">
                    Budget Range: ${budgetRange[0].toLocaleString()} - ${budgetRange[1].toLocaleString()}
                  </label>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="0"
                      max="10000000"
                      step="100000"
                      value={budgetRange[0]}
                      onChange={(e) => setBudgetRange([parseInt(e.target.value), budgetRange[1]])}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#1D4E89]"
                    />
                    <input
                      type="range"
                      min="0"
                      max="10000000"
                      step="100000"
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
                    {sortedContracts.length} contracts found
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Results Summary */}
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-gray-600">
              Showing {sortedContracts.length} of {allContracts.length} contracts
            </p>
          </div>

          {/* Contract Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {sortedContracts.map((contract) => (
              <div key={contract.id} className="bg-white rounded-lg shadow-sm p-5 border border-gray-100 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="text-[#0B3C5D] mb-1">{contract.title}</h3>
                    <p className="text-sm text-[#1D4E89]">{contract.id}</p>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs ${
                      contract.status === "Open"
                        ? "bg-green-100 text-green-800"
                        : contract.status === "Closing Soon"
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {contract.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <FileText className="w-4 h-4" />
                    <span>{contract.category}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <DollarSign className="w-4 h-4" />
                    <span>${(contract.budget / 1000).toFixed(0)}K</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Calendar className="w-4 h-4" />
                    <span>{contract.deadline}</span>
                  </div>
                  <div className="text-sm text-gray-600">
                    {contract.department}
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-gray-500 mb-4">
                  <span>{contract.requiredDocs} documents required</span>
                </div>

                <div className="flex items-center gap-2">
                  <button className="flex-1 px-4 py-2 bg-[#1D4E89] hover:bg-[#154068] text-white rounded-md text-sm transition-colors">
                    View Details
                  </button>
                  <button className="flex-1 px-4 py-2 border border-[#1D4E89] text-[#1D4E89] rounded-md text-sm hover:bg-blue-50 transition-colors">
                    Submit Bid
                  </button>
                </div>
              </div>
            ))}
          </div>

          {sortedContracts.length === 0 && (
            <div className="bg-white rounded-lg shadow-sm p-12 border border-gray-100 text-center">
              <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg text-gray-700 mb-2">No contracts found</h3>
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
        </div>
      </div>
      <AIAssistant role="bidder" />
    </div>
  );
}