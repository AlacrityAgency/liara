"""Offline behavior checks: no Google or Liara requests are made."""
import shutil
from pathlib import Path
import tempfile
import unittest

import notebooklm_rag as rag


NOTEBOOK = "9779ea1a-3e17-4146-96b8-95865e23159f"


class FakeCLI:
    def __init__(self):
        self.sources = []
        self.add_count = 0
        self.fail_add = False

    def run(self, *args, **kwargs):
        if args[:2] == ("source", "list"):
            return {"sources": self.sources}
        if args[:2] == ("source", "add"):
            self.add_count += 1
            if self.fail_add:
                raise RuntimeError("simulated ambiguous timeout")
            source = {"id": "source-" + str(self.add_count), "title": args[args.index("--title") + 1]}
            self.sources.append(source)
            return {"source": source}
        if args[:2] == ("source", "wait"):
            return {"status": "ready"}
        raise AssertionError(args)


class Checks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        shutil.copyfile(rag.ROOT / "WHITEPAPER.md", self.root / "WHITEPAPER.md")
        rag.prepare(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def test_sections_cover_all_whitepaper_sections_once(self):
        manifest = rag.read_json(self.root / "knowledge/sections/manifest.json")
        numbers = [span["section"] for source in manifest["sources"] for span in source["spans"]]
        self.assertEqual(sorted(numbers), list(range(1, 19)))

    def test_sync_is_idempotent(self):
        cli = FakeCLI()
        first = rag.sync(self.root, cli, notebook_id=NOTEBOOK)
        self.assertEqual(first["ready_sources"], 7)
        rag.sync(self.root, cli)
        self.assertEqual(cli.add_count, 7)

    def test_ambiguous_upload_is_not_retried(self):
        cli = FakeCLI()
        cli.fail_add = True
        with self.assertRaisesRegex(RuntimeError, "ambiguous"):
            rag.sync(self.root, cli, notebook_id=NOTEBOOK)
        cli.fail_add = False
        with self.assertRaisesRegex(RuntimeError, "outcome unknown"):
            rag.sync(self.root, cli)
        self.assertEqual(cli.add_count, 1)

    def test_changed_bundle_refused(self):
        path = self.root / "knowledge/sections/01-requirements.md"
        path.write_text(path.read_text(encoding="utf-8") + "changed", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Hash mismatch"):
            rag.corpus(self.root)

    def test_path_escape_refused(self):
        with self.assertRaisesRegex(ValueError, "escapes"):
            rag.safe_path(self.root, "../outside.txt")

    def test_dry_run_does_not_mutate_state(self):
        result = rag.sync(self.root, FakeCLI(), dry_run=True)
        self.assertTrue(result["dry_run"])
        self.assertFalse((self.root / "knowledge/notebooklm-state.json").exists())


if __name__ == "__main__":
    unittest.main()
