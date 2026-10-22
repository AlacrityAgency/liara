"""Refresh the public reference snapshot; never uses account credentials."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
HEADERS = {"User-Agent": "Sokan-RAG-source-builder"}
REPOS = {
    "openapi": ("338325a42cd28d12dcee10c088840d2098504a8b", [
        "spec/paas.yaml", "spec/dns.yaml", "spec/dbaas.yaml", "spec/me.yaml", "spec/billing.yaml"]),
    "cli": ("14ec35f79d703a09a5e3abbb22ba59239cdde80d", [
        "src/commands/deploy.ts", "src/services/build-logs.ts", "src/services/cancel-deployment.ts",
        "src/commands/app/create.ts", "src/commands/app/logs.ts", "src/commands/app/update-port.ts",
        "src/commands/plan/list.ts", "src/utils/detect-platform.ts", "src/types/deployment-config.ts"]),
    "ai-sdk-examples": ("c6da7c43a3b5ce7d753003e409429fa6681156a7", [
        "README.md", "NodeJS/call-tools-in-parallel/main.js", "NextJS/human-in-the-loop/tools.ts"]),
    "github-cd-example": ("f67073949d369daca9d970db547843c1d7b1959f", [".github/workflows/liara.yaml", "liara.json"]),
}

def fetch(item):
    repo, commit, path = item
    url = f"https://raw.githubusercontent.com/liara-cloud/{repo}/{commit}/{path}"
    record = {"id": f"liara-{repo}-{path.replace('/', '-').replace('.', '-')}",
              "repository": f"https://github.com/liara-cloud/{repo}", "commit": commit,
              "upstream_path": path, "url": url, "status": "official_reference",
              "verification": "Public source snapshot only; no authenticated Liara API contract or deployment test."}
    try:
        with urlopen(Request(url, headers=HEADERS), timeout=45) as response:
            content = response.read()
        destination = ROOT / "knowledge" / "sources" / repo / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
        record.update(path=destination.relative_to(ROOT).as_posix(), sha256=sha256(content).hexdigest(),
                      bytes=len(content), retrieved_at=datetime.now(timezone.utc).isoformat())
    except Exception as error:
        record.update(status="fetch_failed", error=str(error))
    return record

if __name__ == "__main__":
    items = [(repo, commit, path) for repo, (commit, paths) in REPOS.items() for path in paths]
    with ThreadPoolExecutor(max_workers=6) as pool:
        records = list(pool.map(fetch, items))
    mcp_url = "https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture.md"
    mcp_record = {"id": "mcp-architecture-2026-07-28", "url": mcp_url,
                  "status": "official_reference", "verification": "Versioned official documentation snapshot; no runtime compatibility test."}
    try:
        with urlopen(Request(mcp_url, headers=HEADERS), timeout=45) as response:
            content = response.read()
        destination = ROOT / "knowledge" / "sources" / "mcp" / "architecture-2026-07-28.md"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
        mcp_record.update(path=destination.relative_to(ROOT).as_posix(), sha256=sha256(content).hexdigest(),
                          bytes=len(content), retrieved_at=datetime.now(timezone.utc).isoformat())
    except Exception as error:
        mcp_record.update(status="fetch_failed", error=str(error))
    records.append(mcp_record)
    registry = {"schema_version": 1, "created_at": datetime.now(timezone.utc).isoformat(),
                "scope": "Public authoritative reference snapshots for Sokan knowledge. Product design is WHITEPAPER.md; references do not establish implemented or live behavior.",
                "sources": records,
                "gaps": ["Challenge organizer brief was not supplied; judging criteria in the whitepaper remain unverified against the organizer.",
                         "Authenticated Liara API calls, pricing, rollback behavior and deployment remain untested.",
                         "MCP architecture is captured separately from its official documentation endpoint, without Git commit pinning."]}
    (ROOT / "knowledge" / "source-registry.json").write_text(json.dumps(registry, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"fetched": sum(r["status"] == "official_reference" for r in records),
                      "failed": [r for r in records if r["status"] != "official_reference"]}))
