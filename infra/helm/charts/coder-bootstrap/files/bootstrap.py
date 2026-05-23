#!/usr/bin/env python3

import base64
import json
import os
import platform
import shutil
import ssl
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request


def log(message):
    print(f"[coder-bootstrap] {message}", flush=True)


def fail(message):
    print(f"[coder-bootstrap] {message}", file=sys.stderr, flush=True)
    sys.exit(1)


def env(name, default=None, required=False):
    value = os.environ.get(name, default)
    if required and not value:
        fail(f"missing required environment variable: {name}")
    return value


CODER_URL = env("CODER_URL", required=True).rstrip("/")
CODER_PUBLIC_URL = env("CODER_PUBLIC_URL", CODER_URL)
CODER_TEMPLATE_NAME = env("CODER_TEMPLATE_NAME", "mercato-k8s")
CODER_TEMPLATE_DIR = env("CODER_TEMPLATE_DIR", "/work/template")
CODER_CLI_VERSION = env("CODER_CLI_VERSION", "2.30.0").lstrip("v")
CODER_TOKEN_NAME = env("CODER_TOKEN_NAME", "onboarding-app-k8s")
CODER_TOKEN_LIFETIME_NS = int(
    env("CODER_TOKEN_LIFETIME_NS", "31536000000000000")
)
CODER_ORGANIZATION = env("CODER_ORGANIZATION", "")

FIRST_USER_EMAIL = env("CODER_FIRST_USER_EMAIL", required=True)
FIRST_USER_USERNAME = env("CODER_FIRST_USER_USERNAME", required=True)
FIRST_USER_PASSWORD = env("CODER_FIRST_USER_PASSWORD", required=True)
FIRST_USER_FULL_NAME = env("CODER_FIRST_USER_FULL_NAME", FIRST_USER_USERNAME)

ONBOARDING_ADMIN_SECRET_NAME = env(
    "ONBOARDING_ADMIN_SECRET_NAME", "onboarding-coder-admin"
)
ONBOARDING_TEMPLATE_SECRET_NAME = env(
    "ONBOARDING_TEMPLATE_SECRET_NAME", "onboarding-coder-template"
)

NAMESPACE = env("POD_NAMESPACE", env("NAMESPACE", "default"))

SERVICEACCOUNT_TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token"
SERVICEACCOUNT_CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
KUBERNETES_HOST = env("KUBERNETES_SERVICE_HOST", required=True)
KUBERNETES_PORT = env("KUBERNETES_SERVICE_PORT_HTTPS", "443")
KUBERNETES_URL = f"https://{KUBERNETES_HOST}:{KUBERNETES_PORT}"

TEMPLATE_VARIABLES = {
    "sandbox_domain": env("SANDBOX_DOMAIN", required=True),
    "wildcard_apps_domain": env("WILDCARD_APPS_DOMAIN", required=True),
    "proxy_scheme": env("PROXY_SCHEME", "https"),
    "proxy_port_suffix": env("PROXY_PORT_SUFFIX", ""),
    "coder_public_url": CODER_PUBLIC_URL,
    "agent_coder_url": env("AGENT_CODER_URL", required=True),
    "workspace_namespace": env("WORKSPACE_NAMESPACE", NAMESPACE),
    "workspace_image": env("WORKSPACE_IMAGE", required=True),
    "workspace_image_pull_secrets": env("WORKSPACE_IMAGE_PULL_SECRETS", ""),
    "workspace_storage_class": env("WORKSPACE_STORAGE_CLASS", "local-path"),
    "home_storage_size": env("WORKSPACE_HOME_STORAGE", "20Gi"),
    "pg_storage_size": env("WORKSPACE_PG_STORAGE", "10Gi"),
    "workspace_node_options": env(
        "WORKSPACE_NODE_OPTIONS", "--max-old-space-size=6144"
    ),
}

K8S_SSL_CONTEXT = ssl.create_default_context(cafile=SERVICEACCOUNT_CA_PATH)


def http_request(url, method="GET", headers=None, body=None, context=None):
    request = urllib.request.Request(url, method=method)
    normalized_headers = dict(headers or {})
    for key, value in normalized_headers.items():
        request.add_header(key, value)

    data = None
    if body is not None:
        if isinstance(body, (bytes, bytearray)):
            data = body
        else:
            data = json.dumps(body).encode("utf-8")
            if not any(key.lower() == "content-type" for key in normalized_headers):
                request.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(request, data=data, context=context) as response:
            payload = response.read()
            content_type = response.headers.get("Content-Type", "")
            if payload and "application/json" in content_type:
                return response.status, json.loads(payload)
            if payload:
                return response.status, payload.decode("utf-8")
            return response.status, None
    except urllib.error.HTTPError as exc:
        payload = exc.read()
        content_type = exc.headers.get("Content-Type", "")
        if payload and "application/json" in content_type:
            return exc.code, json.loads(payload)
        if payload:
            return exc.code, payload.decode("utf-8")
        return exc.code, None


