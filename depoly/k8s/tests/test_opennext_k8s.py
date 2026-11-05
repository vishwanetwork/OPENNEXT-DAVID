import configparser
import io
import json
import shutil
import stat
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import opennext_k8s as k8s  # noqa: E402

SHA = "8ebab70" + "0" * 33
OVERLAY = Path(k8s.__file__).parent / "overlays" / "production"


class Render(unittest.TestCase):
    def test_pins_both_images_to_one_commit(self):
        text = "image: ghcr.io/x/opennext-web:RELEASE\nimage: ghcr.io/x/opennext-spotbot:RELEASE\n"
        pinned = k8s.pin_images(text, SHA)
        self.assertEqual(pinned.count(":" + SHA), 2)
        self.assertNotIn("RELEASE", pinned)
        for bad in ("latest", SHA[:12], SHA.upper()):
            with self.assertRaises(k8s.Invalid):
                k8s.pin_images(text, bad)
        with self.assertRaises(k8s.Invalid):
            k8s.pin_images("image: ghcr.io/x/other:RELEASE\n", SHA)

    @unittest.skipUnless(shutil.which("kubectl"), "kubectl renders kustomize overlays")
    def test_production_overlay(self):
        with self.assertRaisesRegex(k8s.Invalid, "REPLACE_WITH_ACM_CERTIFICATE_ARNS"):
            k8s.render(OVERLAY, SHA)
        with self.assertRaisesRegex(k8s.Invalid, "--tag"):
            k8s.render(OVERLAY)
        text = k8s.render(OVERLAY, SHA, allow_placeholders=True)
        self.assertIn(f"ghcr.io/vishwanetwork/opennext-web:{SHA}", text)
        self.assertEqual(text.count(f"ghcr.io/vishwanetwork/opennext-spotbot:{SHA}"), 2)
        # Exactly one writer of each kind, never rolled side by side.
        self.assertEqual(text.count("replicas: 1"), 3)
        self.assertEqual(text.count("type: Recreate"), 3)
        # The services call each other inside the cluster.
        for url in (
            "http://spotbot.opennext.svc:8000",
            "http://spotbot-gateway.opennext.svc:18084",
            "http://spotbot-gateway.opennext.svc:18084/v1/gateway/events",
        ):
            self.assertIn(url, text)
        storage = k8s.render(OVERLAY, kinds=["Namespace", "PersistentVolumeClaim"])
        self.assertEqual(len(k8s.documents(storage)), 2)
        self.assertNotIn("kind: Deployment", storage)


class Env(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.dir)

    def write(self, name, text):
        path = self.dir / name
        path.write_text(text)
        return path

    def test_raw_values_merge_and_runtime_keys_drop(self):
        base = self.write(
            "bot.env",
            "PATH=/usr/bin\nSPOTBOT_MYSQL_URL=mysql+pymysql://old\n"
            "SPOTBOT_AWS_REGIONS='kept,with quotes'\nA=b=c # not a comment\n\n# comment\n",
        )
        override = self.write("override.env", "SPOTBOT_MYSQL_URL=mysql+pymysql://new\n")
        values = k8s.merge_env([base, override], drop=["A"])
        self.assertEqual(
            values,
            {
                "SPOTBOT_MYSQL_URL": "mysql+pymysql://new",
                "SPOTBOT_AWS_REGIONS": "'kept,with quotes'",
            },
        )
        manifest = json.loads(k8s.secret_manifest("spotbot-env", values))
        self.assertEqual(manifest["metadata"], {"name": "spotbot-env", "namespace": "opennext"})
        self.assertEqual(manifest["stringData"]["SPOTBOT_MYSQL_URL"], "mysql+pymysql://new")

    def test_rejects_malformed_lines(self):
        with self.assertRaises(k8s.Invalid):
            k8s.read_env(self.write("bad.env", "export A=1\n"))
        with self.assertRaises(k8s.Invalid):
            k8s.read_env(self.write("bad.env", "no separator\n"))

    def test_secret_is_never_printed_to_a_terminal(self):
        class Terminal(io.StringIO):
            def isatty(self):
                return True

        env = self.write("bot.env", "SECRET=value\n")
        out = Terminal()
        with redirect_stdout(out):
            code = k8s.main(["env-secret", "--name", "x", str(env)])
        self.assertEqual(code, 1)
        self.assertNotIn("value", out.getvalue())


