import { Sidebar } from "../layout/Sidebar";
import { AIAssistant } from "../AIAssistant";
import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../api";

export function CPOContractStatus() {
  const [contracts, setContracts] = useState<any[]>([]);
  const [contractSearch, setContractSearch] = useState("");
  const [contractStatusFilter, setContractStatusFilter] = useState("All");
  const [contractSort, setContractSort] = useState<"tender-asc" | "tender-desc" | "vendor-asc" | "status">("tender-asc");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  const filteredContracts = useMemo(() => {
    const filtered = contracts.filter((c) => {
      const q = contractSearch.trim().toLowerCase();
      const matchSearch =
        !q ||
        (c.tenderId?.title || "").toLowerCase().includes(q) ||
        (c.vendorId?.name || "").toLowerCase().includes(q);
      const matchStatus =
        contractStatusFilter === "All" || c.status === contractStatusFilter;
      return matchSearch && matchStatus;
    });

    const sorted = [...filtered];
    sorted.sort((left, right) => {
      if (contractSort === "tender-desc") {
        return String(right.tenderId?.title || "").localeCompare(String(left.tenderId?.title || ""));
      }
      if (contractSort === "vendor-asc") {
        return String(left.vendorId?.name || "").localeCompare(String(right.vendorId?.name || ""));
      }
      if (contractSort === "status") {
        return String(left.status || "").localeCompare(String(right.status || ""));
      }
      return String(left.tenderId?.title || "").localeCompare(String(right.tenderId?.title || ""));
    });

    return sorted;
  }, [contracts, contractSearch, contractStatusFilter, contractSort]);

  const loadContracts = async () => {
    try {
      const data = await apiRequest<any[]>("/api/contracts");
      setContracts(data);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to load contracts");
    }
  };

  const updateContractStatus = async (
    contractId: string,
    status: "Awarded" | "Signed" | "Completed" | "Cancelled"
  ) => {
    setActionError("");
    setActionSuccess("");
    try {
      await apiRequest(`/api/contracts/${contractId}/status`, {
        method: "PUT",
        body: { status },
      });
      setActionSuccess("Contract status updated.");
      await loadContracts();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update contract status");
    }
  };

  useEffect(() => {
    loadContracts();
  }, []);

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="cpo" />
      <div className="flex-1 overflow-auto p-6">
        <div className="mb-6">
          <h1 className="text-2xl text-[#0B3C5D] mb-1">Contract Status</h1>
          <p className="text-sm text-gray-600">
            View and update contract statuses across all active procurements
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
          <div className="flex flex-wrap gap-3 mb-4">
            <input
              type="text"
              value={contractSearch}
              onChange={(e) => setContractSearch(e.target.value)}
              placeholder="Search by tender or vendor…"
              className="flex-1 min-w-[200px] max-w-sm px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
            <select
              value={contractStatusFilter}
              onChange={(e) => setContractStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white"
            >
              <option value="All">All Statuses</option>
              <option value="Awarded">Awarded</option>
              <option value="Signed">Signed</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
            <select
              value={contractSort}
              onChange={(e) => setContractSort(e.target.value as "tender-asc" | "tender-desc" | "vendor-asc" | "status")}
              className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white"
            >
              <option value="tender-asc">Sort: Tender A-Z</option>
              <option value="tender-desc">Sort: Tender Z-A</option>
              <option value="vendor-asc">Sort: Vendor A-Z</option>
              <option value="status">Sort: Status</option>
            </select>
            {(contractSearch || contractStatusFilter !== "All" || contractSort !== "tender-asc") && (
              <button
                onClick={() => {
                  setContractSearch("");
                  setContractStatusFilter("All");
                  setContractSort("tender-asc");
                }}
                className="text-xs text-gray-500 hover:text-gray-700 underline self-center"
              >
                Clear
              </button>
            )}
            <span className="text-xs text-gray-400 self-center">
              {filteredContracts.length} of {contracts.length}
            </span>
          </div>

          {actionError && <p className="text-sm text-red-600 mb-3">{actionError}</p>}
          {actionSuccess && <p className="text-sm text-green-600 mb-3">{actionSuccess}</p>}

          {!contracts.length && (
            <p className="text-sm text-gray-600 py-6 text-center">No contracts available.</p>
          )}
          {!!contracts.length && !filteredContracts.length && (
            <p className="text-sm text-gray-400 py-6 text-center">No contracts match your search.</p>
          )}

          <div className="space-y-3">
            {filteredContracts.map((contract) => (
              <div
                key={contract._id}
                className="flex flex-col md:flex-row md:items-center md:justify-between border border-gray-200 rounded-md p-4 gap-3"
              >
                <div>
                  <p className="text-sm font-medium text-[#0B3C5D]">
                    {contract.tenderId?.title || "Tender"}
                  </p>
                  <p className="text-xs text-gray-600">
                    Vendor: {contract.vendorId?.name || "N/A"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-800">
                    {contract.status}
                  </span>
                  <select
                    value={contract.status}
                    onChange={(e) =>
                      updateContractStatus(
                        contract._id,
                        e.target.value as "Awarded" | "Signed" | "Completed" | "Cancelled"
                      )
                    }
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                  >
                    <option value="Awarded">Awarded</option>
                    <option value="Signed">Signed</option>
                    <option value="Completed">Completed</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
        </div>
        <AIAssistant role="cpo" />
      </div>
    </div>
  );
}
