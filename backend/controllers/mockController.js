// Mock Controllers for Demo Features
export const getAnalytics = (req, res) => {
    res.json({
        totalTenders: 42,
        activeTenders: 12,
        awardedContracts: 20,
        totalVendors: 156,
        performanceData: [
            { month: 'Jan', bids: 65, awards: 4 },
            { month: 'Feb', bids: 89, awards: 6 }
        ]
    });
};

export const getNotifications = (req, res) => {
    res.json([
        { id: 1, text: 'New bid received for Tender #1234', date: new Date(), read: false },
        { id: 2, text: 'Tender deadline approaching: Software Licensing', date: new Date(), read: true }
    ]);
};

export const getAuditLogs = (req, res) => {
    res.json([
        { action: 'CREATE_TENDER', userRole: 'PO', timestamp: new Date(), details: 'Created tender for Laptops' },
        { action: 'SUBMIT_BID', userRole: 'Vendor', timestamp: new Date(), details: 'Bid submitted' }
    ]);
};

export const getDocuments = (req, res) => {
    res.json([
        { id: 'doc1', name: 'RFP_Final.pdf', type: 'application/pdf', uploadedBy: 'CPO' },
        { id: 'doc2', name: 'Vendor_Compliance.docx', type: 'application/docx', uploadedBy: 'Vendor' }
    ]);
};

export const getVendorPerformance = (req, res) => {
    res.json([
         { vendorId: 'v1', name: 'TechCorp', onTimeDeliveryRate: 0.95, qualityScore: 8.8, totalContracts: 12 },
         { vendorId: 'v2', name: 'GlobalSupplies', onTimeDeliveryRate: 0.82, qualityScore: 7.4, totalContracts: 3 }
    ]);
};