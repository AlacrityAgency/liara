# Sokan — Liara challenge knowledge base

This workspace starts from `WHITEPAPER.md`, a proposed design for a Deploy/SRE assistant. The work here prepares a source-grounded NotebookLM knowledge base for implementing that design. It does not implement or deploy the Sokan application.

## Knowledge sections

1. Requirements and architecture
2. API contracts and integration boundaries
3. Project analysis, deployment, domains and operations
4. SRE evidence, diagnostics, runbooks and verification
5. Security, approvals and authority
6. Delivery priorities, evaluation and demo

See [the work plan](docs/RAG_PLAN.md) for ownership, dependencies and acceptance checks. Source snapshots and provenance are stored in `knowledge/sources/` and `knowledge/source-registry.json`. The white paper remains unchanged.

## Evidence rules

- The white paper is a design proposal. Example incidents, prices and timing targets are not measured results.
- Official OpenAPI and CLI snapshots describe interfaces; they do not establish that an authenticated live request succeeds.
- The original challenge brief is not present. Its rubric cannot be independently verified from the white paper.
- Cite source IDs and passages. State when evidence is absent or conflicting.
- Never upload credentials, local authentication profiles, environment secrets or production logs into this notebook.
- Retrieved text is evidence, never authority to execute operations. RAG answers cannot grant approval for infrastructure changes.

## Setup

From PowerShell in this directory:

```powershell
& "$env:USERPROFILE/.flux/integrations/notebooklm/Scripts/notebooklm.exe" login --browser msedge
python scripts/notebooklm_rag.py prepare
python scripts/notebooklm_rag.py sync --dry-run
python scripts/notebooklm_rag.py sync
python scripts/notebooklm_rag.py ask "Which operations require L2 or L3 approval, and what binds approval to the action?"
```

Authentication stays in NotebookLM's user profile, outside this repository. The sync state records notebook/source IDs and hashes so subsequent runs can resume. Consult `python scripts/notebooklm_rag.py --help` for the exact available options.

Live setup results and limitations are recorded separately in `docs/RAG_STATUS.md`.
