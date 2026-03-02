import { useState } from "react";
import { Sidebar } from "../layout/Sidebar";
import { Header } from "../layout/Header";
import { AIAssistant } from "../AIAssistant";
import {
  Calendar,
  CheckCircle,
  Circle,
  AlertTriangle,
  Clock,
  Upload,
  Plus,
  Edit2,
  Trash2,
  Eye,
  FileText,
  Image as ImageIcon,
} from "lucide-react";

type UserRole = "po" | "committee" | "cpo";

interface Milestone {
  id: string;
  title: string;
  description: string;
  plannedStartDate: string;
  plannedEndDate: string;
  actualStartDate?: string;
  actualEndDate?: string;
  status: "not-started" | "in-progress" | "completed" | "delayed";
  progress: number;
  assignedTo: string;
  documents: string[];
  images: string[];
  remarks: string;
}

const initialMilestones: Milestone[] = [
  {
    id: "M-001",
    title: "Site Preparation & Foundation",
    description: "Clear site, excavation, and foundation work including base concrete pouring",
    plannedStartDate: "2026-01-15",
    plannedEndDate: "2026-02-10",
    actualStartDate: "2026-01-15",
    actualEndDate: "2026-02-10",
    status: "completed",
    progress: 100,
    assignedTo: "Committee Member A",
    documents: ["Foundation_Report.pdf", "Site_Clearance_Certificate.pdf"],
    images: ["foundation_1.jpg", "foundation_2.jpg"],
    remarks: "Completed on time with all quality checks passed",
  },
  {
    id: "M-002",
    title: "Primary Structure Construction",
    description: "Main building structure, columns, beams, and floor slabs",
    plannedStartDate: "2026-02-11",
    plannedEndDate: "2026-03-20",
    actualStartDate: "2026-02-13",
    actualEndDate: undefined,
    status: "delayed",
    progress: 65,
    assignedTo: "Committee Member B",
    documents: ["Progress_Report_Week_1.pdf"],
    images: ["structure_progress_1.jpg"],
    remarks: "Delayed by 12 days due to material supply issues. Penalty clause may apply.",
  },
  {
    id: "M-003",
    title: "Roofing & External Works",
    description: "Roof installation, external walls, and waterproofing",
    plannedStartDate: "2026-03-21",
    plannedEndDate: "2026-04-30",
    status: "not-started",
    progress: 0,
    assignedTo: "Committee Member A",
    documents: [],
    images: [],
    remarks: "",
  },
  {
    id: "M-004",
    title: "Internal Finishing",
    description: "Plastering, flooring, electrical and plumbing installations",
    plannedStartDate: "2026-05-01",
    plannedEndDate: "2026-06-15",
    status: "not-started",
    progress: 0,
    assignedTo: "Committee Member C",
    documents: [],
    images: [],
    remarks: "",
  },
  {
    id: "M-005",
    title: "Final Inspection & Handover",
    description: "Quality inspection, defect rectification, and project handover",
    plannedStartDate: "2026-06-16",
    plannedEndDate: "2026-06-30",
    status: "not-started",
    progress: 0,
    assignedTo: "Committee Member A",
    documents: [],
    images: [],
    remarks: "",
  },
];

interface MilestoneTrackingProps {
  userRole?: UserRole;
}

