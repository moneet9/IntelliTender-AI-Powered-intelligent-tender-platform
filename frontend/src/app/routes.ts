import { createBrowserRouter } from "react-router";
import { HomePage } from "./components/pages/HomePage";
import { Login } from "./components/pages/Login";
import { CPODashboard } from "./components/pages/CPODashboard";
import { PODashboard } from "./components/pages/PODashboard";
import { CommitteeDashboard } from "./components/pages/CommitteeDashboard";
import { BidderDashboard } from "./components/pages/BidderDashboard";
import { TenderCreation } from "./components/pages/TenderCreation";
import { AIEvaluation } from "./components/pages/AIEvaluation";
import { BidderProfile } from "./components/pages/BidderProfile";
import { POMilestones } from "./components/pages/POMilestones";
import { CommitteeMilestones } from "./components/pages/CommitteeMilestones";
import { ContractSearch } from "./components/pages/ContractSearch";
import { CreatePO } from "./components/pages/CreatePO";
import { CreateCommittee } from "./components/pages/CreateCommittee";
import { ChangePassword } from "./components/pages/ChangePassword";

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
    path: "/po/evaluation",
    Component: AIEvaluation,
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
  // Bidder Routes
  {
    path: "/bidder",
    Component: BidderDashboard,
  },
  {
    path: "/bidder/contract-search",
    Component: ContractSearch,
  },
]);
