import { useState, useRef, useEffect } from "react";
import { MessageSquare, Send, X, Bot } from "lucide-react";
import { apiRequest } from "../api";

interface AIAssistantProps {
  role: "cpo" | "po" | "committee" | "vendor" | "bidder";
}

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

const sampleQuestions = [
  "What is the delay status for TND-2026-046?",
  "Show penalty clause for late delivery",
  "What is the risk history of Premier IT Services?",
  "Explain AI evaluation for TND-2026-047",
  "Show audit trail for contract CNT-2026-045",
  "How to submit a bid?",
  "What documents are required for tender?",
  "Show my contract performance score",
];

const demoConversations = [
  {
    user: "Show me active tenders in IT category",
    assistant: `**Active IT Tenders (3 found)**

📋 **TND-2026-048 - Cloud Infrastructure Setup**
- Budget: $850,000
- Deadline: March 15, 2026
- Status: Open for Bidding
- Documents Required: 5

📋 **TND-2026-049 - Cybersecurity Assessment**
- Budget: $320,000  
- Deadline: March 22, 2026
- Status: Open for Bidding
- Documents Required: 4

📋 **TND-2026-050 - Enterprise Portal Development**
- Budget: $1,200,000
- Deadline: March 28, 2026
- Status: Open for Bidding
- Documents Required: 6

💡 **Tip:** Click on any tender to view full details and submit your bid.`,
  },
  {
    user: "What documents do I need for tender submission?",
    assistant: `**Required Documents for Tender Submission**

✅ **Mandatory Documents:**
1. Company Registration Certificate
2. Tax Compliance Certificate (Valid)
3. Financial Statements (Last 3 years)
4. Bank Reference Letter
5. Technical Proposal Document
6. Commercial/Price Proposal

✅ **Supporting Documents:**
7. Previous Project References (minimum 3)
8. Quality Certifications (ISO 9001, etc.)
9. Professional Licenses
10. Insurance Coverage Certificate

⚠️ **Important Notes:**
- All documents must be less than 6 months old
- Scanned copies must be clear and legible
- Submit in PDF format only
- Maximum file size: 5MB per document

📎 **Upload Format:** PDF only
🕐 **Submission Deadline:** Check individual tender`,
  },
  {
    user: "Show my performance analytics",
    assistant: `**Your Performance Dashboard**

**Overall Performance Score: 91.2/100** 🌟

**Contract Success Rate:**
✅ Completed Successfully: 22 contracts
⚠️ Minor Issues: 1 contract
❌ Failed: 0 contracts

**Financial Performance:**
- Total Contract Value: $8,700,000
- Average Contract Size: $378,261
- On-Time Payment: 100%

**Quality Metrics:**
- Technical Compliance: 96%
- Documentation Quality: 94%
- Delivery Timeliness: 91%

**Risk Assessment:**
- Current Risk Level: **LOW (5%)**
- Risk Trend: ⬇️ Decreasing
- Compliance Score: 94/100

**Recent Achievements:**
🏆 Perfect delivery record in Q4 2025
🏆 Zero quality complaints in 2025
🏆 Fastest bid response time (avg 2.3 days)

**Areas for Improvement:**
- Reduce average delivery time by 2 days
- Improve document submission speed

Keep up the excellent work! 👏`,
  },
];

