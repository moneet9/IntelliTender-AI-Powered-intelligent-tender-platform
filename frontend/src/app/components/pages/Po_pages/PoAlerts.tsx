import { useEffect, useState } from "react";
import { Sidebar } from "../../layout/Sidebar";
import { Header } from "../../layout/Header";
import { AIAssistant } from "../../AIAssistant";
import { apiRequest } from "../../../api";

type AiNotification = {
  _id: string;
  title: string;
  message: string;
  severity?: "low" | "medium" | "high";
  link?: string;
  createdAt?: string;
};

export function PoAlerts() {
  const [notifications, setNotifications] = useState<AiNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadAlerts = async () => {
      setLoading(true);
      setError("");
      try {
        const data = await apiRequest<{ items: AiNotification[] }>("/api/ai/milestones/notifications");
        setNotifications(data.items || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load alerts");
      } finally {
        setLoading(false);
      }
    };
    loadAlerts();
  }, []);

  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="po" />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header role="po" userName="Rajesh Kumar" />
        <div className="flex-1 overflow-auto p-6">
          <div className="mb-6">
            <h1 className="text-2xl text-[#0B3C5D] mb-1">AI Alerts</h1>
            <p className="text-sm text-gray-600">Milestone risk and delay notifications from AI review</p>
          </div>

          {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
          {loading && <p className="text-sm text-gray-500">Loading alerts...</p>}

          <div className="bg-white rounded-lg shadow-sm border border-gray-100">
            {!loading && !notifications.length && (
              <p className="text-sm text-gray-500 px-6 py-8">No AI alerts have been generated yet.</p>
            )}
            {!!notifications.length && (
              <div className="divide-y divide-gray-100">
                {notifications.map((item) => (
                  <div key={item._id} className="px-6 py-4 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-[#0B3C5D]">{item.title}</p>
                      <span className="text-xs text-gray-400">
                        {item.createdAt ? new Date(item.createdAt).toLocaleString() : ""}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600">{item.message}</p>
                    {item.link && (
                      <a href={item.link} className="text-xs text-[#1D4E89] hover:underline">
                        Open milestone
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <AIAssistant role="po" />
      </div>
    </div>
  );
}
