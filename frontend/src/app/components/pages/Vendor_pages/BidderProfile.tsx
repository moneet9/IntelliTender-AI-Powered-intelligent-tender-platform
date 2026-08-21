import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "../../layout/Sidebar";
import { Header } from "../../layout/Header";
import { AIAssistant } from "../../AIAssistant";
import { apiRequest, getAuthUser } from "../../../api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../ui/alert-dialog";

export function BidderProfile() {
  const authUser = getAuthUser();
  const role = authUser?.role === "PO" ? "po" : "cpo";
  const [vendors, setVendors] = useState<any[]>([]);
  const [freezeDateTime, setFreezeDateTime] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [deleteVendorTarget, setDeleteVendorTarget] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadVendors = async () => {
    setError("");
    try {
      const data = await apiRequest<any[]>("/api/admin/vendors");
      setVendors(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load vendors");
    }
  };

  useEffect(() => {
    loadVendors();
  }, []);

  const freezeVendor = async (id: string) => {
    setError("");
    setSuccess("");
    const selectedDateTime = freezeDateTime[id];
    if (!selectedDateTime) {
      setError("Select freeze date and time");
      return;
    }
    const freezeUntilDate = new Date(selectedDateTime);
    if (Number.isNaN(freezeUntilDate.getTime()) || freezeUntilDate <= new Date()) {
      setError("Freeze date/time must be in the future");
      return;
    }
    const freezeUntil = freezeUntilDate.toISOString();
    try {
      await apiRequest(`/api/admin/vendors/${id}/freeze`, {
        method: "PUT",
        body: { freezeUntil },
      });
      setSuccess(`Vendor frozen until ${freezeUntilDate.toLocaleString()}`);
      await loadVendors();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to freeze vendor");
    }
  };

  const deleteVendor = async () => {
    if (!deleteVendorTarget) return;
    setError("");
    setSuccess("");
    setIsDeleting(true);
    try {
      await apiRequest(`/api/admin/vendors/${deleteVendorTarget.id}`, { method: "DELETE" });
      setSuccess("Vendor account suspended");
      await loadVendors();
      setDeleteVendorTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to suspend vendor");
    } finally {
      setIsDeleting(false);
    }
  };

  const vendorStats = useMemo(() => {
    const total = vendors.length;
    const active = vendors.filter((v) => v.accountStatus === "Active").length;
    const frozen = vendors.filter((v) => v.accountStatus === "Frozen").length;
    const suspended = vendors.filter((v) => v.accountStatus === "Suspended" || v.accountStatus === "Deleted").length;
    return { total, active, frozen, suspended };
  }, [vendors]);

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role={role as "cpo" | "po"} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role={role as "cpo" | "po"} userName={authUser?.name || "User"} />
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl text-[#0B3C5D] mb-1">Vendor Management</h1>
            <p className="text-sm text-gray-600">Freeze or delete vendor accounts</p>
          </div>

          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          {success && <p className="text-sm text-green-700 mb-3">{success}</p>}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg border border-gray-100 p-4">
              <p className="text-sm text-gray-600">Total Vendors</p>
              <p className="text-2xl text-[#0B3C5D]">{vendorStats.total}</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 p-4">
              <p className="text-sm text-gray-600">Active</p>
              <p className="text-2xl text-green-700">{vendorStats.active}</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 p-4">
              <p className="text-sm text-gray-600">Frozen</p>
              <p className="text-2xl text-yellow-700">{vendorStats.frozen}</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 p-4">
              <p className="text-sm text-gray-600">Suspended</p>
              <p className="text-2xl text-red-700">{vendorStats.suspended}</p>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-100 overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="px-6 py-3 text-left text-xs uppercase text-gray-600">Name</th>
                  <th className="px-6 py-3 text-left text-xs uppercase text-gray-600">Email</th>
                  <th className="px-6 py-3 text-left text-xs uppercase text-gray-600">Status</th>
                  <th className="px-6 py-3 text-left text-xs uppercase text-gray-600">Frozen Until</th>
                  <th className="px-6 py-3 text-left text-xs uppercase text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {!vendors.length && (
                  <tr>
                    <td colSpan={5} className="px-6 py-4 text-sm text-gray-600">No vendors found.</td>
                  </tr>
                )}
                {vendors.map((vendor) => (
                  <tr key={vendor._id}>
                    <td className="px-6 py-4 text-sm text-gray-800">{vendor.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{vendor.email}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-3 py-1 rounded-full text-xs ${
                          vendor.accountStatus === "Active"
                            ? "bg-green-100 text-green-800"
                            : vendor.accountStatus === "Frozen"
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {vendor.accountStatus === "Deleted" ? "Suspended" : vendor.accountStatus}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {vendor.frozenUntil ? new Date(vendor.frozenUntil).toLocaleString() : "-"}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <input
                          type="datetime-local"
                          value={freezeDateTime[vendor._id] || ""}
                          onChange={(e) => setFreezeDateTime({ ...freezeDateTime, [vendor._id]: e.target.value })}
                          className="w-52 px-2 py-1 border border-gray-300 rounded-md text-sm"
                        />
                        <button
                          onClick={() => freezeVendor(vendor._id)}
                          className="px-3 py-1 text-xs rounded bg-yellow-100 text-yellow-800 hover:bg-yellow-200"
                          disabled={vendor.accountStatus === "Suspended"}
                        >
                          Freeze
                        </button>
                        <button
                          onClick={() => setDeleteVendorTarget({ id: vendor._id, name: vendor.name })}
                          className="px-3 py-1 text-xs rounded bg-red-100 text-red-800 hover:bg-red-200"
                          disabled={vendor.accountStatus === "Suspended"}
                        >
                          Suspend
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <AlertDialog open={!!deleteVendorTarget} onOpenChange={(open) => !open && !isDeleting && setDeleteVendorTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-700">Suspend Vendor Account?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                You are suspending <span className="font-semibold text-gray-900">{deleteVendorTarget?.name || "this vendor"}</span>.
              </span>
              <span className="block text-red-700">Suspended vendors can still log in, but actions are limited.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteVendor}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-500"
            >
              {isDeleting ? "Suspending..." : "Yes, Suspend"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AIAssistant role={role as "cpo" | "po"} />
    </div>
  );
}

