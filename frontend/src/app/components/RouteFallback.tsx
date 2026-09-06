import { AlertTriangle, ArrowLeft, Home } from "lucide-react";
import { useNavigate } from "react-router";
import { getAuthUser } from "../api";

function getDashboardPath() {
  const role = getAuthUser()?.role;
  if (role === "CPO") return "/cpo";
  if (role === "PO") return "/po";
  if (role === "Committee") return "/committee";
  if (role === "Vendor") return "/vendor";
  return "/login";
}

export function RouteFallback() {
  const navigate = useNavigate();
  const dashboardPath = getDashboardPath();

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F4F6F9] p-6">
      <section className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold text-[#0B3C5D]">Page not found</h1>
        <p className="mt-2 text-sm text-gray-600">That page is no longer available or the link is incomplete.</p>
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <ArrowLeft className="h-4 w-4" /> Go back
          </button>
          <button type="button" onClick={() => navigate(dashboardPath)} className="inline-flex items-center gap-2 rounded-md bg-[#0B3C5D] px-4 py-2 text-sm text-white hover:bg-[#1D4E89]">
            <Home className="h-4 w-4" /> Dashboard
          </button>
        </div>
      </section>
    </main>
  );
}
