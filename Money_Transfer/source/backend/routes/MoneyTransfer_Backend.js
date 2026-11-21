
import express from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

const makeId = () =>
  crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 7);

const amountOk = (v) =>
  Number.isFinite(Number(v)) &&
  Number(v) > 0 &&
  Number(v) <= 10000000 &&
  /^\d+(\.\d{1,2})?$/.test(String(v));

async function alert(customerId, title, message, eventType, severity = "INFO", metadata = undefined) {
  return prisma.securityAlert.create({
    data: { customerId, title, message, eventType, severity, metadata },
  });
}

// CUSTOMER AUTHENTICATION
router.use(authenticate);

router.use((req, res, next) => {
  if (req.user.role !== "CUSTOMER") {
    return res.status(403).json({
      success: false,
      message: "Customer access required.",
    });
  }
  next();
});

// STEP 1: START MONEY TRANSFER AND GENERATE OTP
router.post("/transfers/challenge", async (req, res) => {
  try {
    const {
      sourceAccountNumber,
      destinationType,
      recipient,
      amount,
      reference,
      password,
    } = req.body;

    if (
      !amountOk(amount) ||
      !["FINSHEILD", "BKASH", "NAGAD", "ROCKET", "UPAY", "OTHER"].includes(destinationType) ||
      !recipient ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Complete all transfer fields with a valid amount.",
      });
    }

    // Currently only internal Finsheild transfer is supported.
    if (destinationType !== "FINSHEILD") {
      return res.status(501).json({
        success: false,
        message: "External transfers are not implemented yet.",
      });
    }

    // Find sender account.
    const source = await prisma.account.findFirst({
      where: {
        accountNumber: String(sourceAccountNumber),
        customerId: req.user.id,
        status: "ACTIVE",
      },
      include: { customer: true },
    });

    if (!source) {
      return res.status(404).json({
        success: false,
        message: "Source account not found.",
      });
    }

    // Verify account password.
    if (
      !source.customer.password ||
      !(await bcrypt.compare(String(password), source.customer.password))
    ) {
      return res.status(401).json({
        success: false,
        message: "Account password is incorrect.",
      });
    }

    // Find recipient account.
    const target = await prisma.account.findUnique({
      where: { accountNumber: String(recipient) },
    });

    if (!target || target.status !== "ACTIVE") {
      return res.status(404).json({
        success: false,
        message: "Recipient account not found or inactive.",
      });
    }

    if (target.id === source.id) {
      return res.status(400).json({
        success: false,
        message: "You cannot transfer to the same account.",
      });
    }

    const transferAmount = Number(amount);

    // Check available balance.
    if (Number(source.balance) < transferAmount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient balance.",
      });
    }

    // RISK ANALYSIS
    const recent = await prisma.transaction.findMany({
      where: {
        accountId: source.id,
        createdAt: {
          gte: new Date(Date.now() - 60 * 60 * 1000),
        },
      },
      select: { amount: true },
    });

    const reasons = [];
    let score = 0;

    if (transferAmount >= 100000) {
      score += 35;
      reasons.push("High transaction amount");
    }

    if (recent.length >= 5) {
      score += 30;
      reasons.push("High transaction frequency");
    }

    if (
      recent.reduce((sum, item) => sum + Number(item.amount), 0) +
        transferAmount >=
      200000
    ) {
      score += 25;
      reasons.push("Unusual hourly transaction volume");
    }

    const level =
      score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW";

    // Block high-risk transfers.
    if (level === "HIGH") {
      await prisma.transactionRisk.create({
        data: {
          customerId: req.user.id,
          accountId: source.id,
          score,
          level,
          reasons,
          decision: "BLOCKED",
        },
      });

      await alert(
        req.user.id,
        "Transfer blocked",
        `A transfer of BDT ${transferAmount} was blocked.`,
        "RISK_BLOCK",
        "HIGH",
        { score, reasons }
      );

      return res.status(403).json({
        success: false,
        message: "Transfer blocked by security risk controls.",
        risk: { score, level, reasons },
      });
    }

    // GENERATE SIX-DIGIT OTP
    const otp = String(crypto.randomInt(100000, 1000000));

    // Store OTP as a bcrypt hash.
    const challenge = await prisma.transferChallenge.create({
      data: {
        customerId: req.user.id,
        accountId: source.id,
        payload: {
          targetAccountId: target.id,
          targetAccountNumber: target.accountNumber,
          amount: String(transferAmount),
          reference: String(reference || "").slice(0, 180),
          score,
          level,
          reasons,
        },
        codeHash: await bcrypt.hash(otp, 10),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    const response = {
      success: true,
      message: "OTP verification is required.",
      data: {
        challengeId: challenge.id,
        expiresInSeconds: 300,
      },
    };

    // Local testing only.
    if (process.env.NODE_ENV !== "production") {
      response.data.developmentOTP = otp;
    }

    return res.status(201).json(response);

  } catch (error) {
    console.error("Transfer challenge error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to start transfer verification.",
    });
  }
});

