import { useState } from "react";
import { Sidebar } from "../layout/Sidebar";
import { Header } from "../layout/Header";
import { AIAssistant } from "../AIAssistant";
import { Upload, Plus, X, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router";
import { apiRequest } from "../../api";

export function TenderCreation() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    title: "",
    category: "supply",
    budget: "",
    deadline: "",
  });

  const [weights, setWeights] = useState({
    price: 40,
    quality: 25,
    experience: 20,
    timeline: 15,
  });

  const totalWeight = Object.values(weights).reduce((sum, val) => sum + val, 0);
  const isWeightValid = totalWeight === 100;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleWeightChange = (key: string, value: number) => {
    const newWeights = { ...weights, [key]: value };
    const otherKeys = Object.keys(weights).filter((k) => k !== key);
    const otherTotal = Object.values(newWeights).reduce((sum, val) => sum + val, 0) - value;
    
    // Calculate how much we need to distribute among other fields
    const targetTotal = 100 - value;
    const difference = targetTotal - otherTotal;
    
    if (difference !== 0 && otherKeys.length > 0) {
      // Distribute the difference proportionally among other fields
      const totalOtherWeights = otherKeys.reduce((sum, k) => sum + weights[k], 0);
      
      otherKeys.forEach((k) => {
        if (totalOtherWeights > 0) {
          const proportion = weights[k] / totalOtherWeights;
          const adjustment = Math.round(targetTotal * proportion);
          newWeights[k] = Math.max(0, Math.min(100, adjustment));
        } else {
          // If all others are 0, distribute equally
          newWeights[k] = Math.round(targetTotal / otherKeys.length);
        }
      });
      
      // Fine-tune to ensure exactly 100%
      const currentTotal = Object.values(newWeights).reduce((sum, val) => sum + val, 0);
      if (currentTotal !== 100) {
        const firstOtherKey = otherKeys[0];
        newWeights[firstOtherKey] = Math.max(0, newWeights[firstOtherKey] + (100 - currentTotal));
      }
    }
    
    setWeights(newWeights);
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
          description: `${formData.category} tender`,
          budget: Number(formData.budget),
          deadline: formData.deadline,
        },
      });
      navigate("/po");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create tender");
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
            <h1 className="text-2xl text-[#0B3C5D] mb-1">Create New Tender</h1>
            <p className="text-sm text-gray-600">Define tender specifications and evaluation criteria</p>
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
                  <label className="block text-sm text-gray-700 mb-2">Submission Deadline</label>
                  <input
                    type="date"
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
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-[#1D4E89] transition-colors cursor-pointer">
                <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                <p className="text-sm text-gray-600 mb-1">Click to upload or drag and drop</p>
                <p className="text-xs text-gray-500">PDF, DOC, DOCX (Max 10MB)</p>
                <input type="file" className="hidden" accept=".pdf,.doc,.docx" />
              </div>
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

              <div className="space-y-4">
                {Object.entries(weights).map(([key, value]) => (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm text-gray-700 capitalize">{key}</label>
                      <span className="text-sm text-[#0B3C5D]">{value}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={value}
                      onChange={(e) => handleWeightChange(key, parseInt(e.target.value))}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#1D4E89]"
                    />
                  </div>
                ))}
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
                {loading ? "Creating..." : "Create Tender"}
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