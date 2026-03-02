import { Sidebar } from "../layout/Sidebar";
import { AIAssistant } from "../AIAssistant";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { TrendingUp, Users, FileText, CheckCircle, AlertTriangle } from "lucide-react";

const departmentData = [
  {
    id: 1,
    name: "राजेश कुमार शर्मा (Rajesh Kumar Sharma)",
    department: "Information Technology",
    activeTenders: 12,
    completedTenders: 45,
    avgEvaluationTime: 3.2,
    successRate: 94,
    totalValue: "₹8.5 Cr",
    status: "excellent"
  },
  {
    id: 2,
    name: "प्रिया देशपांडे (Priya Deshpande)",
    department: "Healthcare & Medical",
    activeTenders: 8,
    completedTenders: 38,
    avgEvaluationTime: 4.1,
    successRate: 91,
    totalValue: "₹12.3 Cr",
    status: "excellent"
  },
  {
    id: 3,
    name: "अमित पटेल (Amit Patel)",
    department: "Infrastructure & PWD",
    activeTenders: 15,
    completedTenders: 52,
    avgEvaluationTime: 5.8,
    successRate: 88,
    totalValue: "₹45.7 Cr",
    status: "good"
  },
  {
    id: 4,
    name: "सुनीता रेड्डी (Sunita Reddy)",
    department: "Education",
    activeTenders: 6,
    completedTenders: 29,
    avgEvaluationTime: 3.9,
    successRate: 92,
    totalValue: "₹6.2 Cr",
    status: "excellent"
  },
  {
    id: 5,
    name: "विक्रम सिंह राठौर (Vikram Singh Rathore)",
    department: "Transport & Roads",
    activeTenders: 10,
    completedTenders: 41,
    avgEvaluationTime: 6.2,
    successRate: 85,
    totalValue: "₹28.4 Cr",
    status: "good"
  },
  {
    id: 6,
    name: "अनीता मेनन (Anita Menon)",
    department: "Urban Development",
    activeTenders: 7,
    completedTenders: 33,
    avgEvaluationTime: 7.5,
    successRate: 79,
    totalValue: "₹15.8 Cr",
    status: "needs-attention"
  }
];

const monthlyTenderData = [
  { month: "Oct", count: 45 },
  { month: "Nov", count: 52 },
  { month: "Dec", count: 48 },
  { month: "Jan", count: 61 },
  { month: "Feb", count: 58 },
  { month: "Mar", count: 67 }
];

const departmentValueData = [
  { name: "Infrastructure", value: 45.7, color: "#0B3C5D" },
  { name: "Transport", value: 28.4, color: "#1D4E89" },
  { name: "Urban Dev", value: 15.8, color: "#2E8B57" },
  { name: "Healthcare", value: 12.3, color: "#F4A300" },
  { name: "IT", value: 8.5, color: "#B22222" },
  { name: "Education", value: 6.2, color: "#5A7C99" }
];

const performanceTrendData = [
  { month: "Oct", performance: 82 },
  { month: "Nov", performance: 85 },
  { month: "Dec", performance: 87 },
  { month: "Jan", performance: 89 },
  { month: "Feb", performance: 88 },
  { month: "Mar", performance: 91 }
];

