import { Link, useLocation } from "react-router";
import {
  LayoutDashboard,
  FileText,
  Users,
  Settings,
  Shield,
  ClipboardList,
  TrendingUp,
  Calendar,
  Search,
  UserPlus,
} from "lucide-react";

interface SidebarProps {
  role: "cpo" | "po" | "committee" | "bidder";
}

export function Sidebar({ role }: SidebarProps) {
  const location = useLocation();

  const roleConfig = {
    cpo: {
      items: [
        { path: "/cpo", icon: LayoutDashboard, label: "Dashboard" },
        { path: "/cpo/create-po", icon: UserPlus, label: "Create PO" },
        { path: "/cpo/bidders", icon: Users, label: "Vendor Management" },
      ],
    },
    po: {
      items: [
        { path: "/po", icon: LayoutDashboard, label: "Dashboard" },
        { path: "/po/create-tender", icon: FileText, label: "Create Tender" },
        { path: "/po/create-committee", icon: UserPlus, label: "Create Committee" },
        { path: "/po/milestones", icon: Calendar, label: "Milestones" },
        { path: "/po/evaluation", icon: ClipboardList, label: "AI Evaluation" },
        { path: "/po/bidders", icon: Users, label: "Bidder Profiles" },
      ],
    },
    committee: {
      items: [
        { path: "/committee", icon: LayoutDashboard, label: "Dashboard" },
        { path: "/committee/evaluation", icon: ClipboardList, label: "Evaluation" },
        { path: "/committee/milestones", icon: Calendar, label: "Milestones" },
        { path: "/committee/monitoring", icon: TrendingUp, label: "Contract Monitoring" },
      ],
    },
    bidder: {
      items: [
        { path: "/bidder", icon: LayoutDashboard, label: "Dashboard" },
        { path: "/bidder/contract-search", icon: Search, label: "Search Contracts" },
      ],
    },
  };

  const items = roleConfig[role].items;

  return (
    <div className="w-64 h-screen bg-[#0B3C5D] text-white flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <Shield className="w-8 h-8" />
          <div>
            <div className="font-semibold text-lg">IntelliTender</div>
            <div className="text-xs text-white/70">Gov. Procurement</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4">
        <div className="space-y-1">
          {items.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3 rounded-md transition-colors ${
                  isActive
                    ? "bg-[#1D4E89] text-white"
                    : "text-white/80 hover:bg-white/10 hover:text-white"
                }`}
              >
                <item.icon className="w-5 h-5" />
                <span className="text-sm">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Settings */}
      <div className="p-4 border-t border-white/10">
        <Link to="/change-password" className="w-full flex items-center gap-3 px-4 py-3 rounded-md text-white/80 hover:bg-white/10 hover:text-white transition-colors">
          <Settings className="w-5 h-5" />
          <span className="text-sm">Settings</span>
        </Link>
      </div>
    </div>
  );
}