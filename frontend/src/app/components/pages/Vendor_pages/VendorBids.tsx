import { useState } from "react";
import { Sidebar } from "../../layout/Sidebar";
import { Header } from "../../layout/Header";
import { AIAssistant } from "../../AIAssistant";
import { apiRequest, getAuthUser } from "../../../api";
import { getStoredDocumentName, getStoredDocumentUrl } from "../../../document-utils";
import {
  formatCurrency,
  getBidStatusClass,
  type BidView,
} from "./vendorHelpers";
import { useVendorData } from "./vendorData";

type EvaluationRow = {
  key: string;
  criterion: string;
  documentLabel?: string;
  maxMarks: number;
  aiMarks?: number;
  aiEvidence: string[];
  committeeMarks: number[];
  committeeComments: string[];
  sourceDocumentId?: string;
};

const normalizeLabel = (value?: string) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const buildEvaluationRows = (bid: BidView): EvaluationRow[] => {
  const rows = new Map<string, EvaluationRow>();
  const ensureRow = (label: string, maxMarks?: number) => {
    const criterion = label.trim();
    if (!criterion) return undefined;
    const key = normalizeLabel(criterion);
    const existing = rows.get(key);
    if (existing) {
      existing.maxMarks = Math.max(existing.maxMarks, Number(maxMarks || 0));
      return existing;
    }
    const row: EvaluationRow = {
      key,
      criterion,
      maxMarks: Number(maxMarks || 0),
      aiEvidence: [],
      committeeMarks: [],
      committeeComments: [],
    };
    rows.set(key, row);
    return row;
  };

  (bid.aiEvaluation?.criteriaScores || []).forEach((score) => {
    const row = ensureRow(score.criterion || "", score.maxMarks);
    if (!row) return;
    row.documentLabel = score.documentLabel || row.documentLabel;
    row.aiMarks = Number(score.awardedMarks || 0);
    row.aiEvidence = score.evidence || [];
  });

  (bid.committeeEvaluations || []).forEach((evaluation) => {
    (evaluation.criteriaScores || []).forEach((score) => {
      const row = ensureRow(score.documentLabel || score.criterion || "", score.maxMarks);
      if (!row) return;
      row.documentLabel = score.documentLabel || row.documentLabel;
      row.committeeMarks.push(Number(score.awardedMarks || 0));
      if (evaluation.comments) row.committeeComments.push(evaluation.comments);
    });
  });

  return Array.from(rows.values());
};

const getSourceDocument = (bid: BidView, row: EvaluationRow) => {
  const label = normalizeLabel(row.documentLabel || row.criterion);
  return (bid.bidDocuments || []).find((document) => {
    const documentLabel = normalizeLabel(document.label);
    return document.documentId && documentLabel && (
      documentLabel === label || documentLabel.includes(label) || label.includes(documentLabel)
    );
  });
};

const getOverallScore = (bid: BidView) => {
  if (bid.evaluationSummary?.overallScore !== undefined) return bid.evaluationSummary.overallScore;
  if (bid.technicalScore === undefined || bid.financialScore === undefined) return "Pending";
  const technicalWeight = Number(bid.technicalWeight);
  const commercialWeight = Number(bid.commercialWeight);
  const totalWeight = technicalWeight + commercialWeight;
  const overall = totalWeight > 0
    ? (Number(bid.technicalScore) * technicalWeight + Number(bid.financialScore) * commercialWeight) / totalWeight
    : (Number(bid.technicalScore) + Number(bid.financialScore)) / 2;
  return overall.toFixed(2);
};

