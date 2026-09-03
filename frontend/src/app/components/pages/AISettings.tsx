import { useState } from "react";
import { BrainCircuit, Save } from "lucide-react";
import { Link, useLocation } from "react-router";
import { getAuthUser, getLmStudioUrl, saveLmStudioUrl } from "../../api";
import { Header } from "../layout/Header";
import { Sidebar } from "../layout/Sidebar";

type Role = "cpo" | "po" | "committee" | "vendor";

export function AISettings() {
  const user = getAuthUser();
  const location = useLocation();
  const role: Role = location.pathname.startsWith("/cpo")
    ? "cpo"
    : location.pathname.startsWith("/committee")
      ? "committee"
      : location.pathname.startsWith("/vendor") || location.pathname.startsWith("/bidder")
        ? "vendor"
        : "po";
  const [url, setUrl] = useState(getLmStudioUrl());
  const [saved, setSaved] = useState(false);

  const save = () => {
    saveLmStudioUrl(url);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  };

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role={role} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header role={role} userName={user?.name || ""} />
        <main className="flex-1 overflow-auto p-6">
          <div className="max-w-2xl rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center gap-3">
              <BrainCircuit className="h-6 w-6 text-[#0B3C5D]" />
              <div>
                <h1 className="text-xl text-[#0B3C5D]">AI connection</h1>
                <p className="text-sm text-gray-600">Optional LM Studio address for this browser.</p>
              </div>
            </div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="lm-studio-url">LM Studio URL</label>
            <input
              id="lm-studio-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="http://localhost:1234/v1"
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#1D4E89]"
            />
            <p className="mt-2 text-xs text-gray-500">Leave blank to try localhost:1234 first. Include the optional /v1 path.</p>
            <div className="mt-5 flex items-center gap-3">
              <button type="button" onClick={save} className="inline-flex items-center gap-2 rounded-md bg-[#0B3C5D] px-4 py-2 text-sm text-white hover:bg-[#1D4E89]">
                <Save className="h-4 w-4" /> Save
              </button>
              {saved && <span className="text-sm text-emerald-700">Saved for this browser.</span>}
            </div>
            <Link to={`/${role}`} className="mt-5 inline-block text-sm text-[#1D4E89] hover:underline">Back to dashboard</Link>
          </div>
        </main>
      </div>
    </div>
  );
}
