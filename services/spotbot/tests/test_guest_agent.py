"""Guest filesystem freeze: all-or-nothing, root last, unsupported filesystems skipped."""

import pytest

from spotbot import guest_agent


def disks():
    return [
        dict(volume_id="vol-root", device=dict(fstype=None, mountpoints=[None])),
        dict(volume_id="vol-root", device=dict(fstype="ext4", mountpoints=["/"])),
        dict(volume_id="vol-root", device=dict(fstype="vfat", mountpoints=["/boot/efi"])),
        dict(volume_id="vol-data", device=dict(fstype="xfs", mountpoints=["/data/sdf"])),
        dict(volume_id="vol-swap", device=dict(fstype="swap", mountpoints=["[SWAP]"])),
    ]


def test_protected_mounts_freeze_root_last_and_skip_unfreezable(monkeypatch):
    monkeypatch.setattr(guest_agent, "disks", disks)
    assert guest_agent.protected_mounts() == ["/data/sdf", "/"]


def test_partial_freeze_failure_thaws_what_was_frozen(monkeypatch):
    calls = []

    def command(*args, timeout=5):
        calls.append(args[1:])
        if args[1:] == ("--freeze", "/"):
            raise OSError("freeze failed")
        return ""

    monkeypatch.setattr(guest_agent, "command", command)
    with pytest.raises(OSError):
        guest_agent.freeze(["/data/sdf", "/"])
    # Never leave the server half-frozen: the data disk is thawed again.
    assert calls == [("--freeze", "/data/sdf"), ("--freeze", "/"), ("--unfreeze", "/data/sdf")]


def test_successful_freeze_reports_every_mount(monkeypatch):
    calls = []
    monkeypatch.setattr(guest_agent, "command", lambda *a, timeout=5: calls.append(a[1:]) or "")
    assert guest_agent.freeze(["/data/sdf", "/"]) == ["/data/sdf", "/"]
    assert ("--unfreeze", "/") not in calls


def test_frozen_guest_skips_gpu_probe(monkeypatch):
    seen = []
    monkeypatch.setattr(guest_agent, "disks", lambda: [])
    monkeypatch.setattr(guest_agent, "metadata", lambda path: "i-0123" if path == "instance-id" else "{}")
    monkeypatch.setattr(guest_agent, "command", lambda *a, timeout=5: seen.append(a[0]) or "")
    config = dict(rental_id="r", generation=1, token="t")
    guest_agent.collect(config, frozen=True)
    assert "nvidia-smi" not in seen
    guest_agent.collect(config)
    assert "nvidia-smi" in seen