const demoResponses: { [key: string]: string } = {
  delay: `**Project Delay Analysis - TND-2026-046**

**Contract:** Road Construction Project
**Contractor:** BuildTech Solutions
**Status:** 12 days behind schedule

**Timeline Analysis:**
- Original Completion Date: February 18, 2026
- Current Date: March 1, 2026
- Delay Duration: 12 days

**Milestone Status:**
✓ Foundation Work - Completed (On Time)
✓ Initial Construction - Completed (2 days delay)
⚠ Primary Structure - In Progress (12 days delay)

**Risk Assessment:** Medium Risk
**Recommended Action:** Review penalty clause 7.3`,

  penalty: `**Penalty Clause Analysis**

**Contract Reference:** Standard Procurement Terms & Conditions
**Clause 7.3 - Late Delivery Penalties**

**For Supply Contracts:**
- First 5 days: Warning only
- 6-10 days: $1,000 per day
- Over 10 days: $2,400 per day

**For Work Contracts:**
- First 7 days: Warning only
- 8-14 days: $2,400 per day
- Over 14 days: $3,500 per day + potential contract termination

**Current Application:**
For TND-2026-046 (Work Contract):
- Delay: 12 days
- Penalty Rate: $2,400/day
- **Total Penalty: $28,800**

**Payment Terms:** Deducted from final payment
**Appeal Period:** 10 business days from notice`,

  risk: `**Bidder Risk Profile - Premier IT Services**

**Company ID:** BID-00152
**Registration Date:** January 2019

**Performance Metrics:**
- Total Contracts: 23
- Success Rate: 96%
- Average Performance Score: 91.2/100
- Compliance Score: 94/100

**Risk Evolution (Last 6 Months):**
- August 2025: 12% (Medium)
- December 2025: 8% (Low)
- **February 2026: 5% (Low)**

**Historical Flags:**
- Total Flags: 3 (All resolved)
- High Risk Incidents: 0
- Penalties Imposed: 1 ($5,500 - Late delivery 2024)

**Contract Value:**
- Total Awarded: $8.7M
- Average Contract: $378,000

**Recommendation:** ✅ Low Risk - Approved for high-value contracts
**Last Updated:** March 1, 2026`,

  evaluation: `**AI Evaluation Explanation - TND-2026-047**

**Tender:** Medical Equipment Supply
**Evaluation Date:** February 28, 2026
**Total Bidders:** 4

**Top Ranked Bidder: Premier IT Services**

**Weighted Score Breakdown:**
1. **Price (40% weight):**
   - Bid Amount: $492,000
   - Budget: $750,000
   - Competitiveness: 93.2%
   - Score: 37.3/40

2. **Quality (25% weight):**
   - Technical Compliance: 96%
   - Certification Score: 100%
   - Score: 24.0/25

3. **Experience (20% weight):**
   - Years in Business: 15
   - Similar Projects: 12
   - Score: 19.2/20

4. **Timeline (15% weight):**
   - Proposed Duration: 45 days
   - Required: 60 days
   - Score: 14.0/15

**Final AI Score: 91.2/100**

**Risk Assessment:**
- Document Verification: ✅ Passed
- Financial Stability: ✅ Strong
- Past Performance: ✅ Excellent
- **Overall Risk: 5% (Low)**

**AI Recommendation:** ✅ **APPROVE** - Highest scored bidder with low risk profile`,

  audit: `**Audit Trail - Contract CNT-2026-045**

**Contract:** Office Furniture Supply
**Contractor:** Premier IT Services
**Value:** $285,000
**Status:** Completed

**Complete Activity Log:**

**2026-01-15 09:23:45** - Tender Published (TND-2026-045)
- Officer: Michael Chen (PO)
- Budget Allocated: $300,000

**2026-01-28 14:32:10** - Bid Submission
- Bidder: Premier IT Services
- Amount: $285,000

**2026-01-28 14:35:22** - Bid Submission
- Bidder: Office Solutions Inc
- Amount: $295,000

**2026-02-05 10:15:30** - AI Evaluation Completed
- System: AI Engine v3.2
- Top Score: Premier IT Services (91.2)

**2026-02-06 11:20:15** - Committee Review
- Officer: David Rodriguez (Committee)
- Decision: Approved with recommendation

**2026-02-10 15:45:00** - Final Award Approval
- Officer: Sarah Johnson (CPO)
- **Contract Awarded to: Premier IT Services**

**2026-02-28 09:00:00** - Delivery Completed
- Verification: All items received
- Quality Check: Passed

**2026-03-01 10:30:00** - Payment Released
- Amount: $285,000
- Status: Completed

**Compliance Status:** ✅ Fully Compliant
**No Flags or Violations Recorded**`,

  submit: `**How to Submit a Bid - Step by Step Guide**

**Step 1: Review Tender Requirements**
- Read tender document thoroughly
- Check eligibility criteria
- Note submission deadline

**Step 2: Prepare Documents**
✅ Technical Proposal
✅ Financial Proposal
✅ Company Registration
✅ Tax Compliance Certificate
✅ Previous Project References
✅ Financial Statements

**Step 3: Submit Online**
1. Navigate to "Available Tenders"
2. Click on desired tender
3. Click "Submit Bid" button
4. Upload required documents
5. Fill pricing details
6. Review and confirm submission

**Step 4: Track Status**
- Check "My Submissions" page
- Monitor evaluation progress
- Respond to clarifications if requested

**Important:**
⏰ Submit before deadline
📎 Max file size: 5MB per document
📄 PDF format only
✍️ Digital signature required

**Need Help?** Contact procurement@intellitender.com`,

  performance: `**Your Performance Dashboard**

**Overall Score: 91.2/100** ⭐⭐⭐⭐⭐

**Contract Statistics:**
- Total Contracts: 23
- Active: 2
- Completed: 21
- Success Rate: 96%

**Financial Overview:**
- Total Value: $8,700,000
- Avg Contract: $378,261
- Payment Status: 100% On-time

**Quality Metrics:**
 Technical Compliance: 96%
📊 Delivery Timeliness: 91%
📊 Documentation Quality: 94%
📊 Customer Satisfaction: 4.8/5

**Risk Profile:**
✅ Current Risk: LOW (5%)
✅ Compliance: 94/100
✅ Financial Health: Strong

**Monthly Trend:**
Jan 2026: 90.5
Feb 2026: 91.2 (↑ 0.7)

**Recommendations:**
- Maintain current quality standards
- Improve delivery speed by 5%
- Continue excellent documentation`,
};

