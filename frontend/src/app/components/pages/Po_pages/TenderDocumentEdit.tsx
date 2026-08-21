import { useEffect, useState } from "react";
import { FileText, Save, Upload } from "lucide-react";
import { useNavigate } from "react-router";
import { apiRequest } from "../../../api";
import { encodeFilesToStoredDocuments, getStoredDocumentName } from "../../../document-utils";

type TenderRecord = {
  _id: string;
  title: string;
  status: string;
  documents?: string[];
};

const maxIndividualDocumentSizeBytes = 10 * 1024 * 1024;
const maxCombinedDocumentSizeBytes = 35 * 1024 * 1024;

export function TenderDocumentEdit() {
  const navigate = useNavigate();
  const [tenders, setTenders] = useState<TenderRecord[]>([]);
  const [selectedTenderId, setSelectedTenderId] = useState("");
  const [documents, setDocuments] = useState<string[]>([]);
  const [documentNames, setDocumentNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const loadTenders = async () => {
      try {
        const data = await apiRequest<TenderRecord[]>("/api/tenders?summary=true");
        setTenders(Array.isArray(data) ? data : []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load tenders");
      } finally {
        setLoading(false);
      }
    };

    void loadTenders();
  }, []);

  const selectTender = (tenderId: string) => {
    const tender = tenders.find((item) => item._id === tenderId);
    setSelectedTenderId(tenderId);
    setDocuments(tender?.documents || []);
    setDocumentNames((tender?.documents || []).map((document) => getStoredDocumentName(document)));
    setError("");
    setSuccess("");
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const selectedFiles = Array.from(files);
    const oversizedFile = selectedFiles.find((file) => file.size > maxIndividualDocumentSizeBytes);
    if (oversizedFile) {
      setError(`${oversizedFile.name} exceeds the 10MB limit`);
      return;
    }

    const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > maxCombinedDocumentSizeBytes) {
      setError("Combined file size is too large. Keep total uploads under 35MB.");
      return;
    }

    try {
      setError("");
      const encodedDocuments = await encodeFilesToStoredDocuments(files);
      setDocuments((current) => [...current, ...encodedDocuments]);
      setDocumentNames((current) => [...current, ...selectedFiles.map((file) => file.name)]);
    } catch {
      setError("Failed to process uploaded documents");
    }
  };

  const saveDocuments = async () => {
    if (!selectedTenderId) {
      setError("Select a tender first");
      return;
    }
    if (!documents.length) {
      setError("At least one tender document is required");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await apiRequest(`/api/tenders/${selectedTenderId}`, {
        method: "PUT",
        body: { documents },
      });
      setSuccess("Tender documents updated successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update tender documents");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <div className="w-64 h-screen bg-[#0B3C5D] text-white p-6">
        <h1 className="font-semibold text-lg">IntelliTender</h1>
        <button className="mt-8 text-sm text-white/80 hover:text-white" onClick={() => navigate("/po")}>
          Back to dashboard
        </button>
      </div>
      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl">
          <h2 className="text-2xl text-[#0B3C5D] mb-1">Edit Tender Documents</h2>
          <p className="text-sm text-gray-600 mb-6">Add missing specifications or compliance documents to an existing tender.</p>

          <div className="bg-white rounded-lg border border-gray-100 p-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Select Tender</label>
            <select
              value={selectedTenderId}
              onChange={(event) => selectTender(event.target.value)}
              disabled={loading}
              className="w-full border border-gray-300 rounded-md px-3 py-2 mb-6"
            >
              <option value="">{loading ? "Loading tenders..." : "Select a tender"}</option>
              {tenders.map((tender) => (
                <option key={tender._id} value={tender._id}>
                  {tender.title} ({tender.status})
                </option>
              ))}
            </select>

            {selectedTenderId && (
              <>
                <label className="block border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-[#1D4E89]">
                  <Upload className="w-9 h-9 text-gray-400 mx-auto mb-2" />
                  <span className="text-sm text-gray-600">Upload additional tender documents</span>
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.doc,.docx"
                    multiple
                    onChange={(event) => void handleFiles(event.target.files)}
                  />
                </label>

                <div className="mt-5 space-y-2">
                  {documentNames.map((name, index) => (
                    <div key={`${name}-${index}`} className="flex items-center gap-2 text-sm text-gray-700">
                      <FileText className="w-4 h-4 text-[#1D4E89]" />
                      <span>{name}</span>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => void saveDocuments()}
                  disabled={saving}
                  className="mt-6 inline-flex items-center gap-2 rounded-md bg-[#1D4E89] px-4 py-2 text-sm text-white disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {saving ? "Saving..." : "Save Documents"}
                </button>
              </>
            )}

            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
            {success && <p className="mt-4 text-sm text-green-700">{success}</p>}
          </div>
        </div>
      </main>
    </div>
  );
}
