import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import type { SettingsDto, SettingsInput } from "@power-leads/shared";

type Props = {
  settings: SettingsDto;
  saving: boolean;
  onSave: (input: SettingsInput) => Promise<void>;
};

type TextFields = {
  industries: string;
  geographies: string;
  exclusions: string;
  titles: string;
  seniorities: string;
};

export function SettingsPanel({ settings, saving, onSave }: Props) {
  const [fields, setFields] = useState<TextFields>(() => toTextFields(settings));
  const [requireVerifiedEmail, setRequireVerifiedEmail] = useState(settings.personas.requireVerifiedEmail);

  useEffect(() => {
    setFields(toTextFields(settings));
    setRequireVerifiedEmail(settings.personas.requireVerifiedEmail);
  }, [settings]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSave({
      icp: {
        industries: splitList(fields.industries),
        geographies: splitList(fields.geographies),
        exclusions: splitList(fields.exclusions)
      },
      personas: {
        titles: splitList(fields.titles),
        seniorities: splitList(fields.seniorities),
        requireVerifiedEmail
      }
    });
  }

  const setField = (key: keyof TextFields, value: string) => setFields((current) => ({ ...current, [key]: value }));

  return (
    <section className="settings-section" id="settings">
      <div className="settings-heading">
        <div><p className="eyebrow">Pipeline rules</p><h2>Define who you want to reach</h2><p>These settings decide which companies qualify and which people Apollo should find. Changes apply only to new runs.</p></div>
        <div className="integration-status">
          <span><i className={settings.integrations.adsCredentialConfigured ? "ready" : ""} />Ads API · {settings.integrations.adsMode}</span>
          <span><i className={settings.integrations.apolloCredentialConfigured ? "ready" : ""} />Apollo · {settings.integrations.apolloMode}</span>
          <span><i className={settings.integrations.geminiCredentialConfigured || settings.integrations.geminiMode === "mock" ? "ready" : ""} />Gemini · {settings.integrations.geminiMode} · {settings.integrations.geminiModel}</span>
          <span><i className={settings.integrations.sendGridCredentialConfigured || settings.integrations.mailMode === "mock" ? "ready" : ""} />SendGrid · {settings.integrations.mailMode}{settings.integrations.sendGridFromEmail ? ` · ${settings.integrations.sendGridFromEmail}` : ""}</span>
          <span><i className={settings.integrations.sendGridWebhookConfigured || settings.integrations.mailMode === "mock" ? "ready" : ""} />Mail events · {settings.integrations.sendGridWebhookConfigured ? "signed webhook" : "not configured"} · {settings.integrations.mailPerRunLimit}/run · {settings.integrations.mailDailyWorkspaceLimit}/day</span>
        </div>
      </div>
      <form className="settings-form" onSubmit={submit}>
        <fieldset><legend>Company qualification</legend><p className="fieldset-help">Gemini compares every advertiser with these ICP rules before Apollo enrichment.</p>
          <label>Industries<input required value={fields.industries} onChange={(event) => setField("industries", event.target.value)} /></label>
          <label>Geographies<input required value={fields.geographies} onChange={(event) => setField("geographies", event.target.value)} /></label>
          <label>Company exclusions<input value={fields.exclusions} onChange={(event) => setField("exclusions", event.target.value)} placeholder="Domains or company names" /></label>
        </fieldset>
        <fieldset><legend>Contact search</legend><p className="fieldset-help">Apollo uses these titles and seniorities to find the right decision-makers at qualified companies.</p>
          <label>Job titles<input required value={fields.titles} onChange={(event) => setField("titles", event.target.value)} /></label>
          <label>Seniorities<input required value={fields.seniorities} onChange={(event) => setField("seniorities", event.target.value)} /></label>
          <label className="checkbox"><input type="checkbox" checked={requireVerifiedEmail} onChange={(event) => setRequireVerifiedEmail(event.target.checked)} />Require verified email</label>
        </fieldset>
        <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>
      </form>
    </section>
  );
}

function toTextFields(settings: SettingsDto): TextFields {
  return {
    industries: settings.icp.industries.join(", "),
    geographies: settings.icp.geographies.join(", "),
    exclusions: settings.icp.exclusions.join(", "),
    titles: settings.personas.titles.join(", "),
    seniorities: settings.personas.seniorities.join(", ")
  };
}

function splitList(value: string) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}
