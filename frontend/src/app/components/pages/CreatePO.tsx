import { useState } from "react";
import { Sidebar } from "../layout/Sidebar";
import { AIAssistant } from "../AIAssistant";
import { UserPlus, Mail, Phone, Building, CheckCircle } from "lucide-react";
import { useEffect } from "react";
import { apiRequest } from "../../api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";

export function CreatePO() {
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
    department: ""
  });
  const [showSuccess, setShowSuccess] = useState(false);
  const [poList, setPoList] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [deletePO, setDeletePO] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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
      <div className="flex-1 overflow-auto">
        <div className="p-8">
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
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500">{new Date(officer.createdAt).toLocaleDateString()}</span>
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