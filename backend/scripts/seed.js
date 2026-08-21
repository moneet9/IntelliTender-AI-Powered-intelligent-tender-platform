import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { connectDB } from '../config/db.js';
import { User, Tender, Contract } from '../models/model.js';

dotenv.config();

const createStoredAsset = ({ name, body, mimeType = 'text/plain' }) =>
  JSON.stringify({
    name,
    content: `data:${mimeType};base64,${Buffer.from(body, 'utf8').toString('base64')}`,
    mimeType,
  });

const createStoredTextDocument = (name, lines) =>
  createStoredAsset({
    name,
    body: Array.isArray(lines) ? lines.join('\n') : lines,
    mimeType: 'text/plain',
  });

const createStoredSvgImage = (name, label, accent = '#1D4E89') =>
  createStoredAsset({
    name,
    mimeType: 'image/svg+xml',
    body: `
      <svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
        <rect width="960" height="540" fill="#F4F6F9" />
        <rect x="40" y="40" width="880" height="460" rx="24" fill="${accent}" opacity="0.95" />
        <text x="80" y="170" fill="#ffffff" font-size="42" font-family="Arial, Helvetica, sans-serif">${label}</text>
        <text x="80" y="235" fill="#ffffff" font-size="24" font-family="Arial, Helvetica, sans-serif">IntelliTender seeded evidence asset</text>
      </svg>
    `.trim(),
  });

const buildTenderDocument = (tenderTitle, fileName, section) =>
  createStoredTextDocument(fileName, [
    'IntelliTender Demo Tender Document',
    `Tender: ${tenderTitle}`,
    `Section: ${section}`,
    'This file was seeded so you can test document visibility, download, and review flows.',
  ]);

const buildProposalDocument = (vendorName, tenderTitle, fileName) =>
  createStoredTextDocument(fileName, [
    'IntelliTender Demo Proposal',
    `Vendor: ${vendorName}`,
    `Tender: ${tenderTitle}`,
    'This seeded proposal simulates an uploaded vendor PDF document.',
  ]);

const buildProgressAttachment = (title, fileName) =>
  createStoredTextDocument(fileName, [
    'IntelliTender Progress Attachment',
    `Subject: ${title}`,
    'This attachment is included for testing report and milestone evidence flows.',
  ]);

const asDate = (value) => new Date(value);

