import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "../layout/Sidebar";
import { Header } from "../layout/Header";
import { AIAssistant } from "../AIAssistant";
import { apiRequest } from "../../api";
import {
  encodeFilesToStoredDocuments,
  getStoredDocumentName,
  getStoredDocumentUrl,
} from "../../document-utils";

type UserRole = "po" | "committee" | "cpo";

type ChecklistItem = { label: string; checked: boolean };

type HistoryEntry = {
  updatedBy?: { name?: string; role?: string } | null;
  updatedAt?: string;
  status?: string;
  progress?: number;
  remarks?: string;
  checklistSnapshot?: ChecklistItem[];
  committeeReport?: {
    workDone?: string;
    materialQuality?: string;
    delayReason?: string;
    clauseReference?: string;
    recommendation?: string;
  } | null;
};

type Milestone = {
  _id: string;
  title: string;
  description?: string;
  plannedStartDate: string;
  plannedEndDate: string;
  actualStartDate?: string;
  actualEndDate?: string;
  status: "Not Started" | "In Progress" | "Completed" | "Delayed";
  progress: number;
  assignedTo?: string;
  checklist?: ChecklistItem[];
  remarks?: string;
  documents?: string[];
  images?: string[];
  verifiedBy?: { name?: string; role?: string };
  verifiedAt?: string;
  history?: HistoryEntry[];
};

type ProgressReport = {
  _id: string;
  milestoneId?: string;
  milestoneTitle?: string;
  completionDate?: string;
  description?: string;
  observations?: string;
  attachments?: string[];
  reportType: "Checklist" | "WorkProgress" | "General";
  createdAt: string;
  reportedBy?: { name?: string; role?: string };
};

type AiMilestoneReport = {
  _id: string;
  milestoneId: string;
  severity?: "low" | "medium" | "high";
  penaltyEstimate?: number;
  summary?: string;
  alerts?: string[];
  observations?: string[];
  checklistSummary?: string[];
  timeline?: {
    plannedStartDate?: string;
    plannedEndDate?: string;
    actualStartDate?: string;
    actualEndDate?: string;
    delayedDays?: number;
    status?: string;
  };
  committeeReport?: Record<string, unknown> | null;
  aiAssessment?: {
    clauseReferences?: string[];
    documentSignals?: string[];
    qualityNotes?: string[];
    penaltyReason?: string;
  } | null;
  generatedAt?: string;
};

type TenderRecord = {
  _id: string;
  title: string;
  status: "Draft" | "Published" | "Closed" | "Awarded" | "Completed";
};

type CommitteeMember = {
  _id: string;
  name: string;
  designation?: string;
  specialization?: string;
};

type ContractRecord = {
  _id: string;
  status: "Awarded" | "Signed" | "Completed" | "Cancelled";
  timelineDefined?: boolean;
  timelineStartDate?: string;
  timelineEndDate?: string;
  tenderId?: { _id?: string; title?: string; documents?: string[] };
  vendorId?: { name?: string; email?: string };
  milestones?: Milestone[];
  progressReports?: ProgressReport[];
};

type DelayAnalysis = {
  delayedMilestones: Array<{
    milestoneId: string;
    title: string;
    plannedEndDate: string;
    status: string;
    delayedDays: number;
  }>;
  totalDelayedMilestones: number;
  overallDelayedDays: number;
  contractDelayed: boolean;
  contractDelayDays: number;
};

type TimelineDraftMilestone = {
  title: string;
  description: string;
  plannedStartDate: string;
  plannedEndDate: string;
  assignedTo: string;
  checklistItems: string[];
};

type MilestoneUpdateForm = {
  status: Milestone["status"];
  progress: number;
  actualStartDate: string;
  actualEndDate: string;
  remarks: string;
  committeeReport: {
    workDone: string;
    materialQuality: string;
    delayReason: string;
    clauseReference: string;
    recommendation: string;
  };
  documents: string[];
  documentNames: string[];
  images: string[];
  imageNames: string[];
  checklist: ChecklistItem[];
};

const STATUS_STYLES: Record<Milestone["status"], { dot: string; badge: string; bar: string }> = {
  "Not Started": { dot: "bg-gray-200 border-gray-400",   badge: "bg-gray-100 text-gray-600",  bar: "bg-gray-400"  },
  "In Progress":  { dot: "bg-blue-100 border-blue-500",   badge: "bg-blue-100 text-blue-700",  bar: "bg-blue-500"  },
  "Completed":    { dot: "bg-green-100 border-green-500", badge: "bg-green-100 text-green-700", bar: "bg-green-500" },
  "Delayed":      { dot: "bg-red-100 border-red-500",     badge: "bg-red-100 text-red-700",    bar: "bg-red-500"   },
};

const emptyTimelineMilestone = (): TimelineDraftMilestone => ({
  title: "",
  description: "",
  plannedStartDate: "",
  plannedEndDate: "",
  assignedTo: "",
  checklistItems: [],
});

interface MilestoneTrackingProps {
  userRole?: UserRole;
}

