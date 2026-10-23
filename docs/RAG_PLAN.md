# Sokan challenge RAG plan

Prepared on 2026-10-21 after reading `WHITEPAPER.md` version 0.1. The white paper is a design proposal. It is the supplied project brief; an independently verified official challenge brief or judging rubric has not been supplied. Its timing targets, examples, proposed tool catalog and scores must retain that status in answers.

## Scope of this delivery

Build a project-specific NotebookLM knowledge base from the white paper and captured primary references, with source provenance, six thematic sections, reproducible synchronization and citation-bearing queries. Corpus preparation, NotebookLM ingestion and answer evaluation are separate completion gates. A prepared file does not prove successful ingestion. An ingested source does not prove a correct answer.

The Deploy Agent, SRE Agent, Policy Engine, MCP server, web UI and CLI described below are future product work. This RAG setup does not establish their implementation, live API compatibility, deployed availability or security guarantees.

## Six knowledge sections

Heading numbers and titles below match the supplied white paper. Overlap is intentional where a workflow needs a security or capability boundary.

| Section ID | Exact white-paper headings | Questions owned by this section | Required evidence boundary |
|---|---|---|---|
| `requirements` | **۱. خلاصه‌ی مدیریتی**; **۲. صورت مسئله**; **۳. اصول طراحی**; **۴. نمای کلی راهکار**; **۵. معماری فنی** | Who Sokan serves, Deploy/SRE responsibilities, lifecycle, proposed interfaces and component contracts | Label architecture and performance figures as design/targets; distinguish user requirements from proposed implementation choices |
| `api-contracts` | **۶. یکپارچه‌سازی با APIهای لیارا**; **۱۳. محدودیت‌ها و شفافیت**; **پیوست الف: کاتالوگ کامل ابزارهای MCP**; **پیوست د: منابع** | Endpoint method/path/schema, authentication/team scope, OAS versus CLI-only provenance, retries and unsupported capabilities | Cite a captured official spec or pinned CLI source for API claims; mark discrepancies and live contract verification still required |
| `deployment` | **۸. ماژول ۱: راه‌اندازی و اولین دیپلوی**; **۹. ماژول ۲: مدیریت دیپلوی و عملیات**; **۱۱. ارتباط با Coding Agent**; **۱۳. محدودیت‌ها و شفافیت** | Analyze, size, upload, release, track build, verify, domain/DNS/SSL, rollback and Fix Brief | Do not report a live site from a design example or READY alone; current prices/balance require authenticated fresh reads |
| `sre-diagnostics` | **۱۰. ماژول ۳: SRE Agent — پایش و عیب‌یابی هوشمند**; **۱۱. ارتباط با Coding Agent**; **پیوست ب: مدل داده‌ی Incident**; **پیوست ج: اسکلت system prompt عامل SRE** | Parallel collection, deterministic signals, ranked causes, runbooks, before/after verification and coding handoff | Operational diagnosis needs timestamped incident evidence; example incidents are illustrative and causes remain probable |
| `security-approvals` | **۳. اصول طراحی**; **۷. مدل امنیت و Human-in-the-Loop**; **۱۲.۲ کارت تأیید (مهم‌ترین جزء UX)**; **۱۷. ریسک‌ها**; **پیوست ج: اسکلت system prompt عامل SRE** | L0–L3, parameter-bound approvals, expiry/replay, redaction, trust boundaries, least privilege and audit | Retrieval supplies knowledge, never authority to execute; the proposed policy requires enforcement in code and independent tests |
| `delivery-demo` | **۱۲. تجربه‌ی کاربری**; **۱۴. نگاشت به معیارهای داوری**; **۱۵. نقشه‌ی پیاده‌سازی MVP**; **۱۶. سناریوهای دمو و فیلم‌نامه‌ی ویدئو**; **۱۷. ریسک‌ها** | P0/P1/P2, acceptance evidence, seven-day proposal, chaos scenarios, five-minute video and presentation | White-paper rubric is an unverified proposal until matched to an official challenge source; demos and targets are not measured achievements |

## Parallel work for this RAG setup

