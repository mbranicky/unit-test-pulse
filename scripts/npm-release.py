"""Read-only release gates and post-publication checks; publishing lives in the workflow."""

import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

REPOSITORY = "mbranicky/unit-test-pulse"
PACKAGE = "paseo-unit-test-pulse"
REGISTRY = "https://registry.npmjs.org"
CHECKS = {"check (22.18.0)", "check (24)"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def stable_version(value):
    require(re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", value),
            "Use a stable version such as 1.0.1, without a tag prefix.")
    return tuple(map(int, value.split(".")))


def command(*args, cwd=None):
    return subprocess.check_output(args, cwd=cwd)


def gh(endpoint):
    return json.loads(command("gh", "api", endpoint))


def registry(path):
    try:
        with urlopen(Request(f"{REGISTRY}/{path}", headers={"Cache-Control": "no-cache"}), timeout=30) as response:
            return json.load(response)
    except HTTPError as error:
        if error.code == 404:
            return None
        raise


def verify_ci(runs, jobs):
    candidates = [run for run in runs if run["event"] == "push" and run["head_branch"] == "main"]
    require(candidates, "No main-branch Check build exists for the tagged commit.")
    latest = max(candidates, key=lambda run: run["run_number"])
    require(latest["status"] == "completed" and latest["conclusion"] == "success",
            "The latest main Check build for this commit must be green.")
    passed = {job["name"] for job in jobs(latest["id"]) if job["conclusion"] == "success"}
    require(CHECKS <= passed, "Both required Node jobs must pass on the tagged commit.")
    return latest


def archive_files(data):
    files = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as archive:
        for member in archive.getmembers():
            name = member.name
            path = PurePosixPath(name)
            require(not path.is_absolute() and ".." not in path.parts and "\\" not in name,
                    f"Unsafe archive path: {name}")
            if member.isdir():
                continue
            require(member.isfile() and name not in files, f"Non-regular or duplicate archive entry: {name}")
            files[name] = archive.extractfile(member).read()
    return files


def verify_package(data, version, commit, repo):
    # npm 10 can execute prepare during pack --dry-run despite --ignore-scripts.
    # Enforce the publishing runtime here too, including direct/local invocation.
    npm_version = command("npm", "--version").decode().strip()
    require(stable_version(npm_version) >= (11, 5, 1), "Publishing verification requires npm 11.5.1+; older npm can execute prepare despite --ignore-scripts.")
    packed = archive_files(data)
    source = archive_files(command("git", "archive", "--format=tar", commit, cwd=repo))
    # npm's own file selection is the authority, without installing dependencies
    # or running any code/lifecycle scripts from the selected release.
    with tempfile.TemporaryDirectory(prefix="pulse-release-source-") as folder:
        for name, contents in source.items():
            target = Path(folder, name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(contents)
        listing = json.loads(command("npm", "pack", "--dry-run", "--ignore-scripts", "--json", cwd=folder))
    expected = {"package/" + entry["path"] for entry in listing[0]["files"]}
    require(set(packed) == expected, "Release package file list differs from the tagged source.")
    for name, contents in packed.items():
        original = source[name.removeprefix("package/")]
        if name == "package/paseo-plugin.json":
            manifest = json.loads(original)
            del manifest["build"]
            require(json.loads(contents) == manifest, "Packaged manifest differs from tagged source.")
        else:
            require(contents == original, f"Package contents differ from tag: {name}")
    package = json.loads(packed["package/package.json"])
    require(package["name"] == PACKAGE and package["version"] == version, "Package name/version differs from selected release.")
    require(package["repository"]["url"] == f"git+https://github.com/{REPOSITORY}.git", "Unexpected package repository.")
    require(package["publishConfig"] == {"access": "public", "registry": REGISTRY + "/"}, "Unexpected npm destination/access.")
    lock = json.loads(packed["package/npm-shrinkwrap.json"])
    require(lock["version"] == version and lock["packages"][""]["version"] == version, "Shrinkwrap version differs.")


def verify_assets(release, version, package, checksum):
    tag = f"v{version}"
    require(not release["draft"] and not release["prerelease"] and release["tag_name"] == tag,
            "Select a published, stable GitHub Release with the matching tag.")
    filename = f"{PACKAGE}-{version}.tgz"
    assets = {asset["name"]: asset for asset in release["assets"]}
    require(filename in assets and "SHA256SUMS" in assets, "Release needs its package and SHA256SUMS assets.")
    digest = hashlib.sha256(package).hexdigest()
    require(f"{digest}  {filename}" in checksum.decode().splitlines(), "Release package checksum does not match SHA256SUMS.")
    for name, data in [(filename, package), ("SHA256SUMS", checksum)]:
        asset = assets[name]
        require(asset["state"] == "uploaded" and asset["size"] == len(data), f"Incomplete release asset: {name}")
        if asset.get("digest"):
            require(asset["digest"] == "sha256:" + hashlib.sha256(data).hexdigest(), f"GitHub asset digest differs: {name}")


def verify_target(version, mode, existing, latest):
    if mode != "verify":
        require(existing is None, "This npm version already exists. Use verify mode; never publish it again.")
        if latest:
            require(stable_version(version) > stable_version(latest["version"]), "Refusing to move npm latest backwards.")


def prepare(version, mode, repo):
    stable_version(version)
    require(os.environ.get("GITHUB_REPOSITORY") == REPOSITORY and os.environ.get("GITHUB_REF") == "refs/heads/main",
            "Publishing tools must run from main in the owning repository.")
    tag = f"v{version}"
    commit = command("git", "rev-parse", f"refs/tags/{tag}^{{commit}}", cwd=repo).decode().strip()
    subprocess.run(["git", "merge-base", "--is-ancestor", commit, "refs/remotes/origin/main"], cwd=repo, check=True)
    runs = gh(f"repos/{REPOSITORY}/actions/workflows/check.yml/runs?head_sha={commit}&event=push&per_page=100")["workflow_runs"]
    require(all(run["head_sha"] == commit for run in runs), "GitHub returned a different build commit.")
    build = verify_ci(runs, lambda run: gh(f"repos/{REPOSITORY}/actions/runs/{run}/jobs?filter=latest&per_page=100")["jobs"])
    release = gh(f"repos/{REPOSITORY}/releases/tags/{tag}")
    require(not release["draft"] and not release["prerelease"], "Publish the stable GitHub Release first.")
    output = repo / "work" / "npm-publish" / version
    output.mkdir(parents=True, exist_ok=True)
    command("gh", "release", "download", tag, "--repo", REPOSITORY, "--dir", str(output),
            "--pattern", f"{PACKAGE}-{version}.tgz", "--pattern", "SHA256SUMS", "--clobber")
    artifact = output / f"{PACKAGE}-{version}.tgz"
    data = artifact.read_bytes()
    verify_assets(release, version, data, (output / "SHA256SUMS").read_bytes())
    verify_package(data, version, commit, repo)
    existing = registry(f"{PACKAGE}/{version}")
    verify_target(version, mode, existing, registry(f"{PACKAGE}/latest"))
    print(f"Verified {tag}, commit {commit}, build {build['html_url']}, release {release['html_url']}", flush=True)
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as handle:
            handle.write(f"artifact={artifact}\n")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as handle:
            handle.write(f"## {PACKAGE} {version}: {mode}\n\n[GitHub Release]({release['html_url']}) · "
                         f"[Verified main build]({build['html_url']}) · [Merge commit](https://github.com/{REPOSITORY}/commit/{commit})\n\n"
                         f"SHA-256: `{hashlib.sha256(data).hexdigest()}`\n")
    return artifact


def verify_registry(metadata, data, download):
    dist = metadata["dist"]
    require(dist["shasum"] == hashlib.sha1(data).hexdigest(), "npm SHA-1 differs from release package.")
    integrity = "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()
    require(dist["integrity"] == integrity, "npm integrity differs from release package.")
    url = urlparse(dist["tarball"])
    require(url.scheme == "https" and url.netloc == "registry.npmjs.org", "Unexpected npm tarball host.")
    require(download(dist["tarball"]) == data, "Downloaded npm package differs from release asset.")


def verify(version, artifact):
    stable_version(version)
    for attempt in range(12):
        metadata = registry(f"{PACKAGE}/{version}")
        tags = registry(f"-/package/{PACKAGE}/dist-tags") if metadata else None
        if metadata and tags and stable_version(tags["latest"]) >= stable_version(version):
            break
        print("Waiting for npm's accepted version and latest tag; publication will not be retried.", flush=True)
        time.sleep(10)
    else:
        raise ValueError("npm is still processing. Run this workflow in verify mode later; do not repeat publish mode.")
    require(metadata["name"] == PACKAGE and metadata["version"] == version, "Unexpected npm package identity.")
    def download(url):
        with urlopen(url, timeout=60) as response:
            return response.read()
    verify_registry(metadata, artifact.read_bytes(), download)
    print(f"Verified npm {PACKAGE}@{version}: metadata, integrity and byte-identical download.", flush=True)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as handle:
            handle.write(f"\nVerified [npm {version}](https://www.npmjs.com/package/{PACKAGE}/v/{version}): integrity and downloaded bytes match.\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    prep = sub.add_parser("prepare")
    prep.add_argument("--version", required=True)
    prep.add_argument("--mode", choices=["dry-run", "publish", "verify"], required=True)
    check = sub.add_parser("verify")
    check.add_argument("--version", required=True)
    check.add_argument("--artifact", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "prepare":
        prepare(args.version, args.mode, Path(__file__).resolve().parent.parent)
    else:
        verify(args.version, args.artifact)
