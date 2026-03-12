import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { apiRequest, getAuthUser } from "../../api";

export function ChangePassword() {
  const authUser = getAuthUser();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"request" | "verify">("request");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [otpExpiresAt, setOtpExpiresAt] = useState<Date | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    if (!otpExpiresAt) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [otpExpiresAt]);

  const countdown = useMemo(() => {
    if (!otpExpiresAt) return "";
    const remaining = new Date(otpExpiresAt).getTime() - nowMs;
    if (remaining <= 0) {
      return "00:00";
    }
    const minutes = Math.floor(remaining / (1000 * 60));
    const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, [otpExpiresAt, nowMs]);

  const isOtpExpired = otpExpiresAt ? new Date(otpExpiresAt).getTime() < nowMs : false;

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Please fill all fields");
      return;
    }

    if (currentPassword === newPassword) {
      setError("New password must be different from current password");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const response = await apiRequest<{ message: string }>("/api/auth/change-password", {
        method: "PUT",
        body: { currentPassword, newPassword },
      });
      setSuccess(response.message || "OTP sent successfully to your email");
      setOtpExpiresAt(new Date(Date.now() + 2 * 60 * 1000));
      setStep("verify");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!otp) {
      setError("Please enter OTP");
      return;
    }

    if (isOtpExpired) {
      setError("OTP has expired. Please request a new OTP.");
      return;
    }

    setLoading(true);
    try {
      const response = await apiRequest<{ message: string }>("/api/auth/change-password/verify-otp", {
        method: "PUT",
        body: { otp },
      });
      setSuccess(response.message || "Password changed successfully");
      setStep("request");
      setOtp("");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setOtpExpiresAt(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "OTP verification failed");
    } finally {
      setLoading(false);
    }
  };

  const handleBackFromOtp = () => {
    setStep("request");
    setOtp("");
    setError("");
    setOtpExpiresAt(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#F4F6F9] to-white flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-[#1D4E89]/20">
        <CardHeader className="text-center">
          <CardTitle className="text-[#0B3C5D]">Change Password</CardTitle>
          <CardDescription>
            {authUser
              ? step === "request"
                ? "Enter your current password and new password"
                : "Enter the verification code sent to your email"
              : "Login required to change password"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!authUser ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-gray-600">Please login first.</p>
              <Link to="/login" className="text-[#1D4E89] hover:underline text-sm">
                Go to Login
              </Link>
            </div>
          ) : (
            <>
              {step === "request" && (
                <form onSubmit={handleRequestOtp} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="currentPassword">Current Password</Label>
                    <Input
                      id="currentPassword"
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Enter current password"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="newPassword">New Password</Label>
                    <Input
                      id="newPassword"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter new password"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm New Password</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                    />
                  </div>

                  {error && <p className="text-sm text-red-600">{error}</p>}
                  {success && <p className="text-sm text-green-700">{success}</p>}

                  <Button type="submit" className="w-full bg-[#0B3C5D] hover:bg-[#1D4E89]" disabled={loading}>
                    {loading ? "Sending OTP..." : "Send OTP"}
                  </Button>
                  <Link to="/login" className="block text-center text-sm text-[#1D4E89] hover:underline">
                    Back
                  </Link>
                </form>
              )}

              {step === "verify" && (
                <form onSubmit={handleVerifyOtp} className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="otp">Verification Code</Label>
                      <span className={`text-sm font-semibold ${isOtpExpired ? "text-red-600" : "text-orange-600"}`}>
                        {countdown}
                      </span>
                    </div>
                    <Input
                      id="otp"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                      maxLength={6}
                      placeholder="Enter 6-digit OTP"
                      className="text-center tracking-widest text-2xl font-bold"
                      disabled={isOtpExpired}
                    />
                  </div>

                  {isOtpExpired && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                      <p className="text-sm text-red-700">OTP has expired. Please request a new one.</p>
                    </div>
                  )}

                  {error && <p className="text-sm text-red-600">{error}</p>}
                  {success && <p className="text-sm text-green-700">{success}</p>}

                  <Button 
                    type="submit" 
                    className="w-full bg-[#0B3C5D] hover:bg-[#1D4E89]" 
                    disabled={loading || isOtpExpired}
                  >
                    {loading ? "Verifying..." : "Verify OTP & Change Password"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={handleBackFromOtp}
                  >
                    Request New OTP
                  </Button>
                </form>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
