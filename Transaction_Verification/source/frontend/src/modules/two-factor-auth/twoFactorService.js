import { apiRequest } from "../../services/api";

export function verifyTwoFactorCode(loginRequestId, otp) {
  return apiRequest("/auth/customer/verify-2fa", {
    method: "POST",
    body: JSON.stringify({ loginRequestId, otp }),
  });
}
