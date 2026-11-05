import importlib.util
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("adopt", HERE / "adopt.py")
adopt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adopt)


class EnvFileTest(unittest.TestCase):
    def test_reads_plain_quoted_and_exported_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / ".env"
            path.write_text(
                "# comment\n\nA=1\nB='{\"x\": 1}'\nexport C=\"two words\"\nD=\n"
            )
            self.assertEqual(
                adopt.read_env_file(path), {"A": "1", "B": '{"x": 1}', "C": "two words", "D": ""}
            )

    def test_replaces_in_place_and_appends_new_keys_once(self):
        text = "A=1\n# B=old comment\nB=old\nC=3\n"
        out = adopt.updated_env_text(text, {"B": '{"k": "v"}', "E": "5"}, "STAMP")
        self.assertEqual(
            out,
            "A=1\n# B=old comment\nB='{\"k\": \"v\"}'\nC=3\n\n"
            "# Moved here from the compose overlays by adopt.py on STAMP\nE='5'\n",
        )

    def test_refuses_values_it_cannot_quote(self):
        with self.assertRaises(SystemExit):
            adopt.updated_env_text("", {"A": "it's"}, "STAMP")


@unittest.skipUnless(shutil.which("docker"), "docker is not installed")
class ComposeTest(unittest.TestCase):
    """The compose files take every setting from the env files the way adopt.py writes them."""

    def render(self, compose_file, service, env_name, values):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            (home / "aws").mkdir()
            (home / "aws" / "config").write_text("")
            (home / ".env").write_text("")
            (home / ".env.gateway").write_text("")
            (home / env_name).write_text(adopt.updated_env_text("", values, "STAMP"))
            try:
                return adopt.compose_environment(HERE / compose_file, home, service)
            except subprocess.CalledProcessError as error:
                self.fail(error.stderr)

    def test_bot_environment(self):
        accounts = json.dumps({"b300-west": {"account_id": "1", "profile": "p"}})
        env = self.render("compose.bot.yaml", "spotbot", ".env", {"SPOTBOT_AWS_ACCOUNTS": accounts})
        self.assertEqual(env, {"SPOTBOT_AWS_ACCOUNTS": accounts, "AWS_CONFIG_FILE": "/app/aws/config"})

    def test_gateway_environment(self):
        env = self.render(
            "compose.gateway.yaml", "gateway", ".env.gateway",
            {"SPOTBOT_GATEWAY_INFERENCE_READ_TIMEOUT_SECONDS": "600"},
        )
        self.assertEqual(env["SPOTBOT_GATEWAY_INFERENCE_READ_TIMEOUT_SECONDS"], "600")
        self.assertEqual(env["AWS_EC2_METADATA_DISABLED"], "true")
        self.assertEqual(env["AWS_CONFIG_FILE"], "/nonexistent")


if __name__ == "__main__":
    unittest.main()
