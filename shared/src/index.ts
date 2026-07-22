export const RUN_STATUSES = [
  "queued",
  "discovering",
  "filtering",
  "enriching",
  "pending_review",
  "sending",
  "enrolling",
  "done",
  "quota_limited",
  "cancelled",
  "failed"
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export type RunFilters = {
  keyword?: string;
  industry: string;
  category: string;
  geography?: string;
  platform: string;
  minDaysActive: number;
  pageSize: number;
};

export type RunStats = {
  adsReturned?: number;
  discovered: number;
  qualified: number;
  enriched: number;
  approved: number;
  sent: number;
  enrolled: number;
  skipped: number;
};

export type PipelineStage = "discover" | "qualify" | "enrich";

export type RunUsage = {
  adsCalls: number;
  adsResults: number;
  geminiCalls: number;
  geminiFallbacks: number;
  geminiInputTokens: number;
  geminiOutputTokens: number;
  apolloCalls: number;
  apolloSearchCalls: number;
  apolloEnrichCalls: number;
  apolloContactsSaved: number;
};

export type RunBudgets = {
  adsCalls: number;
  geminiCalls: number;
  apolloCalls: number;
};

export type StageMetric = {
  attempts: number;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
};

export type RunDto = {
  id: string;
  workspaceId: string;
  createdBy: string;
  createdAt: string;
  status: RunStatus;
  filters: RunFilters;
  reviewRequired: boolean;
  stats: RunStats;
  error?: string;
  currentStage?: PipelineStage;
  completedStages: PipelineStage[];
  attemptCount: number;
  usage: RunUsage;
  budgets: RunBudgets;
  stageMetrics: Record<PipelineStage, StageMetric>;
  quota?: { provider: "ads" | "gemini" | "apollo"; limit: number; used: number };
};

export type CompanyDto = {
  id: string;
  runId: string;
  name: string;
  domain: string;
  category?: string;
  industry?: string;
  geography?: string;
  adPlatforms: string[];
  adFirstSeen?: string;
  adLastSeen?: string;
  daysActive?: number;
  adCreativeSnippet?: string;
  adUrl?: string;
  icpMatch: boolean;
  icpReason: string;
  aiScore?: number;
  aiReason?: string;
  personalization?: string;
  analysisSource?: "gemini" | "deterministic_fallback" | "mock";
  geminiModel?: string;
  geminiPromptVersion?: string;
  geminiLatencyMs?: number;
  geminiInputTokens?: number;
  geminiOutputTokens?: number;
  geminiFallbackReason?: string;
  status: "discovered" | "filtered_out" | "qualified" | "enriched" | "no_contacts";
};

export const ENROLLMENT_STATUSES = ["pending", "approved", "rejected", "sent", "enrolled", "skipped", "failed"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export type ContactDto = {
  id: string;
  runId: string;
  companyId: string;
  name: string;
  title: string;
  email?: string;
  personalEmails: string[];
  emailVerified: boolean;
  linkedinUrl?: string;
  twitterUrl?: string;
  facebookUrl?: string;
  githubUrl?: string;
  phoneNumbers: Array<{ number: string; type?: string; status?: string; source?: string }>;
  seniority?: string;
  apolloId: string;
  mailMessageId?: string;
  sentAt?: string;
  enrollmentStatus: EnrollmentStatus;
  tags: {
    source: "power_leads";
    adPlatform: string;
    adSeenDate?: string;
    adSnippet?: string;
    personalization?: string;
  };
};

export type RunDetailDto = RunDto & { companies: CompanyDto[]; contacts: ContactDto[] };

export type CreateRunInput = {
  filters: RunFilters;
  reviewRequired: boolean;
};

export type SettingsInput = {
  icp: {
    industries: string[];
    geographies: string[];
    exclusions: string[];
  };
  personas: {
    titles: string[];
    seniorities: string[];
    requireVerifiedEmail: boolean;
  };
};

export type SettingsDto = SettingsInput & {
  integrations: {
    adsMode: "mock" | "live";
    apolloMode: "mock" | "live";
    adsCredentialConfigured: boolean;
      apolloCredentialConfigured: boolean;
      geminiMode: "mock" | "live";
      geminiCredentialConfigured: boolean;
      geminiModel: string;
      mailMode: "mock" | "live";
      sendGridCredentialConfigured: boolean;
      sendGridWebhookConfigured: boolean;
      sendGridFromEmail?: string;
      sendGridFromName: string;
      mailPerRunLimit: number;
      mailDailyWorkspaceLimit: number;
  };
};

export type SendRunMailInput = {
  subject: string;
  body: string;
  contactIds?: string[];
};

export type SendRunMailResult = {
  sent: number;
  skipped: number;
  failed: number;
  errors: Array<{ contactId: string; message: string }>;
};

export type IndustryOption = {
  id: number;
  title: string;
};

export type CategoryOption = {
  id: number;
  title: string;
  industries: IndustryOption[];
};
