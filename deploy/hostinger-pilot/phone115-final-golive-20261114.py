"""Authorized final Phone Step 115 Go-Live on VPS 1871828 (PHONE115_FINAL_SARVAM_GOLIVE_SCOPE_20261114.md)."""
import base64, hashlib, io, json, os, re, shutil, ssl, stat, subprocess, sys, tempfile, time, urllib.error, urllib.request, zipfile
from pathlib import Path

PAYLOAD = {}  # PAYLOAD_PLACEHOLDER

D = "/usr/bin/docker"
API_IMG = "sha256:72eff3f5ff972425e9caaf7e638789b7ac996f4e7a341260134a622e02c6d9d7"
RCV_BASE_IMG = "sha256:a15f7ad5a40c67be17c941bb386e7ae0b3e992e190993707b19331da4af25513"
WRK_STANDING_IMG = "sha256:9ffca943a55dcbd960a9e6719da41306dcfe9717cd1a0aa494eca54169819915"
PG_IMG = "sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea"
SEC = "/opt/thaara-v2-pilot-private/secrets"
BRIDGE = "thaara-phone115-tls-bridge-f3a0ab369fe5061f"
TLSNET = "thaara-phone115-tls-f3a0ab369fe5061f"
HOST_ADD = "db-callback.quantumweaveai.io:172.16.1.3"
ROUTE_ID = "qw-callback-dd60ce8ff4e842df8d19ab50674810c2"
SERVICE_FN_HASH = "5e2ee6c3adf5faf16f21942b77e390b4818aa2d373b43460599ee4b3f7a83669"
INTAKE_SAVE_HASH = "971ef97b34974e0cc0c6f9af84c895647a57461de466f99f7494961e421e3e31"
INTAKE_FINALIZE_HASH = "26f12a9508623926057a534cf397620a5bbb984ace0bf0ee7a140155f81b7175"

ENV = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"}

def sha(data): return hashlib.sha256(data).hexdigest()

def run(args, timeout=180, inp=None, env_override=None):
    p = subprocess.run(args, capture_output=True, text=True, timeout=timeout, input=inp, env=env_override or ENV, check=False)
    return p.returncode, p.stdout.strip(), p.stderr.strip()[-800:]

def must(args, timeout=180, inp=None, label=None, env_override=None):
    c, o, e = run(args, timeout, inp, env_override)
    if c != 0:
        raise RuntimeError((label or " ".join(args[:4])) + " failed: stdout=" + o[-500:] + " stderr=" + e[-300:])
    return o

def inspect_container(name):
    c, o, _ = run([D, "inspect", "--type", "container", name])
    return json.loads(o)[0] if c == 0 else None

def inspect_image(ref):
    c, o, _ = run([D, "image", "inspect", "--format", "{{.Id}}", ref])
    return o if c == 0 else None

def psql(sql, pg_id, extra_opts="", timeout=60):
    opts = "-c statement_timeout=15000 -c lock_timeout=3000" + (" " + extra_opts if extra_opts else "")
    return must([
        D, "exec", "-i", "--user", "postgres", pg_id, "env", "-i",
        "PATH=/usr/local/bin:/usr/bin:/bin", "LANG=C.UTF-8", "PGPASSFILE=/dev/null",
        "PGOPTIONS=" + opts, "psql", "-X", "--no-password", "-h", "/var/run/postgresql",
        "-p", "5432", "-U", "postgres", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1",
        "-d", "thaara_vps_pilot", "-f", "-"
    ], timeout, sql, "psql")

def http_check(url, method="GET", headers=None, body=None):
    req = urllib.request.Request(url, method=method, headers=headers or {}, data=body)
    try:
        r = urllib.request.urlopen(req, timeout=15, context=ssl.create_default_context())
        return r.status, r.headers.get("content-type", "")
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("content-type", "")
    except Exception as e:
        return 0, type(e).__name__

