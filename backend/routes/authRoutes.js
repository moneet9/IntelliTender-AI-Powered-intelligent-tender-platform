import express from 'express';
const router = express.Router();
import auth from '../middleware/auth.js';
import {
	registerUser,
	loginUser,
	signupVendor,
	requestPasswordResetOtp,
	resetPasswordWithOtp,
	changePassword,
} from '../controllers/authController.js';

router.post('/register', registerUser);
router.post('/signup-vendor', signupVendor);
router.post('/login', loginUser);
router.post('/forgot-password/request-otp', requestPasswordResetOtp);
router.post('/forgot-password/reset', resetPasswordWithOtp);
router.put('/change-password', auth(['CPO', 'PO', 'Committee', 'Vendor']), changePassword);

export default router;