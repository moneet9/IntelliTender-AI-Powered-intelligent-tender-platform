import { Bell, User, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { apiRequest, clearAuthUser, getAuthUser } from "../../api";

interface HeaderProps {
  role: "cpo" | "po" | "committee" | "vendor" | "bidder";
  userName?: string;
}

const roleBadges = {
  cpo: { label: "CPO", color: "bg-[#0B3C5D]" },
  po: { label: "PO", color: "bg-[#1D4E89]" },
  committee: { label: "Committee", color: "bg-[#2E8B57]" },
  vendor: { label: "Vendor", color: "bg-gray-600" },
  bidder: { label: "Vendor", color: "bg-gray-600" },
};

const roleNames = {
  cpo: "Chief Procurement Officer",
  po: "Procurement Officer",
  committee: "Committee Member",
  vendor: "Vendor",
  bidder: "Vendor",
};

type AiNotification = {
  _id: string;
  title: string;
  message: string;
  severity?: "low" | "medium" | "high";
  link?: string;
  createdAt?: string;
};

export function Header({ role, userName }: HeaderProps) {
  const navigate = useNavigate();
  const badge = roleBadges[role];
  const authUser = getAuthUser();
  const resolvedUserName =
    (userName && userName.trim()) || authUser?.name || "User";
  const [notifications, setNotifications] = useState<AiNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);

  useEffect(() => {
    if (role !== "po") return;
    const loadNotifications = async () => {
      try {
        const data = await apiRequest<{
          items: AiNotification[];
          unreadCount: number;
        }>("/api/ai/milestones/notifications");
        setNotifications(data.items || []);
        setUnreadCount(data.unreadCount || 0);
      } catch {
        setNotifications([]);
        setUnreadCount(0);
      }
    };
    loadNotifications();
  }, [role]);

  const handleLogout = () => {
    clearAuthUser();
    navigate("/login");
  };

  return (
    <div className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 shadow-sm">
      {/* Left Side - Role Badge */}
      <div className="flex items-center gap-3">
        <span className={`${badge.color} text-white px-3 py-1 rounded text-sm`}>
          {badge.label}
        </span>
        <span className="text-gray-600 text-sm">{roleNames[role]}</span>
      </div>

      {/* Right Side - Notifications and Profile */}
      <div className="flex items-center gap-4">
        {/* Notifications */}
        {role === "po" && (
          <div className="relative">
            <button
              className="relative p-2 hover:bg-gray-100 rounded-full transition-colors"
              onClick={() => setShowNotifications((prev) => !prev)}
            >
              <Bell className="w-5 h-5 text-gray-600" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-4 px-1 rounded-full bg-[#B22222] text-white text-[10px] flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
            {showNotifications && (
              <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-20">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-semibold text-[#0B3C5D]">
                    AI Milestone Alerts
                  </p>
                  <p className="text-xs text-gray-500">
                    Latest updates from committee reports
                  </p>
                </div>
                <div className="max-h-72 overflow-auto">
                  {!notifications.length && (
                    <p className="px-4 py-4 text-sm text-gray-500">
                      No alerts yet.
                    </p>
                  )}
                  {notifications.map((item) => (
                    <button
                      key={item._id}
                      onClick={() => navigate(item.link || "/po/ai-alerts")}
                      className="w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50"
                    >
                      <p className="text-sm font-medium text-[#0B3C5D]">
                        {item.title}
                      </p>
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                        {item.message}
                      </p>
                    </button>
                  ))}
                </div>
                <div className="px-4 py-2 text-right">
                  <button
                    className="text-xs text-[#1D4E89] hover:underline"
                    onClick={() => navigate("/po/ai-alerts")}
                  >
                    View all alerts
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Profile */}
        <div className="flex items-center gap-3 pl-4 border-l border-gray-200">
          <div className="text-right">
            <div className="text-sm text-gray-800">{resolvedUserName}</div>
            <div className="text-xs text-gray-500">{roleNames[role]}</div>
          </div>
          <div className="w-10 h-10 bg-[#1D4E89] rounded-full flex items-center justify-center">
            <User className="w-5 h-5 text-white" />
          </div>
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          title="Logout"
        >
          <LogOut className="w-5 h-5 text-gray-600" />
        </button>
      </div>
    </div>
  );
}
