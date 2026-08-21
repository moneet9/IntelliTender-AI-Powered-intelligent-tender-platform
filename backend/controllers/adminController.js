import bcrypt from 'bcryptjs';
import { User, Tender, Contract, AIBidSummary, AIMilestoneReport, ResearchMetricEvent } from '../models/model.js';
import { formatMetricEvent } from '../utils/researchMetrics.js';

const sanitizeUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  phone: user.phone,
  department: user.department,
  specialization: user.specialization,
  designation: user.designation,
  managerPo: user.managerPo,
  accountStatus: user.accountStatus,
  frozenUntil: user.frozenUntil,
  createdAt: user.createdAt,
});

const average = (values) => {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (!numbers.length) return 0;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
};

const round = (value, fractionDigits = 2) => Number(Number(value || 0).toFixed(fractionDigits));

const getAiCommitteeConsistency = (tenders, aiSummaries) => {
  const comparisons = [];
  const summariesByBid = new Map(aiSummaries.map((summary) => [String(summary.bidId), summary]));

  tenders.forEach((tender) => {
    (tender.bids || []).forEach((bid) => {
      const ai = summariesByBid.get(String(bid._id));
      const evaluations = Array.isArray(bid.committeeEvaluations) ? bid.committeeEvaluations : [];
      if (!ai?.aiScores || !evaluations.length) return;

      const maxTechnical = (tender.qcbsConfig?.technicalCriteria || [])
        .reduce((sum, criterion) => sum + Number(criterion.maxMarks || 0), 0);
      const committeeTechnical = average(evaluations.map((item) => Number(item.technicalScore || 0)));
      const aiTechnical = Math.min(100, Math.max(0, Number(ai.aiScores.technicalScore || 0)));
      const committeeTechnicalNormalized = maxTechnical > 0
        ? Math.min(100, Math.max(0, (committeeTechnical / maxTechnical) * 100))
        : Math.min(100, Math.max(0, committeeTechnical));
      const technicalDifference = Math.abs(aiTechnical - committeeTechnicalNormalized);

      // Financial scores for QCBS are already normalized to a 0–100 scale.
      // For L1, financialScore is a price, so compare technical scores only.
      if (tender.evaluationMethod === 'L1') {
        comparisons.push(Math.max(0, 100 - technicalDifference));
        return;
      }
      const committeeFinancial = average(evaluations.map((item) => Number(item.financialScore || 0)));
      const aiFinancial = Math.min(100, Math.max(0, Number(ai.aiScores.financialScore || 0)));
      const committeeFinancialNormalized = Math.min(100, Math.max(0, committeeFinancial));
      const financialDifference = Math.abs(aiFinancial - committeeFinancialNormalized);
      comparisons.push(Math.max(0, 100 - ((technicalDifference + financialDifference) / 2)));
    });
  });

  return comparisons.length ? round(average(comparisons)) : null;
};

const buildResearchLogs = async ({ tenderIds = [], contractIds = [], actorId = null, actorRole = null, limit = 10 }) => {
  // Keep the research feed outcome-focused. Low-level local model calls are
  // summarized separately and should not drown out tender/bid/milestone work.
  const query = { eventType: { $nin: ['local-ai-inference'] } };
  const scopeClauses = [];
  if (tenderIds.length) {
    scopeClauses.push({ tenderId: { $in: tenderIds } });
  }
  if (contractIds.length) {
    scopeClauses.push({ contractId: { $in: contractIds } });
  }
  if (scopeClauses.length) {
    query.$or = scopeClauses;
  }
  if (actorId) {
    query.actorId = actorId;
  }
  if (actorRole) {
    query.actorRole = actorRole;
  }

  const logs = await ResearchMetricEvent.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return logs.map(formatMetricEvent);
};

const buildResearchSummary = async ({ tenderFilter, actorId, actorRole, limit = 8 }) => {
  const tenders = await Tender.find(tenderFilter).lean();
  const tenderIds = tenders.map((tender) => tender._id);
  const contracts = await Contract.find({ tenderId: { $in: tenderIds } }).lean();
  const aiSummaries = await AIBidSummary.find({ tenderId: { $in: tenderIds } }).lean();
  const milestoneReports = await AIMilestoneReport.find({ tenderId: { $in: tenderIds } }).lean();
  const contractIds = contracts.map((contract) => contract._id);
  const logs = await buildResearchLogs({ tenderIds, contractIds, actorId, actorRole, limit });

  const aiEvaluationEvents = await ResearchMetricEvent.find({
    eventType: 'ai-bid-scoring',
    tenderId: { $in: tenderIds },
    status: 'success',
  }).lean();
  const committeeEvaluationEvents = await ResearchMetricEvent.find({
    eventType: 'committee-evaluation',
    tenderId: { $in: tenderIds },
    status: 'success',
  }).lean();
  const chatEvents = await ResearchMetricEvent.find({
    eventType: 'chat-query',
    ...(actorId ? { actorId } : {}),
    status: 'success',
  }).lean();
  const aiEvaluationAvgMs = round(average(aiEvaluationEvents.map((event) => Number(event.durationMs || 0))));
  const committeeEvaluationAvgMs = round(average(committeeEvaluationEvents.map((event) => Number(event.durationMs || 0))));
  const chatQueryAvgMs = round(average(chatEvents.map((event) => Number(event.durationMs || 0))));
  const bidsProcessedPerHour = aiEvaluationAvgMs > 0 ? round(3600000 / aiEvaluationAvgMs) : 0;

  const aiRiskCount = aiSummaries.reduce((sum, summary) => (
    sum
      + (Array.isArray(summary?.genuityChecks?.warnings) ? summary.genuityChecks.warnings.length : 0)
      + (Array.isArray(summary?.commercialAnalysis?.risks) ? summary.commercialAnalysis.risks.length : 0)
  ), 0);
  const milestoneRiskCount = milestoneReports.reduce((sum, report) => sum + (Array.isArray(report.alerts) ? report.alerts.length : 0), 0);
  const errorCount = aiSummaries.filter((summary) => summary.status === 'failed').length
    + milestoneReports.filter((report) => report.status === 'failed').length
    + (await ResearchMetricEvent.countDocuments({
      tenderId: { $in: tenderIds },
      status: 'failed',
      eventType: { $nin: ['local-ai-inference'] },
    }));

  return {
    totals: {
      tenders: tenders.length,
      contracts: contracts.length,
      aiScoredBids: aiSummaries.filter((summary) => summary.status === 'success').length,
      committeeReviews: committeeEvaluationEvents.length,
    },
    metrics: {
      aiEvaluationAvgMs,
      committeeEvaluationAvgMs,
      chatQueryAvgMs,
      bidsProcessedPerHour,
      aiCommitteeConsistency: getAiCommitteeConsistency(tenders, aiSummaries),
      errorCount,
      riskyItemsDetected: aiRiskCount + milestoneRiskCount,
    },
    logs,
  };
};

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