export function DepartmentPerformance() {
  return (
    <div className="flex h-screen bg-[#F4F6F9]">
      <Sidebar role="cpo" />
      <div className="flex-1 overflow-auto">
        <div className="p-8">
          <div className="mb-8">
            <h1 className="text-2xl text-[#0B3C5D] mb-2">Department Performance Overview</h1>
            <p className="text-sm text-gray-600">Monitor procurement officer performance across all departments</p>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-600">Total POs</span>
                <Users className="w-5 h-5 text-[#1D4E89]" />
              </div>
              <div className="text-2xl text-[#0B3C5D] mb-1">6</div>
              <div className="text-xs text-[#2E8B57]">All Active</div>
            </div>

            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-600">Active Tenders</span>
                <FileText className="w-5 h-5 text-[#F4A300]" />
              </div>
              <div className="text-2xl text-[#0B3C5D] mb-1">58</div>
              <div className="text-xs text-gray-600">Across all departments</div>
            </div>

            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-600">Avg Success Rate</span>
                <CheckCircle className="w-5 h-5 text-[#2E8B57]" />
              </div>
              <div className="text-2xl text-[#0B3C5D] mb-1">88.2%</div>
              <div className="text-xs text-[#2E8B57]">+3.2% from last quarter</div>
            </div>

            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-600">Total Value</span>
                <TrendingUp className="w-5 h-5 text-[#0B3C5D]" />
              </div>
              <div className="text-2xl text-[#0B3C5D] mb-1">₹116.9 Cr</div>
              <div className="text-xs text-gray-600">Current FY</div>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Monthly Tender Trend */}
            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <h3 className="text-sm text-[#0B3C5D] mb-4">Monthly Tender Activity</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={monthlyTenderData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="month" stroke="#6B7280" style={{ fontSize: '12px' }} />
                  <YAxis stroke="#6B7280" style={{ fontSize: '12px' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'white',
                      border: '1px solid #E5E7EB',
                      borderRadius: '6px',
                      fontSize: '12px'
                    }}
                  />
                  <Bar dataKey="count" fill="#1D4E89" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Department Value Distribution */}
            <div className="bg-white p-6 rounded-lg border border-gray-200">
              <h3 className="text-sm text-[#0B3C5D] mb-4">Department-wise Tender Value (₹ Crores)</h3>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={departmentValueData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ₹${value}`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {departmentValueData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'white',
                      border: '1px solid #E5E7EB',
                      borderRadius: '6px',
                      fontSize: '12px'
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Overall Performance Trend */}
            <div className="bg-white p-6 rounded-lg border border-gray-200 lg:col-span-2">
              <h3 className="text-sm text-[#0B3C5D] mb-4">Overall Performance Trend (%)</h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={performanceTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="month" stroke="#6B7280" style={{ fontSize: '12px' }} />
                  <YAxis stroke="#6B7280" style={{ fontSize: '12px' }} domain={[70, 100]} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'white',
                      border: '1px solid #E5E7EB',
                      borderRadius: '6px',
                      fontSize: '12px'
                    }}
                  />
                  <Line type="monotone" dataKey="performance" stroke="#2E8B57" strokeWidth={2} dot={{ fill: '#2E8B57', r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Procurement Officers Table */}
          <div className="bg-white rounded-lg border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-sm text-[#0B3C5D]">Procurement Officer Performance Details</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left p-4 text-xs text-gray-600">Officer Name</th>
                    <th className="text-left p-4 text-xs text-gray-600">Department</th>
                    <th className="text-left p-4 text-xs text-gray-600">Active</th>
                    <th className="text-left p-4 text-xs text-gray-600">Completed</th>
                    <th className="text-left p-4 text-xs text-gray-600">Avg Time (days)</th>
                    <th className="text-left p-4 text-xs text-gray-600">Success Rate</th>
                    <th className="text-left p-4 text-xs text-gray-600">Total Value</th>
                    <th className="text-left p-4 text-xs text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {departmentData.map((dept) => (
                    <tr key={dept.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="p-4 text-sm text-gray-900">{dept.name}</td>
                      <td className="p-4 text-sm text-gray-600">{dept.department}</td>
                      <td className="p-4 text-sm text-gray-900">{dept.activeTenders}</td>
                      <td className="p-4 text-sm text-gray-900">{dept.completedTenders}</td>
                      <td className="p-4 text-sm text-gray-900">{dept.avgEvaluationTime}</td>
                      <td className="p-4">
                        <span className={`inline-flex items-center gap-1 text-sm ${
                          dept.successRate >= 90 ? 'text-[#2E8B57]' :
                          dept.successRate >= 85 ? 'text-[#F4A300]' :
                          'text-[#B22222]'
                        }`}>
                          {dept.successRate}%
                        </span>
                      </td>
                      <td className="p-4 text-sm text-gray-900">{dept.totalValue}</td>
                      <td className="p-4">
                        {dept.status === "excellent" && (
                          <span className="px-3 py-1 bg-[#2E8B57]/10 text-[#2E8B57] rounded-full text-xs">
                            Excellent
                          </span>
                        )}
                        {dept.status === "good" && (
                          <span className="px-3 py-1 bg-[#F4A300]/10 text-[#F4A300] rounded-full text-xs">
                            Good
                          </span>
                        )}
                        {dept.status === "needs-attention" && (
                          <span className="px-3 py-1 bg-[#B22222]/10 text-[#B22222] rounded-full text-xs flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            Needs Attention
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <AIAssistant role="cpo" />
    </div>
  );
}