export function MilestoneTracking({ userRole = "committee" }: MilestoneTrackingProps) {
  const [contracts, setContracts] = useState<ContractRecord[]>([]);
  const [tenders, setTenders] = useState<TenderRecord[]>([]);
  const [committeeMembers, setCommitteeMembers] = useState<CommitteeMember[]>([]);
  const [selectedContractId, setSelectedContractId] = useState("");
  const [selectedMilestoneId, setSelectedMilestoneId] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<"update" | "history">("update");
  const [delayAnalysis, setDelayAnalysis] = useState<DelayAnalysis | null>(null);
  const [aiReports, setAiReports] = useState<AiMilestoneReport[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [milestoneUpdate, setMilestoneUpdate] = useState<MilestoneUpdateForm>({
    status: "Not Started",
    progress: 0,
    actualStartDate: "",
    actualEndDate: "",
    remarks: "",
    committeeReport: {
      workDone: "",
      materialQuality: "",
      delayReason: "",
      clauseReference: "",
      recommendation: "",
    },
    documents: [],
    documentNames: [],
    images: [],
    imageNames: [],
    checklist: [],
  });

  const [pdfViewer, setPdfViewer] = useState<{ url: string; name: string } | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);

  // Contract search & filter
  const [contractSearch, setContractSearch] = useState("");
  const [contractStatusFilter, setContractStatusFilter] = useState("All");

  // Milestone search & filter
  const [milestoneSearch, setMilestoneSearch] = useState("");
  const [milestoneStatusFilter, setMilestoneStatusFilter] = useState("All");

  const canDefineTimeline = userRole === "po";
  const canUpdateMilestones = userRole === "committee" || userRole === "po";
  const canViewHistory = userRole === "po" || userRole === "cpo";
  const canChangeContractStatus = userRole === "po";

  const filteredContracts = useMemo(() => {
    return contracts.filter((c) => {
      const q = contractSearch.trim().toLowerCase();
      const matchSearch = !q ||
        (c.tenderId?.title || "").toLowerCase().includes(q) ||
        (c.vendorId?.name || "").toLowerCase().includes(q);
      const matchStatus = contractStatusFilter === "All" || c.status === contractStatusFilter;
      return matchSearch && matchStatus;
    });
  }, [contracts, contractSearch, contractStatusFilter]);

  const getCommitteeAssigneeLabel = (member: CommitteeMember) => {
    const designation = member.designation || member.specialization || "No designation";
    return `${member.name} - ${designation}`;
  };

  const getAssignedToDisplay = (assignedTo?: string) => {
    const rawValue = assignedTo?.trim();
    if (!rawValue) return "Not assigned";
    if (rawValue.includes("(") && rawValue.includes(")")) return rawValue;

    const matchedMember = committeeMembers.find(
      (member) => member.name.trim().toLowerCase() === rawValue.toLowerCase()
    );

    return matchedMember ? getCommitteeAssigneeLabel(matchedMember) : rawValue;
  };

  const loadContracts = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest<ContractRecord[]>("/api/contracts");
      setContracts(data || []);

      if (!selectedContractId && data?.length) {
        setSelectedContractId(data[0]._id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load contracts");
    } finally {
      setLoading(false);
    }
  };

  const loadDelayAnalysis = async (contractId: string) => {
    if (!contractId) {
      setDelayAnalysis(null);
      return;
    }

    try {
      const data = await apiRequest<DelayAnalysis>(`/api/contracts/${contractId}/delay-analysis`);
      setDelayAnalysis(data);
    } catch {
      setDelayAnalysis(null);
    }
  };

  const loadAiReports = async (contractId: string) => {
    if (!contractId) {
      setAiReports([]);
      return;
    }

    try {
      const data = await apiRequest<AiMilestoneReport[]>(`/api/ai/milestones/contracts/${contractId}`);
      setAiReports(Array.isArray(data) ? data : []);
    } catch {
      setAiReports([]);
    }
  };

  useEffect(() => {
    loadContracts();
  }, []);

  useEffect(() => {
    if (!selectedContractId) return;
    loadDelayAnalysis(selectedContractId);
    loadAiReports(selectedContractId);
  }, [selectedContractId]);

  const selectedContract = useMemo(
    () => contracts.find((contract) => contract._id === selectedContractId) || null,
    [contracts, selectedContractId]
  );

  const selectedMilestone = useMemo(
    () => selectedContract?.milestones?.find((milestone) => milestone._id === selectedMilestoneId) || null,
    [selectedContract, selectedMilestoneId]
  );

  const filteredMilestones = useMemo(() => {
    const milestones = selectedContract?.milestones || [];
    return milestones.filter((m) => {
      const q = milestoneSearch.trim().toLowerCase();
      const matchSearch = !q ||
        m.title.toLowerCase().includes(q) ||
        (m.assignedTo || "").toLowerCase().includes(q);
      const matchStatus = milestoneStatusFilter === "All" || m.status === milestoneStatusFilter;
      return matchSearch && matchStatus;
    });
  }, [selectedContract, milestoneSearch, milestoneStatusFilter]);

  // Contract matching the tender selected in the + panel


  useEffect(() => {
    if (!selectedContract) return;

    if (!selectedMilestoneId && selectedContract.milestones?.length) {
      setSelectedMilestoneId(selectedContract.milestones[0]._id);
    }
  }, [selectedContract, selectedMilestoneId]);

  useEffect(() => {
    if (!selectedMilestone) return;

    setMilestoneUpdate({
      status: selectedMilestone.status,
      progress: selectedMilestone.progress || 0,
      actualStartDate: selectedMilestone.actualStartDate ? selectedMilestone.actualStartDate.slice(0, 10) : "",
      actualEndDate: selectedMilestone.actualEndDate ? selectedMilestone.actualEndDate.slice(0, 10) : "",
      remarks: selectedMilestone.remarks || "",
      committeeReport: {
        workDone: "",
        materialQuality: "",
        delayReason: "",
        clauseReference: "",
        recommendation: "",
      },
      documents: selectedMilestone.documents || [],
      documentNames: (selectedMilestone.documents || []).map((document, index) =>
        getStoredDocumentName(document, `Document ${index + 1}`)
      ),
      images: selectedMilestone.images || [],
      imageNames: (selectedMilestone.images || []).map((image, index) =>
        getStoredDocumentName(image, `Image ${index + 1}`)
      ),
      checklist: selectedMilestone.checklist || [],
    });
  }, [selectedMilestone]);

  const selectedAiReport = useMemo(
    () => aiReports.find((report) => report.milestoneId === selectedMilestoneId) || aiReports[0] || null,
    [aiReports, selectedMilestoneId]
  );

  const summary = useMemo(() => {
    const milestones = selectedContract?.milestones || [];
    const total = milestones.length;
    const completed = milestones.filter((item) => item.status === "Completed").length;
    const delayed = milestones.filter((item) => item.status === "Delayed").length;
    const overallProgress = total
      ? Math.round(milestones.reduce((sum, item) => sum + (item.progress || 0), 0) / total)
      : 0;

    return { total, completed, delayed, overallProgress };
  }, [selectedContract]);



  const handleMilestoneFiles = async (kind: "documents" | "images", files: FileList | null) => {
    if (!files?.length) return;

    const oversizedFile = Array.from(files).find((file) => file.size > 10 * 1024 * 1024);
    if (oversizedFile) {
      setError(`${oversizedFile.name} exceeds the 10MB file size limit`);
      return;
    }

    try {
      setError("");
      const encodedFiles = await encodeFilesToStoredDocuments(files);
      const fileNames = Array.from(files).map((file) => file.name);

      setMilestoneUpdate((prev) =>
        kind === "documents"
          ? {
              ...prev,
              documents: [...prev.documents, ...encodedFiles],
              documentNames: [...prev.documentNames, ...fileNames],
            }
          : {
              ...prev,
              images: [...prev.images, ...encodedFiles],
              imageNames: [...prev.imageNames, ...fileNames],
            }
      );
    } catch {
      setError(`Failed to process selected ${kind}`);
    }
  };

  const removeMilestoneFile = (kind: "documents" | "images", index: number) => {
    setMilestoneUpdate((prev) =>
      kind === "documents"
        ? {
            ...prev,
            documents: prev.documents.filter((_, fileIndex) => fileIndex !== index),
            documentNames: prev.documentNames.filter((_, fileIndex) => fileIndex !== index),
          }
        : {
            ...prev,
            images: prev.images.filter((_, fileIndex) => fileIndex !== index),
            imageNames: prev.imageNames.filter((_, fileIndex) => fileIndex !== index),
          }
    );
  };

  const updateContractStatus = async (newStatus: "Completed" | "Cancelled") => {
    if (!selectedContractId) return;
    setError("");
    setSuccess("");
    setStatusUpdating(true);
    try {
      await apiRequest(`/api/contracts/${selectedContractId}/status`, {
        method: "PUT",
        body: { status: newStatus },
      });
      setSuccess(`Contract marked as ${newStatus}.`);
      await loadContracts();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to set contract ${newStatus}`);
    } finally {
      setStatusUpdating(false);
    }
  };



  const submitMilestoneUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContractId || !selectedMilestoneId) return;

    setError("");
    setSuccess("");

    try {
      await apiRequest(`/api/contracts/${selectedContractId}/milestones/${selectedMilestoneId}`, {
        method: "PUT",
        body: {
          status: milestoneUpdate.status,
          progress: Number(milestoneUpdate.progress),
          actualStartDate: milestoneUpdate.actualStartDate || undefined,
          actualEndDate: milestoneUpdate.actualEndDate || undefined,
          remarks: milestoneUpdate.remarks,
          committeeReport: milestoneUpdate.committeeReport,
          checklist: milestoneUpdate.checklist,
          documents: milestoneUpdate.documents,
          images: milestoneUpdate.images,
        },
      });

      setSuccess("Milestone updated successfully");
      setModalOpen(false);
      await loadContracts();
      await loadDelayAnalysis(selectedContractId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update milestone");
    }
  };

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role={userRole} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          role={userRole}
          userName={userRole === "po" ? "Rajesh Kumar" : userRole === "committee" ? "Anil Verma" : "Priya Sharma"}
        />
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl text-[#0B3C5D] mb-1">Milestone Tracking</h1>
            <p className="text-sm text-gray-600">Step 2 Governance: timeline control, committee verification, and delay detection</p>
          </div>

          <div className="bg-white rounded-lg border border-gray-100 p-4 mb-6">
            <label className="block text-sm text-gray-700 mb-3">Select Contract</label>
            <div className="flex flex-wrap gap-3 mb-3">
              <input
                type="text"
                value={contractSearch}
                onChange={(e) => setContractSearch(e.target.value)}
                placeholder="Search by tender or vendor…"
                className="flex-1 min-w-[180px] max-w-xs px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
              />
              <select
                value={contractStatusFilter}
                onChange={(e) => setContractStatusFilter(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
              >
                <option value="All">All Statuses</option>
                <option value="Awarded">Awarded</option>
                <option value="Signed">Signed</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
              {(contractSearch || contractStatusFilter !== "All") && (
                <button
                  onClick={() => { setContractSearch(""); setContractStatusFilter("All"); }}
                  className="text-xs text-gray-500 hover:text-gray-700 underline self-center"
                >
                  Clear
                </button>
              )}
              <span className="text-xs text-gray-400 self-center">
                {filteredContracts.length} of {contracts.length}
              </span>
            </div>
            <select
              value={selectedContractId}
              onChange={(e) => {
                setSelectedContractId(e.target.value);
                setSelectedMilestoneId("");
                setMilestoneSearch("");
                setMilestoneStatusFilter("All");
              }}
              className="w-full md:w-[480px] px-3 py-2 border border-gray-300 rounded-md bg-white"
            >
              <option value="">Choose a contract</option>
              {filteredContracts.map((contract) => (
                <option key={contract._id} value={contract._id}>
                  {(contract.tenderId?.title || "Untitled Tender") + " - " + (contract.vendorId?.name || "Vendor") + " (" + contract.status + ")"}
                </option>
              ))}
            </select>
            {loading && <p className="text-sm text-gray-600 mt-3">Loading contracts...</p>}
          </div>

          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
          {success && <p className="text-sm text-green-700 mb-4">{success}</p>}

          {selectedContract && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-white rounded-lg border border-gray-100 p-4">
                  <p className="text-sm text-gray-600">Contract Status</p>
                  <p className={`text-2xl mb-3 ${selectedContract.status === "Cancelled" ? "text-red-600" : selectedContract.status === "Completed" ? "text-green-700" : "text-[#0B3C5D]"}`}>
                    {selectedContract.status}
                  </p>
                  {canChangeContractStatus && selectedContract.status !== "Completed" && selectedContract.status !== "Cancelled" && (
                    <div className="flex flex-col gap-2">
                      {summary.total > 0 && summary.completed === summary.total && (
                        <button
                          type="button"
                          disabled={statusUpdating}
                          onClick={() => updateContractStatus("Completed")}
                          className="w-full px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-colors disabled:opacity-50"
                        >
                          {statusUpdating ? "Updating…" : "Mark Complete"}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={statusUpdating}
                        onClick={() => {
                          if (window.confirm("Cancel this contract? This cannot be undone.")) {
                            updateContractStatus("Cancelled");
                          }
                        }}
                        className="w-full px-3 py-1.5 rounded bg-red-100 hover:bg-red-200 text-red-700 text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        Cancel Contract
                      </button>
                    </div>
                  )}
                </div>
                <div className="bg-white rounded-lg border border-gray-100 p-4">
                  <p className="text-sm text-gray-600">Total Milestones</p>
                  <p className="text-2xl text-[#0B3C5D]">{summary.total}</p>
                </div>
                <div className="bg-white rounded-lg border border-gray-100 p-4">
                  <p className="text-sm text-gray-600">Completed</p>
                  <p className="text-2xl text-green-700">{summary.completed}</p>
                </div>
                <div className="bg-white rounded-lg border border-gray-100 p-4">
                  <p className="text-sm text-gray-600">Overall Progress</p>
                  <p className="text-2xl text-[#1D4E89]">{summary.overallProgress}%</p>
                </div>
              </div>

              {selectedContract.timelineDefined && (
                <>
                  <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                      <h3 className="text-lg font-semibold text-[#0B3C5D]">Project Timeline</h3>
                      <div className="flex flex-wrap items-center gap-3">
                        <input
                          type="text"
                          value={milestoneSearch}
                          onChange={(e) => setMilestoneSearch(e.target.value)}
                          placeholder="Search milestone or assignee…"
                          className="min-w-[170px] max-w-xs px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
                        />
                        <select
                          value={milestoneStatusFilter}
                          onChange={(e) => setMilestoneStatusFilter(e.target.value)}
                          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
                        >
                          <option value="All">All Statuses</option>
                          <option value="Not Started">Not Started</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Completed">Completed</option>
                          <option value="Delayed">Delayed</option>
                        </select>
                        {(milestoneSearch || milestoneStatusFilter !== "All") && (
                          <button
                            onClick={() => { setMilestoneSearch(""); setMilestoneStatusFilter("All"); }}
                            className="text-xs text-gray-500 hover:text-gray-700 underline"
                          >
                            Clear
                          </button>
                        )}
                        <span className="text-xs text-gray-400">
                          {filteredMilestones.length} of {(selectedContract.milestones || []).length}
                        </span>
                      </div>
                    </div>
                    {!selectedContract.milestones?.length && (
                      <p className="text-sm text-gray-500 text-center py-8">No milestones defined for this contract.</p>
                    )}
                    {!!selectedContract.milestones?.length && filteredMilestones.length === 0 && (
                      <p className="text-sm text-gray-400 text-center py-8">No milestones match your search.</p>
                    )}
                    <div className="relative">
                      <div className="absolute left-5 top-5 bottom-0 w-px bg-gray-200" />
                      <div className="space-y-4">
                        {filteredMilestones.map((milestone, index) => {
                          const styles = STATUS_STYLES[milestone.status];
                          return (
                            <div key={milestone._id} className="relative flex gap-4">
                              <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 border-2 ${styles.dot} shadow-sm bg-white`}>
                                {milestone.status === "Completed"
                                  ? <span className="text-green-600 text-base leading-none">✓</span>
                                  : milestone.status === "Delayed"
                                  ? <span className="text-red-500 text-base font-bold leading-none">!</span>
                                  : <span className="text-xs font-bold text-gray-500">{index + 1}</span>
                                }
                              </div>
                              <button
                                onClick={() => {
                                  setSelectedMilestoneId(milestone._id);
                                  if (canUpdateMilestones) {
                                    setModalTab("update");
                                    setModalOpen(true);
                                  } else if (canViewHistory) {
                                    setModalTab("history");
                                    setModalOpen(true);
                                  }
                                }}
                                className="flex-1 text-left bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md hover:border-[#1D4E89]/50 transition-all group mb-4"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-[#0B3C5D] group-hover:text-[#1D4E89] truncate">{milestone.title}</p>
                                    {milestone.description && (
                                      <p className="text-xs text-gray-400 mt-0.5 truncate">{milestone.description}</p>
                                    )}
                                    <p className="text-xs text-gray-400 mt-1">
                                      {formatDate(milestone.plannedStartDate)} → {formatDate(milestone.plannedEndDate)}
                                    </p>
                                    <p className="text-xs text-gray-500 mt-1">
                                      Assigned: {getAssignedToDisplay(milestone.assignedTo)}
                                    </p>
                                  </div>
                                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${styles.badge}`}>
                                      {milestone.status}
                                    </span>
                                    <span className="text-xs text-gray-500 font-medium">{milestone.progress}%</span>
                                  </div>
                                </div>
                                <div className="mt-3">
                                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                    <div className={`h-full rounded-full transition-all ${styles.bar}`} style={{ width: `${milestone.progress}%` }} />
                                  </div>
                                </div>
                                {canUpdateMilestones && (
                                  <p className="text-xs text-[#1D4E89]/40 mt-2 group-hover:text-[#1D4E89] transition-colors">Click to update →</p>
                                )}
                                {!canUpdateMilestones && canViewHistory && (
                                  <p className="text-xs text-gray-300 mt-2 group-hover:text-gray-500 transition-colors">Click to view activity →</p>
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {modalOpen && selectedMilestone && (canUpdateMilestones || canViewHistory) && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                        {/* Sticky header */}
                        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10 flex-shrink-0">
                          <div>
                            <h3 className="text-base font-semibold text-[#0B3C5D]">{selectedMilestone.title}</h3>
                            <p className="text-xs text-gray-500 mt-0.5">Planned: {formatDate(selectedMilestone.plannedStartDate)} → {formatDate(selectedMilestone.plannedEndDate)}</p>
                          </div>
                          <button type="button" onClick={() => setModalOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm transition-colors">✕</button>
                        </div>

                        {/* Tabs */}
                        {canUpdateMilestones && (
                          <div className="flex gap-0 border-b border-gray-100 flex-shrink-0">
                            <button
                              type="button"
                              onClick={() => setModalTab("update")}
                              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${modalTab === "update" ? "border-[#1D4E89] text-[#1D4E89]" : "border-transparent text-gray-500 hover:text-gray-700"}`}
                            >
                              Update
                            </button>
                            <button
                              type="button"
                              onClick={() => setModalTab("history")}
                              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${modalTab === "history" ? "border-[#1D4E89] text-[#1D4E89]" : "border-transparent text-gray-500 hover:text-gray-700"}`}
                            >
                              Activity Log
                              {(selectedMilestone.history?.length ?? 0) > 0 && (
                                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-blue-100 text-[#1D4E89] text-xs">{selectedMilestone.history!.length}</span>
                              )}
                            </button>
                          </div>
                        )}
                        {!canUpdateMilestones && canViewHistory && (
                          <div className="px-6 pt-4 pb-1 flex-shrink-0">
                            <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Activity Log — committee accountability record</p>
                          </div>
                        )}

                        {/* Scrollable content */}
                        <div className="overflow-y-auto flex-1">
                          {/* Update form tab */}
                          {canUpdateMilestones && modalTab === "update" && (
                            <form onSubmit={submitMilestoneUpdate} className="p-6 space-y-5">
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="p-3 rounded-md bg-gray-50 border border-gray-100">
                              <p className="text-gray-500">Assigned To</p>
                              <p className="text-[#0B3C5D] mt-1">{getAssignedToDisplay(selectedMilestone.assignedTo)}</p>
                            </div>
                            <div className="p-3 rounded-md bg-gray-50 border border-gray-100">
                              <p className="text-gray-500">Planned Window</p>
                              <p className="text-[#0B3C5D] mt-1">
                                {formatDate(selectedMilestone.plannedStartDate)} to {formatDate(selectedMilestone.plannedEndDate)}
                              </p>
                            </div>
                            <div className="p-3 rounded-md bg-gray-50 border border-gray-100">
                              <p className="text-gray-500">Latest Verification</p>
                              <p className="text-[#0B3C5D] mt-1">
                                {selectedMilestone.verifiedBy?.name || "Not verified"}
                              </p>
                            </div>
                            <div className="p-3 rounded-md bg-gray-50 border border-gray-100">
                              <p className="text-gray-500">Verified On</p>
                              <p className="text-[#0B3C5D] mt-1">{formatDate(selectedMilestone.verifiedAt)}</p>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm text-gray-700 mb-2">Status</label>
                              <select
                                value={milestoneUpdate.status}
                                onChange={(e) =>
                                  setMilestoneUpdate((prev) => ({ ...prev, status: e.target.value as Milestone["status"] }))
                                }
                                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                              >
                                <option value="Not Started">Not Started</option>
                                <option value="In Progress">In Progress</option>
                                <option value="Completed">Completed</option>
                                <option value="Delayed">Delayed</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-sm text-gray-700 mb-2">Progress (%)</label>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={milestoneUpdate.progress}
                                onChange={(e) =>
                                  setMilestoneUpdate((prev) => ({ ...prev, progress: Number(e.target.value || 0) }))
                                }
                                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm text-gray-700 mb-2">Actual Start Date</label>
                              <input
                                type="date"
                                value={milestoneUpdate.actualStartDate}
                                onChange={(e) => setMilestoneUpdate((prev) => ({ ...prev, actualStartDate: e.target.value }))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                              />
                            </div>
                            <div>
                              <label className="block text-sm text-gray-700 mb-2">Actual End Date</label>
                              <input
                                type="date"
                                value={milestoneUpdate.actualEndDate}
                                onChange={(e) => setMilestoneUpdate((prev) => ({ ...prev, actualEndDate: e.target.value }))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                              />
                            </div>
                          </div>

                          <div>
                            <p className="text-sm text-gray-700 mb-2">Checklist Confirmation</p>
                            {milestoneUpdate.checklist.length === 0 ? (
                              <p className="text-sm text-gray-400 italic">No checklist items defined for this milestone.</p>
                            ) : (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {milestoneUpdate.checklist.map((item, idx) => (
                                  <label key={idx} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={item.checked}
                                      onChange={(e) =>
                                        setMilestoneUpdate((prev) => ({
                                          ...prev,
                                          checklist: prev.checklist.map((ci, i) =>
                                            i === idx ? { ...ci, checked: e.target.checked } : ci
                                          ),
                                        }))
                                      }
                                      className="w-4 h-4 accent-[#1D4E89]"
                                    />
                                    {item.label}
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>

                          <textarea
                            value={milestoneUpdate.remarks}
                            onChange={(e) => setMilestoneUpdate((prev) => ({ ...prev, remarks: e.target.value }))}
                            placeholder="Committee comments, observations, or verification remarks"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                            rows={3}
                          />

                          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                            <div>
                              <p className="text-sm font-semibold text-amber-900">Committee report JSON</p>
                              <p className="text-xs text-amber-800">Add the inspection details that the AI should compare against the tender and contract clauses.</p>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs text-amber-900 mb-1">Work done</label>
                                <textarea
                                  value={milestoneUpdate.committeeReport.workDone}
                                  onChange={(e) =>
                                    setMilestoneUpdate((prev) => ({
                                      ...prev,
                                      committeeReport: { ...prev.committeeReport, workDone: e.target.value },
                                    }))
                                  }
                                  className="w-full px-3 py-2 border border-amber-200 rounded-md bg-white"
                                  rows={3}
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-amber-900 mb-1">Material quality</label>
                                <textarea
                                  value={milestoneUpdate.committeeReport.materialQuality}
                                  onChange={(e) =>
                                    setMilestoneUpdate((prev) => ({
                                      ...prev,
                                      committeeReport: { ...prev.committeeReport, materialQuality: e.target.value },
                                    }))
                                  }
                                  className="w-full px-3 py-2 border border-amber-200 rounded-md bg-white"
                                  rows={3}
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-amber-900 mb-1">Delay reason</label>
                                <input
                                  type="text"
                                  value={milestoneUpdate.committeeReport.delayReason}
                                  onChange={(e) =>
                                    setMilestoneUpdate((prev) => ({
                                      ...prev,
                                      committeeReport: { ...prev.committeeReport, delayReason: e.target.value },
                                    }))
                                  }
                                  className="w-full px-3 py-2 border border-amber-200 rounded-md bg-white"
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-amber-900 mb-1">Clause reference</label>
                                <input
                                  type="text"
                                  value={milestoneUpdate.committeeReport.clauseReference}
                                  onChange={(e) =>
                                    setMilestoneUpdate((prev) => ({
                                      ...prev,
                                      committeeReport: { ...prev.committeeReport, clauseReference: e.target.value },
                                    }))
                                  }
                                  className="w-full px-3 py-2 border border-amber-200 rounded-md bg-white"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-xs text-amber-900 mb-1">Recommendation</label>
                              <textarea
                                value={milestoneUpdate.committeeReport.recommendation}
                                onChange={(e) =>
                                  setMilestoneUpdate((prev) => ({
                                    ...prev,
                                    committeeReport: { ...prev.committeeReport, recommendation: e.target.value },
                                  }))
                                }
                                className="w-full px-3 py-2 border border-amber-200 rounded-md bg-white"
                                rows={3}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm text-gray-700 mb-2">Milestone Documents</label>
                              <label className="block border border-dashed border-gray-300 rounded-md p-4 text-center cursor-pointer hover:border-[#1D4E89] transition-colors">
                                <span className="text-sm text-gray-600">Upload reports, certificates, or signed checklists</span>
                                <input
                                  type="file"
                                  className="hidden"
                                  accept=".pdf,.doc,.docx,.xls,.xlsx"
                                  multiple
                                  onChange={(e) => handleMilestoneFiles("documents", e.target.files)}
                                />
                              </label>
                              <UploadedFileList
                                names={milestoneUpdate.documentNames}
                                onRemove={(index) => removeMilestoneFile("documents", index)}
                              />
                            </div>

                            <div>
                              <label className="block text-sm text-gray-700 mb-2">Evidence Images</label>
                              <label className="block border border-dashed border-gray-300 rounded-md p-4 text-center cursor-pointer hover:border-[#1D4E89] transition-colors">
                                <span className="text-sm text-gray-600">Upload site photos or visual evidence</span>
                                <input
                                  type="file"
                                  className="hidden"
                                  accept="image/*"
                                  multiple
                                  onChange={(e) => handleMilestoneFiles("images", e.target.files)}
                                />
                              </label>
                              <UploadedFileList
                                names={milestoneUpdate.imageNames}
                                onRemove={(index) => removeMilestoneFile("images", index)}
                              />
                            </div>
                          </div>

                              <div className="flex gap-3 pt-4 border-t border-gray-100 mt-2">
                                <button type="submit" className="flex-1 px-5 py-2.5 rounded-lg bg-[#1D4E89] text-white text-sm font-medium hover:bg-[#154068] transition-colors">
                                  Save Milestone Update
                                </button>
                                <button type="button" onClick={() => setModalOpen(false)} className="px-5 py-2.5 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50 transition-colors">
                                  Cancel
                                </button>
                              </div>
                            </form>
                          )}

                          {/* Activity log tab */}
                          {(modalTab === "history" || !canUpdateMilestones) && (
                            <MilestoneActivityLog history={selectedMilestone.history} />
                          )}
                        </div>
                      </div>
                    </div>
                  )}


                </>
              )}

              <div className="bg-white rounded-lg border border-gray-100 p-6">
                <h3 className="text-lg text-[#0B3C5D] mb-4">Delay Identification</h3>
                {!delayAnalysis && <p className="text-sm text-gray-600">Delay analysis unavailable.</p>}
                {delayAnalysis && (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-700">
                      Delayed Milestones: <span className="font-semibold">{delayAnalysis.totalDelayedMilestones}</span>
                    </p>
                    <p className="text-sm text-gray-700">
                      Accumulated Delay Days: <span className="font-semibold">{delayAnalysis.overallDelayedDays}</span>
                    </p>
                    {delayAnalysis.contractDelayed && (
                      <p className="text-sm text-red-700">
                        Contract is behind planned timeline by {delayAnalysis.contractDelayDays} day(s).
                      </p>
                    )}
                    {!!delayAnalysis.delayedMilestones.length && (
                      <div className="space-y-2">
                        {delayAnalysis.delayedMilestones.map((item) => (
                          <div key={item.milestoneId} className="p-3 border border-red-200 bg-red-50 rounded-md">
                            <p className="text-sm text-red-800">{item.title}</p>
                            <p className="text-xs text-red-700">
                              Planned end: {formatDate(item.plannedEndDate)} | Delay: {item.delayedDays} day(s)
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {selectedAiReport && (
                <div className="bg-white rounded-lg border border-gray-100 p-6">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <h3 className="text-lg text-[#0B3C5D]">Latest AI Milestone Review</h3>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      selectedAiReport.severity === "high"
                        ? "bg-red-100 text-red-700"
                        : selectedAiReport.severity === "medium"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-green-100 text-green-700"
                    }`}>
                      {selectedAiReport.severity || "low"}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm mb-4">
                    <div className="bg-gray-50 rounded-md p-3">
                      <p className="text-gray-500">Penalty estimate</p>
                      <p className="text-[#0B3C5D] mt-1 font-medium">
                        {selectedAiReport.penaltyEstimate !== undefined && selectedAiReport.penaltyEstimate !== null
                          ? `₹${Number(selectedAiReport.penaltyEstimate).toLocaleString()}`
                          : "Not calculated"}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-md p-3">
                      <p className="text-gray-500">Delay days</p>
                      <p className="text-[#0B3C5D] mt-1 font-medium">
                        {selectedAiReport.timeline?.delayedDays ?? 0}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded-md p-3">
                      <p className="text-gray-500">AI status</p>
                      <p className="text-[#0B3C5D] mt-1 font-medium">
                        {selectedAiReport.timeline?.status || "Reviewed"}
                      </p>
                    </div>
                  </div>
                  {selectedAiReport.summary && <p className="text-sm text-gray-700 mb-3">{selectedAiReport.summary}</p>}
                  {!!selectedAiReport.alerts?.length && (
                    <div className="mb-4">
                      <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Alerts</p>
                      <ul className="space-y-1">
                        {selectedAiReport.alerts.map((alert, index) => (
                          <li key={index} className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                            {alert}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {!!selectedAiReport.aiAssessment?.clauseReferences?.length && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                      <div className="bg-gray-50 rounded-md p-3">
                        <p className="text-gray-500 mb-2">Clause references</p>
                        <div className="flex flex-wrap gap-2">
                          {selectedAiReport.aiAssessment.clauseReferences.map((item, index) => (
                            <span key={index} className="px-2 py-1 rounded-full bg-white border border-gray-200 text-gray-700 text-xs">
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="bg-gray-50 rounded-md p-3">
                        <p className="text-gray-500 mb-2">Quality notes</p>
                        <div className="space-y-1">
                          {(selectedAiReport.aiAssessment.qualityNotes || []).map((item, index) => (
                            <p key={index} className="text-gray-700 text-xs">{item}</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <AIAssistant role={userRole} />

      {/* PDF Viewer Modal */}
      {pdfViewer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setPdfViewer(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col" style={{ height: "90vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 flex-shrink-0">
              <p className="text-sm font-medium text-[#0B3C5D] truncate max-w-[80%]">{pdfViewer.name}</p>
              <button onClick={() => setPdfViewer(null)} className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors">✕</button>
            </div>
            <div className="flex-1 overflow-hidden rounded-b-2xl">
              <iframe src={pdfViewer.url} className="w-full h-full border-0" title={pdfViewer.name} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UploadedFileList({ names, onRemove }: { names: string[]; onRemove: (index: number) => void }) {
  if (!names.length) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {names.map((name, index) => (
        <button
          key={`${name}-${index}`}
          type="button"
          onClick={() => onRemove(index)}
          className="px-3 py-1 rounded-full bg-blue-50 text-[#1D4E89] text-xs border border-blue-100"
        >
          {name} ×
        </button>
      ))}
    </div>
  );
}

function StoredDocumentLinks({ documents, emptyLabel, onView }: { documents?: string[]; emptyLabel: string; onView?: (url: string, name: string) => void }) {
  if (!documents?.length) {
    return <p className="text-sm text-gray-500">{emptyLabel}</p>;
  }

  return (
    <div className="mt-3 flex flex-wrap gap-3">
      {documents.map((document, index) => {
        const name = getStoredDocumentName(document, `Document ${index + 1}`);
        const url = getStoredDocumentUrl(document);

        if (!url) return <span key={`${name}-${index}`} className="text-sm text-gray-700">{name}</span>;

        return onView ? (
          <button
            key={`${name}-${index}`}
            type="button"
            onClick={() => onView(url, name)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-100 text-[#1D4E89] text-xs font-medium hover:bg-blue-100 transition-colors"
          >
            <span>📄</span> {name}
          </button>
        ) : (
          <a key={`${name}-${index}`} href={url} target="_blank" rel="noreferrer" className="text-sm text-[#1D4E89] hover:underline">
            {name}
          </a>
        );
      })}
    </div>
  );
}

function formatDate(value?: string): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString();
}

function formatDateTime(value?: string): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function MilestoneActivityLog({ history }: { history?: HistoryEntry[] }) {
  const entries = [...(history || [])].reverse(); // most recent first

  if (!entries.length) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-gray-400">No activity recorded yet for this milestone.</p>
        <p className="text-xs text-gray-300 mt-1">Updates made by committee members will appear here.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {entries.map((entry, idx) => {
        const checkedCount = (entry.checklistSnapshot || []).filter((ci) => ci.checked).length;
        const totalCount = (entry.checklistSnapshot || []).length;
        return (
          <div key={idx} className="border border-gray-100 rounded-xl p-4 bg-gray-50">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-sm font-medium text-[#0B3C5D]">
                  {entry.updatedBy?.name || "Unknown user"}
                  <span className="ml-2 text-xs font-normal text-gray-400 bg-white border border-gray-200 px-1.5 py-0.5 rounded-full">
                    {entry.updatedBy?.role || "—"}
                  </span>
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(entry.updatedAt)}</p>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                {entry.status && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-600">
                    {entry.status}
                  </span>
                )}
                {entry.progress !== undefined && (
                  <span className="text-xs text-gray-500">{entry.progress}% progress</span>
                )}
              </div>
            </div>

            {totalCount > 0 && (
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <p className="text-xs text-gray-500">Checklist at this update</p>
                  <span className="text-xs text-gray-400">{checkedCount}/{totalCount} ticked</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(entry.checklistSnapshot || []).map((ci, ci_idx) => (
                    <span
                      key={ci_idx}
                      className={`text-xs px-2 py-0.5 rounded-full border ${ci.checked ? "bg-green-50 border-green-200 text-green-700" : "bg-white border-gray-200 text-gray-400 line-through"}`}
                    >
                      {ci.label}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {entry.remarks && (
              <p className="text-xs text-gray-600 italic border-t border-gray-100 pt-2 mt-1">"{entry.remarks}"</p>
            )}

            {entry.committeeReport && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                {entry.committeeReport.workDone && (
                  <div className="bg-white border border-gray-200 rounded-md p-2">
                    <p className="text-gray-400">Work done</p>
                    <p className="text-gray-700 mt-1">{entry.committeeReport.workDone}</p>
                  </div>
                )}
                {entry.committeeReport.materialQuality && (
                  <div className="bg-white border border-gray-200 rounded-md p-2">
                    <p className="text-gray-400">Material quality</p>
                    <p className="text-gray-700 mt-1">{entry.committeeReport.materialQuality}</p>
                  </div>
                )}
                {entry.committeeReport.delayReason && (
                  <div className="bg-white border border-gray-200 rounded-md p-2">
                    <p className="text-gray-400">Delay reason</p>
                    <p className="text-gray-700 mt-1">{entry.committeeReport.delayReason}</p>
                  </div>
                )}
                {entry.committeeReport.recommendation && (
                  <div className="bg-white border border-gray-200 rounded-md p-2 md:col-span-2">
                    <p className="text-gray-400">Recommendation</p>
                    <p className="text-gray-700 mt-1">{entry.committeeReport.recommendation}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