const upsertUser = async ({
  name,
  email,
  role,
  password,
  phone,
  department,
  specialization,
  accountStatus,
  managerPo,
}) => {
  const hashedPassword = await bcrypt.hash(password, 10);

  const update = {
    name,
    email,
    role,
    password: hashedPassword,
  };

  if (phone) update.phone = phone;
  if (department) update.department = department;
  if (specialization) update.specialization = specialization;
  if (accountStatus) update.accountStatus = accountStatus;
  if (managerPo) update.managerPo = managerPo;

  return User.findOneAndUpdate(
    { email },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const upsertTender = async (title, payload) =>
  Tender.findOneAndUpdate(
    { title },
    { $set: { title, ...payload } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

const upsertContract = async (tenderId, vendorId, payload) =>
  Contract.findOneAndUpdate(
    { tenderId, vendorId },
    { $set: { tenderId, vendorId, ...payload } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

const seed = async () => {
  try {
    await connectDB();

    const cpo = await upsertUser({
      name: 'Priya Sharma',
      email: 'cpo@intellitender.local',
      role: 'CPO',
      password: 'Password@123',
    });

    const po = await upsertUser({
      name: 'Rajesh Kumar',
      email: 'po@intellitender.local',
      role: 'PO',
      password: 'Password@123',
    });

    const committee = await upsertUser({
      name: 'Anil Verma',
      email: 'committee@intellitender.local',
      role: 'Committee',
      password: 'Password@123',
      managerPo: po._id,
    });

    const vendor1 = await upsertUser({
      name: 'ABC Corporation',
      email: 'vendor1@intellitender.local',
      role: 'Vendor',
      password: 'Password@123',
      phone: '+91-9000000001',
      department: 'Public Infrastructure',
      specialization: 'Healthcare Supply and Civil Works',
    });

    const vendor2 = await upsertUser({
      name: 'TechNova Systems',
      email: 'vendor2@intellitender.local',
      role: 'Vendor',
      password: 'Password@123',
      phone: '+91-9000000002',
      department: 'Energy Solutions',
      specialization: 'Smart Lighting and Automation',
    });

    const vendor3 = await upsertUser({
      name: 'SecureOps Labs',
      email: 'vendor3@intellitender.local',
      role: 'Vendor',
      password: 'Password@123',
      phone: '+91-9000000003',
      department: 'ICT Services',
      specialization: 'Cybersecurity and Classroom Technology',
    });

    const draftTender = await upsertTender('Demo Tender - Office Furniture Supply', {
      description: 'Procurement of ergonomic furniture for administrative offices',
      category: 'Supply',
      budget: 1800000,
      preBidDate: asDate('2026-08-23T00:00:00.000Z'),
      finalSubmissionDate: asDate('2026-08-30T00:00:00.000Z'),
      status: 'Draft',
      createdBy: po._id,
      documents: [
        buildTenderDocument('Demo Tender - Office Furniture Supply', 'Office_Furniture_BOQ.pdf', 'Bill of Quantities'),
        buildTenderDocument('Demo Tender - Office Furniture Supply', 'Office_Furniture_Specification.pdf', 'Technical Specification'),
      ],
      bids: [],
    });

    const openSubmissionTender = await upsertTender('Demo Tender - Network Security Services', {
      description: 'Managed firewall, SIEM monitoring, and incident response services for district offices',
      category: 'Service',
      budget: 3200000,
      preBidDate: asDate('2026-09-08T00:00:00.000Z'),
      finalSubmissionDate: asDate('2026-09-15T00:00:00.000Z'),
      status: 'Published',
      createdBy: po._id,
      documents: [
        buildTenderDocument('Demo Tender - Network Security Services', 'Network_Security_RFP.pdf', 'Request for Proposal'),
        buildTenderDocument('Demo Tender - Network Security Services', 'Network_Security_SLA.pdf', 'Service Level Agreement'),
      ],
      bids: [],
    });

    const evaluationTender = await upsertTender('Demo Tender - IT Infrastructure Upgrade', {
      description: 'Procurement of rack servers, switches, UPS units, and secure endpoint devices',
      category: 'Supply',
      budget: 7500000,
      preBidDate: asDate('2026-10-13T00:00:00.000Z'),
      finalSubmissionDate: asDate('2026-10-20T00:00:00.000Z'),
      status: 'Published',
      createdBy: po._id,
      documents: [
        buildTenderDocument('Demo Tender - IT Infrastructure Upgrade', 'IT_Infrastructure_RFP.pdf', 'RFP Overview'),
        buildTenderDocument('Demo Tender - IT Infrastructure Upgrade', 'IT_Infrastructure_Compliance_Checklist.pdf', 'Compliance Checklist'),
      ],
      bids: [
        {
          vendorId: vendor1._id,
          vendorName: vendor1.name,
          proposedAmount: 6980000,
          proposalDocument: buildProposalDocument(vendor1.name, 'Demo Tender - IT Infrastructure Upgrade', 'ABC_Infra_Proposal.pdf'),
          status: 'Pending',
          createdAt: asDate('2026-03-02T10:15:00.000Z'),
          updatedAt: asDate('2026-03-02T10:15:00.000Z'),
        },
        {
          vendorId: vendor3._id,
          vendorName: vendor3.name,
          proposedAmount: 7215000,
          proposalDocument: buildProposalDocument(vendor3.name, 'Demo Tender - IT Infrastructure Upgrade', 'SecureOps_Infra_Proposal.pdf'),
          status: 'Pending',
          createdAt: asDate('2026-03-03T13:40:00.000Z'),
          updatedAt: asDate('2026-03-03T13:40:00.000Z'),
        },
      ],
    });

    const evaluatedTender = await upsertTender('Demo Tender - Smart Classroom Setup', {
      description: 'Interactive boards, classroom audio, networking, and installation services for six schools',
      category: 'Service',
      budget: 5400000,
      preBidDate: asDate('2026-02-08T00:00:00.000Z'),
      finalSubmissionDate: asDate('2026-02-15T00:00:00.000Z'),
      status: 'Closed',
      createdBy: cpo._id,
      documents: [
        buildTenderDocument('Demo Tender - Smart Classroom Setup', 'Smart_Classroom_RFP.pdf', 'RFP Overview'),
        buildTenderDocument('Demo Tender - Smart Classroom Setup', 'Smart_Classroom_Scope_of_Work.pdf', 'Scope of Work'),
      ],
      bids: [
        {
          vendorId: vendor2._id,
          vendorName: vendor2.name,
          proposedAmount: 5140000,
          proposalDocument: buildProposalDocument(vendor2.name, 'Demo Tender - Smart Classroom Setup', 'TechNova_Classroom_Proposal.pdf'),
          status: 'Evaluated',
          technicalScore: 84,
          financialScore: 81,
          comments: 'Commercially strong, minor clarification pending on support staffing.',
          evaluatedBy: committee._id,
          evaluatedDate: asDate('2026-02-18T11:00:00.000Z'),
          createdAt: asDate('2026-02-12T09:20:00.000Z'),
          updatedAt: asDate('2026-02-18T11:00:00.000Z'),
        },
        {
          vendorId: vendor3._id,
          vendorName: vendor3.name,
          proposedAmount: 5265000,
          proposalDocument: buildProposalDocument(vendor3.name, 'Demo Tender - Smart Classroom Setup', 'SecureOps_Classroom_Proposal.pdf'),
          status: 'Evaluated',
          technicalScore: 89,
          financialScore: 78,
          comments: 'Best technical submission; price is slightly higher than the lowest evaluated bid.',
          evaluatedBy: committee._id,
          evaluatedDate: asDate('2026-02-18T11:10:00.000Z'),
          createdAt: asDate('2026-02-13T14:05:00.000Z'),
          updatedAt: asDate('2026-02-18T11:10:00.000Z'),
        },
      ],
    });

    const awardedNoTimelineTender = await upsertTender('Demo Tender - Medical Equipment Supply', {
      description: 'Supply of MRI and ICU equipment for the district hospital',
      category: 'Supply',
      budget: 12000000,
      preBidDate: asDate('2026-01-08T00:00:00.000Z'),
      finalSubmissionDate: asDate('2026-01-15T00:00:00.000Z'),
      status: 'Awarded',
      createdBy: cpo._id,
      documents: [
        buildTenderDocument('Demo Tender - Medical Equipment Supply', 'Medical_Equipment_Specification.pdf', 'Technical Specification'),
        buildTenderDocument('Demo Tender - Medical Equipment Supply', 'Medical_Equipment_Compliance_Checklist.pdf', 'Compliance Checklist'),
      ],
      bids: [
        {
          vendorId: vendor1._id,
          vendorName: vendor1.name,
          proposedAmount: 11400000,
          proposalDocument: buildProposalDocument(vendor1.name, 'Demo Tender - Medical Equipment Supply', 'ABC_Medical_Proposal.pdf'),
          status: 'Selected',
          technicalScore: 88,
          financialScore: 82,
          comments: 'Strong compliance and delivery track record.',
          evaluatedBy: committee._id,
          evaluatedDate: asDate('2026-01-20T10:30:00.000Z'),
          createdAt: asDate('2026-01-10T09:00:00.000Z'),
          updatedAt: asDate('2026-01-20T10:30:00.000Z'),
        },
        {
          vendorId: vendor2._id,
          vendorName: vendor2.name,
          proposedAmount: 11850000,
          proposalDocument: buildProposalDocument(vendor2.name, 'Demo Tender - Medical Equipment Supply', 'TechNova_Medical_Proposal.pdf'),
          status: 'Rejected',
          technicalScore: 80,
          financialScore: 77,
          comments: 'Higher cost compared to selected bid.',
          evaluatedBy: committee._id,
          evaluatedDate: asDate('2026-01-20T10:35:00.000Z'),
          createdAt: asDate('2026-01-11T15:45:00.000Z'),
          updatedAt: asDate('2026-01-20T10:35:00.000Z'),
        },
      ],
    });

    const inProgressTender = await upsertTender('Demo Tender - Solar Street Lighting Project', {
      description: 'Design, supply, installation, and commissioning of solar street lights across municipal roads',
      category: 'Work',
      budget: 9100000,
      preBidDate: asDate('2026-01-05T00:00:00.000Z'),
      finalSubmissionDate: asDate('2026-01-12T00:00:00.000Z'),
      status: 'Awarded',
      createdBy: po._id,
      documents: [
        buildTenderDocument('Demo Tender - Solar Street Lighting Project', 'Solar_Lighting_Drawings.pdf', 'Approved Drawings'),
        buildTenderDocument('Demo Tender - Solar Street Lighting Project', 'Solar_Lighting_BOQ.pdf', 'Bill of Quantities'),
      ],
      bids: [
        {
          vendorId: vendor1._id,
          vendorName: vendor1.name,
          proposedAmount: 8625000,
          proposalDocument: buildProposalDocument(vendor1.name, 'Demo Tender - Solar Street Lighting Project', 'ABC_Solar_Project_Proposal.pdf'),
          status: 'Selected',
          technicalScore: 91,
          financialScore: 84,
          comments: 'Balanced technical quality and commercial competitiveness.',
          evaluatedBy: committee._id,
          evaluatedDate: asDate('2026-01-22T12:20:00.000Z'),
          createdAt: asDate('2026-01-08T10:10:00.000Z'),
          updatedAt: asDate('2026-01-22T12:20:00.000Z'),
        },
        {
          vendorId: vendor2._id,
          vendorName: vendor2.name,
          proposedAmount: 8790000,
          proposalDocument: buildProposalDocument(vendor2.name, 'Demo Tender - Solar Street Lighting Project', 'TechNova_Solar_Project_Proposal.pdf'),
          status: 'Rejected',
          technicalScore: 86,
          financialScore: 81,
          comments: 'Technically acceptable but ranked lower overall.',
          evaluatedBy: committee._id,
          evaluatedDate: asDate('2026-01-22T12:25:00.000Z'),
          createdAt: asDate('2026-01-08T10:50:00.000Z'),
          updatedAt: asDate('2026-01-22T12:25:00.000Z'),
        },
      ],
    });

    const readyForCompletionTender = await upsertTender('Demo Tender - Smart Meter Installation', {
      description: 'Installation and commissioning of smart utility meters in urban households',
      category: 'Work',
      budget: 6800000,
      preBidDate: asDate('2025-12-29T00:00:00.000Z'),
      finalSubmissionDate: asDate('2026-01-05T00:00:00.000Z'),
      status: 'Awarded',
      createdBy: cpo._id,
      documents: [
        buildTenderDocument('Demo Tender - Smart Meter Installation', 'Smart_Meter_Installation_Guide.pdf', 'Installation Guide'),
        buildTenderDocument('Demo Tender - Smart Meter Installation', 'Smart_Meter_Testing_Checklist.pdf', 'Testing Checklist'),
      ],
      bids: [
        {
          vendorId: vendor2._id,
          vendorName: vendor2.name,
          proposedAmount: 6495000,
          proposalDocument: buildProposalDocument(vendor2.name, 'Demo Tender - Smart Meter Installation', 'TechNova_Smart_Meter_Proposal.pdf'),
          status: 'Selected',
          technicalScore: 90,
          financialScore: 86,
          comments: 'Deployment plan is complete and all certifications are attached.',
          evaluatedBy: committee._id,
          evaluatedDate: asDate('2026-01-09T09:30:00.000Z'),
          createdAt: asDate('2026-01-03T16:10:00.000Z'),
          updatedAt: asDate('2026-01-09T09:30:00.000Z'),
        },
        {
          vendorId: vendor3._id,
          vendorName: vendor3.name,
          proposedAmount: 6610000,
          proposalDocument: buildProposalDocument(vendor3.name, 'Demo Tender - Smart Meter Installation', 'SecureOps_Smart_Meter_Proposal.pdf'),
          status: 'Rejected',
          technicalScore: 83,
          financialScore: 80,
          comments: 'Lower field deployment readiness compared to selected vendor.',
          evaluatedBy: committee._id,
          evaluatedDate: asDate('2026-01-09T09:35:00.000Z'),
          createdAt: asDate('2026-01-04T12:40:00.000Z'),
          updatedAt: asDate('2026-01-09T09:35:00.000Z'),
        },
      ],
    });

    const completedTender = await upsertTender('Demo Tender - Water Purifier Annual Maintenance', {
      description: 'Annual preventive maintenance of institutional water purification systems',
      category: 'Service',
      budget: 1950000,
      preBidDate: asDate('2025-11-21T00:00:00.000Z'),
      finalSubmissionDate: asDate('2025-11-28T00:00:00.000Z'),
      status: 'Awarded',
      createdBy: po._id,
      documents: [
        buildTenderDocument('Demo Tender - Water Purifier Annual Maintenance', 'Water_Purifier_AMC_Scope.pdf', 'Scope of Work'),
        buildTenderDocument('Demo Tender - Water Purifier Annual Maintenance', 'Water_Purifier_AMC_Compliance.pdf', 'Compliance Matrix'),
      ],
      bids: [
        {
          vendorId: vendor1._id,
          vendorName: vendor1.name,
          proposedAmount: 1820000,
          proposalDocument: buildProposalDocument(vendor1.name, 'Demo Tender - Water Purifier Annual Maintenance', 'ABC_Water_AMC_Proposal.pdf'),
          status: 'Selected',
          technicalScore: 87,
          financialScore: 88,
          comments: 'Selected based on prior maintenance performance and lowest evaluated price.',
          evaluatedBy: committee._id,
          evaluatedDate: asDate('2025-12-02T10:15:00.000Z'),
          createdAt: asDate('2025-11-24T14:30:00.000Z'),
          updatedAt: asDate('2025-12-02T10:15:00.000Z'),
        },
        {
          vendorId: vendor3._id,
          vendorName: vendor3.name,
          proposedAmount: 1945000,
          proposalDocument: buildProposalDocument(vendor3.name, 'Demo Tender - Water Purifier Annual Maintenance', 'SecureOps_Water_AMC_Proposal.pdf'),
          status: 'Rejected',
          technicalScore: 78,
          financialScore: 75,
          comments: 'Price and staffing mix were less competitive.',
          evaluatedBy: committee._id,
          evaluatedDate: asDate('2025-12-02T10:20:00.000Z'),
          createdAt: asDate('2025-11-25T11:15:00.000Z'),
          updatedAt: asDate('2025-12-02T10:20:00.000Z'),
        },
      ],
    });

    const awardedNoTimelineContract = await upsertContract(awardedNoTimelineTender._id, vendor1._id, {
      status: 'Awarded',
      timelineDefined: false,
      milestones: [],
      progressReports: [],
    });

    const inProgressContract = await upsertContract(inProgressTender._id, vendor1._id, {
      status: 'Signed',
      timelineDefined: true,
      timelineStartDate: asDate('2026-02-15T00:00:00.000Z'),
      timelineEndDate: asDate('2026-03-20T00:00:00.000Z'),
      milestones: [
        {
          title: 'Site Mobilisation and Layout Approval',
          description: 'Confirm pole locations, access, traffic safety plan, and utility clearances.',
          plannedStartDate: asDate('2026-02-15T00:00:00.000Z'),
          plannedEndDate: asDate('2026-02-24T00:00:00.000Z'),
          actualStartDate: asDate('2026-02-16T00:00:00.000Z'),
          actualEndDate: asDate('2026-02-23T00:00:00.000Z'),
          status: 'Completed',
          progress: 100,
          assignedTo: committee.name,
          checklist: {
            quantityVerified: true,
            qualityVerified: true,
            documentsUploaded: true,
            deliveryComplete: true,
          },
          remarks: 'Layout approved and mobilisation completed without deviations.',
          verifiedBy: committee._id,
          verifiedAt: asDate('2026-02-24T15:20:00.000Z'),
          documents: [buildProgressAttachment('Site mobilisation approval', 'Solar_Mobilisation_Report.pdf')],
          images: [createStoredSvgImage('Solar_Mobilisation_Photo.svg', 'Mobilisation Complete', '#0B3C5D')],
          createdAt: asDate('2026-02-15T09:00:00.000Z'),
          updatedAt: asDate('2026-02-24T15:20:00.000Z'),
        },
        {
          title: 'Pole Installation and Cable Routing',
          description: 'Install poles, cable trays, battery boxes, and connect the solar controller assemblies.',
          plannedStartDate: asDate('2026-02-25T00:00:00.000Z'),
          plannedEndDate: asDate('2026-03-05T00:00:00.000Z'),
          actualStartDate: asDate('2026-02-26T00:00:00.000Z'),
          status: 'Delayed',
          progress: 72,
          assignedTo: committee.name,
          checklist: {
            quantityVerified: true,
            qualityVerified: false,
            documentsUploaded: true,
            deliveryComplete: false,
          },
          remarks: 'Seven poles are pending due to delayed material delivery from the subcontractor.',
          verifiedBy: committee._id,
          verifiedAt: asDate('2026-03-10T16:00:00.000Z'),
          documents: [buildProgressAttachment('Pole installation status', 'Solar_Pole_Installation_Update.pdf')],
          images: [createStoredSvgImage('Solar_Pole_Installation_Status.svg', '72% Installed', '#B22222')],
          createdAt: asDate('2026-02-25T08:30:00.000Z'),
          updatedAt: asDate('2026-03-10T16:00:00.000Z'),
        },
        {
          title: 'Lighting Commissioning and Safety Audit',
          description: 'Commission luminaires, complete insulation tests, and record safety sign-off.',
          plannedStartDate: asDate('2026-03-06T00:00:00.000Z'),
          plannedEndDate: asDate('2026-03-20T00:00:00.000Z'),
          status: 'Not Started',
          progress: 0,
          assignedTo: committee.name,
          checklist: {
            quantityVerified: false,
            qualityVerified: false,
            documentsUploaded: false,
            deliveryComplete: false,
          },
          remarks: '',
          documents: [],
          images: [],
          createdAt: asDate('2026-03-06T09:00:00.000Z'),
          updatedAt: asDate('2026-03-06T09:00:00.000Z'),
        },
      ],
      progressReports: [
        {
          milestoneTitle: 'Site Mobilisation and Layout Approval',
          completionDate: asDate('2026-02-24T00:00:00.000Z'),
          description: 'Mobilisation checklist completed and signed off by the committee.',
          observations: 'No site access issue observed at the time of inspection.',
          attachments: [buildProgressAttachment('Mobilisation checklist', 'Solar_Mobilisation_Checklist.pdf')],
          reportType: 'Checklist',
          reportedBy: committee._id,
          createdAt: asDate('2026-02-24T15:30:00.000Z'),
          updatedAt: asDate('2026-02-24T15:30:00.000Z'),
        },
        {
          milestoneTitle: 'Pole Installation and Cable Routing',
          completionDate: asDate('2026-03-10T00:00:00.000Z'),
          description: 'Weekly work progress submitted for the delayed pole installation activity.',
          observations: 'Material shortage is causing a seven-day slippage on the baseline plan.',
          attachments: [
            buildProgressAttachment('Weekly installation report', 'Solar_Weekly_Progress_Report.pdf'),
            createStoredSvgImage('Solar_Weekly_Progress_Evidence.svg', 'Field Progress Evidence', '#1D4E89'),
          ],
          reportType: 'WorkProgress',
          reportedBy: committee._id,
          createdAt: asDate('2026-03-10T16:05:00.000Z'),
          updatedAt: asDate('2026-03-10T16:05:00.000Z'),
        },
      ],
    });

    const readyForCompletionContract = await upsertContract(readyForCompletionTender._id, vendor2._id, {
      status: 'Signed',
      timelineDefined: true,
      timelineStartDate: asDate('2026-01-15T00:00:00.000Z'),
      timelineEndDate: asDate('2026-02-18T00:00:00.000Z'),
      milestones: [
        {
          title: 'Meter Delivery and Warehouse Verification',
          description: 'Receive meter lots, verify batch numbers, and reconcile against the supply plan.',
          plannedStartDate: asDate('2026-01-15T00:00:00.000Z'),
          plannedEndDate: asDate('2026-01-22T00:00:00.000Z'),
          actualStartDate: asDate('2026-01-15T00:00:00.000Z'),
          actualEndDate: asDate('2026-01-21T00:00:00.000Z'),
          status: 'Completed',
          progress: 100,
          assignedTo: committee.name,
          checklist: {
            quantityVerified: true,
            qualityVerified: true,
            documentsUploaded: true,
            deliveryComplete: true,
          },
          remarks: 'All incoming batches verified and accepted.',
          verifiedBy: committee._id,
          verifiedAt: asDate('2026-01-21T18:00:00.000Z'),
          documents: [buildProgressAttachment('Warehouse verification', 'Smart_Meter_Warehouse_Verification.pdf')],
          images: [createStoredSvgImage('Smart_Meter_Warehouse.svg', 'Warehouse Acceptance', '#2E8B57')],
          createdAt: asDate('2026-01-15T09:00:00.000Z'),
          updatedAt: asDate('2026-01-21T18:00:00.000Z'),
        },
        {
          title: 'Field Installation and Testing',
          description: 'Install smart meters, pair devices, and complete household acceptance tests.',
          plannedStartDate: asDate('2026-01-23T00:00:00.000Z'),
          plannedEndDate: asDate('2026-02-12T00:00:00.000Z'),
          actualStartDate: asDate('2026-01-23T00:00:00.000Z'),
          actualEndDate: asDate('2026-02-11T00:00:00.000Z'),
          status: 'Completed',
          progress: 100,
          assignedTo: committee.name,
          checklist: {
            quantityVerified: true,
            qualityVerified: true,
            documentsUploaded: true,
            deliveryComplete: true,
          },
          remarks: 'Household installation completed and the integration test passed.',
          verifiedBy: committee._id,
          verifiedAt: asDate('2026-02-11T17:15:00.000Z'),
          documents: [buildProgressAttachment('Field installation report', 'Smart_Meter_Field_Report.pdf')],
          images: [createStoredSvgImage('Smart_Meter_Field_Test.svg', 'Field Testing Passed', '#2E8B57')],
          createdAt: asDate('2026-01-23T09:00:00.000Z'),
          updatedAt: asDate('2026-02-11T17:15:00.000Z'),
        },
        {
          title: 'Final Audit and Handover',
          description: 'Complete punch list review, upload audit records, and sign handover documents.',
          plannedStartDate: asDate('2026-02-13T00:00:00.000Z'),
          plannedEndDate: asDate('2026-02-18T00:00:00.000Z'),
          actualStartDate: asDate('2026-02-13T00:00:00.000Z'),
          actualEndDate: asDate('2026-02-17T00:00:00.000Z'),
          status: 'Completed',
          progress: 100,
          assignedTo: committee.name,
          checklist: {
            quantityVerified: true,
            qualityVerified: true,
            documentsUploaded: true,
            deliveryComplete: true,
          },
          remarks: 'Ready for procurement officer completion declaration.',
          verifiedBy: committee._id,
          verifiedAt: asDate('2026-02-17T18:45:00.000Z'),
          documents: [buildProgressAttachment('Final audit sign-off', 'Smart_Meter_Final_Audit.pdf')],
          images: [createStoredSvgImage('Smart_Meter_Handover.svg', 'Ready for Completion', '#0B3C5D')],
          createdAt: asDate('2026-02-13T09:00:00.000Z'),
          updatedAt: asDate('2026-02-17T18:45:00.000Z'),
        },
      ],
      progressReports: [
        {
          milestoneTitle: 'Final Audit and Handover',
          completionDate: asDate('2026-02-17T00:00:00.000Z'),
          description: 'All meter installation milestones are complete and signed off.',
          observations: 'This contract is ready for the PO to declare it completed.',
          attachments: [buildProgressAttachment('Completion readiness note', 'Smart_Meter_Completion_Readiness.pdf')],
          reportType: 'General',
          reportedBy: committee._id,
          createdAt: asDate('2026-02-17T19:00:00.000Z'),
          updatedAt: asDate('2026-02-17T19:00:00.000Z'),
        },
      ],
    });

    const completedContract = await upsertContract(completedTender._id, vendor1._id, {
      status: 'Completed',
      timelineDefined: true,
      timelineStartDate: asDate('2025-12-05T00:00:00.000Z'),
      timelineEndDate: asDate('2026-01-31T00:00:00.000Z'),
      milestones: [
        {
          title: 'Preventive Inspection and Filter Audit',
          description: 'Inspect every purifier unit and audit filter condition against maintenance records.',
          plannedStartDate: asDate('2025-12-05T00:00:00.000Z'),
          plannedEndDate: asDate('2025-12-18T00:00:00.000Z'),
          actualStartDate: asDate('2025-12-05T00:00:00.000Z'),
          actualEndDate: asDate('2025-12-17T00:00:00.000Z'),
          status: 'Completed',
          progress: 100,
          assignedTo: committee.name,
          checklist: {
            quantityVerified: true,
            qualityVerified: true,
            documentsUploaded: true,
            deliveryComplete: true,
          },
          remarks: 'Inspection completed across all institutional locations.',
          verifiedBy: committee._id,
          verifiedAt: asDate('2025-12-17T17:20:00.000Z'),
          documents: [buildProgressAttachment('Inspection audit', 'Water_Purifier_Inspection_Audit.pdf')],
          images: [createStoredSvgImage('Water_Purifier_Inspection.svg', 'Inspection Complete', '#2E8B57')],
          createdAt: asDate('2025-12-05T09:00:00.000Z'),
          updatedAt: asDate('2025-12-17T17:20:00.000Z'),
        },
        {
          title: 'Replacement and Final Service Completion',
          description: 'Replace cartridges, perform sanitisation, and close the maintenance log.',
          plannedStartDate: asDate('2025-12-19T00:00:00.000Z'),
          plannedEndDate: asDate('2026-01-31T00:00:00.000Z'),
          actualStartDate: asDate('2025-12-19T00:00:00.000Z'),
          actualEndDate: asDate('2026-01-28T00:00:00.000Z'),
          status: 'Completed',
          progress: 100,
          assignedTo: committee.name,
          checklist: {
            quantityVerified: true,
            qualityVerified: true,
            documentsUploaded: true,
            deliveryComplete: true,
          },
          remarks: 'AMC cycle closed ahead of schedule and accepted by the facility team.',
          verifiedBy: committee._id,
          verifiedAt: asDate('2026-01-28T18:10:00.000Z'),
          documents: [buildProgressAttachment('Final AMC closure', 'Water_Purifier_AMC_Closure.pdf')],
          images: [createStoredSvgImage('Water_Purifier_Closure.svg', 'AMC Closed', '#0B3C5D')],
          createdAt: asDate('2025-12-19T09:00:00.000Z'),
          updatedAt: asDate('2026-01-28T18:10:00.000Z'),
        },
      ],
      progressReports: [
        {
          milestoneTitle: 'Replacement and Final Service Completion',
          completionDate: asDate('2026-01-28T00:00:00.000Z'),
          description: 'AMC service cycle closed with all delivery, service, and documentation checkpoints satisfied.',
          observations: 'Completed contract available for vendor history testing.',
          attachments: [buildProgressAttachment('AMC completion summary', 'Water_Purifier_AMC_Summary.pdf')],
          reportType: 'General',
          reportedBy: committee._id,
          createdAt: asDate('2026-01-28T18:20:00.000Z'),
          updatedAt: asDate('2026-01-28T18:20:00.000Z'),
        },
      ],
    });

    const usersCount = await User.countDocuments();
    const tendersCount = await Tender.countDocuments();
    const contractsCount = await Contract.countDocuments();

    console.log('Seed completed successfully');
    console.log({
      usersCount,
      tendersCount,
      contractsCount,
      sampleLogins: [
        'cpo@intellitender.local / Password@123',
        'po@intellitender.local / Password@123',
        'committee@intellitender.local / Password@123',
        'vendor1@intellitender.local / Password@123',
        'vendor2@intellitender.local / Password@123',
        'vendor3@intellitender.local / Password@123',
      ],
      seededTenderIds: [
        draftTender._id,
        openSubmissionTender._id,
        evaluationTender._id,
        evaluatedTender._id,
        awardedNoTimelineTender._id,
        inProgressTender._id,
        readyForCompletionTender._id,
        completedTender._id,
      ],
      seededContracts: {
        awardedWithoutTimeline: awardedNoTimelineContract._id,
        signedInProgress: inProgressContract._id,
        signedReadyForCompletion: readyForCompletionContract._id,
        completed: completedContract._id,
      },
      testScenarios: {
        publishDraftTender: 'Demo Tender - Office Furniture Supply',
        vendorSubmitNewBid: 'Demo Tender - Network Security Services',
        committeeEvaluatePendingBids: 'Demo Tender - IT Infrastructure Upgrade',
        poSelectWinnerFromEvaluatedBids: 'Demo Tender - Smart Classroom Setup',
        poDefineTimeline: 'Demo Tender - Medical Equipment Supply',
        committeeUpdateMilestones: 'Demo Tender - Solar Street Lighting Project',
        poDeclareTenderCompleted: 'Demo Tender - Smart Meter Installation',
        vendorPastWorkHistory: 'Demo Tender - Water Purifier Annual Maintenance',
      },
    });

    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  }
};

seed();
