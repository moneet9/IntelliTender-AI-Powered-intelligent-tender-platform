import { Tender, Contract, User } from '../models/model.js';

// --- TENDER MANAGEMENT ---
export const createTender = async (req, res) => {
    try {
        const { title, description, budget, deadline } = req.body;
        const tender = await Tender.create({
            title,
            description,
            budget,
            deadline,
            createdBy: req.user.id
        });
        res.status(201).json(tender);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

export const getTenders = async (req, res) => {
    try {
        const tenders = await Tender.find().populate('createdBy', 'name');
        res.json(tenders);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

export const getTenderById = async (req, res) => {
    try {
        const tender = await Tender.findById(req.params.id);
        if (!tender) return res.status(404).json({ message: 'Tender not found' });
        res.json(tender);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

export const editTender = async (req, res) => {
     try {
        const tender = await Tender.findByIdAndUpdate(req.params.id, req.body, { new: true });
        res.json(tender);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

export const publishTender = async (req, res) => {
     try {
        const tender = await Tender.findById(req.params.id);
        if (!tender) return res.status(404).json({ message: 'Tender not found' });
        if (tender.status !== 'Draft') return res.status(400).json({ message: 'Only draft tender can be published' });
        tender.status = 'Published';
        await tender.save();
        res.json(tender);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

export const closeTender = async (req, res) => {
     try {
        const tender = await Tender.findById(req.params.id);
        if (!tender) return res.status(404).json({ message: 'Tender not found' });
        if (!['Published', 'Draft'].includes(tender.status)) return res.status(400).json({ message: 'Tender cannot be closed in current status' });
        tender.status = 'Closed';
        await tender.save();
        res.json(tender);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// --- BID SUBMISSION ---
export const submitBid = async (req, res) => {
    try {
        const tender = await Tender.findById(req.params.id);
        if (!tender) return res.status(404).json({ message: 'Tender not found' });
        if (tender.status !== 'Published') return res.status(400).json({ message: 'Tender is not published' });
        if (new Date() > new Date(tender.deadline)) return res.status(400).json({ message: 'Deadline passed' });

        const existingBid = tender.bids.find(b => b.vendorId.toString() === req.user.id);
        if(existingBid) return res.status(400).json({ message: 'Already bid on this tender' });

        if (!req.body.proposedAmount || Number(req.body.proposedAmount) <= 0) {
            return res.status(400).json({ message: 'Valid proposedAmount is required' });
        }

        const vendor = await User.findById(req.user.id);
        if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

        tender.bids.push({
            vendorId: req.user.id,
            vendorName: vendor.name,
            proposedAmount: req.body.proposedAmount,
            proposalDocument: req.body.proposalDocument || 'mock_doc_link'
        });
        
        await tender.save();
        res.status(201).json({ message: 'Bid submitted' });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

export const getBidsByTender = async (req, res) => {
    try {
        const tender = await Tender.findById(req.params.id);
        if (!tender) return res.status(404).json({ message: 'Tender not found' });
        res.json(tender.bids);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};

// --- MANUAL EVALUATION ---
export const evaluateBid = async (req, res) => {
     try {
        const tender = await Tender.findById(req.params.tenderId);
        if (!tender) return res.status(404).json({ message: 'Tender not found' });

        const bid = tender.bids.id(req.params.bidId); // Mongoose specific syntax to find subdocument
        if (!bid) return res.status(404).json({ message: 'Bid not found' });

        if (bid.status !== 'Pending' && bid.status !== 'Evaluated') {
            return res.status(400).json({ message: 'Bid is not in evaluatable state' });
        }

        if (typeof req.body.technicalScore !== 'number' || typeof req.body.financialScore !== 'number') {
            return res.status(400).json({ message: 'technicalScore and financialScore must be numbers' });
        }

        bid.technicalScore = req.body.technicalScore;
        bid.financialScore = req.body.financialScore;
        bid.comments = req.body.comments;
        bid.status = 'Evaluated';
        bid.evaluatedBy = req.user.id;
        bid.evaluatedDate = new Date();

        await tender.save();
        res.json({ message: 'Bid evaluated', bid });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// --- BID COMPARISON & AWARD ---
export const getEvaluatedBids = async (req, res) => {
   try {
        const tender = await Tender.findById(req.params.id);
        if (!tender) return res.status(404).json({ message: 'Tender not found' });
        const evaluatedBids = tender.bids.filter(b => b.status === 'Evaluated' || b.status === 'Selected' || b.status === 'Rejected');
        
        // Example: Sort by score descending then amount ascending
        evaluatedBids.sort((a,b) => (b.technicalScore||0) - (a.technicalScore||0) || a.proposedAmount - b.proposedAmount);

        res.json(evaluatedBids);
    } catch (e) { res.status(500).json({ error: e.message }); } 
};

export const selectWinner = async (req, res) => {
    try {
        const tender = await Tender.findById(req.params.tenderId);
        if (!tender) return res.status(404).json({ message: 'Tender not found' });
        
        const winningBid = tender.bids.id(req.params.bidId);
        if (!winningBid) return res.status(404).json({ message: 'Bid not found' });

        if (winningBid.status !== 'Evaluated') {
            return res.status(400).json({ message: 'Only evaluated bid can be selected as winner' });
        }

        tender.status = 'Awarded';
        
        tender.bids.forEach(bid => {
            if(bid._id.toString() === req.params.bidId) {
                bid.status = 'Selected';
            } else {
                bid.status = 'Rejected';
            }
        });

        await tender.save();

        const contract = await Contract.create({
            tenderId: tender._id,
            vendorId: winningBid.vendorId,
            status: 'Awarded'
        });

        res.json({ message: 'Winner selected and contract created', tenderId: tender._id, contractId: contract._id });
    } catch (e) { res.status(500).json({ error: e.message }); }
};