export function MilestoneTracking({ userRole = "committee" }: MilestoneTrackingProps) {
  const [milestones, setMilestones] = useState<Milestone[]>(initialMilestones);
  const [selectedMilestone, setSelectedMilestone] = useState<Milestone | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit" | "update" | "view">("view");

  const handleCreateMilestone = () => {
    setModalMode("create");
    setSelectedMilestone({
      id: `M-${String(milestones.length + 1).padStart(3, "0")}`,
      title: "",
      description: "",
      plannedStartDate: "",
      plannedEndDate: "",
      status: "not-started",
      progress: 0,
      assignedTo: "",
      documents: [],
      images: [],
      remarks: "",
    });
    setIsModalOpen(true);
  };

  const handleEditMilestone = (milestone: Milestone) => {
    setModalMode("edit");
    setSelectedMilestone(milestone);
    setIsModalOpen(true);
  };

  const handleUpdateProgress = (milestone: Milestone) => {
    setModalMode("update");
    setSelectedMilestone(milestone);
    setIsModalOpen(true);
  };

  const handleViewMilestone = (milestone: Milestone) => {
    setModalMode("view");
    setSelectedMilestone(milestone);
    setIsModalOpen(true);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-800 border-green-200";
      case "in-progress":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "delayed":
        return "bg-red-100 text-red-800 border-red-200";
      default:
        return "bg-gray-100 text-gray-600 border-gray-200";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case "in-progress":
        return <Clock className="w-5 h-5 text-blue-600" />;
      case "delayed":
        return <AlertTriangle className="w-5 h-5 text-red-600" />;
      default:
        return <Circle className="w-5 h-5 text-gray-400" />;
    }
  };

  const canEdit = userRole === "po";
  const canUpdate = userRole === "committee";
  const isViewOnly = userRole === "cpo";

  const completedMilestones = milestones.filter((m) => m.status === "completed").length;
  const delayedMilestones = milestones.filter((m) => m.status === "delayed").length;
  const overallProgress = Math.round(
    milestones.reduce((sum, m) => sum + m.progress, 0) / milestones.length
  );

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role={userRole} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role={userRole} userName={userRole === "po" ? "Rajesh Kumar" : userRole === "committee" ? "Anil Verma" : "Priya Sharma"} />
        <div className="flex-1 overflow-auto p-6">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-start justify-between mb-2">
              <div>
                <h1 className="text-2xl text-[#0B3C5D] mb-1">Milestone Tracking</h1>
                <p className="text-sm text-gray-600">Contract: CNT-2026-028 - Road Construction Project</p>
                <p className="text-sm text-gray-600">Contractor: BuildTech Solutions</p>
              </div>
              {canEdit && (
                <button
                  onClick={handleCreateMilestone}
                  className="px-4 py-2 bg-[#1D4E89] hover:bg-[#154068] text-white rounded-md transition-colors text-sm flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add Milestone
                </button>
              )}
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">Total Milestones</p>
              <p className="text-3xl text-[#0B3C5D]">{milestones.length}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">Completed</p>
              <p className="text-3xl text-[#2E8B57]">{completedMilestones}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">Delayed</p>
              <p className="text-3xl text-[#B22222]">{delayedMilestones}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">Overall Progress</p>
              <div className="flex items-end gap-2">
                <p className="text-3xl text-[#1D4E89]">{overallProgress}%</p>
                <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden mb-2">
                  <div
                    className="h-full bg-[#1D4E89]"
                    style={{ width: `${overallProgress}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>

          {/* Timeline Visualization */}
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100 mb-6">
            <h3 className="text-lg text-[#0B3C5D] mb-6">Project Timeline</h3>
            <div className="relative">
              {milestones.map((milestone, index) => (
                <div key={milestone.id} className="flex gap-4 mb-8 last:mb-0">
                  {/* Timeline Line */}
                  <div className="relative flex flex-col items-center">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full border-2 flex items-center justify-center bg-white z-10"
                      style={{
                        borderColor: milestone.status === "completed" ? "#2E8B57" : milestone.status === "delayed" ? "#B22222" : milestone.status === "in-progress" ? "#1D4E89" : "#D1D5DB"
                      }}
                    >
                      {getStatusIcon(milestone.status)}
                    </div>
                    {index < milestones.length - 1 && (
                      <div className="w-0.5 h-full bg-gray-300 absolute top-10"></div>
                    )}
                  </div>

                  {/* Milestone Content */}
                  <div className="flex-1 pb-8">
                    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <h4 className="text-[#0B3C5D] mb-1">{milestone.title}</h4>
                          <p className="text-sm text-gray-600 mb-2">{milestone.description}</p>
                          <div className="flex items-center gap-4 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              Planned: {milestone.plannedStartDate} → {milestone.plannedEndDate}
                            </span>
                            {milestone.actualStartDate && (
                              <span className="flex items-center gap-1">
                                Actual: {milestone.actualStartDate} → {milestone.actualEndDate || "In Progress"}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs border ${getStatusColor(milestone.status)}`}>
                          {milestone.status.replace("-", " ").toUpperCase()}
                        </span>
                      </div>

                      <div className="mt-3 mb-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-gray-600">Progress</span>
                          <span className="text-xs text-[#0B3C5D]">{milestone.progress}%</span>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${milestone.status === "delayed" ? "bg-[#B22222]" : "bg-[#2E8B57]"}`}
                            style={{ width: `${milestone.progress}%` }}
                          ></div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4 text-xs text-gray-600">
                          <span>Assigned: {milestone.assignedTo}</span>
                          {milestone.documents.length > 0 && (
                            <span className="flex items-center gap-1">
                              <FileText className="w-3 h-3" />
                              {milestone.documents.length} docs
                            </span>
                          )}
                          {milestone.images.length > 0 && (
                            <span className="flex items-center gap-1">
                              <ImageIcon className="w-3 h-3" />
                              {milestone.images.length} images
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleViewMilestone(milestone)}
                            className="p-1 hover:bg-white rounded text-gray-600 hover:text-[#1D4E89]"
                            title="View Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {canEdit && (
                            <button
                              onClick={() => handleEditMilestone(milestone)}
                              className="p-1 hover:bg-white rounded text-gray-600 hover:text-[#1D4E89]"
                              title="Edit Milestone"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                          {canUpdate && milestone.status !== "completed" && (
                            <button
                              onClick={() => handleUpdateProgress(milestone)}
                              className="px-3 py-1 bg-[#1D4E89] hover:bg-[#154068] text-white rounded text-xs transition-colors"
                            >
                              Update Progress
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* AI Analysis */}
          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
            <h3 className="text-lg text-[#0B3C5D] mb-4">AI Delay & Risk Analysis</h3>
            <div className="space-y-4">
              <div className="p-4 bg-red-50 border border-red-200 rounded-md">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5" />
                  <div className="flex-1">
                    <h4 className="text-sm text-red-800 mb-2">Critical Delay Detected - M-002</h4>
                    <p className="text-sm text-red-700 mb-2">
                      Milestone "Primary Structure Construction" is <span className="font-medium">12 days behind schedule</span>. 
                      Expected completion was March 20, 2026.
                    </p>
                    <p className="text-sm text-red-700 mb-3">
                      <span className="font-medium">Impact Analysis:</span> This delay will cascade to subsequent milestones M-003 and M-004, 
                      potentially extending project completion by 2-3 weeks.
                    </p>
                    <div className="p-3 bg-white rounded border border-red-200">
                      <p className="text-sm text-gray-700 mb-1">
                        <span className="font-medium">Recommended Penalty (Clause 7.3):</span>
                      </p>
                      <p className="text-sm text-gray-700">
                        Work Contract Delay: $2,400/day × 12 days = <span className="font-medium text-red-800">$28,800</span>
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-blue-50 border border-blue-200 rounded-md">
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-blue-600 mt-0.5" />
                  <div className="flex-1">
                    <h4 className="text-sm text-blue-800 mb-2">Performance Insight</h4>
                    <p className="text-sm text-blue-700">
                      Milestone M-001 was completed on time with 100% quality compliance. Contractor demonstrated strong capability 
                      in foundation work. Current delay appears to be material supply issue rather than execution capability.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <AIAssistant />

      {/* Modal for Create/Edit/Update */}
      {isModalOpen && selectedMilestone && (
        <MilestoneModal
          milestone={selectedMilestone}
          mode={modalMode}
          onClose={() => setIsModalOpen(false)}
          onSave={(updated) => {
            if (modalMode === "create") {
              setMilestones([...milestones, updated]);
            } else {
              setMilestones(milestones.map((m) => (m.id === updated.id ? updated : m)));
            }
            setIsModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

// Modal Component
function MilestoneModal({
  milestone,
  mode,
  onClose,
  onSave,
}: {
  milestone: Milestone;
  mode: "create" | "edit" | "update" | "view";
  onClose: () => void;
  onSave: (milestone: Milestone) => void;
}) {
  const [formData, setFormData] = useState(milestone);

  const isReadOnly = mode === "view";
  const isUpdate = mode === "update";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg text-[#0B3C5D]">
            {mode === "create" && "Create New Milestone"}
            {mode === "edit" && "Edit Milestone"}
            {mode === "update" && "Update Milestone Progress"}
            {mode === "view" && "Milestone Details"}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>

        <div className="p-6 space-y-4">
          {(mode === "create" || mode === "edit") && (
            <>
              <div>
                <label className="block text-sm text-gray-700 mb-2">Milestone Title</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                  disabled={isReadOnly}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-2">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                  rows={3}
                  disabled={isReadOnly}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-700 mb-2">Planned Start Date</label>
                  <input
                    type="date"
                    value={formData.plannedStartDate}
                    onChange={(e) => setFormData({ ...formData, plannedStartDate: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                    disabled={isReadOnly}
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-2">Planned End Date</label>
                  <input
                    type="date"
                    value={formData.plannedEndDate}
                    onChange={(e) => setFormData({ ...formData, plannedEndDate: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                    disabled={isReadOnly}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-700 mb-2">Assigned To</label>
                <input
                  type="text"
                  value={formData.assignedTo}
                  onChange={(e) => setFormData({ ...formData, assignedTo: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                  disabled={isReadOnly}
                />
              </div>
            </>
          )}

          {isUpdate && (
            <>
              <div>
                <label className="block text-sm text-gray-700 mb-2">Progress (%)</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={formData.progress}
                  onChange={(e) => setFormData({ ...formData, progress: parseInt(e.target.value) })}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#1D4E89]"
                />
                <div className="text-center mt-2 text-2xl text-[#0B3C5D]">{formData.progress}%</div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-700 mb-2">Actual Start Date</label>
                  <input
                    type="date"
                    value={formData.actualStartDate || ""}
                    onChange={(e) => setFormData({ ...formData, actualStartDate: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-700 mb-2">Actual End Date (if complete)</label>
                  <input
                    type="date"
                    value={formData.actualEndDate || ""}
                    onChange={(e) => setFormData({ ...formData, actualEndDate: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-gray-700 mb-2">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                >
                  <option value="not-started">Not Started</option>
                  <option value="in-progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="delayed">Delayed</option>
                </select>
              </div>

              <div>
                <label className="block text-sm text-gray-700 mb-2">Remarks/Observations</label>
                <textarea
                  value={formData.remarks}
                  onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                  rows={4}
                  placeholder="Enter progress notes, observations, or issues..."
                />
              </div>

              <div>
                <label className="block text-sm text-gray-700 mb-2">Upload Documents/Images</label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-[#1D4E89] transition-colors cursor-pointer">
                  <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-600">Upload progress photos and documents</p>
                </div>
              </div>
            </>
          )}

          {mode === "view" && (
            <div className="space-y-3">
              <div>
                <span className="text-sm text-gray-600">Title:</span>
                <p className="text-[#0B3C5D]">{formData.title}</p>
              </div>
              <div>
                <span className="text-sm text-gray-600">Description:</span>
                <p className="text-gray-700">{formData.description}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-gray-600">Planned Period:</span>
                  <p className="text-gray-700">{formData.plannedStartDate} → {formData.plannedEndDate}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-600">Actual Period:</span>
                  <p className="text-gray-700">
                    {formData.actualStartDate || "Not started"} → {formData.actualEndDate || "In progress"}
                  </p>
                </div>
              </div>
              <div>
                <span className="text-sm text-gray-600">Progress:</span>
                <p className="text-[#0B3C5D]">{formData.progress}%</p>
              </div>
              <div>
                <span className="text-sm text-gray-600">Remarks:</span>
                <p className="text-gray-700">{formData.remarks || "No remarks"}</p>
              </div>
            </div>
          )}
        </div>

        {!isReadOnly && (
          <div className="p-6 border-t border-gray-100 flex items-center gap-3">
            <button
              onClick={() => onSave(formData)}
              className="px-6 py-2 bg-[#1D4E89] hover:bg-[#154068] text-white rounded-md transition-colors"
            >
              {mode === "create" ? "Create Milestone" : mode === "update" ? "Update Progress" : "Save Changes"}
            </button>
            <button
              onClick={onClose}
              className="px-6 py-2 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}