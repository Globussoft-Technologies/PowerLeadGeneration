import pRetry, { AbortError } from "p-retry";
import { env } from "../config/env.js";
import { UsageBudgetExceededError } from "../services/runUsage.js";
import { z } from "zod";

export type PersonaQuery = {
  titles: string[];
  seniorities: string[];
  requireVerifiedEmail: boolean;
};

export type ApolloCandidate = {
  id: string;
  firstName: string;
  lastName?: string;
  title: string;
  seniority?: string;
};

export type ApolloContact = ApolloCandidate & {
  name: string;
  email?: string;
  personalEmails: string[];
  emailVerified: boolean;
  linkedinUrl?: string;
  twitterUrl?: string;
  facebookUrl?: string;
  githubUrl?: string;
  phoneNumbers: ApolloPhoneNumber[];
};

export type ApolloPhoneNumber = {
  number: string;
  type?: string;
  status?: string;
  source?: string;
};

export class ApolloHttpError extends Error {
  constructor(readonly status: number, readonly providerMessage?: string) {
    super(`Apollo request failed (${status})${providerMessage ? `: ${providerMessage}` : ""}`);
    this.name = "ApolloHttpError";
  }
}

export interface ApolloClient {
  searchPeople(domain: string, personas: PersonaQuery, beforeRequest?: () => Promise<void>): Promise<ApolloCandidate[]>;
  enrichPerson(candidate: ApolloCandidate, domain: string, beforeRequest?: () => Promise<void>): Promise<ApolloContact | null>;
}

const nullableText = z.string().trim().nullable().optional().transform((value) => value || undefined);
const phoneNumberSchema = z.object({
  raw_number: nullableText,
  sanitized_number: nullableText,
  type: nullableText,
  type_cd: nullableText,
  status: nullableText,
  status_cd: nullableText,
  source_name: nullableText,
  direct_dial_source_cd: nullableText
}).passthrough();
const contactEmailSchema = z.object({ email: nullableText }).passthrough();
const personSchema = z.object({
  id: nullableText,
  first_name: nullableText,
  last_name: nullableText,
  last_name_obfuscated: nullableText,
  name: nullableText,
  title: nullableText,
  seniority: nullableText,
  email: nullableText,
  email_status: nullableText,
  personal_emails: z.array(nullableText).nullish().transform((value) => value ?? []),
  contact_emails: z.array(contactEmailSchema).nullish().transform((value) => value ?? []),
  phone_numbers: z.array(phoneNumberSchema).nullish().transform((value) => value ?? []),
  linkedin_url: nullableText,
  twitter_url: nullableText,
  facebook_url: nullableText,
  github_url: nullableText
}).passthrough();
const searchPersonSchema = personSchema.extend({ id: z.string().trim().min(1) });
const searchPayloadSchema = z.object({ people: z.array(searchPersonSchema).nullish().transform((value) => value ?? []) }).passthrough();
const enrichPayloadSchema = z.object({ person: personSchema.nullish() }).passthrough();

class LiveApolloClient implements ApolloClient {
  async searchPeople(domain: string, personas: PersonaQuery, beforeRequest?: () => Promise<void>) {
    const url = new URL(`${env.APOLLO_BASE_URL}/mixed_people/api_search`);
    personas.titles.forEach((title) => url.searchParams.append("person_titles[]", title));
    personas.seniorities.forEach((seniority) => url.searchParams.append("person_seniorities[]", seniority));
    url.searchParams.append("q_organization_domains_list[]", domain);
    if (personas.requireVerifiedEmail) url.searchParams.append("contact_email_status[]", "verified");
    url.searchParams.set("include_similar_titles", "true");
    url.searchParams.set("page", "1");
    url.searchParams.set("per_page", String(env.APOLLO_CONTACTS_PER_COMPANY));

    const payload = parseApolloSearchResponse(await apolloRequest<unknown>(url, { method: "POST" }, beforeRequest));
    return (payload.people ?? []).map((person): ApolloCandidate => ({
      id: person.id,
      firstName: person.first_name ?? "Unknown",
      lastName: person.last_name ?? person.last_name_obfuscated,
      title: person.title ?? "Unknown title",
      seniority: person.seniority
    }));
  }

