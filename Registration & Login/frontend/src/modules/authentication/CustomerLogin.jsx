import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiRequest } from "../../services/api";
import { getDeviceFingerprint } from "../device-monitoring/utils/fingerprint";
import { getDeviceInfo } from "../device-monitoring/utils/deviceInfo";
import { getCurrentGPSLocation } from "../device-monitoring/services/locationService";
import { verifyTwoFactorCode } from "../two-factor-auth/twoFactorService";
import Brand from "../../components/common/Brand";
import OTPVerification from "../two-factor-auth/OTPVerification";

export default function CustomerLogin() {
  const navigate = useNavigate();

  const [mobileNumber, setMobileNumber] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");

  const [loginRequestId, setLoginRequestId] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [approvalPending, setApprovalPending] = useState(false);
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();

    setError("");
    setMessage("");
    setLoading(true);

    try {
      const deviceFingerprint = getDeviceFingerprint();
      const deviceMetadata = getDeviceInfo();
      // The browser displays its native location permission prompt after the user
      // submits the login form. A denial/timeout never prevents authentication.
      const gpsLocation = await getCurrentGPSLocation();

      const result = await apiRequest("/auth/customer/login", {
        method: "POST",
        body: JSON.stringify({
          mobileNumber: mobileNumber.trim(),
          password,
          deviceFingerprint,
          deviceName: deviceMetadata.deviceName,
          deviceMetadata,
          gpsLocation,
        }),
      });

      if (result.requiresAdminApproval) {
        setApprovalPending(true);
        setRequiresTwoFactor(false);

        setMessage(
          result.message ||
          "Your device is waiting for Admin approval."
        );

        return;
      }

      if (result.requiresTwoFactor) {
        setLoginRequestId(result.loginRequestId);
        setRequiresTwoFactor(true);
        setApprovalPending(false);

        setMessage(
          result.message ||
          "Enter the OTP to continue."
        );

        // Development testing only.
        if (result.developmentOTP) {
          setOtp(result.developmentOTP);
        }

        return;
      }

      if (!result.token) {
        throw new Error("Login token was not received.");
      }

      localStorage.setItem("token", result.token);

      const customerData = result.user || result.customer;

      if (customerData) {
        localStorage.setItem(
          "user",
          JSON.stringify(customerData)
        );
      }

      navigate("/customer/dashboard");
    } catch (err) {
      setError(err.message || "Customer login failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleOTPVerification(e) {
    e.preventDefault();

    setError("");
    setMessage("");
    setLoading(true);

    try {
      const result = await verifyTwoFactorCode(loginRequestId, otp.trim());

      if (!result.token) {
        throw new Error("Verification token was not received.");
      }

      localStorage.setItem("token", result.token);

      const customerData = result.user || result.customer;

      if (customerData) {
        localStorage.setItem(
          "user",
          JSON.stringify(customerData)
        );
      }

      setMessage("Verification successful!");

      navigate("/customer/dashboard");
    } catch (err) {
      setError(err.message || "OTP verification failed.");
    } finally {
      setLoading(false);
    }
  }

  function resetLogin() {
    setRequiresTwoFactor(false);
    setApprovalPending(false);
    setLoginRequestId(null);
    setOtp("");
    setPassword("");
    setError("");
    setMessage("");
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Brand />

        <div className="auth-heading">
          <h1>
            {requiresTwoFactor
              ? "Two-Factor Verification"
              : approvalPending
              ? "Device Approval Pending"
              : "Customer Login"}
          </h1>

          <p>
            {requiresTwoFactor
              ? "Verify your identity to access your account."
              : approvalPending
              ? "Your new device requires Admin approval."
              : "Sign in to access your SecureBank account."}
          </p>
        </div>

        {approvalPending ? (
          <div className="approval-pending">
            <h3>Admin Approval Required</h3>

            <p>
              Your login request has been submitted.
              Please wait until an administrator approves
              your device.
            </p>

            {message && (
              <p className="auth-success">{message}</p>
            )}

            <button
              type="button"
              className="primary-button"
              onClick={resetLogin}
            >
              Back to Login
            </button>
          </div>
        ) : requiresTwoFactor ? (
          <OTPVerification
            otp={otp}
            setOtp={setOtp}
            message={message}
            error={error}
            loading={loading}
            onSubmit={handleOTPVerification}
            onBack={resetLogin}
          />
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Mobile Number</label>

              <input
                type="tel"
                placeholder="Enter your registered mobile number"
                value={mobileNumber}
                onChange={(e) =>
                  setMobileNumber(e.target.value)
                }
                autoComplete="tel"
                required
              />
            </div>

            <div className="form-group">
              <label>Password</label>

              <input
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) =>
                  setPassword(e.target.value)
                }
                autoComplete="current-password"
                required
              />
            </div>

            {error && (
              <p className="auth-error">{error}</p>
            )}

            <button
              type="submit"
              className="primary-button"
              disabled={loading}
            >
              {loading ? "Signing in..." : "Login"}
            </button>
          </form>
        )}

        {!approvalPending && !requiresTwoFactor && (
          <div className="auth-footer">
            <p>
              First time here?{" "}
              <Link to="/register">
                Create Password / Register
              </Link>
            </p>

            <p>
              Are you an administrator?{" "}
              <button
                type="button"
                className="text-button"
                onClick={() => navigate("/admin/login")}
              >
                Admin Login
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