export function VendorBids() {
  const authUser = getAuthUser();
  const { loading, error, myBids, reload } = useVendorData(authUser?._id);
  const [withdrawingBidId, setWithdrawingBidId] = useState("");
  const [actionError, setActionError] = useState("");

  const total = myBids.length;
  const pending = myBids.filter((bid) => bid.status === "Pending").length;
  const selected = myBids.filter((bid) => bid.status === "Selected").length;
  const rejected = myBids.filter((bid) => bid.status === "Rejected").length;

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="vendor" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="vendor" userName={authUser?.name || ""} />
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl text-[#0B3C5D] mb-1">My Bids</h1>
            <p className="text-sm text-gray-600">Monitor submission status, evaluation comments, and scoring updates.</p>
          </div>

          {(error || actionError) && <p className="text-sm text-red-600 mb-4">{error || actionError}</p>}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg border border-gray-100 p-4">
              <p className="text-sm text-gray-600">Total</p>
              <p className="text-2xl text-[#0B3C5D]">{total}</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 p-4">
              <p className="text-sm text-gray-600">Pending</p>
              <p className="text-2xl text-blue-700">{pending}</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 p-4">
              <p className="text-sm text-gray-600">Selected</p>
              <p className="text-2xl text-green-700">{selected}</p>
            </div>
            <div className="bg-white rounded-lg border border-gray-100 p-4">
              <p className="text-sm text-gray-600">Rejected</p>
              <p className="text-2xl text-red-700">{rejected}</p>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-100">
            {loading && <p className="text-sm text-gray-600">Loading bid activity...</p>}
            {!loading && !myBids.length && <p className="text-sm text-gray-600">No bid submissions yet.</p>}

            <div className="space-y-4">
              {myBids.map((bid) => {
                const proposalUrl = getStoredDocumentUrl(bid.proposalDocument);
                const proposalName = getStoredDocumentName(bid.proposalDocument, "Proposal PDF");

                return (
                  <div key={`${bid.tenderId}-${bid.submittedAt || bid.title}`} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                      <div>
                        <p className="text-sm text-[#0B3C5D]">{bid.title}</p>
                        <p className="text-xs text-gray-600 mt-1">
                          {bid.category} | Submitted {bid.submittedDate}
                        </p>
                      </div>
                      <div className="text-left lg:text-right">
                        <p className="text-base text-[#1D4E89]">Submitted: {formatCurrency(bid.amount)}</p>
                        <span className={`inline-flex mt-2 px-3 py-1 rounded-full text-xs ${getBidStatusClass(bid.status)}`}>
                          {bid.status}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4 text-sm">
                      <div className="p-3 rounded-md bg-gray-50 border border-gray-100">
                        <p className="text-gray-500">Technical Score</p>
                        <p className="text-[#0B3C5D] mt-1">{bid.evaluationSummary?.technicalScore ?? "Pending"}<span className="text-xs text-gray-500"> / 100</span></p>
                      </div>
                      <div className="p-3 rounded-md bg-gray-50 border border-gray-100">
                        <p className="text-gray-500">Financial Score</p>
                        <p className="text-[#0B3C5D] mt-1">{bid.evaluationSummary?.financialScore ?? "Pending"}<span className="text-xs text-gray-500"> / 100</span></p>
                      </div>
                      <div className="p-3 rounded-md bg-green-50 border border-green-100">
                        <p className="text-gray-500">Overall Evaluation</p>
                        <p className="text-[#0B3C5D] mt-1">{bid.evaluationSummary?.overallScore ?? "Pending"}<span className="text-xs text-gray-500"> / 100</span></p>
                      </div>
                      <div className="p-3 rounded-md bg-gray-50 border border-gray-100">
                        <p className="text-gray-500">Uploaded Proposal</p>
                        {proposalUrl ? (
                          <a href={proposalUrl} target="_blank" rel="noreferrer" className="text-[#1D4E89] hover:underline mt-1 inline-block">
                            {proposalName}
                          </a>
                        ) : (
                          <p className="text-[#0B3C5D] mt-1">{proposalName}</p>
                        )}
                      </div>
                    </div>

                    {(bid.aiEvaluation || bid.committeeEvaluations?.length) && (() => {
                      const rows = buildEvaluationRows(bid);
                      const aiStatus = bid.aiEvaluation?.status === "success" ? "Completed" : bid.aiEvaluation?.status === "failed" ? "Failed" : bid.aiEvaluation ? "In progress" : "Pending";
                      const committeeStatus = bid.committeeEvaluations?.length ? "Completed" : "Pending";
                      const statusClass = (status: string) => status === "Completed" ? "bg-green-100 text-green-800" : status === "Failed" ? "bg-red-100 text-red-800" : "bg-yellow-100 text-yellow-800";

                      return (
                        <div className="mt-4 border-t border-gray-100 pt-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                              <p className="text-sm font-medium text-[#0B3C5D]">Complete evaluation report</p>
                              <p className="text-xs text-gray-500 mt-1">Every row shows the tender document, AI marks, committee/PO marks, evidence, and comments.</p>
                            </div>
                            <div className="flex flex-wrap gap-2 text-xs">
                              <span className={`rounded-full px-2.5 py-1 ${statusClass(aiStatus)}`}>AI: {aiStatus}</span>
                              <span className={`rounded-full px-2.5 py-1 ${statusClass(committeeStatus)}`}>Committee / PO: {committeeStatus}</span>
                              <span className={`rounded-full px-2.5 py-1 ${statusClass(bid.status === "Pending" ? "Pending" : "Completed")}`}>Bid: {bid.status}</span>
                            </div>
                          </div>

                          {bid.aiEvaluation?.eligibility && (
                            <div className={`mt-3 rounded-md border p-3 text-sm ${bid.aiEvaluation.eligibility.passed ? "border-green-100 bg-green-50 text-green-800" : "border-red-100 bg-red-50 text-red-800"}`}>
                              <strong>AI eligibility: {bid.aiEvaluation.eligibility.passed ? "Passed" : "Not passed"}</strong>
                              {bid.aiEvaluation.eligibility.reasons?.length ? <p className="mt-1">{bid.aiEvaluation.eligibility.reasons.join(" ")}</p> : null}
                            </div>
                          )}

                          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                            <div className="rounded-md border border-blue-100 bg-blue-50 p-3">
                              <p className="text-xs font-medium uppercase tracking-wide text-blue-700">AI evaluation score</p>
                              <div className="mt-2 grid grid-cols-3 gap-2 text-sm text-gray-700">
                                <span>Technical<strong className="block text-lg text-[#0B3C5D]">{bid.aiEvaluation?.aiScores?.technicalScore ?? "Pending"}</strong></span>
                                <span>Commercial<strong className="block text-lg text-[#0B3C5D]">{bid.aiEvaluation?.aiScores?.financialScore ?? "Pending"}</strong></span>
                                <span>Overall<strong className="block text-lg text-[#0B3C5D]">{bid.aiEvaluation?.aiScores?.overallScore ?? "Pending"}</strong></span>
                              </div>
                            </div>
                            <div className="rounded-md border border-amber-100 bg-amber-50 p-3">
                              <p className="text-xs font-medium uppercase tracking-wide text-amber-700">Committee / PO score</p>
                              <div className="mt-2 grid grid-cols-3 gap-2 text-sm text-gray-700">
                                <span>Technical<strong className="block text-lg text-[#0B3C5D]">{bid.evaluationSummary?.technicalScore ?? "Pending"}</strong></span>
                                <span>Commercial<strong className="block text-lg text-[#0B3C5D]">{bid.evaluationSummary?.financialScore ?? "Pending"}</strong></span>
                                <span>Overall<strong className="block text-lg text-[#0B3C5D]">{getOverallScore(bid)}</strong></span>
                              </div>
                            </div>
                            <div className="rounded-md border border-green-100 bg-green-50 p-3">
                              <p className="text-xs font-medium uppercase tracking-wide text-green-700">Final evaluation score</p>
                              <div className="mt-2 grid grid-cols-3 gap-2 text-sm text-gray-700">
                                <span>Technical<strong className="block text-lg text-[#0B3C5D]">{bid.evaluationSummary?.technicalScore ?? "Pending"}</strong></span>
                                <span>Commercial<strong className="block text-lg text-[#0B3C5D]">{bid.evaluationSummary?.financialScore ?? "Pending"}</strong></span>
                                <span>Overall<strong className="block text-lg text-[#0B3C5D]">{getOverallScore(bid)}</strong></span>
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 overflow-x-auto rounded-md border border-gray-200">
                            <table className="min-w-[980px] w-full text-sm">
                              <thead className="bg-[#0B3C5D] text-white">
                                <tr>
                                  <th className="px-3 py-3 text-left">Document / criterion</th>
                                  <th className="px-3 py-3 text-left">Max</th>
                                  <th className="px-3 py-3 text-left">AI marks</th>
                                  <th className="px-3 py-3 text-left">Committee / PO marks</th>
                                  <th className="px-3 py-3 text-left">AI comment / evidence</th>
                                  <th className="px-3 py-3 text-left">Committee comment</th>
                                  <th className="px-3 py-3 text-left">Source</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100 bg-white">
                                {rows.length ? rows.map((row) => {
                                  const source = getSourceDocument(bid, row);
                                  const committeeAverage = row.committeeMarks.length
                                    ? row.committeeMarks.reduce((sum, mark) => sum + mark, 0) / row.committeeMarks.length
                                    : undefined;
                                  return (
                                    <tr key={row.key} className="align-top hover:bg-gray-50">
                                      <td className="px-3 py-3 min-w-[180px]"><p className="font-medium text-[#0B3C5D]">{row.criterion}</p><p className="text-xs text-gray-500 mt-1">{row.documentLabel || "Document not identified"}</p></td>
                                      <td className="px-3 py-3 whitespace-nowrap">{row.maxMarks || "-"}</td>
                                      <td className="px-3 py-3 whitespace-nowrap"><strong>{row.aiMarks ?? "Pending"}</strong>{row.aiMarks !== undefined ? ` / ${row.maxMarks || "-"}` : ""}</td>
                                      <td className="px-3 py-3 whitespace-nowrap"><strong>{committeeAverage !== undefined ? committeeAverage.toFixed(2) : "Pending"}</strong>{committeeAverage !== undefined ? ` / ${row.maxMarks || "-"} (${row.committeeMarks.length} review${row.committeeMarks.length === 1 ? "" : "s"})` : ""}</td>
                                      <td className="px-3 py-3 min-w-[240px] text-xs text-gray-700">{row.aiEvidence.length ? row.aiEvidence.join(" ") : "No AI comment or evidence returned."}</td>
                                      <td className="px-3 py-3 min-w-[220px] text-xs text-gray-700">{row.committeeComments.length ? row.committeeComments.join(" ") : "No committee comment."}</td>
                                      <td className="px-3 py-3 min-w-[150px]">{source?.documentId ? <a href={`/api/tenders/${bid.tenderId}/bid-documents/${source.documentId}`} target="_blank" rel="noreferrer" className="text-[#1D4E89] hover:underline">Open document</a> : <span className="text-xs text-gray-400">Not available</span>}</td>
                                    </tr>
                                  );
                                }) : <tr><td colSpan={7} className="px-3 py-4 text-sm text-gray-500">No document-level marks are available yet.</td></tr>}
                              </tbody>
                            </table>
                          </div>

                          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                            {bid.aiEvaluation?.summary && <div className="rounded-md border border-indigo-100 bg-indigo-50 p-3 text-sm"><p className="font-medium text-indigo-800">AI overall comment</p><p className="mt-1 text-gray-700">{bid.aiEvaluation.summary}</p></div>}
                            {bid.comments && <div className="rounded-md border border-blue-100 bg-blue-50 p-3 text-sm"><p className="font-medium text-[#0B3C5D]">Final committee / PO comment</p><p className="mt-1 text-gray-700">{bid.comments}</p></div>}
                          </div>
                        </div>
                      );
                    })()}

                    {bid.comments && (
                      <div className="mt-4 p-3 rounded-md bg-blue-50 border border-blue-100">
                        <p className="text-sm text-[#0B3C5D]">Committee Comment</p>
                        <p className="text-sm text-gray-700 mt-1">{bid.comments}</p>
                      </div>
                    )}

                    {bid.status !== "Selected" && (
                      <div className="mt-4 flex justify-end">
                        <button
                          type="button"
                          disabled={withdrawingBidId === bid.bidId}
                          onClick={async () => {
                            if (!window.confirm("Withdraw this submission? The bid, uploaded documents, AI results, chunks, and embeddings will be permanently deleted.")) return;
                            setWithdrawingBidId(bid.bidId);
                            setActionError("");
                            try {
                              await apiRequest(`/api/tenders/${bid.tenderId}/bids/${bid.bidId}`, { method: "DELETE" });
                              await reload();
                            } catch (err) {
                              setActionError(err instanceof Error ? err.message : "Failed to withdraw submission");
                            } finally {
                              setWithdrawingBidId("");
                            }
                          }}
                          className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          {withdrawingBidId === bid.bidId ? "Deleting submission..." : "Withdraw submission"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <AIAssistant role="vendor" />
    </div>
  );
}

