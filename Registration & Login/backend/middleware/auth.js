
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";

export function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication token required",
      });
    }

    const token = authHeader.slice(7);

    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: "securebank-api",
      audience: "securebank-client",
    });

    const userId = Number(decoded.sub);

    if (
      !Number.isSafeInteger(userId) ||
      userId <= 0 ||
      typeof decoded.role !== "string"
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token",
      });
    }

    req.user = {
      id: userId,
      role: decoded.role,
    };

    // Check the live customer status on every protected request so an admin
    // block immediately invalidates access even when an older JWT still exists.
    if (decoded.role === "CUSTOMER") {
      prisma.customer.findUnique({ where: { id: userId }, select: { isActive: true, isLocked: true } })
        .then((customer) => {
          if (!customer || !customer.isActive || customer.isLocked) {
            return res.status(423).json({
              success: false,
              message: "Your Account Is Blocked. Please contact the bank’s customer support for assistance.",
            });
          }
          next();
        })
        .catch((error) => {
          console.error("Customer access status check failed:", error);
          return res.status(503).json({ success: false, message: "Unable to verify account status. Please try again." });
        });
      return;
    }

    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
}

export function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. Insufficient permissions.",
      });
    }

    next();
  };
}