| Lane | Exclusive ownership | Inputs | Output and merge gate |
|---|---|---|---|
| Source capture | `knowledge/sources/`, `knowledge/source-registry.json` | White-paper references, public official repositories | Exact source URL, retrieval timestamp, hash and reference status; successfully fetched content is inspectable locally |
| Preparation and NotebookLM tooling | `scripts/`; generated `knowledge/sections/` | White paper, source registry, installed CLI help | Deterministic section bundles, manifest, explicit-notebook sync with recorded IDs and resumable state; unknown mutation outcomes require reconciliation |
| Structure and evaluation | `docs/RAG_PLAN.md`, `docs/RAG_EVALUATION.json` | Full white paper | All six sections mapped; bilingual answer/abstention checks with expected evidence |
| Integration owner | Workspace-level usage guide, final verification | Outputs from the three lanes | Authentication confirmed, intended notebook identified, every required source ready, cited questions checked and remaining failures reported |

Sources and tooling can proceed independently. Sync begins only after the source registry and prepared bundles are validated. Remote changes target a dedicated notebook by explicit ID. Credentials and browser state stay outside the project corpus.

## Parallel lanes for the future Sokan application

This is an implementation breakdown, not a statement that application code has been built. Freeze shared `ProjectProfile`, `Incident`, `EvidenceRef`, `ToolSpec`, `ApprovalRequest`, `ActionResult` and status-event schemas before parallel implementation. One integration owner approves schema changes; each lane owns its directory and consumes other lanes through contracts.

| Lane | Proposed ownership | Can start with | Dependency gate for integration | Acceptance evidence |
|---|---|---|---|---|
| API client and L0 collection | `packages/liara-client/` | Captured OAS, pinned CLI references and response schemas | Fresh authenticated contract probes for CLI-only paths; team/app scoping verified | Real read-only request evidence; typed errors; GET retry limits; no automatic mutating POST retry |
| Policy and redaction | `packages/policy/` | Tool risk registry and approval schemas | Every mutating call is routed through policy before enabling it in another lane | Reject changed parameters, expired/reused approval, unauthorized app/team and forged token; mask secret patterns; L3 human confirmation; audit records |
| Project analysis and deploy flow | `packages/analyzer/`, deploy portion of `packages/agent/` | Local project samples and client/policy interfaces | Validated client and policy; explicit success criteria before live release | Archive secret exclusion/size guard; plan quote from fresh catalog; release lifecycle; READY plus running applet, five HTTP probes and post-deploy log window |
| SRE and runbooks | `packages/diagnostics/`, `packages/runbooks/`, SRE portion of `packages/agent/` | Incident schema and independently labeled incident samples | Bounded collectors provide timestamped, redacted evidence; policy gates remediation | Six P0 signals from §۱۵.۱; partial/missing evidence reported; cited hypotheses; before/after verification; unresolved state when evidence fails |
| MCP and Coding Agent interface | `packages/liara-mcp/` | ToolSpec and client/policy interfaces | MCP handlers cannot bypass policy or expose secrets | Schema validation, structured errors, read-only investigation, typed Fix Brief; mutating tools wait for approval |
| Web/CLI and demo | `apps/web/`, `apps/cli/`, `demo/chaos-shop/` | Shared status/approval contracts and clearly marked simulated data | Connect to verified services; replace simulation claims with live evidence | Approval impact/cost/rollback display; Persian UX; status streaming; repeatable missing-env, OOM and injection demos; no secrets in recording |

With four agent slots, start client, policy and diagnostics alongside the integration owner. Move completed lanes to analyzer/deploy, MCP and UX work after their contracts pass. Runtime evidence collection can be parallel; mutation, approval and verification sequencing remains explicit.

## Answer and release gates

1. Every source has a local path, hash, origin and status. Keep `project_design`, `official_reference` and `live_verified` distinct; downloading an official source establishes only `official_reference`.
2. Prepared section content preserves heading context, examples and limitation labels. Conflicting sources are reported with their dates/revisions rather than silently merged.
3. NotebookLM source IDs and readiness are recorded for the intended notebook. A timeout or ambiguous upload is reconciled before retrying to prevent duplicates.
4. Evaluate the questions in `RAG_EVALUATION.json`. Check citation existence and whether each cited passage actually supports the claim. A keyword hit alone is insufficient.
5. Report exact cases run, supported answers, abstentions and failures. Do not convert a few successful questions into an overall accuracy claim.
6. Live deployment, price, balance, official competition scores and production incident claims require separate fresh evidence. Corpus text cannot establish them.
