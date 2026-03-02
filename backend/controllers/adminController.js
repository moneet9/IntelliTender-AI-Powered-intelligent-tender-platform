import bcrypt from 'bcryptjs';
import { User, Tender } from '../models/model.js';

const sanitizeUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  phone: user.phone,
  department: user.department,
  specialization: user.specialization,
  managerPo: user.managerPo,
  accountStatus: user.accountStatus,
  frozenUntil: user.frozenUntil,
  createdAt: user.createdAt,
});

export const createPO = async (req, res) => {
  try {
    const { name, email, password, phone, department } = req.body;
    if (!name || !email) {
      return res.status(400).json({ message: 'name and email are required' });
    }

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: 'User already exists' });

    const plainPassword = password || 'Password@123';
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role: 'PO',
      phone,
      department,
    });

    res.status(201).json({ ...sanitizeUser(user), generatedPassword: plainPassword });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const listPOs = async (_req, res) => {
  try {
    const pos = await User.find({ role: 'PO' }).sort({ createdAt: -1 });
    const payload = await Promise.all(
      pos.map(async (po) => {
        const committeeCount = await User.countDocuments({ role: 'Committee', managerPo: po._id });
        return { ...sanitizeUser(po), committeeCount };
      })
    );
    res.json(payload);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deletePO = async (req, res) => {
  try {
    const po = await User.findOne({ _id: req.params.id, role: 'PO' });
    if (!po) return res.status(404).json({ message: 'PO not found' });

    const deletedCommittees = await User.deleteMany({ role: 'Committee', managerPo: po._id });
    await po.deleteOne();

    res.json({
      message: 'PO removed successfully',
      removedPoId: po._id,
      removedCommitteeCount: deletedCommittees.deletedCount || 0,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createCommitteeMember = async (req, res) => {
  try {
    const { name, email, password, phone, specialization } = req.body;
    if (!name || !email) {
      return res.status(400).json({ message: 'name and email are required' });
    }

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: 'User already exists' });

    const plainPassword = password || 'Password@123';
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role: 'Committee',
      phone,
      specialization,
      managerPo: req.user.id,
    });

    res.status(201).json({ ...sanitizeUser(user), generatedPassword: plainPassword });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const listCommitteeMembers = async (req, res) => {
  try {
    const committees = await User.find({ role: 'Committee', managerPo: req.user.id }).sort({ createdAt: -1 });
    res.json(committees.map(sanitizeUser));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteCommitteeMember = async (req, res) => {
  try {
    const committee = await User.findOne({ _id: req.params.id, role: 'Committee', managerPo: req.user.id });
    if (!committee) return res.status(404).json({ message: 'Committee member not found' });

    await committee.deleteOne();
    res.json({ message: 'Committee member removed successfully', removedId: committee._id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const listVendors = async (_req, res) => {
  try {
    const vendors = await User.find({ role: 'Vendor' }).sort({ createdAt: -1 });
    res.json(vendors.map(sanitizeUser));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const freezeVendor = async (req, res) => {
  try {
    const { freezeUntil } = req.body;
    if (!freezeUntil) return res.status(400).json({ message: 'freezeUntil date is required' });

    const vendor = await User.findOne({ _id: req.params.id, role: 'Vendor' });
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    const untilDate = new Date(freezeUntil);
    if (Number.isNaN(untilDate.getTime()) || untilDate <= new Date()) {
      return res.status(400).json({ message: 'freezeUntil must be a valid future date' });
    }

    vendor.accountStatus = 'Frozen';
    vendor.frozenUntil = untilDate;
    await vendor.save();

    res.json({ message: 'Vendor account frozen', vendor: sanitizeUser(vendor) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deleteVendor = async (req, res) => {
  try {
    const vendor = await User.findOne({ _id: req.params.id, role: 'Vendor' });
    if (!vendor) return res.status(404).json({ message: 'Vendor not found' });

    vendor.accountStatus = 'Deleted';
    vendor.frozenUntil = null;
    await vendor.save();

    res.json({ message: 'Vendor account deleted', vendor: sanitizeUser(vendor) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getCpoAnalytics = async (_req, res) => {
  try {
    const pos = await User.find({ role: 'PO' }).lean();
    const poIds = pos.map((po) => po._id.toString());
    const tenders = await Tender.find({ createdBy: { $in: poIds } }).lean();

    const departmentMap = new Map();
    const poPerformance = [];

    for (const po of pos) {
      const poId = po._id.toString();
      const poTenders = tenders.filter((tender) => tender.createdBy.toString() === poId);
      const committeeMembers = await User.find({ role: 'Committee', managerPo: po._id }).lean();
      const committeeIds = committeeMembers.map((member) => member._id.toString());

      const awardedCount = poTenders.filter((tender) => tender.status === 'Awarded').length;
      const totalBids = poTenders.reduce((sum, tender) => sum + (tender.bids?.length || 0), 0);
      const evaluatedByCommittee = poTenders.reduce((sum, tender) => {
        const bidList = tender.bids || [];
        return sum + bidList.filter((bid) => bid.evaluatedBy && committeeIds.includes(bid.evaluatedBy.toString())).length;
      }, 0);

      const departmentKey = po.department || 'Unassigned';
      const existingDepartment = departmentMap.get(departmentKey) || {
        department: departmentKey,
        totalTenders: 0,
        awardedTenders: 0,
      };
      existingDepartment.totalTenders += poTenders.length;
      existingDepartment.awardedTenders += awardedCount;
      departmentMap.set(departmentKey, existingDepartment);

      poPerformance.push({
        poId,
        poName: po.name,
        department: departmentKey,
        committeeCount: committeeMembers.length,
        totalTenders: poTenders.length,
        awardedTenders: awardedCount,
        totalBids,
        committeeEvaluations: evaluatedByCommittee,
      });
    }

    res.json({
      departmentPerformance: Array.from(departmentMap.values()),
      poPerformance,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
