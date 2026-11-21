
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./CustomerDashboard.css";

const API_URL = "http://localhost:5000/api";

function formatMoney(amount) {
  return new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency: "BDT",
    minimumFractionDigits: 2,
  }).format(Number(amount || 0));
}

function formatDate(date) {
  return new Date(date).toLocaleString("en-BD", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function CustomerDashboard() {
  const navigate = useNavigate();

  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activePage, setActivePage] = useState("Overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [featureData, setFeatureData] = useState({ alerts: [], history: null });
  const [transfer, setTransfer] = useState({ sourceAccountNumber: "", destinationType: "FINSHEILD", recipient: "", amount: "", reference: "", password: "" });
  const [transferMessage, setTransferMessage] = useState("");
  const [transferChallenge, setTransferChallenge] = useState(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [receipt, setReceipt] = useState(null);

  const loadDashboard = useCallback(async () => {
    const token = localStorage.getItem("token");

    if (!token) {
      navigate("/login");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const response = await fetch(`${API_URL}/customer/dashboard`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const result = await response.json();

      if (response.status === 401 || response.status === 403) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        navigate("/login");
        return;
      }

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to load dashboard.");
      }

      setDashboard(result.data);
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  async function loadFeatureData() {
    const token = localStorage.getItem("token");
    try {
      const [alerts, history] = await Promise.all([
        fetch(`${API_URL}/customer/security/alerts`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        fetch(`${API_URL}/customer/security/history`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      ]);
      setFeatureData({ alerts: alerts.data || [], history: history.data || null });
    } catch { setFeatureData({ alerts: [], history: null }); }
  }

  async function startTransfer(event) {
    event.preventDefault();
    setTransferMessage("Verifying transfer details and requesting OTP...");
    setReceipt(null);
    try {
      const response = await fetch(`${API_URL}/customer/security/transfers/challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify(transfer),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to request OTP.");
      setTransferChallenge(result.data);
      setVerificationCode("");
      setTransferMessage(result.data.developmentOTP ? `Development OTP: ${result.data.developmentOTP} (local testing only)` : "OTP sent to your registered mobile number.");
    } catch (error) {
      setTransferMessage(error.message || "Unable to connect to the bank server.");
    }
  }

  async function confirmTransfer(event) {
    event.preventDefault();
    try {
      const response = await fetch(`${API_URL}/customer/security/transfers/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ challengeId: transferChallenge.challengeId, code: verificationCode }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Verification failed.");
      const completed = result.data;
      setReceipt({ ...completed, transactionId: completed.transactionId, recipient: transfer.recipient, amount: transfer.amount, destinationType: transfer.destinationType, reference: transfer.reference, sourceAccountNumber: transfer.sourceAccountNumber, completedAt: completed.createdAt || new Date().toISOString(), status: "SUCCESS" });
      setTransferChallenge(null);
      setVerificationCode("");
      setTransferMessage("Transfer completed successfully after OTP verification.");
      setTransfer({ sourceAccountNumber: transfer.sourceAccountNumber, destinationType: "FINSHEILD", recipient: "", amount: "", reference: "", password: "" });
      await loadDashboard();
      await loadFeatureData();
    } catch (error) { setTransferMessage(error.message || "Unable to verify transfer."); }
  }

  function downloadReceipt() {
    if (!receipt) return;
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 1500;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f3f7fb"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(70, 60, 1060, 1380);
    ctx.strokeStyle = "#dce6ef"; ctx.lineWidth = 3; ctx.strokeRect(70, 60, 1060, 1380);
    ctx.fillStyle = "#087b63"; ctx.fillRect(70, 60, 1060, 230);
    ctx.fillStyle = "#ffffff"; ctx.font = "bold 64px Arial"; ctx.fillText("SecureBank", 125, 155);
    ctx.font = "32px Arial"; ctx.fillText("MONEY TRANSFER RECEIPT", 125, 220);
    ctx.fillStyle = "#087b63"; ctx.font = "bold 34px Arial"; ctx.fillText("TRANSFER SUCCESSFUL", 125, 375);
    ctx.fillStyle = "#15243a"; ctx.font = "bold 66px Arial"; ctx.fillText(`BDT ${Number(receipt.amount).toLocaleString("en-BD", { minimumFractionDigits: 2 })}`, 125, 485);
    const rows = [["Transaction ID", receipt.transactionId], ["From Account", receipt.sourceAccountNumber], ["Recipient Account", receipt.recipient], ["Destination", receipt.destinationType], ["Reference", receipt.reference || "—"], ["Status", receipt.status || "SUCCESS"], ["Date & Time", new Date(receipt.completedAt).toLocaleString("en-BD")]];
    let y = 610;
    rows.forEach(([label, value]) => {
      ctx.strokeStyle = "#e5ebf1"; ctx.beginPath(); ctx.moveTo(125, y + 35); ctx.lineTo(1075, y + 35); ctx.stroke();
      ctx.fillStyle = "#68778a"; ctx.font = "28px Arial"; ctx.fillText(label, 125, y);
      ctx.fillStyle = "#17233c"; ctx.font = "bold 28px Arial";
      const text = String(value ?? "—"); ctx.fillText(text.length > 36 ? `${text.slice(0, 33)}...` : text, 570, y);
      y += 105;
    });
    ctx.fillStyle = "#68778a"; ctx.font = "24px Arial"; ctx.fillText("Thank you for banking with SecureBank.", 125, 1335);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = `SecureBank-Receipt-${receipt.transactionId || "transfer"}.png`; link.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  }

  if (loading) {
    return (
      <div className="customer-loading">
        <div className="loading-spinner"></div>
        <p>Loading SecureBank...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="customer-loading">
        <p>{error}</p>
        <button onClick={loadDashboard}>Try Again</button>
        <button onClick={handleLogout}>Logout</button>
      </div>
    );
  }

  if (!dashboard) return null;

  const { customer, accounts, summary, recentTransactions } = dashboard;

  return (
    <div className="customer-dashboard">
      <aside className={`customer-sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-brand">
          <div className="brand-icon">S</div>
          <h2>SecureBank</h2>
        </div>

        <div className="sidebar-profile">
          <div className="profile-avatar">
            {customer.fullName?.charAt(0)?.toUpperCase() || "C"}
          </div>
          <div>
            <h3>{customer.fullName}</h3>
            <p>Customer Account</p>
          </div>
        </div>

        <nav className="sidebar-navigation">
          {["Overview", "Accounts", "Money Transfer", "Alerts", "History", "Transactions", "Profile"].map((item) => (
            <button
              key={item}
              className={activePage === item ? "active" : ""}
              onClick={() => {
                setActivePage(item);
                if (["Alerts", "History"].includes(item)) loadFeatureData();
                setSidebarOpen(false);
              }}
            >
              {item === "Overview" && "▦"}
              {item === "Accounts" && "▣"}
              {item === "Transactions" && "↕"}
              {item === "Money Transfer" && "৳"}
              {item === "Alerts" && "♢"}
              {item === "History" && "◷"}
              {item === "Profile" && "♙"}
              <span>{item}</span>
            </button>
          ))}
        </nav>

        <button className="sidebar-logout" onClick={handleLogout}>
          ↪ <span>Logout</span>
        </button>
      </aside>

      <main className="customer-main">
        <header className="customer-topbar">
          <button
            className="mobile-menu-button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            ☰
          </button>

          <div>
            <h1>{activePage}</h1>
            <p>Welcome back, {customer.fullName}</p>
          </div>

          <div className="topbar-user">
            <div className="profile-avatar small">
              {customer.fullName?.charAt(0)?.toUpperCase() || "C"}
            </div>
            <span>{customer.fullName}</span>
          </div>
        </header>

        {activePage === "Overview" && (
          <>
            <section className="balance-card">
              <div>
                <p>Total Available Balance</p>
                <h2>{formatMoney(summary.totalBalance)}</h2>
                <span>SecureBank Account Overview</span>
              </div>
              <div className="balance-decoration">৳</div>
            </section>

            <section className="statistics-grid">
              <div className="stat-card">
                <span>Total Accounts</span>
                <h2>{summary.totalAccounts}</h2>
                <p>Your registered accounts</p>
              </div>

              <div className="stat-card">
                <span>Total Transactions</span>
                <h2>{summary.totalTransactions}</h2>
                <p>All account transactions</p>
              </div>
            </section>

            <section className="dashboard-section">
              <div className="section-heading">
                <h2>My Accounts</h2>
                <span>{accounts.length} Accounts</span>
              </div>

              <div className="accounts-grid">
                {accounts.map((account) => (
                  <div className="account-card" key={account.id}>
                    <div className="account-card-heading">
                      <span>{account.accountType}</span>
                      <span className={`account-status ${account.status.toLowerCase()}`}>
                        {account.status}
                      </span>
                    </div>
                    <p>Account Number</p>
                    <h3>{account.accountNumber}</h3>
                    <div className="account-card-balance">
                      <span>Balance</span>
                      <strong>{formatMoney(account.balance)}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="dashboard-section">
              <div className="section-heading">
                <h2>Recent Transactions</h2>
                <button onClick={() => setActivePage("Transactions")}>
                  View All
                </button>
              </div>

              <TransactionTable transactions={recentTransactions} />
            </section>
          </>
        )}

        {activePage === "Accounts" && (
          <section className="dashboard-section">
            <div className="section-heading">
              <h2>My Accounts</h2>
            </div>
            <div className="accounts-grid">
              {accounts.map((account) => (
                <div className="account-card" key={account.id}>
                  <span>{account.accountType}</span>
                  <h3>{account.accountNumber}</h3>
                  <p>{account.status}</p>
                  <strong>{formatMoney(account.balance)}</strong>
                </div>
              ))}
            </div>
          </section>
        )}

        {activePage === "Money Transfer" && (
          <section className="transfer-page">
            <div className="transfer-heading"><div><span className="eyebrow">PAYMENTS & TRANSFERS</span><h2>Send money securely</h2><p>Transfer funds with an additional security verification.</p></div><div className="transfer-shield">♢</div></div>
            <div className="transfer-layout">
              <form className="transfer-card" onSubmit={startTransfer}>
                <div className="transfer-card-title"><span className="transfer-icon">↗</span><div><h3>New transfer</h3><p>Complete the details below</p></div></div>
                <label className="transfer-field"><span>From account</span><select required value={transfer.sourceAccountNumber} onChange={e => setTransfer({ ...transfer, sourceAccountNumber: e.target.value })}><option value="">Choose your SecureBank account</option>{accounts.map(a => <option key={a.id} value={a.accountNumber}>{a.accountNumber} · Available {formatMoney(a.balance)}</option>)}</select></label>
                <div className="transfer-field"><span>Choose destination</span><div className="destination-options">{[{id:"FINSHEILD",name:"Finsheild",sub:"Bank account",icon:"S"},{id:"BKASH",name:"bKash",sub:"Mobile wallet",icon:"b"},{id:"NAGAD",name:"Nagad",sub:"Mobile wallet",icon:"N"},{id:"ROCKET",name:"Rocket",sub:"Mobile wallet",icon:"R"},{id:"UPAY",name:"Upay",sub:"Mobile wallet",icon:"U"},{id:"OTHER",name:"Other bank",sub:"BD bank transfer",icon:"⌂"}].map(item=><button type="button" key={item.id} className={`destination-option ${transfer.destinationType===item.id?"selected":""}`} onClick={()=>setTransfer({...transfer,destinationType:item.id,recipient:"",bankName:""})}><b>{item.icon}</b><strong>{item.name}</strong><small>{item.sub}</small></button>)}</div></div>
                {transfer.destinationType === "OTHER" && <label className="transfer-field"><span>Select recipient bank</span><select required value={transfer.bankName || ""} onChange={e=>setTransfer({...transfer,bankName:e.target.value})}><option value="">Choose a bank in Bangladesh</option>{["AB Bank PLC","Agrani Bank PLC","Al-Arafah Islami Bank PLC","Bank Asia PLC","Bangladesh Commerce Bank PLC","Bangladesh Development Bank PLC","BASIC Bank Limited","BRAC Bank PLC","Citizens Bank PLC","City Bank PLC","Community Bank Bangladesh PLC","Dhaka Bank PLC","Dutch-Bangla Bank PLC","Eastern Bank PLC","EXIM Bank PLC","First Security Islami Bank PLC","Global Islami Bank PLC","IFIC Bank PLC","Islami Bank Bangladesh PLC","Jamuna Bank PLC","Janata Bank PLC","Meghna Bank PLC","Mercantile Bank PLC","Midland Bank PLC","Modhumoti Bank PLC","Mutual Trust Bank PLC","National Bank Limited","National Credit and Commerce Bank PLC","NRB Bank PLC","NRB Commercial Bank PLC","One Bank PLC","Padma Bank PLC","Premier Bank PLC","Prime Bank PLC","Pubali Bank PLC","Rupali Bank PLC","Shimanto Bank PLC","Social Islami Bank PLC","Sonali Bank PLC","South Bangla Agriculture and Commerce Bank PLC","Southeast Bank PLC","Standard Bank PLC","The Hongkong and Shanghai Banking Corporation Limited","Trust Bank PLC","Union Bank PLC","United Commercial Bank PLC","Uttara Bank PLC","Standard Chartered Bank","Woori Bank"].map(bank=><option key={bank}>{bank}</option>)}</select></label>}
                <label className="transfer-field"><span>{transfer.destinationType==="FINSHEILD"?"Recipient Finsheild account number":transfer.destinationType==="OTHER"?"Recipient bank account number":"Recipient mobile wallet number"}</span><input required inputMode={transfer.destinationType==="FINSHEILD"||transfer.destinationType==="OTHER"?"numeric":"tel"} value={transfer.recipient} onChange={e=>setTransfer({...transfer,recipient:e.target.value})} placeholder={transfer.destinationType==="FINSHEILD"?"Enter SecureBank account number":transfer.destinationType==="OTHER"?"Enter bank account number":"01XXXXXXXXX"}/></label>
                <div className="transfer-two-col"><label className="transfer-field"><span>Amount (BDT)</span><input required type="number" min="1" step="0.01" value={transfer.amount} onChange={e=>setTransfer({...transfer,amount:e.target.value})} placeholder="0.00"/></label><label className="transfer-field"><span>Reference / purpose</span><input maxLength="180" value={transfer.reference} onChange={e=>setTransfer({...transfer,reference:e.target.value})} placeholder="e.g. Monthly payment"/></label></div>
                <label className="transfer-field"><span>Confirm your account password</span><input required type="password" autoComplete="current-password" value={transfer.password} onChange={e=>setTransfer({...transfer,password:e.target.value})} placeholder="Enter your password"/></label>
                <button className="transfer-submit" type="submit">Transfer money securely <span>→</span></button>
                {transferMessage && <div className={`transfer-feedback ${receipt?"success":""}`} role="status">{transferMessage}</div>}
                {transferChallenge && <div className="transfer-otp-panel"><h3>Verify your transfer</h3><p>Enter the 6-digit OTP to complete this transfer. It expires in 5 minutes.</p><div><label className="transfer-field"><span>One-Time Password (OTP)</span><input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={verificationCode} onChange={e=>setVerificationCode(e.target.value.replace(/\D/g, "").slice(0,6))} placeholder="Enter 6-digit OTP"/></label><button className="transfer-submit" type="button" disabled={verificationCode.length!==6} onClick={()=>confirmTransfer({preventDefault(){}})}>Verify OTP & Complete Transfer</button><button type="button" onClick={()=>{setTransferChallenge(null);setVerificationCode("");setTransferMessage("OTP verification cancelled. Submit the transfer again to request a new OTP.");}}>Cancel</button></div></div>}
              </form>
              <aside className="transfer-side"><div className="transfer-summary"><span className="summary-label">TRANSFER SUMMARY</span><h3>Review before you send</h3><div className="summary-line"><span>From</span><strong>{transfer.sourceAccountNumber || "Select account"}</strong></div><div className="summary-line"><span>To</span><strong>{transfer.destinationType==="OTHER"?(transfer.bankName||"Select bank"):transfer.destinationType}</strong></div><div className="summary-line"><span>Recipient</span><strong>{transfer.recipient || "Not entered"}</strong></div><div className="summary-amount"><span>Transfer amount</span><strong>{formatMoney(transfer.amount)}</strong></div><div className="secure-note">♢ <span>Your transfer is protected by password verification and transaction risk checks. Never share your password.</span></div></div><div className="transfer-help"><strong>Need help?</strong><p>Review recipient details carefully. Only Finsheild-to-Finsheild transfers are implemented. External wallets and other banks: Feature not implemented.</p></div></aside>
            </div>
            {receipt && <div className="receipt-card"><div><span className="receipt-check">✓</span><h3>Transfer successful</h3><p>Your transaction has been recorded.</p><strong>{receipt.transactionId}</strong></div><button onClick={downloadReceipt}>Download receipt ↧</button></div>}
          </section>
        )}

        {activePage === "Alerts" && (
          <section className="dashboard-section"><div className="section-heading"><h2>Security Alerts</h2><button onClick={loadFeatureData}>Refresh</button></div>{featureData.alerts.length ? featureData.alerts.map(a => <article className="account-card" key={a.id}><strong>{a.title}</strong><p>{a.message}</p><small>{formatDate(a.createdAt)} · {a.severity}</small></article>) : <p>No security alerts available. Open this page and refresh to load alerts.</p>}</section>
        )}

        {activePage === "History" && (
          <section className="dashboard-section"><div className="section-heading"><div><h2>My transaction activity</h2><p>See how much you sent or received, where it went and who received it.</p></div><button onClick={loadFeatureData}>Refresh</button></div><div className="customer-activity-list">{(featureData.history?.transactions || []).length ? featureData.history.transactions.map((t,i)=><article className="customer-activity-item" key={t.id || i}><div className="activity-mark">{String(t.type||"").includes("IN")?"↓":"↑"}</div><div className="activity-main"><strong>{String(t.type||"").includes("IN")?"Money received":"Money sent"}</strong><span>To / From account: {t.recipientAccount || t.account?.accountNumber || "Not recorded"}</span><small>{formatDate(t.createdAt)} · {t.status}</small></div><strong className="activity-amount">{formatMoney(t.amount)}</strong></article>) : <p>No transaction activity recorded yet.</p>}</div></section>
        )}

        {activePage === "Transactions" && (
          <section className="dashboard-section">
            <div className="section-heading">
              <h2>Recent Transactions</h2>
            </div>
            <TransactionTable transactions={recentTransactions} />
            <p className="dashboard-note">
              Showing the latest 5 transactions. Full history will be available
              through the transaction history API.
            </p>
          </section>
        )}

        {activePage === "Profile" && (
          <section className="dashboard-section">
            <div className="section-heading">
              <h2>Customer Profile</h2>
            </div>
            <div className="profile-details">
              <div>
                <span>Full Name</span>
                <strong>{customer.fullName}</strong>
              </div>
              <div>
                <span>Mobile Number</span>
                <strong>{customer.mobileNumber}</strong>
              </div>
              <div>
                <span>Email Address</span>
                <strong>{customer.email || "Not provided"}</strong>
              </div>
              <div>
                <span>Customer ID</span>
                <strong>{customer.id}</strong>
              </div>
            </div>
          </section>
        )}

        <footer className="customer-footer">
          SecureBank © 2026. Educational banking simulation.
        </footer>
      </main>
    </div>
  );
}

function TransactionTable({ transactions = [] }) {
  if (!transactions.length) {
    return <div className="empty-transactions">No transactions found.</div>;
  }

  return (
    <div className="transaction-table-wrapper">
      <table className="transaction-table">
        <thead>
          <tr>
            <th>Transaction ID</th>
            <th>Type</th>
            <th>Account</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => (
            <tr key={transaction.transactionId}>
              <td>{transaction.transactionId}</td>
              <td>{transaction.type}</td>
              <td>{transaction.account?.accountNumber || "—"}</td>
              <td>{formatMoney(transaction.amount)}</td>
              <td>
                <span className={`transaction-status ${transaction.status.toLowerCase()}`}>
                  {transaction.status}
                </span>
              </td>
              <td>{formatDate(transaction.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
