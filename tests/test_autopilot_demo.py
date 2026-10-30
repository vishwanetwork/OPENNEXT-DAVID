"""Demo scripts run locally without GPUs, network downloads or cloud mutations."""

import json
import os
import subprocess
from pathlib import Path

import pytest

from spotbot.opennext_autopilot import AutopilotRequest

ROOT = Path(__file__).resolve().parents[1] / "examples" / "autopilot_demo"


def environment(tmp_path, **extra):
    return dict(os.environ, HOME=str(tmp_path), DEMO_NAME="test", DEMO_STEPS="20",
                DEMO_STEP_SECONDS="0.01", DEMO_REQUIRE_GPU="0", DEMO_GPU_WORK="0", **extra)


def checkpoint(tmp_path):
    return json.loads((tmp_path / "autopilot-demo/test/checkpoint.json").read_text())


def test_presets_validate_against_the_customer_api():
    presets = json.loads((ROOT / "presets.json").read_text())["presets"]
    for preset in presets.values():
        request = AutopilotRequest(script=(ROOT / "script.sh").read_text(), **preset).task()
        assert request.max_minutes and request.on_failure in {"keep", "end"}


@pytest.mark.parametrize("mode,code,steps,state", [
    ("success", 0, 20, "succeeded"), ("failure", 42, 4, "failed"),
])
def test_demo_success_and_failure(tmp_path, mode, code, steps, state):
    secret = "demo-secret-must-not-be-printed"
    result = subprocess.run(["bash", str(ROOT / "script.sh")],
                            env=environment(tmp_path, DEMO_MODE=mode, DEMO_SECRET=secret),
                            capture_output=True, text=True, timeout=15)
    assert result.returncode == code, result.stderr
    saved = checkpoint(tmp_path)
    assert saved["completed_steps"] == steps and saved["state"] == state
    assert secret not in result.stdout and secret not in json.dumps(saved)
    assert (tmp_path / "autopilot-demo/test/checkpoint.json").stat().st_mode & 0o777 == 0o600


def test_termination_checkpoints_and_replacement_resumes(tmp_path):
    env = environment(tmp_path, SPOTBOT_ATTEMPT="1")
    process = subprocess.Popen(["bash", str(ROOT / "script.sh")], env=env,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        for line in process.stdout:
            entry = json.loads(line)
            if entry["event"] == "progress" and entry["step"] >= 2:
                process.terminate()
                break
        _, error = process.communicate(timeout=10)
        assert process.returncode == 143, error
        first = checkpoint(tmp_path)
        assert first["state"] == "interrupted" and 2 <= first["completed_steps"] < 20
        result = subprocess.run(["bash", str(ROOT / "script.sh")],
                                env=dict(env, SPOTBOT_RESUMED="1", SPOTBOT_ATTEMPT="2"),
                                capture_output=True, text=True, timeout=10)
        assert result.returncode == 0, result.stderr
        events = [json.loads(line) for line in result.stdout.splitlines()]
        loaded = next(e for e in events if e["event"] == "checkpoint_loaded")
        assert loaded["completed_steps"] == first["completed_steps"]
        assert next(e for e in events if e["event"] == "progress")["step"] == first["completed_steps"] + 1
        assert checkpoint(tmp_path)["attempt"] == "2"
        assert checkpoint(tmp_path)["state"] == "succeeded"
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate()
