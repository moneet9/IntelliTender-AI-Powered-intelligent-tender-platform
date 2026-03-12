import { Bell, User, LogOut } from "lucide-react";
import { useNavigate } from "react-router";
import { clearAuthUser, getAuthUser } from "../../api";

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

export function Header({ role, userName = "Vikram Patel" }: HeaderProps) {
  const navigate = useNavigate();
  const badge = roleBadges[role];
  const authUser = getAuthUser();
  const resolvedUserName = userName || authUser?.name || "User";

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
        <button className="relative p-2 hover:bg-gray-100 rounded-full transition-colors">
          <Bell className="w-5 h-5 text-gray-600" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-[#B22222] rounded-full"></span>
        </button>

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