export const updatePO = async (req, res) => {
  try {
    const { name, email, phone, department, accountStatus } = req.body;
    if (!name || !email) {
      return res.status(400).json({ message: 'name and email are required' });
    }

    const po = await User.findOne({ _id: req.params.id, role: 'PO' });
    if (!po) return res.status(404).json({ message: 'PO not found' });

    const emailInUse = await User.findOne({ email, _id: { $ne: po._id } });
    if (emailInUse) return res.status(400).json({ message: 'Email already in use' });

    po.name = name;
    po.email = email;
    po.phone = phone;
    po.department = department;
    if (accountStatus) po.accountStatus = accountStatus;
    await po.save();

    const committeeCount = await User.countDocuments({ role: 'Committee', managerPo: po._id });
    res.json({ ...sanitizeUser(po), committeeCount });
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
    const { name, email, password, phone, designation, specialization } = req.body;
    if (!name || !email) {
      return res.status(400).json({ message: 'name and email are required' });
    }

    const designationValue = (designation || specialization || '').trim();
    if (!designationValue) {
      return res.status(400).json({ message: 'designation is required' });
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
      specialization: specialization || designationValue,
      designation: designationValue,
      managerPo: req.user.id,
    });

    res.status(201).json({ ...sanitizeUser(user), generatedPassword: plainPassword });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateCommitteeMember = async (req, res) => {
  try {
    const { name, email, phone, designation, specialization, accountStatus } = req.body;
    if (!name || !email) {
      return res.status(400).json({ message: 'name and email are required' });
    }

    const designationValue = (designation || specialization || '').trim();

    const committee = await User.findOne({ _id: req.params.id, role: 'Committee', managerPo: req.user.id });
    if (!committee) return res.status(404).json({ message: 'Committee member not found' });

    const emailInUse = await User.findOne({ email, _id: { $ne: committee._id } });
    if (emailInUse) return res.status(400).json({ message: 'Email already in use' });

    committee.name = name;
    committee.email = email;
    committee.phone = phone;
    if (designationValue) {
      committee.designation = designationValue;
      committee.specialization = specialization || designationValue;
    }
    if (accountStatus) committee.accountStatus = accountStatus;
    await committee.save();

    res.json(sanitizeUser(committee));
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

    vendor.accountStatus = 'Suspended';
    vendor.frozenUntil = null;
    await vendor.save();

    res.json({ message: 'Vendor account suspended', vendor: sanitizeUser(vendor) });
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
        return sum + bidList.reduce((bidSum, bid) => {
          const evaluations = Array.isArray(bid.committeeEvaluations) ? bid.committeeEvaluations : [];
          if (evaluations.length) {
            return bidSum + evaluations.filter(
              (evaluation) => evaluation.committeeMemberId && committeeIds.includes(evaluation.committeeMemberId.toString())
            ).length;
          }

          return bidSum + (bid.evaluatedBy && committeeIds.includes(bid.evaluatedBy.toString()) ? 1 : 0);
        }, 0);
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

export const getPoAnalytics = async (req, res) => {
  try {
    const tenderFilter = { createdBy: req.user.id };
    const summary = await buildResearchSummary({ tenderFilter, actorId: req.user.id, actorRole: 'PO', limit: 12 });
    const tenders = await Tender.find(tenderFilter).lean();

    const publishedTenders = tenders.filter((tender) => tender.status === 'Published').length;
    const totalSubmissions = tenders.reduce((sum, tender) => sum + (tender.bids?.length || 0), 0);
    const committeeCount = await User.countDocuments({ role: 'Committee', managerPo: req.user.id });

    res.json({
      ...summary,
      dashboard: {
        publishedTenders,
        totalSubmissions,
        committeeCount,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getCpoResearchAnalytics = async (_req, res) => {
  try {
    const tenderFilter = {};
    const summary = await buildResearchSummary({ tenderFilter, actorRole: null, limit: 12 });
    const tenderCount = await Tender.countDocuments({});
    const poCount = await User.countDocuments({ role: 'PO' });
    const committeeCount = await User.countDocuments({ role: 'Committee' });

    res.json({
      ...summary,
      dashboard: {
        tenderCount,
        poCount,
        committeeCount,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const purgeLegacyInferenceMetrics = async (_req, res) => {
  try {
    const result = await ResearchMetricEvent.deleteMany({ eventType: 'local-ai-inference' });
    return res.json({
      removed: Number(result.deletedCount || 0),
      message: 'Legacy per-inference token and embedding metrics removed. Bid-level metrics are retained.',
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Failed to remove legacy inference metrics' });
  }
};