def coder_request(path, method="GET", token=None, body=None):
    headers = {"Accept": "application/json"}
    if token:
        headers["Coder-Session-Token"] = token
    return http_request(f"{CODER_URL}{path}", method=method, headers=headers, body=body)


def k8s_request(path, method="GET", body=None, content_type="application/json"):
    with open(SERVICEACCOUNT_TOKEN_PATH, "r", encoding="utf-8") as token_file:
        service_account_token = token_file.read().strip()
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {service_account_token}",
    }
    if body is not None:
        headers["Content-Type"] = content_type
    return http_request(
        f"{KUBERNETES_URL}{path}",
        method=method,
        headers=headers,
        body=body,
        context=K8S_SSL_CONTEXT,
    )


def wait_for_coder():
    deadline = time.time() + 180
    health_url = f"{CODER_URL}/healthz"
    while time.time() < deadline:
        status, _ = http_request(health_url)
        if status == 200:
            log(f"Coder is healthy at {health_url}")
            return
        time.sleep(2)
    fail(f"timed out waiting for {health_url}")


def get_secret_data(name):
    status, payload = k8s_request(f"/api/v1/namespaces/{NAMESPACE}/secrets/{name}")
    if status == 404:
        return None
    if status != 200:
        fail(f"failed to fetch secret {name}: HTTP {status} {payload}")
    encoded = payload.get("data", {})
    return {
        key: base64.b64decode(value).decode("utf-8") for key, value in encoded.items()
    }


def apply_secret(name, string_data):
    labels = {"app.kubernetes.io/part-of": "mercato-sandboxes"}
    existing_status, existing_payload = k8s_request(
        f"/api/v1/namespaces/{NAMESPACE}/secrets/{name}"
    )

    if existing_status == 404:
        body = {
            "apiVersion": "v1",
            "kind": "Secret",
            "metadata": {"name": name, "namespace": NAMESPACE, "labels": labels},
            "type": "Opaque",
            "stringData": string_data,
        }
        status, payload = k8s_request(
            f"/api/v1/namespaces/{NAMESPACE}/secrets", method="POST", body=body
        )
        if status not in (200, 201):
            fail(f"failed to create secret {name}: HTTP {status} {payload}")
        log(f"created secret {name}")
        return

    if existing_status != 200:
        fail(f"failed to read secret {name}: HTTP {existing_status} {existing_payload}")

    body = {
        "metadata": {"labels": labels},
        "type": "Opaque",
        "stringData": string_data,
    }
    status, payload = k8s_request(
        f"/api/v1/namespaces/{NAMESPACE}/secrets/{name}",
        method="PATCH",
        body=body,
        content_type="application/merge-patch+json",
    )
    if status != 200:
        fail(f"failed to patch secret {name}: HTTP {status} {payload}")
    log(f"updated secret {name}")


def validate_admin_token(token):
    if not token:
        return False
    status, _ = coder_request("/api/v2/users/me", token=token)
    return status == 200


def ensure_session_token():
    status, payload = coder_request("/api/v2/users/first")
    if status == 404:
        create_body = {
            "email": FIRST_USER_EMAIL,
            "username": FIRST_USER_USERNAME,
            "name": FIRST_USER_FULL_NAME,
            "password": FIRST_USER_PASSWORD,
            "trial": False,
        }
        create_status, create_payload = coder_request(
            "/api/v2/users/first", method="POST", body=create_body
        )
        if create_status not in (200, 201):
            fail(
                "failed to create first Coder user: "
                f"HTTP {create_status} {create_payload}"
            )
        log("created first Coder user")
    elif status != 200:
        fail(f"unexpected HTTP {status} from /api/v2/users/first: {payload}")

    login_body = {"email": FIRST_USER_EMAIL, "password": FIRST_USER_PASSWORD}
    login_status, login_payload = coder_request(
        "/api/v2/users/login", method="POST", body=login_body
    )
    if login_status not in (200, 201):
        fail(f"failed to log in to Coder: HTTP {login_status} {login_payload}")
    session_token = login_payload.get("session_token")
    if not session_token:
        fail("Coder login did not return a session_token")
    log("logged in to Coder as bootstrap admin")
    return session_token


def ensure_admin_token():
    existing_secret = get_secret_data(ONBOARDING_ADMIN_SECRET_NAME)
    if existing_secret:
        existing_token = existing_secret.get("token", "")
        if validate_admin_token(existing_token):
            log(f"reusing valid token from secret {ONBOARDING_ADMIN_SECRET_NAME}")
            return existing_token

    session_token = ensure_session_token()
    body = {
        "token_name": CODER_TOKEN_NAME,
        "scope": "all",
        "lifetime": CODER_TOKEN_LIFETIME_NS,
    }
    status, payload = coder_request(
        "/api/v2/users/me/keys/tokens",
        method="POST",
        token=session_token,
        body=body,
    )
    if status not in (200, 201):
        fail(f"failed to mint admin token: HTTP {status} {payload}")
    admin_token = payload.get("key")
    if not admin_token:
        fail("Coder token API did not return key")
    apply_secret(ONBOARDING_ADMIN_SECRET_NAME, {"token": admin_token})
    return admin_token


