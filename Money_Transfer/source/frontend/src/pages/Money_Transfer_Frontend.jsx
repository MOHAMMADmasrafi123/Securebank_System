
const [transfer, setTransfer] = useState({
  sourceAccountNumber: "",
  destinationType: "FINSHEILD",
  recipient: "",
  amount: "",
  reference: "",
  password: "",
});
const [transferMessage, setTransferMessage] = useState("");
const [transferChallenge, setTransferChallenge] = useState(null);
const [verificationCode, setVerificationCode] = useState("");
const [receipt, setReceipt] = useState(null);

// 2) Start the transfer: send transfer details to the backend and request an OTP.
async function startTransfer(event) {
  event.preventDefault();
  setTransferMessage("Verifying transfer details and requesting OTP...");
  setReceipt(null);

  try {
    const response = await fetch(
      `${API_URL}/customer/security/transfers/challenge`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify(transfer),
      }
    );

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || "Unable to request OTP.");
    }

    setTransferChallenge(result.data);
    setVerificationCode("");

    setTransferMessage(
      result.data.developmentOTP
        ? `Development OTP: ${result.data.developmentOTP} (local testing only)`
        : "OTP sent to your registered mobile number."
    );
  } catch (error) {
    setTransferMessage(
      error.message || "Unable to connect to the bank server."
    );
  }
}

// 3) Verify the OTP: send challenge ID and entered code to the backend.
async function confirmTransfer(event) {
  event.preventDefault();

  try {
    const response = await fetch(
      `${API_URL}/customer/security/transfers/confirm`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({
          challengeId: transferChallenge.challengeId,
          code: verificationCode,
        }),
      }
    );

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || "Verification failed.");
    }

    const completed = result.data;

    setReceipt({
      ...completed,
      transactionId: completed.transactionId,
      recipient: transfer.recipient,
      amount: transfer.amount,
      destinationType: transfer.destinationType,
      reference: transfer.reference,
      sourceAccountNumber: transfer.sourceAccountNumber,
      completedAt: completed.createdAt || new Date().toISOString(),
      status: "SUCCESS",
    });

    setTransferChallenge(null);
    setVerificationCode("");
    setTransferMessage(
      "Transfer completed successfully after OTP verification."
    );

    setTransfer({
      sourceAccountNumber: transfer.sourceAccountNumber,
      destinationType: "FINSHEILD",
      recipient: "",
      amount: "",
      reference: "",
      password: "",
    });

    // Keep these calls from the original dashboard:
    await loadDashboard();
    await loadFeatureData();
  } catch (error) {
    setTransferMessage(error.message || "Unable to verify transfer.");
  }
}

/*
  4) Money Transfer form JSX.
  Put this section inside the CustomerDashboard return, where the
  activePage === "Money Transfer" section belongs.

  The supplied original dashboard also contains the destination selector,
  optional bank selector, summary panel, receipt card and styling. Those UI
  elements are not required to explain the two assessed modules.
*/
{activePage === "Money Transfer" && (
  <section className="transfer-page">
    <h2>Send money securely</h2>

    <form className="transfer-card" onSubmit={startTransfer}>
      <label>
        From account
        <select
          required
          value={transfer.sourceAccountNumber}
          onChange={(event) =>
            setTransfer({
              ...transfer,
              sourceAccountNumber: event.target.value,
            })
          }
        >
          <option value="">Choose your account</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.accountNumber}>
              {account.accountNumber} — Available {formatMoney(account.balance)}
            </option>
          ))}
        </select>
      </label>

      <label>
        Recipient Finsheild account number
        <input
          required
          value={transfer.recipient}
          onChange={(event) =>
            setTransfer({ ...transfer, recipient: event.target.value })
          }
          placeholder="Enter recipient account number"
        />
      </label>

      <label>
        Amount (BDT)
        <input
          required
          type="number"
          min="1"
          step="0.01"
          value={transfer.amount}
          onChange={(event) =>
            setTransfer({ ...transfer, amount: event.target.value })
          }
          placeholder="0.00"
        />
      </label>

      <label>
        Reference / purpose
        <input
          maxLength={180}
          value={transfer.reference}
          onChange={(event) =>
            setTransfer({ ...transfer, reference: event.target.value })
          }
          placeholder="e.g. Monthly payment"
        />
      </label>

      <label>
        Confirm your account password
        <input
          required
          type="password"
          autoComplete="current-password"
          value={transfer.password}
          onChange={(event) =>
            setTransfer({ ...transfer, password: event.target.value })
          }
          placeholder="Enter your password"
        />
      </label>

      <button type="submit">Transfer money securely</button>
    </form>

    {transferMessage && <p role="status">{transferMessage}</p>}

    {transferChallenge && (
      <div className="transfer-otp-panel">
        <h3>Verify your transfer</h3>
        <p>Enter the 6-digit OTP. The challenge expires in 5 minutes.</p>

        <label>
          One-Time Password (OTP)
          <input
            required
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={verificationCode}
            onChange={(event) =>
              setVerificationCode(
                event.target.value.replace(/\D/g, "").slice(0, 6)
              )
            }
            placeholder="Enter 6-digit OTP"
          />
        </label>

        <button
          type="button"
          disabled={verificationCode.length !== 6}
          onClick={() => confirmTransfer({ preventDefault() {} })}
        >
          Verify OTP & Complete Transfer
        </button>

        <button
          type="button"
          onClick={() => {
            setTransferChallenge(null);
            setVerificationCode("");
            setTransferMessage(
              "OTP verification cancelled. Submit the transfer again to request a new OTP."
            );
          }}
        >
          Cancel
        </button>
      </div>
    )}

    {receipt && (
      <div className="receipt-card">
        <h3>Transfer successful</h3>
        <p>Your transaction has been recorded.</p>
        <strong>{receipt.transactionId}</strong>
        <button type="button" onClick={downloadReceipt}>
          Download receipt
        </button>
      </div>
    )}
  </section>
)}
