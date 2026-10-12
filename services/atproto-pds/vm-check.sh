#!/usr/bin/env bash
set -Eeuo pipefail

# Diagnose sign-in recovery without changing retained credentials or containers.
exec python3 - <<'PY'
import base64
import json
import os
import re
import stat
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

report = {"schemaVersion": 1, "status": "blocked", "configurationCandidates": [],
          "containers": [], "secretManager": [], "metadata": {"status": "unavailable"}}
credential_keys = ("PDS_ADMIN_PASSWORD", "PDS_JWT_SECRET",
                   "PDS_PLC_ROTATION_KEY_K256_PRIVATE_KEY_HEX")
allowed_reasons = {"ACCESS_TOKEN_SCOPE_INSUFFICIENT", "IAM_PERMISSION_DENIED",
                   "BILLING_DISABLED", "SERVICE_DISABLED", "CONSUMER_INVALID",
                   "PERMISSION_DENIED", "NOT_FOUND", "UNAUTHENTICATED"}


def configuration(values, hostname, data_directory):
    present = {key: bool(values.get(key, "").strip().strip("'\"").strip())
               for key in credential_keys}
    plc_valid = bool(re.fullmatch(r"[0-9a-fA-F]{64}", values.get(credential_keys[2], "")))
    matches = values.get("ATLAS_PDS_HOSTNAME", values.get("PDS_HOSTNAME")) == hostname
    data_matches = ("ATLAS_PDS_DATA_DIRECTORY" not in values or
                    values["ATLAS_PDS_DATA_DIRECTORY"] == data_directory)
    return {"credentialsPresent": present, "plcKeyValid": plc_valid,
            "hostnameMatches": matches, "dataDirectoryMatches": data_matches,
            "complete": all(present.values()) and plc_valid and matches and data_matches}


def parse_environment(lines):
    values = {}
    for line in lines:
        if not line.strip() or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or key in values:
            raise ValueError("invalid-environment")
        values[key] = value
    return values


def docker(arguments):
    result = subprocess.run(["docker", *arguments], capture_output=True, text=True, timeout=20)
    if result.returncode:
        raise ValueError("docker-read-failed")
    return result.stdout


def request(url, headers):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=15) as response:
        return response.read(1048576)


