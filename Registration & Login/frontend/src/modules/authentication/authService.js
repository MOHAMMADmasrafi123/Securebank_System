import { apiRequest } from "../../services/api";

export function registerCustomer(payload) {
  return apiRequest("/auth/customer/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function loginCustomer(payload) {
  return apiRequest("/auth/customer/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function loginAdmin(payload) {
  return apiRequest("/auth/admin/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
