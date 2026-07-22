export const CSV_COLUMNS = [
  "company_name",
  "company_domain",
  "company_category",
  "company_industry",
  "contact_name",
  "title",
  "email",
  "email_verified",
  "personal_emails",
  "phone_numbers",
  "mobile_numbers",
  "linkedin_url",
  "twitter_url",
  "facebook_url",
  "github_url",
  "seniority",
  "ad_platform",
  "ad_seen_date",
  "ad_creative_snippet",
  "personalized_hook",
  "source"
] as const;

export type CsvContactRow = Record<(typeof CSV_COLUMNS)[number], string | boolean | undefined>;

export function exportContactsCsv(rows: CsvContactRow[]) {
  const lines = [
    CSV_COLUMNS.join(","),
    ...rows.map((row) => CSV_COLUMNS.map((column) => escapeCsv(row[column])).join(","))
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function escapeCsv(value: string | boolean | undefined) {
  const text = value === undefined ? "" : String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
