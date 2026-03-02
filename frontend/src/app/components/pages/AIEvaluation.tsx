import { useState } from "react";
import { Sidebar } from "../layout/Sidebar";
import { Header } from "../layout/Header";
import { AIAssistant } from "../AIAssistant";
import { AlertTriangle, CheckCircle, ChevronDown, ChevronUp } from "lucide-react";

interface Bidder {
  id: string;
  name: string;
  price: number;
  experience: number;
  aiScore: number;
  riskScore: number;
  flags: string[];
  riskLevel: "low" | "medium" | "high";
}

const bidders: Bidder[] = [
  {
    id: "BID-001",
    name: "Tata Consultancy Services",
    price: 3650000,
    experience: 12,
    aiScore: 87.5,
    riskScore: 8,
    flags: [],
    riskLevel: "low",
  },
  {
    id: "BID-002",
    name: "Infosys Technologies",
    price: 3700000,
    experience: 15,
    aiScore: 91.2,
    riskScore: 5,
    flags: [],
    riskLevel: "low",
  },
  {
    id: "BID-003",
    name: "Wipro Solutions",
    price: 3200000,
    experience: 8,
    aiScore: 68.3,
    riskScore: 45,
    flags: ["Abnormally low bid", "Limited track record"],
    riskLevel: "medium",
  },
  {
    id: "BID-004",
    name: "Tech Mahindra",
    price: 3000000,
    experience: 3,
    aiScore: 42.1,
    riskScore: 72,
    flags: ["Duplicate documents", "Shell company pattern"],
    riskLevel: "high",
  },
];

