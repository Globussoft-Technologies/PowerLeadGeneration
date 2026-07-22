# Power Leads Sales Prospecting Pipeline — Team Plan

**Status:** Prototype accepted; Production Phase P1 is complete, with hosting-specific deployment binding deferred. Phase P2 durable pipeline work is next.

*One-page overview for leadership. Detailed design lives in `BUILD_PLAN.md`.*

## What we're building
An automated tool that finds companies **currently running paid ads** (a signal they have active budget and buying intent), identifies the right decision-makers there, and routes them into our sales outreach — with a quick rep review step before anything goes live.

In one line: **"Company X is running an ad" → "an approved decision-maker receives a relevant SendGrid email"**, with minimal manual work.

## Why it matters
- **Better timing.** Ad-runners are warm targets, not cold list entries — we reach out when budget is active.
- **Less manual work.** Replaces spreadsheet-driven prospecting; reps spend time selling, not list-building.
- **Provable ROI.** We track reply and meeting rates for ad-sourced leads vs. baseline lists.

## How it works (4 steps)
1. **Discover** — pull companies running ads from the Ads Database team's API (filtered by industry, geography, platform, etc.).
2. **Qualify** — dedupe, match against our Ideal Customer Profile, and rank by fit.
3. **Enrich** — use Apollo to find target-persona contacts with verified emails.
4. **Review and send** — reps approve contacts, preview personalized email, then send individually or in bulk through SendGrid.

## Delivery phases
| Phase | What ships | Value |
|---|---|---|
| **1 — MVP** | Full app: trigger a run, auto-enrich, rep reviews, export a ready-to-upload list | Validates the concept end-to-end; usable by reps immediately |
| **2 — Direct mail** | SendGrid individual/bulk delivery, personalization, and cross-run deduplication | Removes manual upload while retaining human control |
| **Production v1** | Identity, durable workers, quotas, observability, compliance, and controlled pilot | Makes the accepted prototype safe and supportable |
| **Post-launch** | Scheduled runs, CRM dedup, ROI dashboard | Hands-off pipeline + proof of channel value |

*Each phase is independently useful and fully tested (unit → integration → end-to-end) before it ships.*

## Tech (brief)
React + TypeScript front end, Node + TypeScript back end, MongoDB. Integrates with the Ads Database API, Gemini, Apollo, and SendGrid. Gemini is required for lead scoring and personalization, with deterministic fallback for resilience.

## What we need from stakeholders
| From | What | Needed by |
|---|---|---|
| **Ads DB team / IT** | Production HTTPS, VPN, or gateway access to the private Ads API | Production P0/P3 — **main deployment dependency** |
| **RevOps / IT** | Apollo plan, credit rules, and approved production budgets | Production P0 |
| **Sales leadership** | Approved ICP, personas, review policy, and pilot volume | Production P0/P4 |
| **RevOps / Marketing Ops** | SendGrid account, verified sender/domain, deliverability policy, and pilot limits | Production P0/P3 |
| **IT / Platform** | Final hosting, protected environment variables, and private Ads API connectivity | Before deployment |
| **Legal / Compliance** | Sign-off on storing contact data (GDPR/CCPA) | Before go-live |

## Key risks
- **Ads API connectivity** — the proven endpoint is on a private network. *Mitigation: approve a secured HTTPS endpoint, VPN/VPC route, or internal gateway during P0.*
- **Apollo credit cost** — scales with volume. *Current default: 3 candidates/contacts per qualified company; production adds per-run and daily workspace budgets.*
- **Lead quality** — depends on a good ICP definition. *Mitigation: rep review step + tunable settings.*

## Success metrics
- New qualified leads per week via this channel
- % of discovered companies yielding a verified and approved contact
- Email delivery, bounce, reply, and meeting rates for ad-sourced prospects versus baseline
- Rep-hours saved vs. manual prospecting
