import { Link, useLocation } from "react-router";
import {
  type LucideIcon,
  LayoutDashboard,
  FileText,
  Users,
  Settings,
  Shield,
  ClipboardList,
  Calendar,
  Search,
  UserPlus,
  BarChart2,
  FileCheck,
  Bell,
} from "lucide-react";
import { getAuthUser } from "../../api";

interface SidebarProps {
  role: "cpo" | "po" | "committee" | "vendor" | "bidder";
}

type NavItem = {
  path: string;
  icon: LucideIcon;
  label: string;
  aliases?: string[];
  disabled?: boolean;
  section?: string;
};

export function Sidebar({ role }: SidebarProps) {
  const location = useLocation();
  const authUser = getAuthUser();
  const vendorRestricted = role === "vendor" && authUser?.accountStatus && authUser.accountStatus !== "Active";

  const vendorItems: NavItem[] = [
    { path: "/vendor", icon: LayoutDashboard, label: "Dashboard", aliases: ["/bidder"] },
    {
      path: "/vendor/contract-search",
      icon: Search,
      label: "Search Tenders",
      aliases: ["/bidder/contract-search"],
      disabled: vendorRestricted,
    },
    {
      path: "/vendor/bids",
      icon: ClipboardList,
      label: "My Bids",
      aliases: ["/bidder/bids"],
      disabled: vendorRestricted,
    },
    {
      path: "/vendor/contracts",
      icon: Calendar,
      label: "Contracts",
      aliases: ["/bidder/contracts"],
      disabled: vendorRestricted,
    },
    { path: "/vendor/ai-settings", icon: Settings, label: "AI Settings", aliases: ["/bidder/ai-settings"] },
  ];

  const roleConfig: Record<SidebarProps["role"], { items: NavItem[] }> = {
    cpo: {
      items: [
        { path: "/cpo", icon: LayoutDashboard, label: "Dashboard" },
        { path: "/cpo/create-po", icon: UserPlus, label: "Create PO" },
        { path: "/cpo/bid-comparison", icon: BarChart2, label: "Bid Comparison" },
        { path: "/cpo/contracts", icon: FileCheck, label: "Contract Status" },
        { path: "/cpo/bidders", icon: Users, label: "Vendor Management" },
        { path: "/cpo/ai-connector", icon: Settings, label: "AI Connector" },
        { path: "/cpo/ai-settings", icon: Settings, label: "AI Settings" },
      ],
    },
    po: {
      items: [
        { path: "/po", icon: LayoutDashboard, label: "Dashboard" },
        { path: "/po/publish-tender", icon: FileText, label: "Publish Tender", aliases: ["/po/create-tender"] },
        { path: "/po/edit-tender", icon: FileText, label: "Edit Tender Documents" },
        { path: "/po/create-committee", icon: UserPlus, label: "Create Committee" },
        { path: "/po/milestones", icon: Calendar, label: "Milestones" },
        { section: "AI Workspace", path: "/po/ai-settings", icon: Settings, label: "AI Settings" },
        { section: "AI Workspace", path: "/po/ai-connector", icon: Settings, label: "AI Connector" },
        { section: "AI Workspace", path: "/po/ai-evaluation", icon: ClipboardList, label: "AI Queue" },
        { section: "AI Workspace", path: "/po/evaluation", icon: FileCheck, label: "AI Results" },
        { section: "AI Workspace", path: "/po/ai-alerts", icon: Bell, label: "AI Alerts" },
        { section: "Monitoring", path: "/po/bidders", icon: Users, label: "Vendor Profiles" },
      ],
    },
    committee: {
      items: [
        { path: "/committee", icon: LayoutDashboard, label: "Dashboard", aliases: ["/committee/evaluation"] },
        { path: "/committee/milestones", icon: Calendar, label: "Milestones", aliases: ["/committee/monitoring"] },
        { path: "/committee/ai-settings", icon: Settings, label: "AI Settings" },
      ],
    },
    vendor: {
      items: vendorItems,
    },
    bidder: {
      items: vendorItems,
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
            <div className="text-xs text-white/70">Procurement Platform</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4">
        <div className="space-y-1">
          {items.map((item, index) => {
            const isActive = location.pathname === item.path || (item.aliases || []).includes(location.pathname);
            const previousSection = index > 0 ? items[index - 1].section : "";
            const showSectionHeader = Boolean(item.section) && item.section !== previousSection;

            const navItem = item.disabled ? (
              <div
                key={item.path}
                className="flex items-center gap-3 px-4 py-3 rounded-md text-white/50 cursor-not-allowed"
              >
                <item.icon className="w-5 h-5" />
                <span className="text-sm">{item.label}</span>
              </div>
            ) : (
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

            if (showSectionHeader) {
              return (
                <div key={item.section} className="space-y-1">
                  <div className="px-4 pt-2 pb-1 text-[11px] uppercase tracking-[0.2em] text-white/45">
                    {item.section}
                  </div>
                  {navItem}
                </div>
              );
            }

            return navItem;
          })}
        </div>
      </nav>

      {/* Settings */}
      <div className="p-4 border-t border-white/10">
        {!(role === "vendor" && authUser?.accountStatus && authUser.accountStatus !== "Active") && (
          <Link to="/change-password" className="w-full flex items-center gap-3 px-4 py-3 rounded-md text-white/80 hover:bg-white/10 hover:text-white transition-colors">
            <Settings className="w-5 h-5" />
            <span className="text-sm">Settings</span>
          </Link>
        )}
      </div>
    </div>
  );
}
