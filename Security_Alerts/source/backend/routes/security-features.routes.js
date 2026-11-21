import express from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { authenticate, authorizeRoles } from "../middleware/auth.js";

const router = express.Router();
const sha = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const makeId = () => crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 7);
const amountOk = (v) => Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 10000000 && /^\d+(\.\d{1,2})?$/.test(String(v));

async function alert(customerId, title, message, eventType, severity = "INFO", metadata = undefined) {
  return prisma.securityAlert.create({ data: { customerId, title, message, eventType, severity, metadata } });
}

// CUSTOMER APIs
router.use(authenticate);
router.use((req, res, next) => {
  if (req.user.role !== "CUSTOMER") return res.status(403).json({ success: false, message: "Customer access required." });
  next();
});

router.get("/alerts", async (req, res) => {
  const data = await prisma.securityAlert.findMany({ where: { customerId: req.user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  res.json({ success: true, data });
});
router.patch("/alerts/:id/read", async (req, res) => {
  const updated = await prisma.securityAlert.updateMany({ where: { id: Number(req.params.id), customerId: req.user.id }, data: { isRead: true } });
  res.json({ success: true, updated: updated.count });
});
router.get("/history", async (req, res) => {
  const accounts = await prisma.account.findMany({ where: { customerId: req.user.id }, select: { id: true } });
  const ids = accounts.map((a) => a.id);
  const [transactions, loginActivities] = await Promise.all([
    prisma.transaction.findMany({ where: { accountId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 200, include: { account: { select: { accountNumber: true } } } }),
    prisma.loginAttempt.findMany({ where: { customerId: req.user.id }, orderBy: { createdAt: "desc" }, take: 200, select: { mobileNumber: true, ipAddress: true, success: true, reason: true, createdAt: true } }),
  ]);
  res.json({ success: true, data: { transactions, loginActivities } });
});

// Internal transfers require a fresh OTP for every transfer attempt.
router.post("/transfers/challenge", async (req, res) => {
  try {
    const { sourceAccountNumber, destinationType, recipient, amount, reference, password } = req.body;
    if (!amountOk(amount) || !["FINSHEILD", "BKASH", "NAGAD", "ROCKET", "UPAY", "OTHER"].includes(destinationType) || !recipient || !password) {
      return res.status(400).json({ success: false, message: "Complete all transfer fields with a valid amount." });
    }
    if (destinationType !== "FINSHEILD") {
      return res.status(501).json({ success: false, message: "Feature not implemented yet. External wallet and other-bank transfers are not available." });
    }
    const source = await prisma.account.findFirst({ where: { accountNumber: String(sourceAccountNumber), customerId: req.user.id, status: "ACTIVE" }, include: { customer: true } });
    if (!source) return res.status(404).json({ success: false, message: "Your active source account was not found." });
    if (!source.customer.password || !(await bcrypt.compare(String(password), source.customer.password))) {
      return res.status(401).json({ success: false, message: "Account password is incorrect." });
    }
    const target = await prisma.account.findUnique({ where: { accountNumber: String(recipient) } });
    if (!target || target.status !== "ACTIVE") return res.status(404).json({ success: false, message: "Recipient Finsheild account was not found or is inactive." });
    if (target.id === source.id) return res.status(400).json({ success: false, message: "You cannot transfer to the same account." });
    const transferAmount = Number(amount);
    if (Number(source.balance) < transferAmount) return res.status(400).json({ success: false, message: "Insufficient balance." });

    const recent = await prisma.transaction.findMany({ where: { accountId: source.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } }, select: { amount: true } });
    const reasons = [];
    let score = 0;
    if (transferAmount >= 100000) { score += 35; reasons.push("High transaction amount"); }
    if (recent.length >= 5) { score += 30; reasons.push("High transaction frequency in the last hour"); }
    if (recent.reduce((sum, item) => sum + Number(item.amount), 0) + transferAmount >= 200000) { score += 25; reasons.push("Unusual hourly transaction volume"); }
    const level = score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW";
    if (level === "HIGH") {
      await prisma.transactionRisk.create({ data: { customerId: req.user.id, accountId: source.id, score, level, reasons, decision: "BLOCKED" } });
      await alert(req.user.id, "Transfer blocked", `A transfer of BDT ${transferAmount} was blocked by risk controls.`, "RISK_BLOCK", "HIGH", { score, reasons });
      await prisma.securityLog.create({ data: { customerId: req.user.id, eventType: "RISK_BLOCKED_TRANSFER", severity: "HIGH", description: "Transfer blocked by risk-based controls.", metadata: { amount: String(transferAmount), score, reasons } } });
      return res.status(403).json({ success: false, message: "This transfer was blocked by security risk controls.", risk: { score, level, reasons } });
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    const challenge = await prisma.transferChallenge.create({
      data: {
        customerId: req.user.id,
        accountId: source.id,
        payload: { targetAccountId: target.id, targetAccountNumber: target.accountNumber, amount: String(transferAmount), reference: String(reference || "").slice(0, 180), score, level, reasons },
        codeHash: await bcrypt.hash(otp, 10),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    await prisma.securityLog.create({ data: { customerId: req.user.id, eventType: "TRANSFER_OTP_ISSUED", severity: "INFO", description: "A one-time verification code was issued for a money transfer.", metadata: { challengeId: challenge.id, recipient: target.accountNumber, amount: String(transferAmount) } } });
    const response = { success: true, message: "OTP verification is required to complete this transfer.", data: { challengeId: challenge.id, expiresInSeconds: 300 } };
    // Local testing only. Configure an SMS provider before production use.
    if (process.env.NODE_ENV !== "production") response.data.developmentOTP = otp;
    return res.status(201).json(response);
  } catch (error) {
    console.error("Transfer challenge error:", error);
    return res.status(500).json({ success: false, message: "Unable to start transfer verification." });
  }
});

router.post("/transfers/confirm", async (req, res) => {
  try {
    const { challengeId, code } = req.body;
    if (!challengeId || !/^\d{6}$/.test(String(code || ""))) return res.status(400).json({ success: false, message: "Enter the six-digit OTP." });
    const challenge = await prisma.transferChallenge.findFirst({ where: { id: Number(challengeId), customerId: req.user.id } });
    if (!challenge || challenge.consumedAt) return res.status(400).json({ success: false, message: "OTP request is invalid or already used. Start the transfer again." });
    if (challenge.expiresAt <= new Date()) return res.status(400).json({ success: false, message: "OTP expired. Start the transfer again." });
    if (challenge.attempts >= 5) return res.status(429).json({ success: false, message: "Too many incorrect OTP attempts. Start the transfer again." });
    const matched = await bcrypt.compare(String(code), challenge.codeHash);
    if (!matched) {
      await prisma.transferChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      return res.status(400).json({ success: false, message: "Incorrect OTP. Please try again." });
    }

    const payload = challenge.payload;
    const transactionId = makeId();
    const result = await prisma.$transaction(async (tx) => {
      const currentChallenge = await tx.transferChallenge.findFirst({ where: { id: challenge.id, customerId: req.user.id, consumedAt: null } });
      if (!currentChallenge || currentChallenge.expiresAt <= new Date() || currentChallenge.attempts >= 5) throw new Error("CHALLENGE_INVALID");
      const debit = await tx.account.updateMany({ where: { id: challenge.accountId, customerId: req.user.id, status: "ACTIVE", balance: { gte: Number(payload.amount) } }, data: { balance: { decrement: Number(payload.amount) } } });
      if (!debit.count) throw new Error("INSUFFICIENT_BALANCE");
      const credit = await tx.account.updateMany({ where: { id: Number(payload.targetAccountId), status: "ACTIVE" }, data: { balance: { increment: Number(payload.amount) } } });
      if (!credit.count) throw new Error("RECIPIENT_UNAVAILABLE");
      await tx.transferChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
      const sent = await tx.transaction.create({ data: { transactionId, type: "TRANSFER_OUT", amount: Number(payload.amount), description: String(payload.reference || "Finsheild internal transfer"), recipientAccount: String(payload.targetAccountNumber), status: "SUCCESS", accountId: challenge.accountId } });
      await tx.transaction.create({ data: { transactionId: makeId(), type: "TRANSFER_IN", amount: Number(payload.amount), description: "Received Finsheild internal transfer", recipientAccount: "", status: "SUCCESS", accountId: Number(payload.targetAccountId) } });
      await tx.transactionRisk.create({ data: { transactionId, customerId: req.user.id, accountId: challenge.accountId, score: Number(payload.score), level: String(payload.level), reasons: payload.reasons, decision: "ALLOWED_AFTER_OTP" } });
      await tx.securityAlert.create({ data: { customerId: req.user.id, title: "Money transferred", message: `BDT ${payload.amount} sent to ${payload.targetAccountNumber} successfully.`, eventType: "TRANSFER_SUCCESS", severity: payload.level === "MEDIUM" ? "MEDIUM" : "INFO", metadata: { transactionId, riskScore: payload.score, riskLevel: payload.level } } });
      await tx.securityLog.create({ data: { customerId: req.user.id, eventType: "TRANSFER_SUCCESS", severity: "INFO", description: "Customer completed an internal Finsheild transfer after OTP verification.", metadata: { transactionId, amount: String(payload.amount), recipient: payload.targetAccountNumber, riskScore: payload.score, riskLevel: payload.level } } });
      return sent;
    });
    return res.json({ success: true, message: "Transfer completed successfully after OTP verification.", data: { ...result, sourceAccountNumber: (await prisma.account.findUnique({ where: { id: challenge.accountId }, select: { accountNumber: true } }))?.accountNumber, recipient: payload.targetAccountNumber, destinationType: "FINSHEILD", reference: payload.reference, risk: { score: payload.score, level: payload.level, reasons: payload.reasons } } });
  } catch (error) {
    if (error.message === "INSUFFICIENT_BALANCE") return res.status(400).json({ success: false, message: "Insufficient balance." });
    if (error.message === "RECIPIENT_UNAVAILABLE") return res.status(404).json({ success: false, message: "Recipient account is unavailable." });
    if (error.message === "CHALLENGE_INVALID") return res.status(400).json({ success: false, message: "OTP request is invalid. Start the transfer again." });
    console.error("Transfer confirmation error:", error);
    return res.status(500).json({ success: false, message: "Unable to verify and complete transfer." });
  }
});

// ADMIN APIs mounted separately through admin router below.
export const adminSecurityRouter = express.Router();
adminSecurityRouter.use(authenticate, authorizeRoles("ADMIN", "SUPER_ADMIN"));
adminSecurityRouter.get("/security/overview", async (req, res) => {
  const [alerts, risks, failedLogins, loginActivities, transactions, logs] = await Promise.all([
    prisma.securityAlert.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.transactionRisk.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.loginAttempt.findMany({ where: { success: false }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.loginAttempt.findMany({ orderBy: { createdAt: "desc" }, take: 500, include: { customer: { select: { fullName: true, mobileNumber: true } } } }),
    prisma.transaction.findMany({ orderBy: { createdAt: "desc" }, take: 500, include: { account: { select: { accountNumber: true, customer: { select: { fullName: true, mobileNumber: true } } } } } }),
    prisma.securityLog.findMany({ orderBy: { createdAt: "desc" }, take: 300, include: { customer: { select: { fullName: true, mobileNumber: true } }, admin: { select: { fullName: true, username: true } } } }),
  ]);
  res.json({ success: true, data: { alerts, risks, failedLogins, loginActivities, transactions, logs } });
});

export default router;
