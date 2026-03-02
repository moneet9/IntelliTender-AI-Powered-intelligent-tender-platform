import { useState } from "react";
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
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError("Please fill all fields");
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
      setSuccess(response.message || "Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#F4F6F9] to-white flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-[#1D4E89]/20">
        <CardHeader className="text-center">
          <CardTitle className="text-[#0B3C5D]">Change Password</CardTitle>
          <CardDescription>
            {authUser ? "Update your account password" : "Login required to change password"}
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
            <form onSubmit={handleSubmit} className="space-y-4">
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
                {loading ? "Updating..." : "Change Password"}
              </Button>
              <Link to="/login" className="block text-center text-sm text-[#1D4E89] hover:underline">
                Back
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
