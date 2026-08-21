import { useState } from "react";
import { Sidebar } from "../../layout/Sidebar";
import { Header } from "../../layout/Header";
import { AIAssistant } from "../../AIAssistant";
import { UserPlus, Mail, Phone, Briefcase, CheckCircle, Edit2 } from "lucide-react";
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

type CommitteeMember = {
  _id: string;
  name: string;
  designation?: string;
  specialization?: string;
  createdAt?: string;
};

export function CreateCommittee() {
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
    designation: ""
  });
  const [editMember, setEditMember] = useState<any | null>(null);
  const [editFormData, setEditFormData] = useState({
    fullName: "",
    email: "",
    phone: "",
    designation: "",
    accountStatus: "Active",
  });
  const [showSuccess, setShowSuccess] = useState(false);
  const [editMessage, setEditMessage] = useState("");
  const [committeeList, setCommitteeList] = useState<CommitteeMember[]>([]);
  const [error, setError] = useState("");
  const [deleteMember, setDeleteMember] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const designations = [
    "Electrical Engineer",
    "Chemical Engineer",
    "Account Officer",
    "Civil Engineer",
    "Risk Analyst",
    "Mechanical Engineer",
    "Procurement Analyst",
    "Quality Assurance Officer",
    "Legal Advisor",
    "Compliance Officer"
  ];

  const loadCommittees = async () => {
    try {
      const data = await apiRequest<any[]>("/api/admin/committee");
      setCommitteeList(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load committee members");
    }
  };

  useEffect(() => {
    loadCommittees();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await apiRequest("/api/admin/committee", {
        method: "POST",
        body: {
          name: formData.fullName,
          email: formData.email,
          phone: formData.phone,
          designation: formData.designation,
          password: "Password@123",
        },
      });
      setShowSuccess(true);
      setFormData({
        fullName: "",
        email: "",
        phone: "",
        designation: ""
      });
      await loadCommittees();
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create committee member");
    }
  };

  const openEditMember = (member: any) => {
    setEditMember(member);
    setEditMessage("");
    setEditFormData({
      fullName: member.name || "",
      email: member.email || "",
      phone: member.phone || "",
      designation: member.designation || member.specialization || "",
      accountStatus: member.accountStatus || "Active",
    });
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editMember) return;

    setError("");
    setIsEditing(true);
    try {
      await apiRequest(`/api/admin/committee/${editMember._id}`, {
        method: "PUT",
        body: {
          name: editFormData.fullName,
          email: editFormData.email,
          phone: editFormData.phone,
          designation: editFormData.designation,
          accountStatus: editFormData.accountStatus,
        },
      });
      setEditMessage("Committee member updated successfully");
      setEditMember(null);
      await loadCommittees();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update committee member");
    } finally {
      setIsEditing(false);
    }
  };

  const removeCommittee = async () => {
    if (!deleteMember) return;
    setError("");
    setIsDeleting(true);
    try {
      await apiRequest(`/api/admin/committee/${deleteMember.id}`, { method: "DELETE" });
      await loadCommittees();
      setDeleteMember(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove committee member");
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
      <Sidebar role="po" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="po" userName="Rajesh Kumar" />
        <div className="flex-1 overflow-auto p-8">
          <div className="mb-8">
            <h1 className="text-2xl text-[#0B3C5D] mb-2">Create Committee Member</h1>
            <p className="text-sm text-gray-600">Add a new committee member for bid evaluation and monitoring</p>
          </div>

          {/* Success Message */}
          {showSuccess && (
            <div className="mb-6 bg-[#2E8B57]/10 border border-[#2E8B57] rounded-lg p-4 flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-[#2E8B57]" />
              <div>
                <p className="text-sm text-[#2E8B57]">
                  Committee Member created successfully! Default login password: <span className="font-semibold">Password@123</span>
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
                  <h2 className="text-lg text-[#0B3C5D]">Committee Member Information</h2>
                  <p className="text-xs text-gray-600">All fields are mandatory</p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                  <p className="text-sm text-blue-900">
                    Default password for newly created committee account: <span className="font-semibold">Password@123</span>
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
                    placeholder="e.g., डॉ. अर्जुन वर्मा (Dr. Arjun Verma)"
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
                      placeholder="arjun.verma@intellitender.com"
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

                {/* Designation */}
                <div>
                  <label className="block text-sm text-gray-700 mb-2 flex items-center gap-2">
                    <Briefcase className="w-4 h-4" />
                    Designation
                  </label>
                  <select
                    name="designation"
                    value={formData.designation}
                    onChange={handleChange}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89] bg-white"
                    required
                  >
                    <option value="">Select Designation</option>
                    {designations.map((designation) => (
                      <option key={designation} value={designation}>{designation}</option>
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
                    Create Committee Member
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({
                      fullName: "",
                      email: "",
                      phone: "",
                      designation: ""
                    })}
                    className="px-6 py-3 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                  >
                    Clear Form
                  </button>
                </div>
              </form>
            </div>

            {/* Existing Committee Members Preview */}
            <div className="bg-white rounded-lg border border-gray-200 p-6 mt-6">
              <h3 className="text-sm text-[#0B3C5D] mb-4">Recently Created Committee Members</h3>
              <div className="space-y-3">
                {!committeeList.length && <p className="text-sm text-gray-600">No committee members available.</p>}
                {committeeList.map((member) => (
                  <div key={member._id} className="flex items-center justify-between p-3 bg-gray-50 rounded-md">
                    <div>
                      <p className="text-sm text-gray-900">{member.name}</p>
                      <p className="text-xs text-gray-600">{member.designation || member.specialization || "N/A"}</p>
                      <p className="text-xs text-gray-500 mt-1">Status: {member.accountStatus || "Active"}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500">{member.createdAt ? new Date(member.createdAt).toLocaleDateString() : ""}</span>
                      <button
                        onClick={() => openEditMember(member)}
                        className="text-xs px-3 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 flex items-center gap-1"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteMember({ id: member._id, name: member.name })}
                        className="text-xs px-3 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      {editMember && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-lg text-[#0B3C5D]">Edit Committee Member</h3>
              <p className="text-sm text-gray-600 mt-1">Update member details and account status</p>
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
                <label className="block text-sm text-gray-700 mb-2">Designation</label>
                <select
                  value={editFormData.designation}
                  onChange={(e) => setEditFormData({ ...editFormData, designation: e.target.value })}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89] bg-white"
                  required
                >
                  <option value="">Select Designation</option>
                  {designations.map((designation) => (
                    <option key={designation} value={designation}>{designation}</option>
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
                  onClick={() => setEditMember(null)}
                  className="px-6 py-3 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      <AlertDialog open={!!deleteMember} onOpenChange={(open) => !open && !isDeleting && setDeleteMember(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-700">Delete Committee Member?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                This will permanently remove <span className="font-semibold text-gray-900">{deleteMember?.name || "this member"}</span>.
              </span>
              <span className="block text-red-700">This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={removeCommittee}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-500"
            >
              {isDeleting ? "Deleting..." : "Yes, Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AIAssistant role="po" />
    </div>
  );
}