def download_coder_cli():
    machine = platform.machine().lower()
    if machine in ("x86_64", "amd64"):
        arch = "amd64"
    elif machine in ("aarch64", "arm64"):
        arch = "arm64"
    else:
        fail(f"unsupported machine architecture for coder CLI download: {machine}")

    download_url = (
        "https://github.com/coder/coder/releases/download/"
        f"v{CODER_CLI_VERSION}/coder_{CODER_CLI_VERSION}_linux_{arch}.tar.gz"
    )
    workdir = tempfile.mkdtemp(prefix="coder-cli-")
    archive_path = os.path.join(workdir, "coder.tar.gz")

    log(f"downloading coder CLI from {download_url}")
    with urllib.request.urlopen(download_url) as response, open(
        archive_path, "wb"
    ) as archive_file:
        archive_file.write(response.read())

    with tarfile.open(archive_path, "r:gz") as archive:
        archive.extractall(workdir)

    for root, _, files in os.walk(workdir):
        if "coder" in files:
            binary_path = os.path.join(root, "coder")
            os.chmod(binary_path, 0o755)
            return binary_path

    fail("failed to locate coder binary after download")


def run_coder_cli(coder_binary, admin_token, *args):
    environment = os.environ.copy()
    environment["CODER_URL"] = CODER_URL
    environment["CODER_SESSION_TOKEN"] = admin_token
    environment["CODER_USE_KEYRING"] = "false"
    if CODER_ORGANIZATION:
        environment["CODER_ORGANIZATION"] = CODER_ORGANIZATION

    result = subprocess.run(
        [coder_binary, *args],
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        fail(
            "coder CLI failed: "
            f"{' '.join(args)}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    return result.stdout


def push_template(coder_binary, admin_token, template_dir):
    version_name = f"v-{int(time.time())}"
    cli_args = [
        "templates",
        "push",
        CODER_TEMPLATE_NAME,
        "--directory",
        template_dir,
        "--name",
        version_name,
        "--yes",
    ]

    for key, value in TEMPLATE_VARIABLES.items():
        if value != "":
            cli_args.extend(["--variable", f"{key}={value}"])

    run_coder_cli(coder_binary, admin_token, *cli_args)
    log(f"pushed template {CODER_TEMPLATE_NAME} as {version_name}")


def sync_template_secret(coder_binary, admin_token):
    raw = run_coder_cli(
        coder_binary, admin_token, "templates", "list", "--output", "json"
    )
    payload = json.loads(raw)
    template_id = ""
    for entry in payload:
        template = entry.get("Template", entry)
        if template.get("name") == CODER_TEMPLATE_NAME:
            template_id = template.get("id", "")
            break

    if not template_id:
        fail(f"template id not found for {CODER_TEMPLATE_NAME}")

    apply_secret(ONBOARDING_TEMPLATE_SECRET_NAME, {"template-id": template_id})


def verify_template_dir():
    required_files = [
        os.path.join(CODER_TEMPLATE_DIR, "main.tf"),
        os.path.join(CODER_TEMPLATE_DIR, "README.md"),
        os.path.join(CODER_TEMPLATE_DIR, "files", "workspace-startup.sh.tftpl"),
    ]
    missing = [path for path in required_files if not os.path.exists(path)]
    if missing:
        fail(f"missing mounted template files: {', '.join(missing)}")


def stage_template_dir():
    staged_dir = tempfile.mkdtemp(prefix="coder-template-")
    required_relative_files = [
        "main.tf",
        "README.md",
        os.path.join("files", "workspace-startup.sh.tftpl"),
    ]

    for rel_path in required_relative_files:
        source = os.path.join(CODER_TEMPLATE_DIR, rel_path)
        destination = os.path.join(staged_dir, rel_path)
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        shutil.copyfile(source, destination, follow_symlinks=True)

    log(f"staged template files into {staged_dir}")
    for root, _, files in os.walk(staged_dir):
        for filename in files:
            path = os.path.join(root, filename)
            rel_path = os.path.relpath(path, staged_dir)
            log(f"staged file {rel_path} ({os.path.getsize(path)} bytes)")
    return staged_dir


def main():
    log("waiting for Coder health endpoint")
    wait_for_coder()
    log("verifying mounted template files")
    verify_template_dir()
    log("staging template files from ConfigMap mount")
    staged_template_dir = stage_template_dir()
    log("ensuring bootstrap admin token")
    admin_token = ensure_admin_token()
    log("downloading coder CLI")
    coder_binary = download_coder_cli()
    log("pushing workspace template")
    push_template(coder_binary, admin_token, staged_template_dir)
    log("syncing template id secret")
    sync_template_secret(coder_binary, admin_token)
    log("bootstrap completed successfully")


if __name__ == "__main__":
    main()
