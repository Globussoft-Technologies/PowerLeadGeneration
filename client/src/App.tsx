import type {
  CategoryOption,
  CreateRunInput,
  RunDetailDto,
  RunDto,
  RunStatus,
  SendRunMailResult,
  SettingsDto,
  SettingsInput
} from "@power-leads/shared";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { SettingsPanel } from "./SettingsPanel";

type HealthResponse = { status: "ok"; service: string; database: string };
type AuthUser = { id: string; workspaceId: string; email: string; name: string; role: "admin" | "operator" | "reviewer"; status: "active" | "disabled" };
type AuthResponse = { user: AuthUser; csrfToken: string };
let csrfToken = "";

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const INITIAL_INPUT: CreateRunInput = {
  filters: { keyword: "", industry: "", category: "", geography: "", platform: "facebook", minDaysActive: 30, pageSize: 100 },
  reviewRequired: true
};
const ACTIVE_STATUSES: RunStatus[] = ["queued", "discovering", "filtering", "enriching", "sending", "enrolling"];
const DEFAULT_MAIL_SUBJECT = "A quick idea for {{companyName}}";
const DEFAULT_MAIL_BODY = `Hi {{firstName}},

{{personalization}}

Would you be open to a brief conversation?

Best,
{{senderName}}`;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...(csrfToken && !["GET", "HEAD", "OPTIONS"].includes(method) ? { "x-csrf-token": csrfToken } : {}), ...init?.headers }
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? `Request failed (${response.status})`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export default function App() {
  const [auth, setAuth] = useState<AuthUser | null | undefined>(undefined);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [runs, setRuns] = useState<RunDto[]>([]);
  const [detail, setDetail] = useState<RunDetailDto | null>(null);
  const [input, setInput] = useState<CreateRunInput>(INITIAL_INPUT);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [settings, setSettings] = useState<SettingsDto | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [updatingContacts, setUpdatingContacts] = useState<string[]>([]);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [pipelineAction, setPipelineAction] = useState<"cancel" | "retry" | null>(null);
  const [mailSubject, setMailSubject] = useState(DEFAULT_MAIL_SUBJECT);
  const [mailBody, setMailBody] = useState(DEFAULT_MAIL_BODY);
  const [sendingMail, setSendingMail] = useState(false);
  const [sendingContactId, setSendingContactId] = useState<string | null>(null);
  const [mailNotice, setMailNotice] = useState("");
  const [previewContactId, setPreviewContactId] = useState("");
  const [error, setError] = useState("");

  const loadRuns = useCallback(async () => {
    const nextRuns = await api<RunDto[]>("/api/runs");
    setRuns(nextRuns);
    return nextRuns;
  }, []);

  const loadDetail = useCallback(async (runId: string) => {
    const nextDetail = await api<RunDetailDto>(`/api/runs/${runId}`);
    setDetail(nextDetail);
    return nextDetail;
  }, []);

  useEffect(() => {
    api<AuthResponse>("/api/auth/session")
      .then((session) => { csrfToken = session.csrfToken; setAuth(session.user); })
      .catch((reason: unknown) => {
        if (reason instanceof ApiError && reason.status === 401) setAuth(null);
        else { setAuth(null); setError(reason instanceof Error ? reason.message : "Unable to check your session"); }
      });
  }, []);

  useEffect(() => {
    if (!auth) return;
    Promise.all([api<HealthResponse>("/api/health"), loadRuns(), api<SettingsDto>("/api/settings"), api<CategoryOption[]>("/api/categories")])
      .then(([nextHealth, nextRuns, nextSettings, nextCategories]) => {
        setHealth(nextHealth);
        setSettings(nextSettings);
        setCategories(nextCategories);
        if (nextRuns[0]) void loadDetail(nextRuns[0].id);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load the app"));
  }, [auth, loadDetail, loadRuns]);

  useEffect(() => {
    if (!detail || !ACTIVE_STATUSES.includes(detail.status)) return;
    const timer = window.setInterval(() => {
      void loadDetail(detail.id).then((next) => {
        if (!ACTIVE_STATUSES.includes(next.status)) void loadRuns();
      });
    }, 800);
    return () => window.clearInterval(timer);
  }, [detail, loadDetail, loadRuns]);

  useEffect(() => {
    if (!detail) return;
    setMailSubject(DEFAULT_MAIL_SUBJECT);
    setMailBody(DEFAULT_MAIL_BODY);
    setMailNotice("");
    setPreviewContactId(detail.contacts.find((contact) => contact.email)?.id ?? "");
  }, [detail?.id]);

  const selectedCategory = categories.find((category) => category.title === input.filters.category);
  const previewContact = detail?.contacts.find((contact) => contact.id === previewContactId);
  const previewCompany = detail?.companies.find((company) => company.id === previewContact?.companyId);
  const previewContext = previewContact && previewCompany ? {
    firstName: previewContact.name.split(/\s+/)[0] || previewContact.name,
    companyName: previewCompany.name,
    personalization: previewContact.tags.personalization || previewCompany.personalization || "I noticed your recent advertising campaign.",
    senderName: settings?.integrations.sendGridFromName || "Power Leads"
  } : null;

  const setFilter = <K extends keyof CreateRunInput["filters"]>(key: K, value: CreateRunInput["filters"][K]) => {
    setInput((current) => ({ ...current, filters: { ...current.filters, [key]: value } }));
  };

  async function submitRun(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const created = await api<RunDto>("/api/runs", { method: "POST", body: JSON.stringify(input) });
      setRuns((current) => [created, ...current]);
      await loadDetail(created.id);
      window.setTimeout(() => document.querySelector("#results")?.scrollIntoView({ behavior: "smooth" }), 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start the run");
    } finally {
      setSubmitting(false);
    }
  }

  async function saveSettings(nextSettings: SettingsInput) {
    setSavingSettings(true);
    setError("");
    try { setSettings(await api<SettingsDto>("/api/settings", { method: "PUT", body: JSON.stringify(nextSettings) })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save settings"); }
    finally { setSavingSettings(false); }
  }

  async function decideContact(contactId: string, enrollmentStatus: "approved" | "rejected") {
    if (!detail) return;
    setUpdatingContacts((current) => [...current, contactId]);
    setError("");
    try {
      await api(`/api/contacts/${contactId}`, { method: "PATCH", body: JSON.stringify({ enrollmentStatus }) });
      await loadDetail(detail.id);
      await loadRuns();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update the contact"); }
    finally { setUpdatingContacts((current) => current.filter((id) => id !== contactId)); }
  }

  async function approveAllPending() {
    if (!detail) return;
    const pendingIds = detail.contacts.filter((contact) => contact.enrollmentStatus === "pending").map((contact) => contact.id);
    setUpdatingContacts(pendingIds);
    try {
      for (const id of pendingIds) {
        await api(`/api/contacts/${id}`, { method: "PATCH", body: JSON.stringify({ enrollmentStatus: "approved" }) });
      }
      await loadDetail(detail.id);
      await loadRuns();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not approve contacts"); }
    finally { setUpdatingContacts([]); }
  }

  async function deleteRun(run: RunDto) {
    if (!window.confirm("Delete this run and all of its companies and contacts? This cannot be undone.")) return;
    setDeletingRunId(run.id);
    try {
      await api(`/api/runs/${run.id}`, { method: "DELETE" });
      const nextRuns = await loadRuns();
      if (detail?.id === run.id) nextRuns[0] ? await loadDetail(nextRuns[0].id) : setDetail(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete the run"); }
    finally { setDeletingRunId(null); }
  }

  async function changePipeline(action: "cancel" | "retry") {
    if (!detail) return;
    if (action === "cancel" && !window.confirm("Cancel this run after the current bounded provider operation?")) return;
    setPipelineAction(action);
    setError("");
    try {
      await api(`/api/runs/${detail.id}/${action}`, { method: "POST" });
      await loadDetail(detail.id);
      await loadRuns();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Could not ${action} the run`);
    } finally {
      setPipelineAction(null);
    }
  }

  async function sendApproved() {
    if (!detail || !window.confirm("Send email now to every approved contact in this run?")) return;
    setSendingMail(true);
    setMailNotice("");
    try {
      const result = await api<SendRunMailResult>(`/api/runs/${detail.id}/send`, { method: "POST", body: JSON.stringify({ subject: mailSubject, body: mailBody }) });
      setMailNotice(`${result.sent} sent, ${result.skipped} skipped, ${result.failed} failed.`);
      await loadDetail(detail.id);
      await loadRuns();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send approved mail"); }
    finally { setSendingMail(false); }
  }

  async function sendIndividual(contactId: string, contactName: string) {
    if (!detail || !window.confirm(`Send the current personalized email to ${contactName}?`)) return;
    setSendingContactId(contactId);
    setMailNotice("");
    setError("");
    try {
      const result = await api<SendRunMailResult>(`/api/runs/${detail.id}/send`, {
        method: "POST",
        body: JSON.stringify({ subject: mailSubject, body: mailBody, contactIds: [contactId] })
      });
      setMailNotice(result.sent === 1 ? `Email sent to ${contactName}.` : `${result.skipped} skipped, ${result.failed} failed.`);
      await loadDetail(detail.id);
      await loadRuns();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send the email");
    } finally {
      setSendingContactId(null);
    }
  }

  async function logout() {
    try { await api<void>("/api/auth/logout", { method: "POST" }); } catch { /* Clear local state even if the session already expired. */ }
    csrfToken = "";
    setAuth(null);
    setRuns([]);
    setDetail(null);
  }

  const pendingContacts = detail?.contacts.filter((contact) => contact.enrollmentStatus === "pending") ?? [];
  const approvedContacts = detail?.contacts.filter((contact) => contact.enrollmentStatus === "approved") ?? [];

  if (auth === undefined) return <div className="auth-shell"><div className="auth-card"><p className="eyebrow">Power Leads</p><h1>Loading workspace...</h1></div></div>;
  if (auth === null) return <AuthScreen error={error} onAuthenticated={(session) => { csrfToken = session.csrfToken; setError(""); setAuth(session.user); window.location.hash = ""; }} />;

  const canOperate = auth.role === "admin" || auth.role === "operator";

  return <div className="shell">
    <header className="topbar">
      <a className="brand" href="#top">Power Leads</a>
      <nav>{canOperate && <a href="#new-run">New run</a>}<a href="#results">Results</a><a href="#account">Account</a>{auth.role === "admin" && <><a href="#settings">Settings</a>{auth.email && <a href="#users">Users</a>}</>}</nav>
      <div className="user-menu"><span><strong>{auth.name}</strong><small>{auth.role}</small></span>{auth.email && <button type="button" onClick={() => void logout()}>Log out</button>}</div>
    </header>

    <main id="top">
      <section className="hero">
        <div><p className="eyebrow">Ad-sourced prospecting</p><h1>Turn active ads into qualified conversations.</h1></div>
        <p className="intro">Find advertisers showing real buying signals, qualify them with Gemini, enrich decision-makers through Apollo, and send approved email with SendGrid.</p>
      </section>

      <ol className="workflow-guide" aria-label="Pipeline workflow">
        <li><span>1</span><div><strong>Discover ads</strong><small>Live advertiser activity</small></div></li>
        <li><span>2</span><div><strong>Qualify companies</strong><small>Gemini ICP analysis</small></div></li>
        <li><span>3</span><div><strong>Find contacts</strong><small>Apollo enrichment</small></div></li>
        <li><span>4</span><div><strong>Review and send</strong><small>Human approval and email</small></div></li>
      </ol>

      {error && <div className="alert" role="alert">{error}</div>}

      <section className={`workspace ${canOperate ? "" : "reviewer-workspace"}`} id="new-run">
        {canOperate && <form className="run-form" onSubmit={submitRun}>
          <div className="section-heading"><div><p className="eyebrow">Discovery</p><h2>Start a new run</h2><p className="block-description">Only platform is required. Category and industry are optional Ads API filters.</p></div><span>Up to 100 ads</span></div>
          <label className="wide">Keyword or company name<input value={input.filters.keyword} onChange={(event) => setFilter("keyword", event.target.value)} placeholder="e.g. Samsung, CRM, analytics" /></label>
          <label>Category<select value={input.filters.category} onChange={(event) => setInput((current) => ({ ...current, filters: { ...current.filters, category: event.target.value, industry: "" } }))}><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.title}>{category.title}</option>)}</select></label>
          <label>Industry<select value={input.filters.industry} disabled={!selectedCategory} onChange={(event) => setFilter("industry", event.target.value)}><option value="">{selectedCategory ? "All industries" : "Select a category first"}</option>{selectedCategory?.industries.map((industry) => <option key={industry.id} value={industry.title}>{industry.title}</option>)}</select></label>
          <label>Geography<input value={input.filters.geography} onChange={(event) => setFilter("geography", event.target.value)} placeholder="All geographies" /></label>
          <label>Platform<select value={input.filters.platform} onChange={(event) => setFilter("platform", event.target.value)}><option value="facebook">Facebook / Meta</option><option value="google">Google</option></select></label>
          <label>Minimum active days<input type="number" min="0" max="3650" value={input.filters.minDaysActive} onChange={(event) => setFilter("minDaysActive", Number(event.target.value))} /></label>
          <label className="checkbox"><input type="checkbox" checked={input.reviewRequired} onChange={(event) => setInput((current) => ({ ...current, reviewRequired: event.target.checked }))} />Require human review</label>
          <button className="primary-button wide" type="submit" disabled={submitting}>{submitting ? "Starting run..." : "Start run"}</button>
        </form>}
        <aside className="run-history"><div className="section-heading"><div><p className="eyebrow">History</p><h2>Recent runs</h2><p className="block-description">Open a run to continue reviewing its results.</p></div></div>
          <div className="run-list">{runs.map((run) => <article className={detail?.id === run.id ? "selected" : ""} key={run.id}><button className="run-open" type="button" onClick={() => void loadDetail(run.id)}><strong>{run.filters.keyword || run.filters.industry || "All advertisers"}</strong><small>{formatDate(run.createdAt)}</small><span className={`status-pill ${run.status}`}>{run.status.replace("_", " ")}</span></button>{canOperate && <button className="delete-button" type="button" disabled={ACTIVE_STATUSES.includes(run.status) || deletingRunId === run.id} onClick={() => void deleteRun(run)}>Delete</button>}</article>)}{runs.length === 0 && <p className="empty-copy">No runs yet.</p>}</div>
        </aside>
      </section>

      {settings && auth.role === "admin" && <SettingsPanel settings={settings} saving={savingSettings} onSave={saveSettings} />}
      <AccountPanel user={auth} onSessionChanged={(session) => { csrfToken = session.csrfToken; setAuth(session.user); }} onLoggedOut={() => { csrfToken = ""; setAuth(null); }} />
      {auth.role === "admin" && auth.email && <UserManagement currentUser={auth} />}

      <section className="results-section" id="results">
        <div className="result-heading"><div><p className="eyebrow">Run result</p><h2>{detail ? runHeading(detail.status) : "No run selected"}</h2><p className="block-description">{detail && ACTIVE_STATUSES.includes(detail.status) ? `${detail.currentStage ? `Current stage: ${detail.currentStage}. ` : ""}Worker attempt ${detail.attemptCount || 1}.` : "Review Gemini decisions first, then approve enriched contacts before sending."}</p>{detail && canOperate && <div className="pipeline-actions">{ACTIVE_STATUSES.includes(detail.status) && <button className="secondary-button" type="button" disabled={pipelineAction !== null} onClick={() => void changePipeline("cancel")}>{pipelineAction === "cancel" ? "Cancelling..." : "Cancel run"}</button>}{["failed", "cancelled"].includes(detail.status) && <button className="secondary-button" type="button" disabled={pipelineAction !== null} onClick={() => void changePipeline("retry")}>{pipelineAction === "retry" ? "Queuing..." : "Retry run"}</button>}</div>}</div>{detail && <div className="result-stats"><span><strong>{detail.stats.adsReturned ?? detail.stats.discovered}</strong>ads</span><span><strong>{detail.stats.qualified}</strong>qualified</span><span><strong>{detail.stats.enriched}</strong>contacts</span><span><strong>{detail.stats.approved}</strong>approved</span></div>}</div>

        {!detail && <div className="empty-panel">Start a run to see advertiser signals and contacts.</div>}
        {detail?.error && <div className="alert">{detail.error}</div>}
        {detail && <div className="usage-panel" aria-label="Run usage">
          <div><small>ADS API</small><strong>{detail.usage.adsCalls} / {detail.budgets.adsCalls} calls</strong><span>{detail.usage.adsResults} results</span></div>
          <div><small>GEMINI</small><strong>{detail.usage.geminiCalls} / {detail.budgets.geminiCalls} calls</strong><span>{detail.usage.geminiInputTokens + detail.usage.geminiOutputTokens} tokens · {detail.usage.geminiFallbacks} fallbacks</span></div>
          <div><small>APOLLO</small><strong>{detail.usage.apolloCalls} / {detail.budgets.apolloCalls} calls</strong><span>{detail.usage.apolloContactsSaved} contacts saved</span></div>
          <div><small>STAGES</small><strong>{detail.completedStages.length} / 3 complete</strong><span>{formatStageDurations(detail.stageMetrics)}</span></div>
        </div>}
        {detail && <div className="company-list">{detail.companies.map((company) => <article className="company-card" key={company.id}><div className="company-main"><span className={`company-dot ${company.icpMatch ? "qualified" : ""}`} /><div><strong>{company.name}</strong><a href={`https://${company.domain}`} target="_blank" rel="noreferrer">{company.domain}</a></div></div><div className="company-signal"><small>SIGNAL</small><p>{company.adCreativeSnippet || "No ad creative was supplied."}</p><div className="tags"><span>{company.category || "Unknown category"}</span><span>{company.industry || "Unknown industry"}</span><span>{company.daysActive ?? 0} active days</span><span>{company.adPlatforms.join(", ")}</span></div></div><div className="company-decision"><small>ICP DECISION · {company.analysisSource?.replace("_", " ") || "rules"}</small><strong>{company.icpMatch ? `Qualified${company.aiScore !== undefined ? ` (${company.aiScore}/100)` : ""}` : "Not qualified"}</strong><p>{company.icpReason}</p><div className="company-hook"><small>EMAIL HOOK</small><p>{company.personalization || "No Gemini hook was generated for this company."}</p></div></div></article>)}</div>}

        {detail && <section className="review-block"><div className="review-heading"><div><p className="eyebrow">Human review</p><h2>Review enriched contacts</h2><p>Only approved contacts are included in export or mail delivery.</p></div><div><a className={`secondary-button ${detail.stats.approved === 0 ? "disabled" : ""}`} href={detail.stats.approved > 0 ? `/api/runs/${detail.id}/export.csv` : undefined}>Download approved CSV</a><button className="secondary-button" type="button" disabled={pendingContacts.length === 0 || updatingContacts.length > 0} onClick={() => void approveAllPending()}>Approve all pending</button></div></div>
          <div className="contact-list">{detail.contacts.map((contact) => { const company = detail.companies.find((item) => item.id === contact.companyId); const updating = updatingContacts.includes(contact.id); return <article key={contact.id}><div><strong>{contact.name}</strong><small>{contact.title} at {company?.name || "Unknown company"}</small></div><div className="contact-channels">{contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}{contact.phoneNumbers.map((phone) => <a key={`${contact.id}-${phone.number}`} href={`tel:${phone.number}`}>{phone.type ? `${phone.type}: ` : ""}{phone.number}</a>)}{contact.linkedinUrl && <a href={contact.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn</a>}{contact.twitterUrl && <a href={contact.twitterUrl} target="_blank" rel="noreferrer">Twitter / X</a>}{!contact.email && contact.phoneNumbers.length === 0 && !contact.linkedinUrl && !contact.twitterUrl && <small>No direct channel</small>}</div><span className={`status-pill ${contact.enrollmentStatus}`}>{contact.enrollmentStatus}</span><div className="contact-actions">{!['sent','skipped'].includes(contact.enrollmentStatus) && <button type="button" disabled={updating || sendingContactId === contact.id} onClick={() => void decideContact(contact.id, "rejected")}>Reject</button>}{contact.enrollmentStatus !== 'approved' && !['sent','skipped'].includes(contact.enrollmentStatus) && <button className="approve" type="button" disabled={updating} onClick={() => void decideContact(contact.id, "approved")}>Approve</button>}</div></article>; })}{detail.contacts.length === 0 && <div className="empty-panel">No reachable persona contacts were found.</div>}</div>
        </section>}

        {detail && detail.contacts.length > 0 && <section className="mail-block"><div className="section-heading"><div><p className="eyebrow">Mail delivery</p><h2>Personalized email</h2><p className="block-description">The content is autofilled after the run. Personalization tokens resolve separately for each approved contact.</p></div><span>{settings?.integrations.mailMode || "mock"} mode</span></div>
          <div className="mail-grid"><div><label>Subject<input value={mailSubject} onChange={(event) => setMailSubject(event.target.value)} /></label><label>Message<textarea rows={10} value={mailBody} onChange={(event) => setMailBody(event.target.value)} /></label></div><div className="mail-preview"><label>Preview recipient<select value={previewContactId} onChange={(event) => setPreviewContactId(event.target.value)}>{detail.contacts.filter((contact) => contact.email).map((contact) => <option key={contact.id} value={contact.id}>{contact.name} - {contact.enrollmentStatus}</option>)}</select></label><div className="preview-content"><small>SUBJECT</small><strong>{previewContext ? renderPreview(mailSubject, previewContext) : "No recipient available"}</strong><pre>{previewContext ? renderPreview(mailBody, previewContext) : "Approve a verified contact to preview the email."}</pre></div><div className="preview-send"><span>{previewContact ? `Recipient status: ${previewContact.enrollmentStatus}` : "Select a recipient"}</span>{canOperate && <button className="primary-button" type="button" disabled={!previewContact || previewContact.enrollmentStatus !== "approved" || sendingContactId !== null || sendingMail} onClick={() => previewContact && void sendIndividual(previewContact.id, previewContact.name)}>{sendingContactId === previewContact?.id ? "Sending..." : previewContact?.enrollmentStatus === "sent" ? "Email sent" : previewContact?.enrollmentStatus === "approved" ? "Send email" : "Approve to send"}</button>}</div></div></div>
          <div className="send-bar"><span>{mailNotice || `${approvedContacts.length} approved recipients ready.`}</span>{canOperate && <button className="primary-button" type="button" disabled={sendingMail || sendingContactId !== null || approvedContacts.length === 0} onClick={() => void sendApproved()}>{sendingMail ? "Sending..." : `Send to ${approvedContacts.length} approved`}</button>}</div>
        </section>}
      </section>
    </main>
  </div>;
}

export function AuthScreen({ error: initialError, onAuthenticated }: { error: string; onAuthenticated: (session: AuthResponse) => void }) {
  const [route, setRoute] = useState(() => authRoute());
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const change = () => { setRoute(authRoute()); setError(""); setNotice(""); };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      if (route.mode === "login") {
        onAuthenticated(await api<AuthResponse>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }));
      } else if (route.mode === "forgot-password") {
        const result = await api<{ message: string; debugResetUrl?: string }>("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
        setNotice(result.debugResetUrl ? `${result.message} Development link: ${result.debugResetUrl}` : result.message);
      } else if (route.mode === "reset-password") {
        if (password !== confirmPassword) throw new Error("Passwords do not match");
        const result = await api<{ message: string }>("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ token: route.token, password }) });
        setNotice(result.message); setPassword(""); setConfirmPassword("");
      } else {
        if (password !== confirmPassword) throw new Error("Passwords do not match");
        onAuthenticated(await api<AuthResponse>("/api/auth/accept-invite", { method: "POST", body: JSON.stringify({ token: route.token, name, password }) }));
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Authentication failed"); }
    finally { setBusy(false); }
  }

  const title = route.mode === "login" ? "Sign in" : route.mode === "forgot-password" ? "Reset your password" : route.mode === "reset-password" ? "Choose a new password" : "Accept your invitation";
  return <div className="auth-shell"><form className="auth-card" onSubmit={submit}><p className="eyebrow">Power Leads</p><h1>{title}</h1><p className="auth-intro">{route.mode === "login" ? "Use your invited team account to continue." : route.mode === "forgot-password" ? "We will send a reset link if the account exists." : "Passwords require 12 characters with uppercase, lowercase, and a number."}</p>
    {error && <div className="alert">{error}</div>}{notice && <div className="notice-box">{notice}</div>}
    {route.mode === "accept-invite" && <label>Name<input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label>}
    {(route.mode === "login" || route.mode === "forgot-password") && <label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
    {route.mode !== "forgot-password" && <label>{route.mode === "login" ? "Password" : "New password"}<input required type="password" minLength={route.mode === "login" ? 1 : 12} autoComplete={route.mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
    {(route.mode === "reset-password" || route.mode === "accept-invite") && <label>Confirm password<input required type="password" minLength={12} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>}
    <button className="primary-button" type="submit" disabled={busy}>{busy ? "Please wait..." : title}</button>
    <div className="auth-links">{route.mode === "login" ? <a href="#forgot-password">Forgot password?</a> : <a href="#login">Back to login</a>}</div>
  </form></div>;
}

function AccountPanel({ user, onSessionChanged, onLoggedOut }: { user: AuthUser; onSessionChanged: (session: AuthResponse) => void; onLoggedOut: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function changePassword(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const session = await api<AuthResponse>("/api/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
      onSessionChanged(session); setCurrentPassword(""); setNewPassword(""); setNotice("Password changed. Other sessions were signed out.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not change password"); }
    finally { setBusy(false); }
  }

  async function logoutAll() {
    if (!window.confirm("Log out this account on every device?")) return;
    try { await api<void>("/api/auth/logout-all", { method: "POST" }); } finally { onLoggedOut(); }
  }

  if (!user.email) return <section className="account-section" id="account"><div className="section-heading"><div><p className="eyebrow">Account</p><h2>Development identity</h2><p className="block-description">Password and session controls become active when `AUTH_MODE=password`.</p></div></div></section>;

  return <section className="account-section" id="account"><div className="section-heading"><div><p className="eyebrow">Account</p><h2>{user.name}</h2><p className="block-description">{user.email} - {user.role}</p></div><button className="secondary-button" type="button" onClick={() => void logoutAll()}>Log out all devices</button></div>
    <form className="account-form" onSubmit={changePassword}>{error && <div className="alert">{error}</div>}{notice && <div className="notice-box">{notice}</div>}<label>Current password<input required type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label><label>New password<input required type="password" minLength={12} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><button className="primary-button" type="submit" disabled={busy}>{busy ? "Changing..." : "Change password"}</button></form>
  </section>;
}

function UserManagement({ currentUser }: { currentUser: AuthUser }) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<AuthUser["role"]>("reviewer");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadUsers = useCallback(() => api<AuthUser[]>("/api/users").then(setUsers).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load users")), []);
  useEffect(() => { void loadUsers(); }, [loadUsers]);

  async function invite(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ email: string; debugInviteUrl?: string }>("/api/users/invitations", { method: "POST", body: JSON.stringify({ email, name: name || undefined, role }) });
      setNotice(result.debugInviteUrl ? `Invitation sent. Development link: ${result.debugInviteUrl}` : `Invitation sent to ${result.email}.`);
      setEmail(""); setName("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not invite user"); }
    finally { setBusy(false); }
  }

  async function updateUser(user: AuthUser, change: Partial<Pick<AuthUser, "role" | "status">>) {
    setError("");
    try {
      const updated = await api<AuthUser>(`/api/users/${user.id}`, { method: "PATCH", body: JSON.stringify(change) });
      setUsers((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update user"); }
  }

  return <section className="users-section" id="users"><div className="section-heading"><div><p className="eyebrow">Administration</p><h2>Users</h2><p className="block-description">Invite team members, assign their role, or disable access.</p></div></div>{error && <div className="alert">{error}</div>}{notice && <div className="notice-box">{notice}</div>}
    <form className="invite-form" onSubmit={invite}><label>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Optional" /></label><label>Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Role<select value={role} onChange={(event) => setRole(event.target.value as AuthUser["role"])}><option value="reviewer">Reviewer</option><option value="operator">Operator</option><option value="admin">Admin</option></select></label><button className="primary-button" type="submit" disabled={busy}>{busy ? "Inviting..." : "Invite user"}</button></form>
    <div className="user-list">{users.map((user) => <article key={user.id}><div><strong>{user.name}</strong><small>{user.email}{user.id === currentUser.id ? " - You" : ""}</small></div><select aria-label={`Role for ${user.name}`} value={user.role} disabled={user.id === currentUser.id} onChange={(event) => void updateUser(user, { role: event.target.value as AuthUser["role"] })}><option value="reviewer">Reviewer</option><option value="operator">Operator</option><option value="admin">Admin</option></select><button className="secondary-button" type="button" disabled={user.id === currentUser.id} onClick={() => void updateUser(user, { status: user.status === "active" ? "disabled" : "active" })}>{user.status === "active" ? "Disable" : "Reactivate"}</button></article>)}</div>
  </section>;
}

export function authRoute(): { mode: "login" | "forgot-password" | "reset-password" | "accept-invite"; token: string } {
  const raw = window.location.hash.replace(/^#/, "");
  const [path = "login", query = ""] = raw.split("?");
  const token = new URLSearchParams(query).get("token") ?? "";
  if (path === "forgot-password") return { mode: "forgot-password", token };
  if (path === "reset-password") return { mode: "reset-password", token };
  if (path === "accept-invite") return { mode: "accept-invite", token };
  return { mode: "login", token: "" };
}

function formatDate(value: string) { return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
function runHeading(status: RunStatus) { if (status === "queued") return "Run queued"; if (ACTIVE_STATUSES.includes(status)) return "Run in progress"; if (status === "pending_review") return "Run pending review"; if (status === "failed") return "Run failed"; if (status === "quota_limited") return "Run stopped at its usage limit"; if (status === "cancelled") return "Run cancelled"; return "Run complete"; }
function formatStageDurations(metrics: RunDto["stageMetrics"]) { const values = Object.values(metrics).filter((metric) => metric.durationMs !== undefined).map((metric) => `${(metric.durationMs! / 1000).toFixed(1)}s`); return values.length ? values.join(" · ") : "Waiting for worker"; }
function renderPreview(template: string, context: Record<string, string>) { return template.replace(/{{\s*([a-zA-Z]+)\s*}}/g, (match, key: string) => context[key] ?? match); }