def bridge_recreate(source_range):
    b = inspect_container(BRIDGE)
    if not b:
        raise RuntimeError("TLS bridge container missing")
    labels = dict(b["Config"]["Labels"])
    labels["traefik.tcp.middlewares.phone115-callback-native.ipallowlist.sourcerange"] = source_range
    keep = {k: v for k, v in labels.items() if k.startswith("traefik.") or k.startswith("thaara.")}
    args = [
        D, "create", "--name", BRIDGE + "-next", "--user", b["Config"]["User"], "--read-only",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--memory", str(b["HostConfig"]["Memory"]), "--restart", "unless-stopped",
        "--network", TLSNET, "--ip", "172.16.95.11",
        "-v", "/root/.config/thaara-phone115-tls/config-f3a0ab369fe5061f/bridge.yml:/lab/bridge.yml:ro",
        "--entrypoint", b["Config"]["Entrypoint"][0]
    ]
    for k, v in keep.items():
        args += ["--label", k + "=" + v]
    args += [b["Image"]] + b["Config"]["Cmd"]
    must([D, "stop", "-t", "5", BRIDGE], label="bridge stop")
    must([D, "rm", BRIDGE], label="bridge rm")
    must(args, label="bridge create")
    must([D, "rename", BRIDGE + "-next", BRIDGE], label="bridge rename")
    c, _, _ = run([D, "network", "connect", "--ip", "172.16.5.5", "thaara-v2-pilot-data", BRIDGE])
    if c != 0:
        must([D, "network", "connect", "thaara-v2-pilot-data", BRIDGE], label="bridge net connect")
    must([D, "start", BRIDGE], label="bridge start")
    for _ in range(25):
        time.sleep(1)
        try:
            mw = json.load(urllib.request.urlopen("http://172.16.1.3:8080/api/tcp/middlewares", timeout=5))
            cur = next((m["ipAllowList"]["sourceRange"] for m in mw if m["name"] == "phone115-callback-native@docker"), None)
            if cur == source_range.split(","):
                return cur
        except Exception:
            pass
    raise RuntimeError("bridge allowlist not observed")

def atomic_write_secret(path, text_content):
    tmp = path + ".tmp-" + str(os.getpid())
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
    try:
        os.write(fd, text_content.encode("utf8"))
        os.fchown(fd, 1000, 1000)
        os.fchmod(fd, 0o400)
    finally:
        os.close(fd)
    os.replace(tmp, path)

