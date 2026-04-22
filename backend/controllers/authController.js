import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { OAuth2Client } from 'google-auth-library';
import { User } from '../models/model.js';

const generateToken = (id, role) => {
    return jwt.sign({ id, role }, process.env.JWT_SECRET || 'secret123', {
        expiresIn: '30d',
    });
};

const buildAuthResponse = (user) => ({
    _id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    accountStatus: user.accountStatus,
    frozenUntil: user.frozenUntil,
    token: generateToken(user._id, user.role),
});

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const registerUser = async (req, res) => {
    try {
        const { name, email, password, role } = req.body;

        if (!name || !email || !password || !role) {
            return res.status(400).json({ message: 'Please provide all required fields' });
        }

        const userExists = await User.findOne({ email });
        if (userExists) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const user = await User.create({
            name,
            email,
            password: hashedPassword,
            role,
        });

        if (user) {
            res.status(201).json({
                ...buildAuthResponse(user),
            });
        } else {
            res.status(400).json({ message: 'Invalid user data' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const signupVendor = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ message: 'Please provide name, email, and password' });
        }

        const userExists = await User.findOne({ email });
        if (userExists) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({
            name,
            email,
            password: hashedPassword,
            role: 'Vendor',
        });

        res.status(201).json({
            ...buildAuthResponse(user),
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        if (user.accountStatus === 'Deleted' && user.role !== 'Vendor') {
            return res.status(403).json({
                code: 'ACCOUNT_DELETED',
                message: 'Your account has been deleted. Contact support.',
            });
        }

        if (user.accountStatus === 'Frozen') {
            const now = new Date();
            if (user.frozenUntil && new Date(user.frozenUntil) > now) {
                if (user.role !== 'Vendor') {
                    return res.status(403).json({
                        code: 'ACCOUNT_FROZEN',
                        message: 'Your account is currently frozen.',
                        frozenUntil: user.frozenUntil,
                    });
                }
            } else {
                user.accountStatus = 'Active';
                user.frozenUntil = null;
                await user.save();
            }
        }

        if (await bcrypt.compare(password, user.password)) {
            res.json(buildAuthResponse(user));
        } else {
            res.status(401).json({ message: 'Invalid credentials' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const createOtpCode = () => String(Math.floor(100000 + Math.random() * 900000));

const getMailTransporter = () => {
    const emailUser = process.env.EMAIL_USER || process.env.email;
    const emailPassword = process.env.EMAIL_PASSWORD || process.env.email_password;

    return nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: Number(process.env.EMAIL_PORT || 587),
        secure: false,
        auth: {
            user: emailUser,
            pass: emailPassword,
        },
    });
};

const sendOtpEmail = async ({ toEmail, otp, subject, purposeLabel }) => {
    const emailUser = process.env.EMAIL_USER || process.env.email;
    const transporter = getMailTransporter();
    await transporter.sendMail({
        from: emailUser,
        to: toEmail,
        subject,
        text: `Your IntelliTender OTP for ${purposeLabel} is ${otp}. It will expire in 2 minutes.`,
        html: `<p>Your IntelliTender OTP for <strong>${purposeLabel}</strong> is <strong>${otp}</strong>.</p><p>It will expire in 2 minutes.</p>`,
    });
};

export const requestPasswordResetOtp = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ message: 'email is required' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.json({ message: 'If this email is registered, an OTP has been sent.' });
        }

        if (user.accountStatus === 'Deleted') {
            return res.status(403).json({ code: 'ACCOUNT_DELETED', message: 'Your account has been deleted. Contact support.' });
        }

        const otp = createOtpCode();
        user.passwordResetOtp = await bcrypt.hash(otp, 10);
        user.passwordResetOtpExpiresAt = new Date(Date.now() + 2 * 60 * 1000);
        await user.save();

        await sendOtpEmail({
            toEmail: email,
            otp,
            subject: 'IntelliTender Password Reset OTP',
            purposeLabel: 'password reset',
        });

        res.json({ message: 'OTP sent successfully to your email.' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const resetPasswordWithOtp = async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;
        if (!email || !otp || !newPassword) {
            return res.status(400).json({ message: 'email, otp and newPassword are required' });
        }

        const user = await User.findOne({ email });
        if (!user || !user.passwordResetOtp || !user.passwordResetOtpExpiresAt) {
            return res.status(400).json({ message: 'Invalid OTP request' });
        }

        if (new Date(user.passwordResetOtpExpiresAt) < new Date()) {
            return res.status(400).json({ message: 'OTP expired. Request a new OTP.' });
        }

        const otpMatches = await bcrypt.compare(otp, user.passwordResetOtp);
        if (!otpMatches) {
            return res.status(400).json({ message: 'Invalid OTP' });
        }

        user.password = await bcrypt.hash(newPassword, 10);
        user.passwordResetOtp = null;
        user.passwordResetOtpExpiresAt = null;
        user.changePasswordOtp = null;
        user.changePasswordOtpExpiresAt = null;
        user.pendingPasswordHash = null;
        await user.save();

        res.json({ message: 'Password reset successful. Please login with new password.' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ message: 'currentPassword and newPassword are required' });
        }

        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        const matches = await bcrypt.compare(currentPassword, user.password);
        if (!matches) {
            return res.status(400).json({ message: 'Current password is incorrect' });
        }

        const otp = createOtpCode();
        user.pendingPasswordHash = await bcrypt.hash(newPassword, 10);
        user.changePasswordOtp = await bcrypt.hash(otp, 10);
        user.changePasswordOtpExpiresAt = new Date(Date.now() + 2 * 60 * 1000);
        await user.save();

        await sendOtpEmail({
            toEmail: user.email,
            otp,
            subject: 'IntelliTender Change Password OTP',
            purposeLabel: 'password change confirmation',
        });

        res.json({ message: 'OTP sent to your email. Verify OTP to complete password change.' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const verifyChangePasswordOtp = async (req, res) => {
    try {
        const { otp } = req.body;
        if (!otp) {
            return res.status(400).json({ message: 'otp is required' });
        }

        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (!user.changePasswordOtp || !user.changePasswordOtpExpiresAt || !user.pendingPasswordHash) {
            return res.status(400).json({ message: 'No pending OTP request found' });
        }

        if (new Date(user.changePasswordOtpExpiresAt) < new Date()) {
            user.changePasswordOtp = null;
            user.changePasswordOtpExpiresAt = null;
            user.pendingPasswordHash = null;
            await user.save();
            return res.status(400).json({ message: 'OTP expired. Request a new OTP.' });
        }

        const otpMatches = await bcrypt.compare(otp, user.changePasswordOtp);
        if (!otpMatches) {
            return res.status(400).json({ message: 'Invalid OTP' });
        }

        user.password = user.pendingPasswordHash;
        user.changePasswordOtp = null;
        user.changePasswordOtpExpiresAt = null;
        user.pendingPasswordHash = null;
        await user.save();

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const loginWithGoogle = async (req, res) => {
    try {
        const { idToken } = req.body;
        if (!idToken) {
            return res.status(400).json({ message: 'Google idToken is required' });
        }

        if (!process.env.GOOGLE_CLIENT_ID) {
            return res.status(500).json({ message: 'Google OAuth is not configured' });
        }

        const ticket = await googleClient.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        const email = String(payload?.email || '').trim().toLowerCase();
        const name = String(payload?.name || '').trim();
        const emailVerified = Boolean(payload?.email_verified);

        if (!email || !emailVerified) {
            return res.status(401).json({ message: 'Google account email is not verified' });
        }

        let user = await User.findOne({ email });

        if (user) {
            if (user.accountStatus === 'Deleted' && user.role !== 'Vendor') {
                return res.status(403).json({
                    code: 'ACCOUNT_DELETED',
                    message: 'Your account has been deleted. Contact support.',
                });
            }

            if (user.accountStatus === 'Frozen') {
                const now = new Date();
                if (user.frozenUntil && new Date(user.frozenUntil) > now) {
                    if (user.role !== 'Vendor') {
                        return res.status(403).json({
                            code: 'ACCOUNT_FROZEN',
                            message: 'Your account is currently frozen.',
                            frozenUntil: user.frozenUntil,
                        });
                    }
                } else {
                    user.accountStatus = 'Active';
                    user.frozenUntil = null;
                    await user.save();
                }
            }

            return res.json(buildAuthResponse(user));
        }

        const generatedPassword = crypto.randomBytes(32).toString('hex');
        const hashedPassword = await bcrypt.hash(generatedPassword, 10);

        user = await User.create({
            name: name || email.split('@')[0] || 'Vendor User',
            email,
            password: hashedPassword,
            role: 'Vendor',
        });

        return res.status(201).json(buildAuthResponse(user));
    } catch (error) {
        return res.status(401).json({ message: 'Google authentication failed' });
    }
};