export function AIAssistant({ role }: AIAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  
  // Role-specific welcome messages
  const getWelcomeMessage = () => {
    switch (role) {
      case "vendor":
      case "bidder":
        return "Hello! I can help you find contracts, understand tender requirements, check your performance scores, and guide you through the bidding process. What would you like to know?";
      case "po":
        return "Hello! I can assist you with creating tenders, evaluating bids, tracking milestones, and managing procurement workflows. How can I help you today?";
      case "committee":
        return "Hello! I can help you with bid evaluations, AI scoring explanations, risk assessments, and milestone updates. What do you need assistance with?";
      case "cpo":
        return "Hello! I can provide insights on overall procurement performance, audit trails, compliance reports, and strategic oversight. How may I assist you?";
      default:
        return "Hello! I'm the IntelliTender AI Assistant. How may I assist you today?";
    }
  };
  
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: getWelcomeMessage(),
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);
  const [input, setInput] = useState("");
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const handleSend = async (question?: string) => {
    const messageText = question || input;
    if (!messageText.trim()) return;

    // Add user message
    const userMessage: Message = {
      role: "user",
      content: messageText,
      timestamp: new Date().toLocaleTimeString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsSending(true);

    try {
      const conversation = [...messages, userMessage]
        .slice(-8)
        .map((entry) => ({ role: entry.role, content: entry.content }));

      const response = await apiRequest<{ reply: string }>("/api/ai/chat", {
        method: "POST",
        body: {
          message: messageText,
          role,
          messages: conversation,
        },
      });

      const aiMessage: Message = {
        role: "assistant",
        content: response.reply || "No response received from the AI service.",
        timestamp: new Date().toLocaleTimeString(),
      };

      setMessages((prev) => [...prev, aiMessage]);
    } catch (error) {
      const aiMessage: Message = {
        role: "assistant",
        content:
          error instanceof Error
            ? `I couldn't reach the AI service: ${error.message}`
            : "I couldn't reach the AI service. Make sure Ollama is running and try again.",
        timestamp: new Date().toLocaleTimeString(),
      };

      setMessages((prev) => [...prev, aiMessage]);
    } finally {
      setIsSending(false);
    }
  };

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-12 h-12 bg-[#1D4E89] hover:bg-[#154068] text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110 z-50"
      >
        <MessageSquare className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-96 h-[600px] bg-white rounded-lg shadow-2xl flex flex-col z-50 border border-gray-200">
      {/* Header */}
      <div className="bg-[#0B3C5D] text-white p-4 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5" />
          <div>
            <h3 className="text-sm">IntelliTender AI Assistant</h3>
            <p className="text-xs text-white/70">Always here to help</p>
          </div>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="hover:bg-white/10 p-1 rounded transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Sample Questions */}
      <div className="p-3 bg-blue-50 border-b border-gray-200">
        <p className="text-xs text-gray-600 mb-2">Quick Questions:</p>
        <div className="flex flex-wrap gap-1">
          {sampleQuestions.slice(0, 3).map((q, i) => (
            <button
              key={i}
              onClick={() => handleSend(q)}
              className="text-xs px-2 py-1 bg-white border border-blue-200 rounded-full hover:bg-blue-100 transition-colors text-[#1D4E89]"
            >
              {q.length > 30 ? q.substring(0, 30) + "..." : q}
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4" ref={chatContainerRef}>
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg p-3 ${
                message.role === "user"
                  ? "bg-[#1D4E89] text-white"
                  : "bg-gray-100 text-gray-800"
              }`}
            >
              <p className="text-sm whitespace-pre-line">{message.content}</p>
              <p
                className={`text-xs mt-1 ${
                  message.role === "user" ? "text-white/70" : "text-gray-500"
                }`}
              >
                {message.timestamp}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-200">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask me anything..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89] text-sm"
          />
          <button
            onClick={() => handleSend()}
            disabled={isSending}
            className="px-4 py-2 bg-[#1D4E89] hover:bg-[#154068] text-white rounded-md transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}