class Aws(unittest.TestCase):
    SOURCE = """[profile spotbot-b300]
role_arn = arn:aws:iam::413287184831:role/SpotOrderBotCrossAccountRole
credential_source = Ec2InstanceMetadata
external_id = example-external-id
region = us-west-2
duration_seconds = 3600
"""

    def convert(self, *args):
        with tempfile.NamedTemporaryFile("w", suffix=".ini") as handle:
            handle.write(self.SOURCE)
            handle.flush()
            parser = configparser.ConfigParser(interpolation=None)
            parser.read_string(k8s.aws_config(handle.name, k8s.DEFAULT_BOT_ROLE, *args))
            return parser

    def test_pod_identity_heads_the_existing_role_chain(self):
        config = self.convert("pod-identity")
        self.assertEqual(
            dict(config["default"]),
            dict(
                role_arn=k8s.DEFAULT_BOT_ROLE,
                role_session_name="spotbot",
                credential_source="EcsContainer",
            ),
        )
        b300 = config["profile spotbot-b300"]
        self.assertEqual(b300["source_profile"], "default")
        self.assertNotIn("credential_source", b300)
        self.assertEqual(b300["external_id"], "example-external-id")

    def test_irsa_uses_the_service_account_token(self):
        config = self.convert("irsa", "arn:aws:iam::111122223333:role/opennext-spotbot")
        self.assertEqual(config["default"]["source_profile"], "pod")
        self.assertEqual(config["profile pod"]["web_identity_token_file"], k8s.IRSA_TOKEN)
        with self.assertRaises(k8s.Invalid):
            self.convert("irsa")

    def test_trust_policy_adds_the_pod_role_once(self):
        current = json.dumps(
            dict(
                Version="2012-10-17",
                Statement=[
                    dict(
                        Effect="Allow",
                        Principal=dict(Service="ec2.amazonaws.com"),
                        Action="sts:AssumeRole",
                    )
                ],
            )
        )
        role = "arn:aws:iam::111122223333:role/opennext-spotbot"
        once = k8s.trust_policy(current, role)
        statements = json.loads(once)["Statement"]
        self.assertEqual(len(statements), 2)
        self.assertEqual(statements[0]["Principal"], {"Service": "ec2.amazonaws.com"})
        self.assertEqual(statements[1]["Principal"], {"AWS": role})
        self.assertEqual(k8s.trust_policy(once, role), once)
        with self.assertRaises(k8s.Invalid):
            k8s.trust_policy(current, "*")


class Mysql(unittest.TestCase):
    def test_private_users_and_urls(self):
        out = Path(tempfile.mkdtemp()) / "private"
        self.addCleanup(shutil.rmtree, out.parent)
        k8s.mysql_setup(out, "db.example.internal")
        self.assertEqual(stat.S_IMODE(out.stat().st_mode), 0o700)
        for name in ("create-users.sql", "bot-override.env", "gateway-override.env"):
            self.assertEqual(stat.S_IMODE((out / name).stat().st_mode), 0o600)
        bot = k8s.read_env(out / "bot-override.env")["SPOTBOT_MYSQL_URL"]
        gateway = k8s.read_env(out / "gateway-override.env")["SPOTBOT_GATEWAY_MYSQL_URL"]
        self.assertRegex(bot, r"^mysql\+pymysql://spotbot:[a-f0-9]{48}@db\.example\.internal:3306/spot_order_bot\?charset=utf8mb4$")
        self.assertIn("@db.example.internal:3306/spot_order_gateway?", gateway)
        sql = (out / "create-users.sql").read_text()
        self.assertIn(bot.split(":")[2].split("@")[0], sql)
        self.assertIn("GRANT ALL PRIVILEGES ON `spot_order_gateway`.* TO 'spotgateway'@'%'", sql)
        with self.assertRaises(k8s.Invalid):
            k8s.mysql_setup(out, "db; DROP")


if __name__ == "__main__":
    unittest.main()
