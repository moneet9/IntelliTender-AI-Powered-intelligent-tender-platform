import { useState } from "react";
import { Sidebar } from "../../layout/Sidebar";
import { Header } from "../../layout/Header";
import { AIAssistant } from "../../AIAssistant";
import { UserPlus, Mail, Phone, Building, CheckCircle, Edit2 } from "lucide-react";
import { useEffect } from "react";
import { apiRequest } from "../../../api";
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

export function CreatePO() {
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
    department: ""
  });
  const [editPO, setEditPO] = useState<any | null>(null);
  const [editFormData, setEditFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
    department: "",
    accountStatus: "Active",
  });
  const [showSuccess, setShowSuccess] = useState(false);
  const [editMessage, setEditMessage] = useState("");
  const [poList, setPoList] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [deletePO, setDeletePO] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const departments = [
    "Information Technology",
    "Healthcare & Medical",
    "Infrastructure & PWD",
    "Education",
    "Transport & Roads",
    "Urban Development",
    "Agriculture & Rural Development",
    "Energy & Power",
    "Water Resources",
    "Finance & Accounts"
  ];

  const loadPOs = async () => {
    try {
      const data = await apiRequest<any[]>("/api/admin/po");
      setPoList(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load POs");
    }
  };

  useEffect(() => {
    loadPOs();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await apiRequest("/api/admin/po", {
        method: "POST",
        body: {
          name: formData.fullName,
          email: formData.email,
          phone: formData.phone,
          department: formData.department,
          password: "Password@123",
        },
      });
      setShowSuccess(true);
      setFormData({
        fullName: "",
        email: "",
        phone: "",
        department: ""
      });
      await loadPOs();
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create PO");
    }
  };

  const openEditPO = (po: any) => {
    setEditPO(po);
    setEditMessage("");
    setEditFormData({
      fullName: po.name || "",
      email: po.email || "",
      phone: po.phone || "",
      department: po.department || "",
      accountStatus: po.accountStatus || "Active",
    });
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editPO) return;

    setError("");
    setIsEditing(true);
    try {
      await apiRequest(`/api/admin/po/${editPO._id}`, {
        method: "PUT",
        body: {
          name: editFormData.fullName,
          email: editFormData.email,
          phone: editFormData.phone,
          department: editFormData.department,
          accountStatus: editFormData.accountStatus,
        },
      });
      setEditMessage("Procurement Officer updated successfully");
      setEditPO(null);
      await loadPOs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update PO");
    } finally {
      setIsEditing(false);
    }
  };

  const removePO = async () => {
    if (!deletePO) return;
    setError("");
    setIsDeleting(true);
    try {
      await apiRequest(`/api/admin/po/${deletePO.id}`, { method: "DELETE" });
      await loadPOs();
      setDeletePO(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove PO");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="cpo" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="cpo" userName="Priya Sharma" />
        <div className="flex-1 overflow-auto p-8">
          <div className="mb-8">
            <h1 className="text-2xl text-[#0B3C5D] mb-2">Create Procurement Officer</h1>
            <p className="text-sm text-gray-600">Add a new procurement officer to manage department tenders</p>
          </div>

          {/* Success Message */}
          {showSuccess && (
            <div className="mb-6 bg-[#2E8B57]/10 border border-[#2E8B57] rounded-lg p-4 flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-[#2E8B57]" />
              <div>
                <p className="text-sm text-[#2E8B57]">
                  Procurement Officer created successfully! Default login password: <span className="font-semibold">Password@123</span>
                </p>
              </div>
            </div>
          )}

          <div className="max-w-3xl">
            {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
            {editMessage && <p className="text-sm text-green-700 mb-4">{editMessage}</p>}
            <div className="bg-white rounded-lg border border-gray-200 p-8">
              <div className="flex items-center gap-3 mb-6 pb-6 border-b border-gray-200">
                <div className="w-12 h-12 bg-[#0B3C5D]/10 rounded-lg flex items-center justify-center">
                  <UserPlus className="w-6 h-6 text-[#0B3C5D]" />
                </div>
                <div>
                  <h2 className="text-lg text-[#0B3C5D]">Officer Information</h2>
                  <p className="text-xs text-gray-600">All fields are mandatory</p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                  <p className="text-sm text-blue-900">
                    Default password for newly created PO account: <span className="font-semibold">Password@123</span>
                  </p>
                </div>
                {/* Full Name */}
                <div>
                  <label className="block text-sm text-gray-700 mb-2">
                    Full Name (in Devanagari & English)
                  </label>
                  <input
                    type="text"
                    name="fullName"
                    value={formData.fullName}
                    onChange={handleChange}
                    placeholder="e.g., राजेश कुमार शर्मा (Rajesh Kumar Sharma)"
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                    required
                  />
                </div>

                {/* Email & Phone */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm text-gray-700 mb-2 flex items-center gap-2">
                      <Mail className="w-4 h-4" />
                      Official Email
                    </label>
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      placeholder="rajesh.sharma@gov.in"
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-700 mb-2 flex items-center gap-2">
                      <Phone className="w-4 h-4" />
                      Mobile Number
                    </label>
                    <input
                      type="tel"
                      name="phone"
                      value={formData.phone}
                      onChange={handleChange}
                      placeholder="+91 98765 43210"
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                      required
                    />
                  </div>
                </div>

                {/* Department */}
                <div>
                  <label className="block text-sm text-gray-700 mb-2 flex items-center gap-2">
                    <Building className="w-4 h-4" />
                    Assigned Department
                  </label>
                  <select
                    name="department"
                    value={formData.department}
                    onChange={handleChange}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89] bg-white"
                    required
                  >
                    <option value="">Select Department</option>
                    {departments.map((dept) => (
                      <option key={dept} value={dept}>{dept}</option>
                    ))}
                  </select>
                </div>

                {/* Submit Button */}
                <div className="flex gap-4 pt-4">
                  <button
                    type="submit"
                    className="flex-1 bg-[#0B3C5D] hover:bg-[#1D4E89] text-white py-3 rounded-md transition-colors flex items-center justify-center gap-2"
                  >
                    <UserPlus className="w-5 h-5" />
                    Create Procurement Officer
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({
                      fullName: "",
                      email: "",
                      phone: "",
                      department: ""
                    })}
                    className="px-6 py-3 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    Clear Form
                  </button>
                </div>
              </form>
            </div>

            {/* Existing POs Preview */}
            <div className="bg-white rounded-lg border border-gray-200 p-6 mt-6">
              <h3 className="text-sm text-[#0B3C5D] mb-4">Recently Created Officers</h3>
              <div className="space-y-3">
                {!poList.length && <p className="text-sm text-gray-600">No POs available.</p>}
                {poList.map((officer) => (
                  <div key={officer._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                    <div>
                      <p className="text-sm text-gray-900">{officer.name}</p>
                      <p className="text-xs text-gray-600">{officer.department || "N/A"} • Committees: {officer.committeeCount || 0}</p>
                      <p className="text-xs text-gray-500 mt-1">Status: {officer.accountStatus || "Active"}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500">{new Date(officer.createdAt).toLocaleDateString()}</span>
                      <button
                        onClick={() => openEditPO(officer)}
                        className="text-xs px-3 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 flex items-center gap-1"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      <button
                        onClick={() => setDeletePO({ id: officer._id, name: officer.name })}
                        className="text-xs px-3 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200"
                      >
                        Remove PO
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      {editPO && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-lg text-[#0B3C5D]">Edit Procurement Officer</h3>
              <p className="text-sm text-gray-600 mt-1">Update officer details and account status</p>
            </div>
            <form onSubmit={handleEditSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm text-gray-700 mb-2">Full Name</label>
                <input
                  type="text"
                  value={editFormData.fullName}
                  onChange={(e) => setEditFormData({ ...editFormData, fullName: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                  required
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-700 mb-2">Email</label>
                  <input
                    type="email"
                    value={editFormData.email}
                    onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-2">Phone</label>
                  <input
                    type="tel"
                    value={editFormData.phone}
                    onChange={(e) => setEditFormData({ ...editFormData, phone: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-2">Department</label>
                <select
                  value={editFormData.department}
                  onChange={(e) => setEditFormData({ ...editFormData, department: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89] bg-white"
                >
                  <option value="">Select Department</option>
                  {departments.map((dept) => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-2">Account Status</label>
                <select
                  value={editFormData.accountStatus}
                  onChange={(e) => setEditFormData({ ...editFormData, accountStatus: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89] bg-white"
                >
                  <option value="Active">Active</option>
                  <option value="Frozen">Frozen</option>
                  <option value="Suspended">Suspended</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={isEditing}
                  className="flex-1 bg-[#0B3C5D] hover:bg-[#1D4E89] text-white py-3 rounded-md transition-colors"
                >
                  {isEditing ? "Saving..." : "Save Changes"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditPO(null)}
                  className="px-6 py-3 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <AlertDialog open={!!deletePO} onOpenChange={(open) => !open && !isDeleting && setDeletePO(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-700">Delete Procurement Officer?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                This will remove <span className="font-semibold text-gray-900">{deletePO?.name || "this PO"}</span>.
              </span>
              <span className="block text-red-700">
                All committee members created under this PO will also be removed.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={removePO}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-500"
            >
              {isDeleting ? "Deleting..." : "Yes, Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AIAssistant role="cpo" />
    </div>
  );
}
