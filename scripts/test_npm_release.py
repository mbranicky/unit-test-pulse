import base64
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
from shlex import quote
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("npm_release", Path(__file__).with_name("npm-release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def archive(files):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as tar:
        for name, data in files.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            tar.addfile(entry, io.BytesIO(data))
    return output.getvalue()


class ReleaseGates(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = tempfile.TemporaryDirectory(prefix="pulse-publish-tests-")
        cls.repo = Path(cls.scratch.name, "source")
        cls.repo.mkdir()
        package = {
            "name": release.PACKAGE, "version": "1.0.1",
            "repository": {"url": f"git+https://github.com/{release.REPOSITORY}.git"},
            "publishConfig": {"access": "public", "registry": release.REGISTRY + "/"},
            "files": ["paseo-plugin.json", "npm-shrinkwrap.json", "README.md", "server/"],
            "scripts": {"prepare": "node -e " + quote(
                f"require('fs').writeFileSync({json.dumps(str(cls.repo / 'executed'))}, 'unsafe')")},
        }
        for name, data in {
            "package.json": json.dumps(package),
            "npm-shrinkwrap.json": json.dumps({"version": "1.0.1", "packages": {"": {"version": "1.0.1"}}}),
            "paseo-plugin.json": json.dumps({"id": "unit-test-pulse", "build": [["npm", "ci"]]}),
            "README.md": "Release documentation\n",
            "server/cli.mjs": "console.log('example');\n",
        }.items():
            path = cls.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(data)
        subprocess.run(["git", "init", "-q", str(cls.repo)], check=True)
        subprocess.run(["git", "add", "."], cwd=cls.repo, check=True)
        subprocess.run(["git", "-c", "user.name=Release test", "-c", "user.email=test@example.invalid",
                        "commit", "-qm", "fixture"], cwd=cls.repo, check=True)
        staging = Path(cls.scratch.name, "package")
        shutil.copytree(cls.repo, staging, ignore=shutil.ignore_patterns(".git"))
        (staging / "paseo-plugin.json").write_text(json.dumps({"id": "unit-test-pulse"}))
        subprocess.run(["npm", "pack", "--ignore-scripts", "--json"], cwd=staging, check=True, capture_output=True)
        cls.package = (staging / "paseo-unit-test-pulse-1.0.1.tgz").read_bytes()
        cls.files = release.archive_files(cls.package)

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def test_valid_package_matches_tag_without_executing_lifecycle_scripts(self):
        release.verify_package(self.package, "1.0.1", "HEAD", self.repo)
        self.assertFalse((self.repo / "executed").exists())

    def test_old_npm_is_rejected_before_touching_release_source(self):
        with patch.object(release, "command", return_value=b"10.9.3\n") as run:
            with self.assertRaisesRegex(ValueError, "requires npm 11.5.1"):
                release.verify_package(b"unused", "1.0.1", "HEAD", self.repo)
            run.assert_called_once_with("npm", "--version")

    def test_modified_packaged_code_is_rejected(self):
        files = {**self.files, "package/server/cli.mjs": b"tampered"}
        with self.assertRaisesRegex(ValueError, "contents differ from tag"):
            release.verify_package(archive(files), "1.0.1", "HEAD", self.repo)

    def test_missing_and_extra_packaged_files_are_rejected(self):
        missing = {name: value for name, value in self.files.items() if name != "package/server/cli.mjs"}
        for files in [missing, {**self.files, "package/unreviewed.mjs": b"extra"}]:
            with self.subTest(files=list(files)), self.assertRaisesRegex(ValueError, "file list differs"):
                release.verify_package(archive(files), "1.0.1", "HEAD", self.repo)

    def test_wrong_selected_version_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "name/version differs"):
            release.verify_package(self.package, "1.0.2", "HEAD", self.repo)

    def test_archive_escape_symlink_and_duplicate_are_rejected(self):
        for name in ["../escape", "/absolute", "package/../escape", "package\\escape"]:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "Unsafe archive path"):
                release.archive_files(archive({name: b"bad"}))
        for symbolic in [True, False]:
            output = io.BytesIO()
            with tarfile.open(fileobj=output, mode="w") as tar:
                entry = tarfile.TarInfo("package/file")
                if symbolic:
                    entry.type = tarfile.SYMTYPE
                    entry.linkname = "/etc/passwd"
                tar.addfile(entry)
                if not symbolic:
                    tar.addfile(entry)
            with self.assertRaisesRegex(ValueError, "Non-regular or duplicate"):
                release.archive_files(output.getvalue())

    def test_only_plain_stable_versions_are_accepted(self):
        self.assertEqual(release.stable_version("1.0.1"), (1, 0, 1))
        for value in ["v1.0.1", "1.0.1-beta.1", "01.0.1", "1.0.1\n", "1.0.1;echo unsafe", "../main"]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                release.stable_version(value)

    def test_duplicate_versions_and_latest_downgrades_cannot_publish(self):
        release.verify_target("1.0.1", "publish", None, {"version": "1.0.0"})
        for mode in ["dry-run", "publish"]:
            with self.subTest(mode=mode), self.assertRaisesRegex(ValueError, "already exists"):
                release.verify_target("1.0.1", mode, {"version": "1.0.1"}, {"version": "1.0.1"})
            with self.subTest(mode=mode), self.assertRaisesRegex(ValueError, "backwards"):
                release.verify_target("1.0.0", mode, None, {"version": "1.0.1"})
        release.verify_target("1.0.0", "verify", {"version": "1.0.0"}, {"version": "1.0.1"})

    def test_wrong_branch_or_repository_is_rejected_before_any_commands(self):
        for environment in [{"GITHUB_REPOSITORY": release.REPOSITORY, "GITHUB_REF": "refs/heads/feature"},
                            {"GITHUB_REPOSITORY": "another/repo", "GITHUB_REF": "refs/heads/main"}]:
            with patch.dict(release.os.environ, environment), patch.object(release, "command") as run:
                with self.assertRaisesRegex(ValueError, "must run from main"):
                    release.prepare("1.0.1", "publish", self.repo)
                run.assert_not_called()

    def test_latest_main_ci_run_and_both_jobs_must_pass(self):
        good = {"id": 1, "run_number": 1, "event": "push", "head_branch": "main", "status": "completed", "conclusion": "success"}
        jobs = lambda _: [{"name": name, "conclusion": "success"} for name in release.CHECKS]
        self.assertEqual(release.verify_ci([good], jobs), good)
        for runs in [[], [{**good, "event": "pull_request"}], [good, {**good, "id": 2, "run_number": 2, "conclusion": "failure"}]]:
            with self.subTest(runs=runs), self.assertRaises(ValueError):
                release.verify_ci(runs, jobs)
        with self.assertRaisesRegex(ValueError, "Both required Node"):
            release.verify_ci([good], lambda _: [{"name": "check (24)", "conclusion": "success"}])

    def test_release_must_be_published_stable_and_have_matching_checksum(self):
        data = b"tested package"
        filename = "paseo-unit-test-pulse-1.0.1.tgz"
        checksum = (hashlib.sha256(data).hexdigest() + "  " + filename + "\n").encode()
        metadata = {"draft": False, "prerelease": False, "tag_name": "v1.0.1",
                    "assets": [{"name": filename, "state": "uploaded", "size": len(data)},
                               {"name": "SHA256SUMS", "state": "uploaded", "size": len(checksum)}]}
        release.verify_assets(metadata, "1.0.1", data, checksum)
        for changed in [{**metadata, "draft": True}, {**metadata, "prerelease": True}, {**metadata, "assets": []}]:
            with self.assertRaises(ValueError):
                release.verify_assets(changed, "1.0.1", data, checksum)
        with self.assertRaisesRegex(ValueError, "checksum"):
            release.verify_assets(metadata, "1.0.1", b"modified", checksum)

    def test_registry_integrity_and_download_must_match_the_release(self):
        data = b"exact tested bytes"
        dist = {"shasum": hashlib.sha1(data).hexdigest(),
                "integrity": "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode(),
                "tarball": "https://registry.npmjs.org/paseo-unit-test-pulse/-/package.tgz"}
        release.verify_registry({"dist": dist}, data, lambda _: data)
        for modified in [{**dist, "shasum": "wrong"}, {**dist, "integrity": "wrong"},
                         {**dist, "tarball": "https://example.invalid/package.tgz"}]:
            with self.assertRaises(ValueError):
                release.verify_registry({"dist": modified}, data, lambda _: data)
        with self.assertRaisesRegex(ValueError, "Downloaded npm package differs"):
            release.verify_registry({"dist": dist}, data, lambda _: b"different")

    def test_full_registry_verification_uses_npm_dist_tag_endpoint(self):
        data = self.package
        metadata = {"name": release.PACKAGE, "version": "1.0.1", "dist": {
            "shasum": hashlib.sha1(data).hexdigest(),
            "integrity": "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode(),
            "tarball": "https://registry.npmjs.org/paseo-unit-test-pulse/-/package.tgz"}}
        def response(path):
            return {"paseo-unit-test-pulse/1.0.1": metadata,
                    "-/package/paseo-unit-test-pulse/dist-tags": {"latest": "1.0.1"}}[path]
        artifact = Path(self.scratch.name, "verified.tgz")
        artifact.write_bytes(data)
        with patch.object(release, "registry", side_effect=response), \
             patch.object(release, "urlopen", return_value=io.BytesIO(data)), \
             patch.dict(release.os.environ, {"GITHUB_STEP_SUMMARY": ""}), redirect_stdout(io.StringIO()):
            release.verify("1.0.1", artifact)

    def test_accepted_but_not_visible_publication_never_republishes(self):
        with patch.object(release, "registry", return_value=None) as registry, \
             patch.object(release.time, "sleep"), patch.object(release, "command") as run, redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError, "do not repeat publish mode"):
                release.verify("1.0.1", Path("unused.tgz"))
            self.assertEqual(registry.call_count, 12)
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
