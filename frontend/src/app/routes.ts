import { createBrowserRouter } from "react-router";
import { HomePage } from "./components/pages/HomePage";
import { Login } from "./components/pages/Login";
import { CPODashboard } from "./components/pages/Cpo_pages/CPODashboard";
import { CPOBidComparison } from "./components/pages/Cpo_pages/CPOBidComparison";
import { CPOContractStatus } from "./components/pages/Cpo_pages/CPOContractStatus";
import { PODashboard } from "./components/pages/Po_pages/PODashboard";
import { CommitteeDashboard } from "./components/pages/Commitee_member_pages/CommitteeDashboard";
import { TenderCreation } from "./components/pages/Po_pages/TenderCreation";
import { AIEvaluation } from "./components/pages/Po_pages/AIEvaluation";
import { AIEvaluationQueue } from "./components/pages/Po_pages/AIEvaluationQueue";
import { PoAlerts } from "./components/pages/Po_pages/PoAlerts";
import { BidderProfile } from "./components/pages/Vendor_pages/BidderProfile";
import { POMilestones } from "./components/pages/Po_pages/POMilestones";
import { CommitteeMilestones } from "./components/pages/Commitee_member_pages/CommitteeMilestones";
import { ContractSearch } from "./components/pages/Vendor_pages/ContractSearch";
import { CreatePO } from "./components/pages/Cpo_pages/CreatePO";
import { CreateCommittee } from "./components/pages/Po_pages/CreateCommittee";
import { ChangePassword } from "./components/pages/ChangePassword";
import { VendorDashboard } from "./components/pages/Vendor_pages/VendorDashboard";
import { VendorBids } from "./components/pages/Vendor_pages/VendorBids";
import { VendorContracts } from "./components/pages/Vendor_pages/VendorContracts";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: HomePage,
  },
  {
    path: "/login",
    Component: Login,
  },
  {
    path: "/change-password",
    Component: ChangePassword,
  },
  // CPO Routes
  {
    path: "/cpo",
    Component: CPODashboard,
  },
  {
    path: "/cpo/bidders",
    Component: BidderProfile,
  },
  {
    path: "/cpo/bid-comparison",
    Component: CPOBidComparison,
  },
  {
    path: "/cpo/contracts",
    Component: CPOContractStatus,
  },
  {
    path: "/cpo/create-po",
    Component: CreatePO,
  },
  // PO Routes
  {
    path: "/po",
    Component: PODashboard,
  },
  {
    path: "/po/create-tender",
    Component: TenderCreation,
  },
  {
    path: "/po/publish-tender",
    Component: TenderCreation,
  },
  {
    path: "/po/evaluation",
    Component: AIEvaluation,
  },
  {
    path: "/po/ai-evaluation",
    Component: AIEvaluationQueue,
  },
  {
    path: "/po/ai-alerts",
    Component: PoAlerts,
  },
  {
    path: "/po/bidders",
    Component: BidderProfile,
  },
  {
    path: "/po/milestones",
    Component: POMilestones,
  },
  {
    path: "/po/create-committee",
    Component: CreateCommittee,
  },
  // Committee Routes
  {
    path: "/committee",
    Component: CommitteeDashboard,
  },
  {
    path: "/committee/evaluation",
    Component: CommitteeDashboard,
  },
  {
    path: "/committee/monitoring",
    Component: CommitteeMilestones,
  },
  {
    path: "/committee/milestones",
    Component: CommitteeMilestones,
  },
  // Vendor Routes
  {
    path: "/vendor",
    Component: VendorDashboard,
  },
  {
    path: "/vendor/contract-search",
    Component: ContractSearch,
  },
  {
    path: "/vendor/bids",
    Component: VendorBids,
  },
  {
    path: "/vendor/contracts",
    Component: VendorContracts,
  },

  // Legacy Bidder Routes (compatibility)
  {
    path: "/bidder",
    Component: VendorDashboard,
  },
  {
    path: "/bidder/contract-search",
    Component: ContractSearch,
  },
  {
    path: "/bidder/bids",
    Component: VendorBids,
  },
  {
    path: "/bidder/contracts",
    Component: VendorContracts,
  },
]);
