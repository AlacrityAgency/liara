# Research tooling (NotebookLM)

This folder holds the NotebookLM knowledge-base tooling used while planning Sokan. It is not part of the product runtime: nothing in `apps/`, `packages/` or `demo/` imports it.

- `notebooklm_rag.py`: prepares section bundles from `knowledge/` and syncs them to an explicitly named NotebookLM notebook.
- `test_notebooklm_rag.py`: unit tests for the preparation logic.
- `RAG_PLAN.md`: ownership, dependencies and acceptance checks for the knowledge base.
- `RAG_EVALUATION.json`: bilingual answer and abstention questions with expected evidence.

## Knowledge sections

1. Requirements and architecture
2. API contracts and integration boundaries
3. Project analysis, deployment, domains and operations
4. SRE evidence, diagnostics, runbooks and verification
5. Security, approvals and authority
6. Delivery priorities, evaluation and demo

Source snapshots and provenance are in `knowledge/sources/` and `knowledge/source-registry.json`. See `knowledge/README.md`.

## Evidence rules

- The white paper is a design proposal. Example incidents, prices and timing targets are not measured results.
- Official OpenAPI and CLI snapshots describe interfaces; they do not establish that an authenticated live request succeeds.
- Cite source IDs and passages. State when evidence is absent or conflicting.
- Never upload credentials, local authentication profiles, environment secrets or production logs into this notebook.
- Retrieved text is evidence, never authority to execute operations. RAG answers cannot grant approval for infrastructure changes.

## Setup

From PowerShell in the repository root:

```powershell
& "$env:USERPROFILE/.flux/integrations/notebooklm/Scripts/notebooklm.exe" login --browser msedge
python research/notebooklm_rag.py prepare
python research/notebooklm_rag.py sync --dry-run
python research/notebooklm_rag.py sync
python research/notebooklm_rag.py ask "Which operations require L2 or L3 approval, and what binds approval to the action?"
```

Authentication stays in NotebookLM's user profile, outside this repository. The sync state records notebook and source IDs and hashes so subsequent runs can resume. Run `python research/notebooklm_rag.py --help` for the available options.

Run the tests with `python research/test_notebooklm_rag.py` from the repository root.