// STEP 2: VERIFY OTP AND COMPLETE TRANSFER
router.post("/transfers/confirm", async (req, res) => {
  try {
    const { challengeId, code } = req.body;

    if (!challengeId || !/^\d{6}$/.test(String(code || ""))) {
      return res.status(400).json({
        success: false,
        message: "Enter the six-digit OTP.",
      });
    }

    const challenge = await prisma.transferChallenge.findFirst({
      where: {
        id: Number(challengeId),
        customerId: req.user.id,
      },
    });

    if (!challenge || challenge.consumedAt) {
      return res.status(400).json({
        success: false,
        message: "OTP request is invalid or already used.",
      });
    }

    if (challenge.expiresAt <= new Date()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired. Start again.",
      });
    }

    if (challenge.attempts >= 5) {
      return res.status(429).json({
        success: false,
        message: "Too many incorrect OTP attempts.",
      });
    }

    // Compare entered OTP with stored hash.
    const matched = await bcrypt.compare(
      String(code),
      challenge.codeHash
    );

    if (!matched) {
      await prisma.transferChallenge.update({
        where: { id: challenge.id },
        data: {
          attempts: { increment: 1 },
        },
      });

      return res.status(400).json({
        success: false,
        message: "Incorrect OTP. Please try again.",
      });
    }

    const payload = challenge.payload;
    const transactionId = makeId();

    // DATABASE TRANSACTION
    const result = await prisma.$transaction(async (tx) => {

      // Deduct money from sender.
      const debit = await tx.account.updateMany({
        where: {
          id: challenge.accountId,
          customerId: req.user.id,
          status: "ACTIVE",
          balance: {
            gte: Number(payload.amount),
          },
        },
        data: {
          balance: {
            decrement: Number(payload.amount),
          },
        },
      });

      if (!debit.count) {
        throw new Error("INSUFFICIENT_BALANCE");
      }

      // Add money to recipient.
      const credit = await tx.account.updateMany({
        where: {
          id: Number(payload.targetAccountId),
          status: "ACTIVE",
        },
        data: {
          balance: {
            increment: Number(payload.amount),
          },
        },
      });

      if (!credit.count) {
        throw new Error("RECIPIENT_UNAVAILABLE");
      }

      // Mark OTP as used.
      await tx.transferChallenge.update({
        where: { id: challenge.id },
        data: {
          consumedAt: new Date(),
        },
      });

      // Sender transaction record.
      const sent = await tx.transaction.create({
        data: {
          transactionId,
          type: "TRANSFER_OUT",
          amount: Number(payload.amount),
          description: String(
            payload.reference || "Finsheild internal transfer"
          ),
          recipientAccount: String(payload.targetAccountNumber),
          status: "SUCCESS",
          accountId: challenge.accountId,
        },
      });

      // Receiver transaction record.
      await tx.transaction.create({
        data: {
          transactionId: makeId(),
          type: "TRANSFER_IN",
          amount: Number(payload.amount),
          description: "Received Finsheild internal transfer",
          recipientAccount: "",
          status: "SUCCESS",
          accountId: Number(payload.targetAccountId),
        },
      });

      // Save risk decision.
      await tx.transactionRisk.create({
        data: {
          transactionId,
          customerId: req.user.id,
          accountId: challenge.accountId,
          score: Number(payload.score),
          level: String(payload.level),
          reasons: payload.reasons,
          decision: "ALLOWED_AFTER_OTP",
        },
      });

      // Create success alert.
      await tx.securityAlert.create({
        data: {
          customerId: req.user.id,
          title: "Money transferred",
          message: `BDT ${payload.amount} sent to ${payload.targetAccountNumber} successfully.`,
          eventType: "TRANSFER_SUCCESS",
          severity: payload.level === "MEDIUM" ? "MEDIUM" : "INFO",
          metadata: {
            transactionId,
            riskScore: payload.score,
            riskLevel: payload.level,
          },
        },
      });

      return sent;
    });

    return res.json({
      success: true,
      message: "Transfer completed successfully after OTP verification.",
      data: {
        ...result,
        recipient: payload.targetAccountNumber,
        destinationType: "FINSHEILD",
        reference: payload.reference,
      },
    });

  } catch (error) {

    if (error.message === "INSUFFICIENT_BALANCE") {
      return res.status(400).json({
        success: false,
        message: "Insufficient balance.",
      });
    }

    if (error.message === "RECIPIENT_UNAVAILABLE") {
      return res.status(404).json({
        success: false,
        message: "Recipient account is unavailable.",
      });
    }

    console.error("Transfer confirmation error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to verify and complete transfer.",
    });
  }
});

export default router;
