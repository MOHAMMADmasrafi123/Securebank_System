import React from "react";

export default function OTPVerification({ otp, setOtp, message, error, loading, onSubmit, onBack }) {
  return (
          <form onSubmit={onSubmit}>
            <div className="form-group">
              <label>Verification Code</label>

              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="Enter 6-digit OTP"
                value={otp}
                onChange={(e) =>
                  setOtp(e.target.value.replace(/\D/g, ""))
                }
                required
              />
            </div>

            {message && (
              <p className="auth-success">{message}</p>
            )}

            {error && (
              <p className="auth-error">{error}</p>
            )}

            <button
              type="submit"
              className="primary-button"
              disabled={loading || otp.length !== 6}
            >
              {loading ? "Verifying..." : "Verify OTP"}
            </button>

            <button
              type="button"
              className="text-button"
              onClick={onBack}
              style={{ marginTop: "15px" }}
            >
              Back to Login
            </button>
          </form>
  );
}
