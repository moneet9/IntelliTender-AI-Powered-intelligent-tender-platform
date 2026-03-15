import { useState } from "react";
import { Sidebar } from "../layout/Sidebar";
import { Header } from "../layout/Header";
import { AIAssistant } from "../AIAssistant";
import { Upload, AlertCircle, FileText, Lock, LockOpen } from "lucide-react";
import { useNavigate } from "react-router";
import { apiRequest } from "../../api";
import { encodeFilesToStoredDocuments } from "../../document-utils";

type WeightKey = "price" | "quality" | "experience" | "timeline";

const weightKeys: WeightKey[] = ["price", "quality", "experience", "timeline"];
const maxIndividualDocumentSizeBytes = 10 * 1024 * 1024;
const maxCombinedDocumentSizeBytes = 35 * 1024 * 1024;

export function TenderCreation() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    title: "",
    category: "supply",
    description: "",
    budget: "",
    deadline: "",
  });
  const [documents, setDocuments] = useState<string[]>([]);
  const [documentNames, setDocumentNames] = useState<string[]>([]);

  const [weights, setWeights] = useState<Record<WeightKey, number>>({
    price: 40,
    quality: 25,
    experience: 20,
    timeline: 15,
  });
  const [frozenWeights, setFrozenWeights] = useState<Record<WeightKey, boolean>>({
    price: false,
    quality: false,
    experience: false,
    timeline: false,
  });
  const [weightError, setWeightError] = useState("");

  const totalWeight = Object.values(weights).reduce((sum, val) => sum + val, 0);
  const isWeightValid = totalWeight === 100;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const categoryLabelMap: Record<string, string> = {
    supply: "Supply",
    work: "Work",
    service: "Service",
    general: "General",
  };

  const handleWeightChange = (key: WeightKey, value: number) => {
    if (frozenWeights[key]) {
      setWeightError(`${key} is frozen. Unfreeze it to change this value.`);
      return;
    }

    const requestedValue = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : weights[key];
    const immutableTotal = weightKeys
      .filter((weightKey) => weightKey !== key && frozenWeights[weightKey])
      .reduce((sum, weightKey) => sum + weights[weightKey], 0);

    const adjustableKeys = weightKeys.filter((weightKey) => weightKey !== key && !frozenWeights[weightKey]);
    const maxAllowed = Math.max(0, 100 - immutableTotal);
    const clampedValue = Math.max(0, Math.min(maxAllowed, requestedValue));
    const distributable = 100 - immutableTotal - clampedValue;

    if (adjustableKeys.length === 0 && clampedValue !== weights[key]) {
      setWeightError(`Cannot change ${key} while all other criteria are frozen. This would break the 100% total.`);
      return;
    }

    const nextWeights: Record<WeightKey, number> = { ...weights, [key]: clampedValue };

    if (adjustableKeys.length > 0) {
      const totalAdjustableWeight = adjustableKeys.reduce((sum, weightKey) => sum + weights[weightKey], 0);

      const provisional = adjustableKeys.map((weightKey) => {
        const rawShare =
          totalAdjustableWeight > 0
            ? (weights[weightKey] / totalAdjustableWeight) * distributable
            : distributable / adjustableKeys.length;

        return {
          key: weightKey,
          floor: Math.floor(rawShare),
          fraction: rawShare - Math.floor(rawShare),
        };
      });

      let remaining = distributable - provisional.reduce((sum, item) => sum + item.floor, 0);

      provisional
        .slice()
        .sort((a, b) => b.fraction - a.fraction)
        .forEach((item) => {
          const bonus = remaining > 0 ? 1 : 0;
          nextWeights[item.key] = item.floor + bonus;
          if (remaining > 0) remaining -= 1;
        });
    }

    setWeightError("");
    setWeights(nextWeights);
  };

  const toggleFreeze = (key: WeightKey) => {
    setWeightError("");
    setFrozenWeights((previous) => ({
      ...previous,
      [key]: !previous[key],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isWeightValid) return;

    setError("");
    setLoading(true);
    try {
      await apiRequest("/api/tenders", {
        method: "POST",
        body: {
          title: formData.title,
          description: formData.description,
          category: categoryLabelMap[formData.category] || "General",
          budget: Number(formData.budget),
          deadline: formData.deadline,
          documents,
        },
      });
      navigate("/po");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish tender");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="po" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="po" userName="Rajesh Kumar" />
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl text-[#0B3C5D] mb-1">Publish Tender</h1>
            <p className="text-sm text-gray-600">Define tender specifications and publish it immediately</p>
          </div>

          <form onSubmit={handleSubmit} className="max-w-4xl">
            {/* Basic Information */}
            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100 mb-6">
              <h3 className="text-lg text-[#0B3C5D] mb-4">Basic Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm text-gray-700 mb-2">Tender Title</label>
                  <input
                    type="text"
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89] bg-white"
                    placeholder="e.g., IT Infrastructure Upgrade Phase 2"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm text-gray-700 mb-2">Category</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89] bg-white"
                    required
                  >
                    <option value="supply">Supply</option>
                    <option value="work">Work</option>
                    <option value="service">Service</option>
                    <option value="general">General</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-gray-700 mb-2">Budget (₹)</label>
                  <input
                    type="number"
                    value={formData.budget}
                    onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89] bg-white"
                    placeholder="e.g., 500000"
                    required
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm text-gray-700 mb-2">Tender Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89] bg-white"
                    placeholder="Scope of work, mandatory requirements, and deliverables"
                    rows={4}
                    required
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm text-gray-700 mb-2">Submission Deadline (Date & Time)</label>
                  <input
                    type="datetime-local"
                    value={formData.deadline}
                    onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89] bg-white"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Document Upload */}
            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100 mb-6">
              <h3 className="text-lg text-[#0B3C5D] mb-4">Tender Documents</h3>
              <label className="block border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-[#1D4E89] transition-colors cursor-pointer">
                <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                <p className="text-sm text-gray-600 mb-1">Upload bid documents, specifications, or compliance sheets</p>
                <p className="text-xs text-gray-500">PDF, DOC, DOCX (Max 10MB)</p>
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx"
                  multiple
                  onChange={async (e) => {
                    const files = e.target.files;
                    if (!files?.length) return;

                    const selectedFiles = Array.from(files);

                    const oversizedFile = selectedFiles.find((file) => file.size > maxIndividualDocumentSizeBytes);
                    if (oversizedFile) {
                      setError(`${oversizedFile.name} exceeds the 10MB limit`);
                      return;
                    }

                    const totalSelectedSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
                    if (totalSelectedSize > maxCombinedDocumentSizeBytes) {
                      setError("Combined file size is too large. Keep total uploads under 35MB.");
                      return;
                    }

                    try {
                      setError("");
                      const encodedDocuments = await encodeFilesToStoredDocuments(files);
                      setDocuments(encodedDocuments);
                      setDocumentNames(selectedFiles.map((file) => file.name));
                    } catch {
                      setError("Failed to process uploaded tender documents");
                    }
                  }}
                />
              </label>
              {!!documentNames.length && (
                <div className="mt-4 space-y-2">
                  {documentNames.map((name) => (
                    <div key={name} className="flex items-center gap-2 text-sm text-gray-700">
                      <FileText className="w-4 h-4 text-[#1D4E89]" />
                      <span>{name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Evaluation Weights */}
            <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg text-[#0B3C5D]">Evaluation Weights</h3>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Total:</span>
                  <span
                    className={`px-3 py-1 rounded-md text-sm ${
                      isWeightValid ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                    }`}
                  >
                    {totalWeight}%
                  </span>
                </div>
              </div>

              {!isWeightValid && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600" />
                  <p className="text-sm text-red-700">Total weight must equal 100%</p>
                </div>
              )}

              {!!weightError && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-md flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-700" />
                  <p className="text-sm text-amber-800">{weightError}</p>
                </div>
              )}

              <p className="text-xs text-gray-500 mb-4">
                Freeze any criterion to lock its value. Frozen criteria never change when you adjust other weights.
              </p>

              <div className="space-y-4">
                {(Object.entries(weights) as Array<[WeightKey, number]>).map(([key, value]) => {
                  const isFrozen = frozenWeights[key];

                  return (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-700 capitalize">{key}</label>
                        {isFrozen && <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">Frozen</span>}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-[#0B3C5D]">{value}%</span>
                        <button
                          type="button"
                          onClick={() => toggleFreeze(key)}
                          className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border transition-colors ${
                            isFrozen
                              ? "bg-slate-800 text-white border-slate-800 hover:bg-slate-700"
                              : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          {isFrozen ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
                          {isFrozen ? "Unfreeze" : "Freeze"}
                        </button>
                      </div>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={value}
                      onChange={(e) => handleWeightChange(key, parseInt(e.target.value))}
                      disabled={isFrozen}
                      className={`w-full h-2 bg-gray-200 rounded-lg appearance-none accent-[#1D4E89] ${
                        isFrozen ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                      }`}
                    />
                  </div>
                  );
                })}
              </div>
            </div>

            {/* Submit Buttons */}
            <div className="flex items-center gap-4">
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={!isWeightValid || loading}
                className={`px-6 py-3 rounded-md transition-colors ${
                  isWeightValid && !loading
                    ? "bg-[#1D4E89] hover:bg-[#154068] text-white"
                    : "bg-gray-300 text-gray-500 cursor-not-allowed"
                }`}
              >
                {loading ? "Publishing..." : "Publish Tender"}
              </button>
              <button
                type="button"
                onClick={() => navigate("/po")}
                className="px-6 py-3 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
      <AIAssistant role="po" />
    </div>
  );
}