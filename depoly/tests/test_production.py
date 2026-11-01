"""Deployment contract tests use temporary generated fixtures, never local customer data."""

import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import HERE, Invalid, immutable, initialize, load, render, validate  # noqa: E402
from operations import Deployment, assert_empty_accounts, reject_baked_credentials  # noqa: E402

WEB = "ghcr.io/vishwanetwork/opennext-homepage:" + "a" * 40


class ProductionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.private = self.root / "private"
        self.config = initialize(self.private, "launch.example.org", WEB, self.root / "production")

    def ready(self):
        result = copy.deepcopy(self.config)
        result["smtp"].update(
            host="smtp.example.org",
            operations_to="operations@example.org",
            password='literal$#"smtp',
        )
        result["aws"].update(
            access_key_id="fixture-only-id", secret_access_key="fixture-only-secret"
        )
        return result

    def test_no_test_data_is_read_and_secrets_are_new_and_private(self):
        loaded = load(self.private)
        self.assertEqual(loaded["deployment_id"], self.config["deployment_id"])
        second = initialize(
            self.root / "another", "other.example.org", WEB, self.root / "another-production"
        )
        self.assertFalse(set(second["secrets"].values()) & set(loaded["secrets"].values()))
        self.assertEqual((self.private / "settings.json").stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.private.stat().st_mode & 0o777, 0o700)
        self.assertFalse(Path(self.config["state_root"]).exists())
        with self.assertRaises(Invalid):
            initialize(self.private, "launch.example.org", WEB, self.root / "different")

    def test_production_rejects_test_names_shared_secrets_and_mutable_app_images(self):
        for mutate in (
            lambda c: c["domains"].update(bot="spotbot.test.vishwalab.com"),
            lambda c: c["images"].update(web="ghcr.io/vishwanetwork/opennext-homepage:latest"),
            lambda c: c["secrets"].update(gateway_api=c["secrets"]["bot_api"]),
            lambda c: c["ports"].update(web=c["ports"]["ssh_start"]),
            lambda c: c.update(state_root="/opt/test"),
        ):
            config = copy.deepcopy(self.config)
            mutate(config)
            with self.assertRaises(Invalid):
                validate(config)
        self.assertTrue(immutable(WEB))
        self.assertTrue(immutable("ghcr.io/vishwanetwork/opennext-homepage@sha256:" + "b" * 64))
        self.assertFalse(immutable("local:latest"))

    def test_ready_validation_requires_smtp_and_cloud_settings_and_protects_real_order_switch(self):
        with self.assertRaises(Invalid):
            validate(self.config, ready=True)
        config = self.ready()
        validate(config, ready=True)
        config["procurement"] = dict(live_orders=True, rentals=True)
        with self.assertRaises(Invalid):
            validate(config, ready=True)
        config["aws"]["initial_images"] = {"us-west-2": "ami-1234567890abcdef0"}
        config["aws"]["interruption_queues"] = {
            "us-west-2": "https://sqs.us-west-2.amazonaws.com/123456789012/opennext-production-interruptions"
        }
        validate(config, ready=True)

    def test_render_compartments_credentials_and_storage(self):
        config = self.ready()
        render(config, self.private)
        web = (self.private / "web.env").read_text()
        gateway = (self.private / "gateway.env").read_text()
        bot = (self.private / "bot.env").read_text()
        mysql = (self.private / "mysql.env").read_text()
        self.assertIn('SMTP_PASS=literal$#"smtp', web)
        self.assertNotIn("AWS_ACCESS_KEY_ID=", web + gateway)
        self.assertIn("AWS_ACCESS_KEY_ID=fixture-only-id", bot)
        self.assertNotIn(config["secrets"]["bot_api"], gateway)
        self.assertNotIn(config["secrets"]["mysql_root"], web + gateway + bot)
        self.assertIn(config["secrets"]["mysql_root"], mysql)
        self.assertIn("opennext_prod_adapter", web)
        self.assertIn("opennext_prod_gateway", gateway)
        self.assertIn("opennext_prod_bot", bot)
        self.assertIn("SPOTBOT_DRY_RUN_ENABLED=false", bot)
        self.assertIn("SPOTBOT_LIVE_ORDERS_ENABLED=false", bot)
        self.assertNotIn("skip-kyb", web + gateway + bot)
        nginx = (self.private / "nginx.conf").read_text()
        self.assertNotRegex(nginx, r"@[A-Z_]+@")
        self.assertIn("proxy_set_header X-Forwarded-For $remote_addr;", nginx)
        for path in self.private.iterdir():
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    @unittest.skipUnless(shutil.which("docker"), "Docker Compose CLI is not installed")
    def test_real_compose_renderer_preserves_raw_passwords_and_has_no_database_port(self):
        render(self.ready(), self.private)
        result = subprocess.run(
            [
                "docker",
                "compose",
                "--project-directory",
                str(HERE),
                "--env-file",
                str(self.private / "compose.env"),
                "-f",
                str(HERE / "compose.yaml"),
                "config",
                "--format",
                "json",
            ],
            text=True,
            capture_output=True,
            check=True,
        )
        parsed = json.loads(result.stdout)
        # `compose config` escapes $ for re-readable canonical output; the raw env file is literal.
        self.assertEqual(
            parsed["services"]["web"]["environment"]["SMTP_PASS"].replace("$$", "$"),
            'literal$#"smtp',
        )
        self.assertNotIn("ports", parsed["services"]["mysql"])
        self.assertEqual(parsed["services"]["web"]["environment"]["OPENNEXT_DEMO_ENABLED"], "0")
        self.assertEqual(
            parsed["services"]["web"]["environment"]["SPOTBOT_OPENNEXT_ALLOW_UNSCANNED"], "false"
        )
        for service in ("web", "bot", "gateway"):
            self.assertEqual(parsed["services"][service]["ports"][0]["host_ip"], "127.0.0.1")
        self.assertFalse(parsed["networks"]["control"]["enable_ipv6"])

    @unittest.skipUnless(shutil.which("node"), "Node is not installed")
    def test_bootstrap_creates_only_empty_records_and_refuses_reinitialization(self):
        target = self.root / "empty-web"
        env = {**os.environ, "OPENNEXT_DATA_DIR": str(target)}
        subprocess.run(
            ["node", str(HERE / "bootstrap-empty.cjs"), self.config["deployment_id"]],
            env=env,
            check=True,
            capture_output=True,
        )
        assert_empty_accounts(target)
        auth = json.loads((target / "auth-state.json").read_text())
        self.assertEqual(auth, dict(version=1, users=[], sessions=[]))
        # Exercise the actual read-only legacy services against the generated empty schemas.
        source = """const assert=require('node:assert/strict');
const path=require('node:path');
const {createMarketplaceService}=require(path.join(process.argv[1],'OpenNEXT-marketplace-service.cjs'));
const {createTopupService}=require(path.join(process.argv[1],'OpenNEXT-topup-service.cjs'));
(async()=>{
 const market=await createMarketplaceService({dataDir:process.argv[2]}).publicMarket();
 assert.deepEqual(market.supplies,[]); assert.deepEqual(market.rfqs,[]);
 const account=await createTopupService({dataDir:process.argv[2]}).account({id:'schema-probe',email:'probe@example.org',onboardingCompleted:true,promotionalCredit:0});
 assert.equal(account.availableCredit,0); assert.deepEqual(account.requests,[]);
})().catch(()=>process.exit(1));"""
        subprocess.run(
            ["node", "-e", source, str(HERE.parent / "legacy"), str(target)],
            check=True,
            capture_output=True,
        )
        repeated = subprocess.run(
            ["node", str(HERE / "bootstrap-empty.cjs"), self.config["deployment_id"]],
            env=env,
            capture_output=True,
        )
        self.assertNotEqual(repeated.returncode, 0)
        auth["users"].append({"id": "fixture-account"})
        (target / "auth-state.json").write_text(json.dumps(auth))
        with self.assertRaises(Invalid):
            assert_empty_accounts(target)

    def test_foreign_data_directory_and_stale_image_lock_are_rejected(self):
        state = Path(self.config["state_root"])
        state.mkdir()
        (state / ".production.json").write_text(
            json.dumps(dict(deployment_id="other", phase="active"))
        )
        deployment = Deployment(self.config, self.private)
        with self.assertRaises(Invalid):
            deployment.marker()
        (self.private / "images.lock.json").write_text(
            json.dumps(dict(deployment_id=self.config["deployment_id"], sources={}, digests={}))
        )
        with self.assertRaises(Invalid):
            deployment.locked()

    def test_metadata_probe_has_no_mount_or_credentials_and_does_not_start_a_worker(self):
        deployment = Deployment(self.config, self.private)
        with patch.object(deployment, "compose") as compose:
            deployment.metadata_probe()
        command = compose.call_args.args
        self.assertEqual(command[:4], ("run", "--rm", "--no-deps", "--entrypoint"))
        self.assertEqual(command[4:7], ("python", "gateway", "-c"))
        self.assertIn("ProxyHandler({})", command[7])
        self.assertNotIn("print(response", command[7])

    def test_backup_resumes_the_same_writers_when_database_dump_fails(self):
        Path(self.config["state_root"]).mkdir(mode=0o700)
        deployment = Deployment(self.ready(), self.private)
        calls = []

        def compose(*args, **kwargs):
            calls.append(args)
            if args[0] == "ps":
                return SimpleNamespace(stdout="web\nbot\ngateway\nmysql\n")
            if args[0] == "exec":
                raise subprocess.CalledProcessError(1, ["fixture-dump"])

        with (
            patch.object(deployment, "marker"),
            patch.object(deployment, "configure"),
            patch.object(deployment, "compose", side_effect=compose),
            patch("operations.shutil.which", return_value="/usr/bin/age"),
        ):
            with self.assertRaises(subprocess.CalledProcessError):
                deployment.backup("age1fixture")
        self.assertIn(("stop", "-t", "60", "web", "bot", "gateway"), calls)
        self.assertEqual(calls[-1], ("start", "web", "bot", "gateway"))
        self.assertEqual(list((Path(self.config["state_root"]) / "backups").iterdir()), [])

    def test_image_credential_check_allows_public_signing_keys_but_never_private_env(self):
        reject_baked_credentials(
            {"Env": ["GPG_KEY=public-package-signing-key", "NODE_ENV=production"]}
        )
        for key in [
            "AWS_SECRET_ACCESS_KEY",
            "SPOTBOT_API_KEY",
            "SMTP_PASS",
            "OPENNEXT_AUTH_SESSION_SECRET",
        ]:
            with self.assertRaises(Invalid) as error:
                reject_baked_credentials({"Env": [key + "=fixture-private-value"]})
            self.assertNotIn("fixture-private-value", str(error.exception))

    def test_prepare_refuses_unsupported_hosts_before_touching_storage(self):
        deployment = Deployment(self.ready(), self.private)
        with (
            patch("operations.platform.system", return_value="Darwin"),
            patch.object(deployment, "configure") as configure,
        ):
            with self.assertRaises(Invalid):
                deployment.prepare()
        configure.assert_not_called()
        self.assertFalse(Path(self.config["state_root"]).exists())


if __name__ == "__main__":
    unittest.main()