export function AIEvaluation() {
  const [expandedBidder, setExpandedBidder] = useState<string | null>(null);
  const [overrideReason, setOverrideReason] = useState("");

  const getRiskColor = (level: string) => {
    switch (level) {
      case "low":
        return "bg-green-100 text-green-800";
      case "medium":
        return "bg-yellow-100 text-yellow-800";
      case "high":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getRiskBorder = (level: string) => {
    switch (level) {
      case "low":
        return "border-l-4 border-[#2E8B57]";
      case "medium":
        return "border-l-4 border-[#F4A300]";
      case "high":
        return "border-l-4 border-[#B22222]";
      default:
        return "border-l-4 border-gray-300";
    }
  };

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="po" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="po" userName="Rajesh Kumar" />
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl text-[#0B3C5D] mb-1">AI Evaluation Results</h1>
            <p className="text-sm text-gray-600">TND-2026-047: Medical Equipment Supply</p>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">Total Bidders</p>
              <p className="text-3xl text-[#0B3C5D]">{bidders.length}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">Low Risk</p>
              <p className="text-3xl text-[#2E8B57]">
                {bidders.filter((b) => b.riskLevel === "low").length}
              </p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">Medium Risk</p>
              <p className="text-3xl text-[#F4A300]">
                {bidders.filter((b) => b.riskLevel === "medium").length}
              </p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-5 border border-gray-100">
              <p className="text-sm text-gray-600 mb-1">High Risk</p>
              <p className="text-3xl text-[#B22222]">
                {bidders.filter((b) => b.riskLevel === "high").length}
              </p>
            </div>
          </div>

          {/* Bidders Table */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100">
            <div className="p-6 border-b border-gray-100">
              <h3 className="text-lg text-[#0B3C5D]">AI-Ranked Bidders</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Bidder</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Price (₹)</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Experience</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">AI Score</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Risk</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Flags</th>
                    <th className="px-6 py-3 text-left text-xs text-gray-600 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {bidders
                    .sort((a, b) => b.aiScore - a.aiScore)
                    .map((bidder) => (
                      <>
                        <tr key={bidder.id} className={`hover:bg-gray-50 ${getRiskBorder(bidder.riskLevel)}`}>
                          <td className="px-6 py-4">
                            <div className="text-sm text-gray-800">{bidder.name}</div>
                            <div className="text-xs text-gray-500">{bidder.id}</div>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-700">
                            ₹{bidder.price.toLocaleString()}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-700">{bidder.experience} years</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-[#0B3C5D]">{bidder.aiScore}</span>
                              <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-[#1D4E89]"
                                  style={{ width: `${bidder.aiScore}%` }}
                                ></div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`px-3 py-1 rounded-full text-xs uppercase ${getRiskColor(
                                bidder.riskLevel
                              )}`}
                            >
                              {bidder.riskLevel} ({bidder.riskScore}%)
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            {bidder.flags.length > 0 ? (
                              <div className="flex items-center gap-1">
                                <AlertTriangle className="w-4 h-4 text-[#F4A300]" />
                                <span className="text-xs text-gray-600">{bidder.flags.length}</span>
                              </div>
                            ) : (
                              <CheckCircle className="w-4 h-4 text-[#2E8B57]" />
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <button
                              onClick={() =>
                                setExpandedBidder(expandedBidder === bidder.id ? null : bidder.id)
                              }
                              className="text-sm text-[#1D4E89] hover:underline flex items-center gap-1"
                            >
                              View Details
                              {expandedBidder === bidder.id ? (
                                <ChevronUp className="w-4 h-4" />
                              ) : (
                                <ChevronDown className="w-4 h-4" />
                              )}
                            </button>
                          </td>
                        </tr>
                        {expandedBidder === bidder.id && (
                          <tr>
                            <td colSpan={7} className="px-6 py-4 bg-gray-50">
                              <div className="space-y-4">
                                <div>
                                  <h4 className="text-sm text-[#0B3C5D] mb-2">AI Explanation</h4>
                                  <div className="bg-white p-4 rounded-md border border-gray-200 space-y-2">
                                    <p className="text-sm text-gray-700">
                                      <span className="font-medium">Price Weight (40%):</span> Score {bidder.aiScore * 0.4}
                                    </p>
                                    <p className="text-sm text-gray-700">
                                      <span className="font-medium">Quality Weight (25%):</span> Score {bidder.aiScore * 0.25}
                                    </p>
                                    <p className="text-sm text-gray-700">
                                      <span className="font-medium">Experience Weight (20%):</span> Score {bidder.aiScore * 0.2}
                                    </p>
                                    <p className="text-sm text-gray-700">
                                      <span className="font-medium">Timeline Weight (15%):</span> Score {bidder.aiScore * 0.15}
                                    </p>
                                  </div>
                                </div>

                                {bidder.flags.length > 0 && (
                                  <div>
                                    <h4 className="text-sm text-[#0B3C5D] mb-2">Risk Flags</h4>
                                    <div className="bg-white p-4 rounded-md border border-gray-200">
                                      <ul className="space-y-1">
                                        {bidder.flags.map((flag, idx) => (
                                          <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                                            <AlertTriangle className="w-4 h-4 text-[#F4A300] mt-0.5" />
                                            {flag}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  </div>
                                )}

                                <div>
                                  <h4 className="text-sm text-[#0B3C5D] mb-2">Decision</h4>
                                  <div className="flex items-center gap-3">
                                    <button className="px-4 py-2 bg-[#2E8B57] hover:bg-[#267347] text-white rounded-md text-sm transition-colors">
                                      Accept AI Recommendation
                                    </button>
                                    <button className="px-4 py-2 bg-[#F4A300] hover:bg-[#d89200] text-white rounded-md text-sm transition-colors">
                                      Override with Justification
                                    </button>
                                  </div>
                                  <div className="mt-3">
                                    <textarea
                                      value={overrideReason}
                                      onChange={(e) => setOverrideReason(e.target.value)}
                                      placeholder="Justification for override (mandatory)"
                                      className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89] text-sm"
                                      rows={3}
                                    />
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <AIAssistant role="po" />
    </div>
  );
}