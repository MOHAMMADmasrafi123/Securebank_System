import { useEffect, useMemo, useState } from "react";
import InfoPage from "./InfoPage";

const API = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

export default function SecurityReports() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const token = localStorage.getItem("adminToken");
      const response = await fetch(`${API}/admin/security/overview`, { headers: { Authorization: `Bearer ${token}` } });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load security report.");
      setData(result.data);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const list = [
      ...data.logs.map(x => ({ date: x.createdAt, type: x.eventType, severity: x.severity, details: x.description, customer: x.customer?.fullName || "System/Admin" })),
      ...data.risks.map(x => ({ date: x.createdAt, type: `RISK_${x.decision}`, severity: x.level, details: (x.reasons || []).join("; ") || `Risk score ${x.score}`, customer: `Customer #${x.customerId}` })),
      ...data.failedLogins.map(x => ({ date: x.createdAt, type: "FAILED_LOGIN", severity: "MEDIUM", details: x.reason || "Failed login", customer: x.mobileNumber })),
    ];
    return list.filter(x => (severity === "ALL" || x.severity === severity) && (!from || new Date(x.date) >= new Date(from)) && (!to || new Date(x.date) <= new Date(`${to}T23:59:59`))).sort((a,b) => new Date(b.date)-new Date(a.date));
  }, [data, severity, from, to]);

  function downloadCsv() {
    const esc = v => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const csv = [["Timestamp","Event","Severity","Customer","Details"], ...rows.map(r => [r.date,r.type,r.severity,r.customer,r.details])].map(r => r.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "securebank-security-report.csv"; a.click(); URL.revokeObjectURL(url);
  }

  if (loading) return <InfoPage title="Security Reports" description="Loading verified security activity..." items={["Fetching recorded security events"]} />;
  if (error) return <section className="dashboard-section"><h2>Security Reports</h2><p>{error}</p><button onClick={load}>Retry</button></section>;
  return <section className="dashboard-section security-report-page">
    <div className="section-heading"><div><h2>Security Reports</h2><p>Only events recorded by the application are shown. Uninstrumented attack categories are not reported as detected.</p></div><div><button onClick={downloadCsv}>Download CSV</button> <button onClick={() => window.print()}>Print / Save PDF</button> <button onClick={load}>Refresh</button></div></div>
    <div className="statistics-grid"><div className="stat-card"><span>Security Logs</span><h2>{data.logs.length}</h2></div><div className="stat-card"><span>Risk Decisions</span><h2>{data.risks.length}</h2></div><div className="stat-card"><span>Failed Logins</span><h2>{data.failedLogins.length}</h2></div><div className="stat-card"><span>Alerts</span><h2>{data.alerts.length}</h2></div></div>
    <div className="section-heading"><h3>Filter recorded activity</h3></div>
    <div className="profile-details"><label>Severity<select value={severity} onChange={e=>setSeverity(e.target.value)}><option value="ALL">All</option><option>INFO</option><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select></label><label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)} /></label><label>To<input type="date" value={to} onChange={e=>setTo(e.target.value)} /></label></div>
    <div className="transaction-table-wrapper"><table className="transaction-table"><thead><tr><th>Date</th><th>Event</th><th>Severity</th><th>Customer</th><th>Details</th></tr></thead><tbody>{rows.map((r,i)=><tr key={`${r.date}-${i}`}><td>{new Date(r.date).toLocaleString()}</td><td>{r.type}</td><td>{r.severity}</td><td>{r.customer}</td><td>{r.details}</td></tr>)}</tbody></table></div>
  </section>;
}
