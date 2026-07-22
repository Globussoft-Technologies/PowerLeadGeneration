export type MailTemplateContext = {
  firstName: string;
  contactName: string;
  companyName: string;
  companyDomain: string;
  personalization: string;
  adSnippet: string;
  senderName: string;
};

const SUPPORTED_PLACEHOLDERS = new Set<keyof MailTemplateContext>([
  "firstName",
  "contactName",
  "companyName",
  "companyDomain",
  "personalization",
  "adSnippet",
  "senderName"
]);

export function unsupportedPlaceholders(template: string) {
  return [...template.matchAll(/{{\s*([a-zA-Z]+)\s*}}/g)]
    .map((match) => match[1] ?? "")
    .filter((placeholder) => !SUPPORTED_PLACEHOLDERS.has(placeholder as keyof MailTemplateContext));
}

export function renderMailTemplate(template: string, context: MailTemplateContext) {
  const unsupported = unsupportedPlaceholders(template);
  if (unsupported.length > 0) throw new Error(`Unsupported placeholder: ${unsupported[0]}`);
  return template.replace(/{{\s*([a-zA-Z]+)\s*}}/g, (_match, key: keyof MailTemplateContext) => context[key] ?? "");
}

export function textToHtml(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => escapeHtml(line) || "&nbsp;")
    .join("<br>");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}
