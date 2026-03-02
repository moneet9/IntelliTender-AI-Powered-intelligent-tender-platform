import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { connectDB } from '../config/db.js';
import { User, Tender, Contract } from '../models/model.js';

dotenv.config();

const upsertUser = async ({ name, email, role, password }) => {
  const hashedPassword = await bcrypt.hash(password, 10);
  return User.findOneAndUpdate(
    { email },
    {
      $set: {
        name,
        email,
        role,
        password: hashedPassword,
      },
    },
    { upsert: true, new: true }
  );
};

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
    });

    const vendor1 = await upsertUser({
      name: 'ABC Corporation',
      email: 'vendor1@intellitender.local',
      role: 'Vendor',
      password: 'Password@123',
    });

    const vendor2 = await upsertUser({
      name: 'TechNova Systems',
      email: 'vendor2@intellitender.local',
      role: 'Vendor',
      password: 'Password@123',
    });

    const publishedTender = await Tender.findOneAndUpdate(
      { title: 'Demo Tender - IT Infrastructure Upgrade' },
      {
        $set: {
          title: 'Demo Tender - IT Infrastructure Upgrade',
          description: 'Procurement of servers, switches and endpoint devices',
          budget: 7500000,
          deadline: new Date('2027-03-30'),
          status: 'Published',
          createdBy: po._id,
          bids: [
            {
              vendorId: vendor1._id,
              vendorName: vendor1.name,
              proposedAmount: 6980000,
              proposalDocument: 'Demo proposal v1',
              status: 'Pending',
            },
          ],
        },
      },
      { upsert: true, new: true }
    );

    const awardedTender = await Tender.findOneAndUpdate(
      { title: 'Demo Tender - Medical Equipment Supply' },
      {
        $set: {
          title: 'Demo Tender - Medical Equipment Supply',
          description: 'Supply of MRI and ICU equipment',
          budget: 12000000,
          deadline: new Date('2026-01-15'),
          status: 'Awarded',
          createdBy: cpo._id,
          bids: [
            {
              vendorId: vendor1._id,
              vendorName: vendor1.name,
              proposedAmount: 11400000,
              proposalDocument: 'Medical supply proposal - ABC',
              status: 'Selected',
              technicalScore: 88,
              financialScore: 82,
              comments: 'Strong compliance and delivery track record',
              evaluatedBy: committee._id,
              evaluatedDate: new Date('2026-01-20'),
            },
            {
              vendorId: vendor2._id,
              vendorName: vendor2.name,
              proposedAmount: 11850000,
              proposalDocument: 'Medical supply proposal - TechNova',
              status: 'Rejected',
              technicalScore: 80,
              financialScore: 77,
              comments: 'Higher cost compared to selected bid',
              evaluatedBy: committee._id,
              evaluatedDate: new Date('2026-01-20'),
            },
          ],
        },
      },
      { upsert: true, new: true }
    );

    await Contract.findOneAndUpdate(
      { tenderId: awardedTender._id, vendorId: vendor1._id },
      {
        $set: {
          tenderId: awardedTender._id,
          vendorId: vendor1._id,
          status: 'Awarded',
        },
      },
      { upsert: true, new: true }
    );

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
      ],
      seededTenderIds: [publishedTender._id, awardedTender._id],
    });

    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  }
};

seed();
