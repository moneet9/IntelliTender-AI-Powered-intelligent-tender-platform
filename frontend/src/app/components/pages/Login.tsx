import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router";
import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";
import { Lock, Shield } from "lucide-react";
import { ApiError, apiRequest, saveAuthUser } from "../../api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

type Role = "cpo" | "po" | "committee" | "vendor";

export function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [selectedRole, setSelectedRole] = useState<Role>("cpo");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [error, setError] = useState("");
  const [warningType, setWarningType] = useState<"deleted" | "frozen" | "">("");
  const [frozenUntil, setFrozenUntil] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [loading, setLoading] = useState(false);

  const [showForgotRequest, setShowForgotRequest] = useState(false);
  const [showOtp, setShowOtp] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [forgotMessage, setForgotMessage] = useState("");
  const [otpExpiresAt, setOtpExpiresAt] = useState<Date | null>(null);

  const roleMap = {
    cpo: "CPO",
    po: "PO",
    committee: "Committee",
    vendor: "Vendor",
  } as const;

  const routeMap = {
    CPO: "/cpo",
    PO: "/po",
    Committee: "/committee",
    Vendor: "/vendor",
  } as const;

  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!frozenUntil && !otpExpiresAt) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [frozenUntil, otpExpiresAt]);

  const countdown = useMemo(() => {
    if (!frozenUntil) return "";
    const remaining = new Date(frozenUntil).getTime() - nowMs;
    if (remaining <= 0) return "00:00:00";
    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, [frozenUntil, nowMs]);

  const otpCountdown = useMemo(() => {
    if (!otpExpiresAt) return "";
    const remaining = new Date(otpExpiresAt).getTime() - nowMs;
    if (remaining <= 0) return "00:00";
    const minutes = Math.floor(remaining / (1000 * 60));
    const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, [otpExpiresAt, nowMs]);

  const isOtpExpired = otpExpiresAt ? new Date(otpExpiresAt).getTime() < nowMs : false;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setWarningType("");
    setFrozenUntil(null);
    setLoading(true);

    try {
      const data = await apiRequest<{
        _id: string;
        name: string;
        email: string;
        role: "CPO" | "PO" | "Committee" | "Vendor";
        accountStatus?: "Active" | "Frozen" | "Suspended" | "Deleted";
        frozenUntil?: string | null;
        token: string;
      }>("/api/auth/login", {
        method: "POST",
        body: { email: username, password },
      });

      if (data.role !== roleMap[selectedRole]) {
        setError(`Logged in as ${data.role}. Please select the matching role.`);
        setLoading(false);
        return;
      }

      saveAuthUser(data);
      navigate(routeMap[data.role]);
    } catch (err) {
      if (err instanceof ApiError && err.code === "ACCOUNT_DELETED") {
        setWarningType("deleted");
        setError(err.message);
      } else if (err instanceof ApiError && err.code === "ACCOUNT_FROZEN") {
        setWarningType("frozen");
        setFrozenUntil(err.frozenUntil || null);
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "Login failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVendorSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setWarningType("");
    setLoading(true);
    try {
      const data = await apiRequest<{
        _id: string;
        name: string;
        email: string;
        role: "Vendor";
        accountStatus?: "Active" | "Frozen" | "Suspended" | "Deleted";
        frozenUntil?: string | null;
        token: string;
      }>("/api/auth/signup-vendor", {
        method: "POST",
        body: { name: fullName, email: username, password },
      });
      saveAuthUser(data);
      navigate("/vendor");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async (credentialResponse: CredentialResponse) => {
    if (!credentialResponse.credential) {
      setError("Google login failed. Please try again.");
      return;
    }

    setError("");
    setWarningType("");
    setFrozenUntil(null);
    setLoading(true);

    try {
      const data = await apiRequest<{
        _id: string;
        name: string;
        email: string;
        role: "CPO" | "PO" | "Committee" | "Vendor";
        accountStatus?: "Active" | "Frozen" | "Suspended" | "Deleted";
        frozenUntil?: string | null;
        token: string;
      }>("/api/auth/google", {
        method: "POST",
        body: { idToken: credentialResponse.credential },
      });

      saveAuthUser(data);
      navigate(routeMap[data.role]);
    } catch (err) {
      if (err instanceof ApiError && err.code === "ACCOUNT_DELETED") {
        setWarningType("deleted");
        setError(err.message);
      } else if (err instanceof ApiError && err.code === "ACCOUNT_FROZEN") {
        setWarningType("frozen");
        setFrozenUntil(err.frozenUntil || null);
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "Google login failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setForgotMessage("");
    if (!forgotEmail) {
      setError("Please enter your email");
      return;
    }

    setLoading(true);
    try {
      const response = await apiRequest<{ message: string }>("/api/auth/forgot-password/request-otp", {
        method: "POST",
        body: { email: forgotEmail },
      });
      setForgotMessage(response.message || "OTP sent to your email");
      setOtpExpiresAt(new Date(Date.now() + 2 * 60 * 1000));
      setShowOtp(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setForgotMessage("");

    if (!otp || !newPassword || !confirmNewPassword) {
      setError("Please enter OTP and new password");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError("New passwords do not match");
      return;
    }

    if (isOtpExpired) {
      setError("OTP has expired. Please request a new one.");
      return;
    }

    setLoading(true);
    try {
      const response = await apiRequest<{ message: string }>("/api/auth/forgot-password/reset", {
        method: "POST",
        body: {
          email: forgotEmail,
          otp,
          newPassword,
        },
      });
      setForgotMessage(response.message || "Password updated. Please login with your new password.");
      setShowOtp(false);
      setShowForgotRequest(false);
      setMode("login");
      setOtp("");
      setNewPassword("");
      setConfirmNewPassword("");
      setPassword("");
      setUsername(forgotEmail);
      setOtpExpiresAt(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "OTP verification failed");
    } finally {
      setLoading(false);
    }
  };

  if (showOtp) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#F4F6F9] to-white flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-[#1D4E89]/20">
          <CardHeader className="text-center">
            <CardTitle className="text-[#0B3C5D]">Verify OTP</CardTitle>
            <CardDescription>
              Enter the verification code sent to your email
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="otp">Verification Code</Label>
                  <span className={`text-sm font-semibold ${isOtpExpired ? "text-red-600" : "text-orange-600"}`}>
                    {otpCountdown}
                  </span>
                </div>
                <Input
                  id="otp"
                  placeholder="000000"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  maxLength={6}
                  className="text-center text-2xl tracking-widest font-bold"
                  disabled={isOtpExpired}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={isOtpExpired}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmNewPassword">Confirm New Password</Label>
                <Input
                  id="confirmNewPassword"
                  type="password"
                  placeholder="Confirm new password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  disabled={isOtpExpired}
                />
              </div>

              {isOtpExpired && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-sm text-red-700">OTP has expired. Please request a new one.</p>
                </div>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}
              {forgotMessage && <p className="text-sm text-green-700">{forgotMessage}</p>}

              <Button 
                type="submit" 
                className="w-full bg-[#0B3C5D] hover:bg-[#1D4E89]" 
                disabled={loading || isOtpExpired}
              >
                {loading ? "Verifying..." : "Verify & Change Password"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setShowOtp(false);
                  setOtp("");
                  setNewPassword("");
                  setConfirmNewPassword("");
                  setOtpExpiresAt(null);
                  setError("");
                }}
              >
                Request New OTP
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (showForgotRequest) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#F4F6F9] to-white flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-[#1D4E89]/20">
          <CardHeader className="text-center">
            <CardTitle className="text-[#0B3C5D]">Forgot Password</CardTitle>
            <CardDescription>
              Enter your registered email to receive OTP
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRequestOtp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="forgotEmail">Email</Label>
                <Input
                  id="forgotEmail"
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="Enter your email"
                />
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}
              {forgotMessage && <p className="text-sm text-green-700">{forgotMessage}</p>}

              <Button type="submit" className="w-full bg-[#0B3C5D] hover:bg-[#1D4E89]" disabled={loading}>
                {loading ? "Sending..." : "Send OTP"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setShowForgotRequest(false);
                  setError("");
                }}
              >
                Back to Login
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F4F6F9' }}>
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center mb-4">
              <div className="bg-[#0B3C5D] p-3 rounded-lg">
                <Shield className="w-10 h-10 text-white" />
              </div>
            </div>
            <h1 className="text-2xl text-[#0B3C5D] mb-2">IntelliTender</h1>
            <p className="text-sm text-gray-600">Intelligent Tender & Contract Management System</p>
          </div>

          <form onSubmit={mode === "login" ? handleLogin : handleVendorSignup} className="space-y-5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMode("login")}
                className={`px-3 py-1 rounded-md text-sm ${mode === "login" ? "bg-[#1D4E89] text-white" : "bg-gray-100 text-gray-700"}`}
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setSelectedRole("vendor");
                }}
                className={`px-3 py-1 rounded-md text-sm ${mode === "signup" ? "bg-[#1D4E89] text-white" : "bg-gray-100 text-gray-700"}`}
              >
                Vendor Signup
              </button>
            </div>

            <div className={mode === "signup" ? "hidden" : "block"}>
              <label className="block text-sm mb-2 text-gray-700">Select Role</label>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as Role)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89] bg-white"
              >
                <option value="cpo">CPO - Chief Procurement Officer</option>
                <option value="po">PO - Procurement Officer</option>
                <option value="committee">Committee Member</option>
                <option value="vendor">Vendor</option>
              </select>
            </div>

            {mode === "signup" && (
              <div>
                <label className="block text-sm mb-2 text-gray-700">Vendor Name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                  placeholder="Enter company/vendor name"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-sm mb-2 text-gray-700">Email</label>
              <input
                type="email"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                placeholder="Enter email"
                required
              />
            </div>

            <div>
              <label className="block text-sm mb-2 text-gray-700">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                placeholder="Enter password"
                required
              />
            </div>

            <div className={mode === "signup" ? "hidden" : "block"}>
              <label className="block text-sm mb-2 text-gray-700 flex items-center gap-2">
                <Lock className="w-4 h-4" />
                Two-Factor Authentication Code
              </label>
              <input
                type="text"
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#1D4E89]"
                placeholder="Enter 6-digit code"
                maxLength={6}
              />
            </div>

            {warningType === "deleted" && (
              <div className="p-4 rounded-md border-2 border-red-500 bg-red-50">
                <p className="text-red-800 text-sm font-medium">⚠ Account Deleted</p>
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            )}

            {warningType === "frozen" && (
              <div className="p-4 rounded-md border-2 border-yellow-500 bg-yellow-50">
                <p className="text-yellow-900 text-sm font-medium">⚠ Account Frozen</p>
                <p className="text-yellow-800 text-sm">{error}</p>
                <p className="text-yellow-900 text-lg mt-2">Remaining freeze time: {countdown}</p>
              </div>
            )}

            {error && !warningType && <p className="text-sm text-red-600">{error}</p>}

            {mode === "login" && (
              <div className="text-center">
                <button
                  type="button"
                  className="text-[#1D4E89] hover:underline text-sm"
                  onClick={() => {
                    setShowForgotRequest(true);
                    setForgotEmail(username);
                    setError("");
                    setForgotMessage("");
                  }}
                >
                  Forgot Password?
                </button>
              </div>
            )}

            {mode === "login" && googleClientId && (
              <div className="space-y-3">
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-gray-200" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white px-2 text-gray-500">Or continue with</span>
                  </div>
                </div>
                <div className="flex justify-center">
                  <GoogleLogin
                    onSuccess={(credentialResponse) => {
                      void handleGoogleLogin(credentialResponse);
                    }}
                    onError={() => setError("Google login was cancelled or failed")}
                    useOneTap={false}
                    theme="outline"
                    size="large"
                    text="continue_with"
                    shape="rectangular"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#0B3C5D] hover:bg-[#1D4E89] text-white py-3 rounded-md transition-colors duration-200"
            >
              {loading ? (mode === "login" ? "Logging in..." : "Creating account...") : (mode === "login" ? "Secure Login" : "Create Vendor Account")}
            </button>
          </form>

          <div className="mt-8 text-center text-xs text-gray-500 border-t border-gray-200 pt-6">
            © 2026 Government Procurement Authority
          </div>
        </div>
      </div>
    </div>
  );
}