  async enrichPerson(candidate: ApolloCandidate, domain: string, beforeRequest?: () => Promise<void>) {
    const url = new URL(`${env.APOLLO_BASE_URL}/people/match`);
    url.searchParams.set("id", candidate.id);
    url.searchParams.set("domain", domain);
    url.searchParams.set("reveal_personal_emails", String(env.APOLLO_REVEAL_PERSONAL_EMAILS));
    url.searchParams.set("reveal_phone_number", String(Boolean(env.APOLLO_WEBHOOK_URL)));
    if (env.APOLLO_WEBHOOK_URL) url.searchParams.set("webhook_url", env.APOLLO_WEBHOOK_URL);
    url.searchParams.set("run_waterfall_email", "false");
    url.searchParams.set("run_waterfall_phone", "false");

    let payload: ReturnType<typeof parseApolloEnrichResponse>;
    try {
      payload = parseApolloEnrichResponse(await apolloRequest<unknown>(url, { method: "POST" }, beforeRequest));
    } catch (error) {
      if (error instanceof ApolloHttpError && (error.status === 404 || error.status === 422)) {
        console.warn(`Apollo skipped unavailable candidate ${candidate.id}: ${error.message}`);
        return null;
      }
      throw error;
    }
    const person = payload.person;
    if (!person) return null;

    const firstName = person.first_name ?? candidate.firstName;
    const lastName = person.last_name ?? candidate.lastName;
    return {
      id: person.id ?? candidate.id,
      firstName,
      lastName,
      name: person.name ?? [firstName, lastName].filter(Boolean).join(" "),
      title: person.title ?? candidate.title,
      seniority: person.seniority ?? candidate.seniority,
      email: validEmail(person.email),
      personalEmails: uniqueStrings([
        ...(person.personal_emails ?? []),
        ...(person.contact_emails ?? []).map((item) => item.email)
      ]).filter((email) => validEmail(email)),
      emailVerified: person.email_status === "verified",
      linkedinUrl: person.linkedin_url,
      twitterUrl: person.twitter_url,
      facebookUrl: person.facebook_url,
      githubUrl: person.github_url,
      phoneNumbers: normalizePhoneNumbers(person.phone_numbers ?? [])
    };
  }
}

class MockApolloClient implements ApolloClient {
  async searchPeople(domain: string, personas: PersonaQuery, beforeRequest?: () => Promise<void>) {
    await beforeRequest?.();
    const slug = domain.replace(/[^a-z\d]/gi, "-");
    return [
      { id: `${slug}-morgan`, firstName: "Morgan", lastName: "Lee", title: personas.titles[0] ?? "CMO", seniority: "c_suite" },
      { id: `${slug}-jordan`, firstName: "Jordan", lastName: "Patel", title: personas.titles[1] ?? "VP Marketing", seniority: "vp" },
      { id: `${slug}-casey`, firstName: "Casey", lastName: "Ng", title: personas.titles[2] ?? "Head of Growth", seniority: "head" }
    ];
  }

  async enrichPerson(candidate: ApolloCandidate, domain: string, beforeRequest?: () => Promise<void>) {
    await beforeRequest?.();
    const emailName = `${candidate.firstName}.${candidate.lastName ?? "contact"}`.toLowerCase().replace(/[^a-z.]/g, "");
    return {
      ...candidate,
      name: [candidate.firstName, candidate.lastName].filter(Boolean).join(" "),
      email: `${emailName}@${domain}`,
      personalEmails: [],
      emailVerified: true,
      linkedinUrl: `https://www.linkedin.com/in/${candidate.id}`,
      phoneNumbers: []
    };
  }
}

async function apolloRequest<T>(url: URL, init: RequestInit, beforeRequest?: () => Promise<void>): Promise<T> {
  return pRetry(async () => {
    await beforeRequest?.();
    const response = await fetch(url, {
      ...init,
      headers: {
        accept: "application/json",
        "cache-control": "no-cache",
        "content-type": "application/json",
        "x-api-key": env.APOLLO_API_KEY,
        ...init.headers
      },
      signal: AbortSignal.timeout(20_000)
    });

    const responseText = await response.text();
    if (!response.ok) {
      const error = new ApolloHttpError(response.status, providerErrorMessage(responseText));
      if (response.status === 429 || response.status >= 500) throw error;
      throw new AbortError(error);
    }
    return (responseText ? JSON.parse(responseText) : null) as T;
  }, {
    retries: 3,
    factor: 2,
    minTimeout: 500,
    maxTimeout: 4_000,
    shouldRetry: (error) => !(error instanceof UsageBudgetExceededError) && !(error instanceof z.ZodError)
  });
}

export function createApolloClient(mode: "mock" | "live" = env.APOLLO_MODE): ApolloClient {
  return mode === "live" ? new LiveApolloClient() : new MockApolloClient();
}

export function parseApolloSearchResponse(value: unknown) {
  return searchPayloadSchema.parse(value);
}

export function parseApolloEnrichResponse(value: unknown) {
  return enrichPayloadSchema.parse(value);
}

function normalizePhoneNumbers(numbers: z.infer<typeof phoneNumberSchema>[]): ApolloPhoneNumber[] {
  const seen = new Set<string>();
  return numbers.flatMap((phone) => {
    const number = phone.sanitized_number ?? phone.raw_number;
    if (!number || seen.has(number)) return [];
    seen.add(number);
    return [{
      number,
      type: phone.type ?? phone.type_cd,
      status: phone.status ?? phone.status_cd,
      source: phone.source_name ?? phone.direct_dial_source_cd
    }];
  });
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => value?.trim().toLowerCase()).filter((value): value is string => Boolean(value)))];
}

function validEmail(value?: string) {
  return value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : undefined;
}

function providerErrorMessage(responseText: string) {
  if (!responseText) return undefined;
  try {
    const payload = JSON.parse(responseText) as Record<string, unknown>;
    const message = payload.error ?? payload.error_message ?? payload.message;
    if (typeof message === "string" && message.trim()) return message.trim().slice(0, 500);
  } catch {
    // Apollo occasionally responds with plain text instead of JSON.
  }
  return responseText.replace(/\s+/g, " ").trim().slice(0, 500) || undefined;
}
