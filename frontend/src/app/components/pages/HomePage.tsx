import { Link } from "react-router";
import { Shield, Users, FileCheck, Brain, Lock, TrendingUp } from "lucide-react";

export function HomePage() {
  return (
    <div className="min-h-screen bg-[#F4F6F9]">
      {/* Header */}
      <header className="bg-[#0B3C5D] text-white">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8" />
            <h1 className="text-xl">IntelliTender</h1>
          </div>
          <Link
            to="/login"
            className="px-6 py-2 bg-[#2E8B57] hover:bg-[#267347] rounded-md transition-colors text-sm"
          >
            Sign In
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="bg-gradient-to-br from-[#0B3C5D] to-[#1D4E89] text-white py-20">
        <div className="container mx-auto px-6 text-center">
          <h2 className="text-4xl md:text-5xl mb-6">
            Government-Grade Tender & Contract Management
          </h2>
          <p className="text-xl text-white/90 mb-8 max-w-3xl mx-auto">
            Streamline procurement with AI-powered evaluation, comprehensive audit logging,
            and role-based dashboards for transparent government contracting.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link
              to="/login"
              className="px-8 py-4 bg-[#2E8B57] hover:bg-[#267347] rounded-md transition-colors"
            >
              Get Started
            </Link>
            <button className="px-8 py-4 bg-white/10 hover:bg-white/20 backdrop-blur rounded-md transition-colors">
              Learn More
            </button>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-6">
          <h3 className="text-3xl text-[#0B3C5D] text-center mb-12">
            Comprehensive Procurement Platform
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <div className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-[#1D4E89]/10 rounded-lg flex items-center justify-center mb-4">
                <Brain className="w-6 h-6 text-[#1D4E89]" />
              </div>
              <h4 className="text-lg text-[#0B3C5D] mb-2">AI-Powered Evaluation</h4>
              <p className="text-sm text-gray-600">
                Automated bid scoring with weighted criteria, risk assessment, and intelligent flagging of anomalies.
              </p>
            </div>

            <div className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-[#2E8B57]/10 rounded-lg flex items-center justify-center mb-4">
                <Users className="w-6 h-6 text-[#2E8B57]" />
              </div>
              <h4 className="text-lg text-[#0B3C5D] mb-2">Role-Based Dashboards</h4>
              <p className="text-sm text-gray-600">
                Specialized interfaces for CPO, PO, Committee Members, and Bidders with tailored permissions.
              </p>
            </div>

            <div className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-[#F4A300]/10 rounded-lg flex items-center justify-center mb-4">
                <FileCheck className="w-6 h-6 text-[#F4A300]" />
              </div>
              <h4 className="text-lg text-[#0B3C5D] mb-2">Milestone Tracking</h4>
              <p className="text-sm text-gray-600">
                Monitor project progress, track delays, and automatically calculate penalties for contract compliance.
              </p>
            </div>

            <div className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-[#B22222]/10 rounded-lg flex items-center justify-center mb-4">
                <Shield className="w-6 h-6 text-[#B22222]" />
              </div>
              <h4 className="text-lg text-[#0B3C5D] mb-2">Complete Audit Trail</h4>
              <p className="text-sm text-gray-600">
                Full transparency with immutable logs of every action, decision, and approval in the system.
              </p>
            </div>

            <div className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-[#0B3C5D]/10 rounded-lg flex items-center justify-center mb-4">
                <Lock className="w-6 h-6 text-[#0B3C5D]" />
              </div>
              <h4 className="text-lg text-[#0B3C5D] mb-2">Bidder Performance</h4>
              <p className="text-sm text-gray-600">
                Historical performance tracking, risk scoring, and compliance monitoring for informed decision-making.
              </p>
            </div>

            <div className="p-6 border border-gray-200 rounded-lg hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-[#2E8B57]/10 rounded-lg flex items-center justify-center mb-4">
                <TrendingUp className="w-6 h-6 text-[#2E8B57]" />
              </div>
              <h4 className="text-lg text-[#0B3C5D] mb-2">Analytics & Reporting</h4>
              <p className="text-sm text-gray-600">
                Real-time insights, performance metrics, and comprehensive reports for strategic oversight.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* User Roles Section */}
      <section className="py-16 bg-gray-50">
        <div className="container mx-auto px-6">
          <h3 className="text-3xl text-[#0B3C5D] text-center mb-12">
            Built for Every Stakeholder
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <h4 className="text-lg text-[#0B3C5D] mb-3">Chief Procurement Officer</h4>
              <ul className="text-sm text-gray-600 space-y-2">
                <li>• Strategic oversight dashboard</li>
                <li>• Risk analytics and compliance</li>
                <li>• Final approval authority</li>
                <li>• System-wide performance metrics</li>
              </ul>
            </div>

            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <h4 className="text-lg text-[#0B3C5D] mb-3">Procurement Officer</h4>
              <ul className="text-sm text-gray-600 space-y-2">
                <li>• Create and manage tenders</li>
                <li>• Review AI evaluations</li>
                <li>• Milestone creation and tracking</li>
                <li>• Operational management</li>
              </ul>
            </div>

            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <h4 className="text-lg text-[#0B3C5D] mb-3">Committee Member</h4>
              <ul className="text-sm text-gray-600 space-y-2">
                <li>• Technical bid evaluation</li>
                <li>• Contract monitoring</li>
                <li>• Progress reporting</li>
                <li>• Quality assurance</li>
              </ul>
            </div>

            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <h4 className="text-lg text-[#0B3C5D] mb-3">Bidder</h4>
              <ul className="text-sm text-gray-600 space-y-2">
                <li>• Browse available tenders</li>
                <li>• Submit competitive bids</li>
                <li>• Track performance scores</li>
                <li>• View contract status</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 bg-[#0B3C5D] text-white">
        <div className="container mx-auto px-6 text-center">
          <h3 className="text-3xl mb-4">Ready to Transform Your Procurement Process?</h3>
          <p className="text-lg text-white/90 mb-8 max-w-2xl mx-auto">
            Join government agencies worldwide using IntelliTender for transparent,
            efficient, and compliant tender management.
          </p>
          <Link
            to="/login"
            className="inline-block px-8 py-4 bg-[#2E8B57] hover:bg-[#267347] rounded-md transition-colors"
          >
            Access Platform
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-800 text-gray-300 py-8">
        <div className="container mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Shield className="w-6 h-6" />
                <span className="text-white">IntelliTender</span>
              </div>
              <p className="text-sm text-gray-400">
                Government-grade procurement platform with AI-powered evaluation and comprehensive audit trails.
              </p>
            </div>
            <div>
              <h5 className="text-white mb-4">Platform</h5>
              <ul className="text-sm space-y-2">
                <li><a href="#" className="hover:text-white">Features</a></li>
                <li><a href="#" className="hover:text-white">Security</a></li>
                <li><a href="#" className="hover:text-white">Compliance</a></li>
                <li><a href="#" className="hover:text-white">Documentation</a></li>
              </ul>
            </div>
            <div>
              <h5 className="text-white mb-4">Support</h5>
              <ul className="text-sm space-y-2">
                <li><a href="#" className="hover:text-white">Help Center</a></li>
                <li><a href="#" className="hover:text-white">Contact Us</a></li>
                <li><a href="#" className="hover:text-white">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-white">Terms of Service</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-700 mt-8 pt-8 text-center text-sm text-gray-400">
            © 2026 IntelliTender. All rights reserved. Government Procurement Solution.
          </div>
        </div>
      </footer>
    </div>
  );
}