try:
    environment = os.environ["ATLAS_PDS_ENVIRONMENT"]
    project = os.environ["ATLAS_PDS_GCP_PROJECT"]
    hostname = os.environ["ATLAS_PDS_HOSTNAME"]
    deploy = Path(os.environ["ATLAS_PDS_DEPLOY_DIRECTORY"])
    data = Path(os.environ["ATLAS_PDS_DATA_DIRECTORY"])
    if (environment not in ("staging", "production") or
            not re.fullmatch(r"[a-z][a-z0-9-]{4,61}[a-z0-9]", project) or
            not re.fullmatch(r"[a-zA-Z0-9.-]+", hostname) or
            not deploy.is_absolute() or not data.is_absolute()):
        raise ValueError("invalid-input")

    directories = [deploy, data]
    for directory in (deploy, data):
        directories.extend(sorted(directory.parent.glob(directory.name + ".*"))[:16])
    directories.extend(sorted(data.glob(".restore-replaced-*"))[:16])
    directories.extend(Path(value) for value in
                       ("/etc/atlas-pds", "/var/backups/atlas-pds", "/root"))
    examined = 0
    for directory in dict.fromkeys(directories):
        if not directory.is_dir() or directory.is_symlink():
            continue
        candidates = [directory / "pds.env", *sorted(directory.glob("pds.env.*"))[:64]]
        if directory == Path("/root"):
            candidates.extend(sorted(directory.glob("atlas-pds*.env*"))[:16])
        for path in candidates:
            if examined >= 128:
                report["candidateLimitReached"] = True
                break
            if not path.exists() and not path.is_symlink():
                continue
            examined += 1
            row = {"path": str(path), "complete": False}
            try:
                info = path.lstat()
                private = (stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid()
                           and stat.S_IMODE(info.st_mode) & 0o077 == 0)
                row["ownerOnly"] = private
                if private and info.st_size <= 65536:
                    flags = os.O_RDONLY | os.O_NOFOLLOW
                    with os.fdopen(os.open(path, flags)) as source:
                        opened = os.fstat(source.fileno())
                        if opened.st_ino != info.st_ino or opened.st_dev != info.st_dev:
                            raise ValueError("candidate-changed")
                        row.update(configuration(parse_environment(source.read().splitlines()),
                                                 hostname, str(data)))
            except (OSError, UnicodeError, ValueError):
                row["reason"] = "unreadable-or-invalid"
            report["configurationCandidates"].append(row)

    try:
        identifiers = docker(["ps", "-a", "--filter", "label=com.docker.compose.service=atlas-pds",
                              "--format", "{{.ID}}"])
        for identifier in identifiers.splitlines()[:16]:
            if not re.fullmatch(r"[a-f0-9]{12,64}", identifier):
                raise ValueError("invalid-container-id")
            inspected = json.loads(docker(["inspect", "--type", "container", identifier]))
            for container in inspected:
                values = parse_environment(container.get("Config", {}).get("Env", []))
                if values.get("PDS_HOSTNAME") != hostname:
                    continue
                # A previous Compose project can retain originals, but another
                # PDS data disk must never qualify this application's recovery.
                data_matches = any(mount.get("Source") == str(data) and
                                   mount.get("Destination") == "/pds"
                                   for mount in container.get("Mounts", []))
                if not data_matches:
                    continue
                state = container.get("State", {})
                status = state.get("Status")
                health = state.get("Health", {}).get("Status")
                row = {"id": identifier, "state": status if status in
                       ("created", "running", "paused", "restarting", "removing", "exited", "dead") else "unknown",
                       "health": health if health in ("starting", "healthy", "unhealthy") else "unknown"}
                row["currentDeployment"] = container.get("Config", {}).get("Labels", {}).get(
                    "com.docker.compose.project.working_dir") == str(deploy)
                row.update(configuration(values, hostname, str(data)))
                report["containers"].append(row)
    except (OSError, ValueError, TypeError, KeyError, AttributeError, subprocess.SubprocessError):
        report["containerReadStatus"] = "unavailable"

    token = None
    try:
        metadata_url = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/"
        headers = {"Metadata-Flavor": "Google"}
        email = request(metadata_url + "email", headers).decode().strip()
        scopes = request(metadata_url + "scopes", headers).decode().splitlines()
        token = json.loads(request(metadata_url + "token", headers))["access_token"]
        if not isinstance(token, str) or not token:
            raise ValueError("invalid-token")
        report["metadata"] = {"status": "available",
                              "serviceAccount": email if re.fullmatch(r"[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.gserviceaccount\.com", email) else "unrecognized",
                              "cloudPlatformScope": "https://www.googleapis.com/auth/cloud-platform" in scopes}
    except (OSError, ValueError, KeyError, TypeError):
        token = None

    try:
        script = request("http://metadata.google.internal/computeMetadata/v1/instance/attributes/startup-script",
                         {"Metadata-Flavor": "Google"}).decode()
        # Inspect only literal Atlas assignments. Never execute startup code or
        # mistake a shell expansion/Secret Manager command for a recovered key.
        values = {}
        allowed_keys = (*credential_keys, "PDS_HOSTNAME", "ATLAS_PDS_HOSTNAME",
                        "ATLAS_PDS_DATA_DIRECTORY")
        for line in script.splitlines():
            key, separator, value = line.removeprefix("export ").partition("=")
            value = value.strip().strip("'\"")
            if key in allowed_keys and separator and re.fullmatch(r"[a-zA-Z0-9._:/=+-]+", value):
                values[key] = value
        row = {"path": "metadata:instance/startup-script", "source": "startup-metadata"}
        row.update(configuration(values, hostname, str(data)))
        report["configurationCandidates"].append(row)
    except (OSError, ValueError, UnicodeError):
        report["startupMetadataReadStatus"] = "unavailable"

    for suffix in ("admin-password", "jwt-secret", "plc-rotation-key"):
        name = "atlas-pds-" + environment + "-" + suffix
        row = {"secretName": name, "httpStatus": None, "present": False}
        if token:
            try:
                payload = json.loads(request("https://secretmanager.googleapis.com/v1/projects/" +
                                             project + "/secrets/" + name + "/versions/latest:access",
                                             {"Authorization": "Bearer " + token}))
                value = base64.b64decode(payload["payload"]["data"], validate=True)
                row.update({"httpStatus": 200, "present": bool(value), "reason": "available" if value else "empty-payload"})
            except urllib.error.HTTPError as error:
                row["httpStatus"] = error.code
                row["reason"] = "other-provider-error"
                try:
                    problem = json.loads(error.read(65536)).get("error", {})
                    reasons = [detail.get("reason") for detail in problem.get("details", []) if isinstance(detail, dict)]
                    reasons.append(problem.get("status"))
                    row["reason"] = next((reason for reason in reasons if reason in allowed_reasons), "other-provider-error")
                except (OSError, ValueError, TypeError, AttributeError):
                    pass
            except (OSError, ValueError, KeyError, TypeError):
                row["reason"] = "unavailable-or-invalid-response"
        else:
            row["reason"] = "metadata-token-unavailable"
        report["secretManager"].append(row)

    current_valid = any(row["path"] == str(deploy / "pds.env") and row["complete"]
                        for row in report["configurationCandidates"])
    healthy = any(row["currentDeployment"] and row["state"] == "running" and
                  row["health"] == "healthy" and row["complete"]
                  for row in report["containers"])
    report["recoveryConfigurationAvailable"] = any(row["complete"] for row in
                                                   report["configurationCandidates"] + report["containers"])
    if current_valid and healthy and all(row["present"] for row in report["secretManager"]):
        report["status"] = "pass"
except Exception:
    report["reason"] = "invalid-or-unavailable-host-configuration"

print(json.dumps(report, sort_keys=True))
sys.exit(0 if report["status"] == "pass" else 1)
PY