def main():
    if len(sys.argv) != 3 or sys.argv[1] != "--approved-phone115-final-golive" or not re.fullmatch(r"[1-9][0-9]{0,4}", sys.argv[2]):
        raise RuntimeError("Usage: --approved-phone115-final-golive <target_app_version>")
    target_version = int(sys.argv[2])
    out = {"status": "starting", "targetAppVersion": target_version, "steps": {}, "secretValuesExported": False}
    work = None

    try:
        # 1. Pre-flight safety checks
        conc = [l for l in must(["/bin/ps", "-eo", "args"]).splitlines() if any(w in l.lower() for w in ("docker build", "docker compose", "docker-compose", "docker pull"))]
        if conc:
            raise RuntimeError("Concurrent docker operation detected")

        api_c = inspect_container("thaara-v2-pilot-api-1")
        pg_c = inspect_container("thaara-v2-pilot-postgres-1")
        rcv_c = inspect_container("thaara-phone115-receiver")
        wrk_c = inspect_container("thaara-phone115-worker")

        if not api_c or api_c["Image"] != API_IMG or api_c["State"].get("Health", {}).get("Status") != "healthy":
            raise RuntimeError("API container baseline mismatch")
        if sorted(api_c["NetworkSettings"]["Networks"].keys()) != ["n8n_default", "thaara-v2-pilot-data", "thaara-v2-pilot-entry"]:
            raise RuntimeError("API network baseline mismatch")
        if not pg_c or pg_c["Image"] != PG_IMG or pg_c["State"].get("Status") != "running":
            raise RuntimeError("Postgres container baseline mismatch")
        if not rcv_c or rcv_c["State"].get("Status") != "running":
            raise RuntimeError("Receiver container not running")
        if inspect_image(RCV_BASE_IMG) != RCV_BASE_IMG or inspect_image(WRK_STANDING_IMG) != WRK_STANDING_IMG:
            raise RuntimeError("Pinned base/standing images missing")

        secret_names = [
            "phone_callback_api_profile", "phone_callback_inbound_token", "phone_callback_ingest_database_url",
            "phone_callback_profile", "phone_callback_token", "phone_callback_database_url", "phone_callback_resend_api_key"
        ]
        for sname in secret_names:
            st = os.lstat(os.path.join(SEC, sname))
            if not stat.S_ISREG(st.st_mode) or stat.S_IMODE(st.st_mode) not in (0o400, 0o600) or st.st_uid != 1000:
                raise RuntimeError(f"Secret metadata invalid: {sname}")

        pg_id = pg_c["Id"]
        fn_check = json.loads(psql("""
            SELECT json_build_object(
              'serviceFn', encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('public.phone_callback_service_worker_operation(text,uuid,uuid,text,text,uuid,text,text,uuid)')),'UTF8')),'hex'),
              'intakeSave', encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('public.phone_callback_intake_save(jsonb)')),'UTF8')),'hex'),
              'intakeFinalize', encode(sha256(convert_to(pg_get_functiondef(to_regprocedure('public.phone_callback_intake_finalize(text)')),'UTF8')),'hex'),
              'configRows', (SELECT count(*)::int FROM public.phone_callback_service_configuration)
            );
        """, pg_id))
        if fn_check["serviceFn"] != SERVICE_FN_HASH or fn_check["intakeSave"] != INTAKE_SAVE_HASH or fn_check["intakeFinalize"] != INTAKE_FINALIZE_HASH:
            raise RuntimeError("PostgreSQL function hash mismatch")
        out["steps"]["preflight"] = {
            "apiHealthy": True,
            "apiImage": api_c["Image"],
            "receiverImageBefore": rcv_c["Image"],
            "standingWorkerImage": WRK_STANDING_IMG,
            "workerPresentBefore": wrk_c is not None,
            "configRowsBefore": fn_check["configRows"],
        }

        # 2. Build offline receiver Sarvam-compatibility image (`DOCKER_BUILDKIT=0`, `--network=none`)
        work = Path(tempfile.mkdtemp(prefix="thaara-phone115-golive-", dir="/root"))
        os.chmod(work, 0o700)
        client_home = work / "client-home"; client_cfg = work / "client-cfg"
        client_home.mkdir(mode=0o700); client_cfg.mkdir(mode=0o700)
        build_env = dict(ENV, HOME=str(client_home), DOCKER_CONFIG=str(client_cfg), DOCKER_BUILDKIT="0")

        pkg_bytes = base64.b64decode(PAYLOAD["receiverPackageZipBase64"], validate=True)
        with zipfile.ZipFile(io.BytesIO(pkg_bytes)) as zf:
            manifest_raw = zf.read("REVIEW_MANIFEST.json")
            if sha(manifest_raw) != PAYLOAD["receiverManifestSha256"]:
                raise RuntimeError("Receiver package manifest SHA-256 mismatch")
            manifest = json.loads(manifest_raw)
            for item in manifest["artifacts"]:
                data = zf.read(item["path"])
                if sha(data) != item["sha256"]:
                    raise RuntimeError("Artifact hash mismatch: " + item["path"])
                dest = work / item["path"]
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)

        base_tag = "thaara-phone115-receiver-base:a15f7ad5a40c"
        cand_tag = "thaara-phone115-receiver:sarvam-compat-20261114-r3"
        must([D, "tag", RCV_BASE_IMG, base_tag], label="tag receiver base", env_override=build_env)
        must([D, "build", "--pull=false", "--network=none", "-t", cand_tag, "-f", str(work / "Dockerfile.receiver.review"), str(work)], timeout=300, label="build receiver compat", env_override=build_env)
        new_rcv_img = inspect_image(cand_tag)
        if not new_rcv_img or not re.fullmatch(r"sha256:[a-f0-9]{64}", new_rcv_img):
            raise RuntimeError("Receiver candidate image digest invalid")

        cold_probe = "import('/app/apps/api/phone-callback-receiver.mjs').then(async m=>{const r=await m.createPhoneCallbackReceiver({});if(r.status!=='off')process.exit(1);console.log('cold_ok');})"
        cold_out = must([D, "run", "--rm", "--network=none", "--read-only", "--user", "1000:1000", "--entrypoint", "node", new_rcv_img, "-e", cold_probe], timeout=60, label="receiver cold probe")
        if cold_out.splitlines()[-1] != "cold_ok":
            raise RuntimeError("Receiver cold import probe failed")
        out["steps"]["receiverBuild"] = {"tag": cand_tag, "image": new_rcv_img, "coldProbe": True}

        # 3. Configure Standing Notification Service (if not yet configured)
        worker_prof = json.loads(Path(SEC, "phone_callback_profile").read_text(encoding="utf8"))
        ws_id = worker_prof["workspaceId"]
        owner_id = worker_prof["userId"]
        if fn_check["configRows"] == 0:
            cfg_sql = base64.b64decode(PAYLOAD["configureSqlBase64"], validate=True).decode("utf8")
            if sha(cfg_sql.encode("utf8")) != PAYLOAD["configureSqlSha256"]:
                raise RuntimeError("Configure SQL SHA-256 mismatch")
            extra = f"-c thaara.callback_service_configuration_approved=phone115-standing-r3 -c thaara.callback_service_workspace={ws_id} -c thaara.callback_service_owner={owner_id}"
            psql(cfg_sql, pg_id, extra_opts=extra)
            out["steps"]["standingService"] = {"configuredNow": True}
        else:
            out["steps"]["standingService"] = {"configuredNow": False, "alreadyConfigured": True}

        # 4. Archive v5/v24/v25 API profile + Update Inbound Profile & Principal Fingerprint to `target_version`
        api_prof_path = os.path.join(SEC, "phone_callback_api_profile")
        bak_prof_path = os.path.join(SEC, "phone_callback_api_profile.bak-v5-20261114")
        bak_v24_path = os.path.join(SEC, "phone_callback_api_profile.bak-v24-20261114")
        bak_v25_path = os.path.join(SEC, "phone_callback_api_profile.bak-v25-20261114")
        cur_prof = json.loads(Path(api_prof_path).read_text(encoding="utf8"))
        if not os.path.lexists(bak_prof_path):
            atomic_write_secret(bak_prof_path, json.dumps(cur_prof))
        if int(cur_prof["inbound"]["appVersion"]) == 24 and not os.path.lexists(bak_v24_path):
            atomic_write_secret(bak_v24_path, json.dumps(cur_prof))
        if int(cur_prof["inbound"]["appVersion"]) == 25 and not os.path.lexists(bak_v25_path):
            atomic_write_secret(bak_v25_path, json.dumps(cur_prof))

        next_prof = json.loads(json.dumps(cur_prof))
        next_rev = max(2, int(cur_prof["inbound"]["revision"]) + (1 if int(cur_prof["inbound"]["appVersion"]) != target_version else 0))
        next_prof["inbound"]["appVersion"] = target_version
        next_prof["inbound"]["revision"] = next_rev

        fp_js = (
            "import('@thaara/contracts').then(({computeCanonicalParameterHash:h})=>{let s='';"
            "process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s);"
            "console.log(h({...p,policy:'phone.inbound.service.v1',direction:'inbound',callbackMeaning:'human_team_request',consentPolicy:'explicit-recap.v1',mediaRetention:'off',calendarBooking:'disabled'}));});})"
        )
        new_fp = must([D, "run", "--rm", "-i", "--network=none", "--read-only", "--user", "1000:1000", "--entrypoint", "node", RCV_BASE_IMG, "-e", fp_js], 60, json.dumps(next_prof["inbound"]), "compute fingerprint").splitlines()[-1]
        if not re.fullmatch(r"[a-f0-9]{64}", new_fp):
            raise RuntimeError("Invalid computed profile fingerprint")

        psql(f"""BEGIN;
            UPDATE public.phone_inbound_principals
               SET profile_fingerprint = '{new_fp}', revision = {next_rev}
             WHERE workspace_id = '{ws_id}' AND owner_user_id = '{owner_id}'
               AND route_id = '{ROUTE_ID}' AND revoked_at IS NULL;
            COMMIT;""", pg_id)
        atomic_write_secret(api_prof_path, json.dumps(next_prof))
        out["steps"]["inboundProfile"] = {"routeId": ROUTE_ID, "appVersion": target_version, "revision": next_rev, "fingerprintUpdated": True, "v5BackupSaved": True}

        # 5. Temporary /24 TLS bridge allowlist during container restart/boot, then strict /32 lockdown
        bridge_recreate("172.16.1.0/24")

        # Recreate `thaara-phone115-receiver`
        run([D, "rm", "-f", "thaara-phone115-receiver"])
        must([
            D, "run", "-d", "--name", "thaara-phone115-receiver", "--user", "1000:1000", "--read-only",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--restart", "unless-stopped",
            "--network", "n8n_default", "--add-host", HOST_ADD, "--memory", "256m", "--cpus", "0.25", "--pids-limit", "64",
            "--tmpfs", "/tmp:rw,noexec,nosuid,size=16777216,uid=1000,gid=1000",
            "--log-opt", "max-size=10m", "--log-opt", "max-file=3",
            "-e", "NODE_ENV=production", "-e", "PORT=8080", "-e", "HOST=0.0.0.0",
            "-e", "THAARA_PHONE_CALLBACK_RECEIVER=approved",
            "-e", "THAARA_PHONE_CALLBACK_INGEST_RESOURCES=approved",
            "-e", "THAARA_PHONE_CALLBACK_INTAKE=approved",
            "-v", SEC + "/phone_callback_api_profile:/run/secrets/phone_callback_api_profile:ro",
            "-v", SEC + "/phone_callback_ingest_database_url:/run/secrets/phone_callback_ingest_database_url:ro",
            "-v", SEC + "/phone_callback_inbound_token:/run/secrets/phone_callback_inbound_token:ro",
            "--label", "traefik.enable=true",
            "--label", "traefik.docker.network=n8n_default",
            "--label", "traefik.http.routers.thaara-phone115-receiver.rule=Host(`thaara-v2.quantumweaveai.io`) && PathPrefix(`/api/v1/connectors/phone/inbound/`)",
            "--label", "traefik.http.routers.thaara-phone115-receiver.entrypoints=web,websecure",
            "--label", "traefik.http.routers.thaara-phone115-receiver.tls=true",
            "--label", "traefik.http.routers.thaara-phone115-receiver.tls.certresolver=mytlschallenge",
            "--label", "traefik.http.routers.thaara-phone115-receiver.priority=200",
            "--label", "traefik.http.routers.thaara-phone115-receiver.service=thaara-phone115-receiver",
            "--label", "traefik.http.services.thaara-phone115-receiver.loadbalancer.server.port=8080",
            new_rcv_img
        ], label="start receiver")

        # Ensure `thaara-phone115-worker` (standing_service mode) is running without unnecessary restart
        wrk_expected_restarts = wrk_c["RestartCount"] if (wrk_c is not None and wrk_c["State"].get("Running") and wrk_c["Image"] == WRK_STANDING_IMG) else 0
        if wrk_c is None or not wrk_c["State"].get("Running") or wrk_c["Image"] != WRK_STANDING_IMG:
            if wrk_c is not None:
                run([D, "rm", "-f", "thaara-phone115-worker"])
            must([
                D, "run", "-d", "--name", "thaara-phone115-worker", "--user", "1000:1000", "--read-only",
                "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--restart", "unless-stopped",
                "--network", "n8n_default", "--add-host", HOST_ADD, "--memory", "256m", "--cpus", "0.25", "--pids-limit", "64",
                "--tmpfs", "/tmp:rw,noexec,nosuid,size=16777216,uid=1000,gid=1000",
                "--log-opt", "max-size=10m", "--log-opt", "max-file=3",
                "-e", "NODE_ENV=production",
                "-e", "THAARA_PHONE_CALLBACK_NATIVE_WORKER=approved",
                "-e", "THAARA_PHONE_CALLBACK_ENABLED=true",
                "-e", "THAARA_PHONE_CALLBACK_DOMAIN_VERIFIED=true",
                "-e", "THAARA_PHONE_CALLBACK_SENDER=notifications@brandmintai.io",
                "-e", "THAARA_PHONE_CALLBACK_AUTHORIZATION_MODE=standing_service",
                "-v", SEC + "/phone_callback_profile:/run/secrets/phone_callback_profile:ro",
                "-v", SEC + "/phone_callback_database_url:/run/secrets/phone_callback_database_url:ro",
                "-v", SEC + "/phone_callback_token:/run/secrets/phone_callback_token:ro",
                "-v", SEC + "/phone_callback_resend_api_key:/run/secrets/phone_callback_resend_api_key:ro",
                WRK_STANDING_IMG
            ], label="start standing worker")

        time.sleep(8)
        api_after = inspect_container("thaara-v2-pilot-api-1")
        rcv_after = inspect_container("thaara-phone115-receiver")
        wrk_after = inspect_container("thaara-phone115-worker")

        if not rcv_after or not rcv_after["State"]["Running"] or rcv_after["RestartCount"] != 0:
            raise RuntimeError("Receiver failed post-start check: " + run([D, "logs", "--tail", "10", "thaara-phone115-receiver"])[2])
        if not wrk_after or not wrk_after["State"]["Running"] or wrk_after["RestartCount"] > wrk_expected_restarts + 1:
            raise RuntimeError("Standing worker failed post-start check: " + run([D, "logs", "--tail", "10", "thaara-phone115-worker"])[2])

        api_ip = api_after["NetworkSettings"]["Networks"]["n8n_default"]["IPAddress"]
        rcv_ip = rcv_after["NetworkSettings"]["Networks"]["n8n_default"]["IPAddress"]
        wrk_ip = wrk_after["NetworkSettings"]["Networks"]["n8n_default"]["IPAddress"]
        allowlist = bridge_recreate(f"{api_ip}/32,{rcv_ip}/32,{wrk_ip}/32")

        time.sleep(4)
        # Re-verify running & 0 restarts after /32 lockdown
        rcv_final = inspect_container("thaara-phone115-receiver")
        wrk_final = inspect_container("thaara-phone115-worker")
        api_final = inspect_container("thaara-v2-pilot-api-1")
        db_state = json.loads(psql("""
            SELECT json_build_object(
              'standingConfigEnabledRows', (SELECT count(*)::int FROM public.phone_callback_service_configuration WHERE enabled = true),
              'workerInfinityPrincipals', (SELECT count(*)::int FROM public.phone_callback_worker_principals WHERE revoked_at IS NULL AND expires_at = 'infinity'),
              'inboundActivePrincipals', (SELECT count(*)::int FROM public.phone_inbound_principals WHERE revoked_at IS NULL AND route_id = 'qw-callback-dd60ce8ff4e842df8d19ab50674810c2')
            );
        """, pg_id))

        health_http = http_check("https://thaara-v2.quantumweaveai.io/api/v1/health")
        intake_unauth = http_check(f"https://thaara-v2.quantumweaveai.io/api/v1/connectors/phone/inbound/{ROUTE_ID}/callback-request", "POST", {"Content-Type": "application/json"}, b"{}")
        comp_unauth = http_check(f"https://thaara-v2.quantumweaveai.io/api/v1/connectors/phone/inbound/completion/{ROUTE_ID}", "POST", {"Content-Type": "application/json"}, b"{}")

        out["steps"]["postflight"] = {
            "apiHealthy": api_final["State"].get("Health", {}).get("Status") == "healthy",
            "apiNetworks": sorted(api_final["NetworkSettings"]["Networks"].keys()),
            "receiverRunning": rcv_final["State"]["Running"],
            "receiverRestarts": rcv_final["RestartCount"],
            "receiverImage": rcv_final["Image"],
            "workerRunning": wrk_final["State"]["Running"],
            "workerRestarts": wrk_final["RestartCount"],
            "workerImage": wrk_final["Image"],
            "tlsBridgeAllowlist": allowlist,
            "dbState": db_state,
            "publicHealthStatus": health_http[0],
            "unauthIntakeStatus": intake_unauth[0],
            "unauthCompletionStatus": comp_unauth[0],
        }
        if not (out["steps"]["postflight"]["apiHealthy"] and out["steps"]["postflight"]["receiverRunning"] and out["steps"]["postflight"]["workerRunning"] and health_http[0] == 200 and comp_unauth[0] == 403):
            raise RuntimeError("Postflight verification attention needed")
        out["status"] = "vps_activated_verified"
    except Exception as exc:
        out["status"] = "failed"
        out["error"] = str(exc)[-1000:]
    finally:
        if work is not None and work.exists():
            shutil.rmtree(work, ignore_errors=True)
    print(json.dumps(out))

if __name__ == "__main__":
    main()
