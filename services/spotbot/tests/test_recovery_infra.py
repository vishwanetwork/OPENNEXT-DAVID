"""Validate deployment boundaries and compatibility with runtime queue checks."""

import json
import re
from pathlib import Path

from spotbot.rental_readiness import EVENT_TYPES, queue_rules
from tests.test_rental_readiness import queue_attributes

TEMPLATE = json.loads((Path(__file__).parents[1] / "infra/aws-rental-recovery.json").read_text())


def resolve(value):
    references = {
        "AWS::AccountId": "123456789012",
        "AWS::Region": "us-west-2",
        "AWS::Partition": "aws",
    }
    if isinstance(value, list):
        return [resolve(v) for v in value]
    if not isinstance(value, dict):
        return value
    if "Ref" in value:
        return references[value["Ref"]]
    if "Fn::GetAtt" in value:
        resource, attribute = value["Fn::GetAtt"]
        return {
            "InterruptionRule": "arn:aws:events:us-west-2:123456789012:rule/interruptions",
            "InterruptionQueue": "arn:aws:sqs:us-west-2:123456789012:interruptions",
            "DeadLetterQueue": "arn:aws:sqs:us-west-2:123456789012:interruptions-dlq",
        }[resource]
    if "Fn::Sub" in value:
        return re.sub(r"\$\{([^}]+)\}", lambda m: references[m[1]], value["Fn::Sub"])
    return {k: resolve(v) for k, v in value.items()}


def test_no_instances_network_changes_or_role_creation():
    types = {r["Type"] for r in TEMPLATE["Resources"].values()}
    assert types <= {
        "AWS::SQS::Queue",
        "AWS::SQS::QueuePolicy",
        "AWS::Events::Rule",
        "AWS::IAM::ManagedPolicy",
        "AWS::CloudWatch::Alarm",
    }
    assert TEMPLATE["Parameters"]["ExistingBotRoleName"]["Default"] == ""
    assert TEMPLATE["Parameters"]["AllowCrossRegionCopies"]["Default"] == "false"
    for resource in TEMPLATE["Resources"].values():
        if resource["Type"] == "AWS::IAM::ManagedPolicy":
            assert resource.get("Condition")
            for statement in resource["Properties"]["PolicyDocument"]["Statement"]:
                assert not any(
                    a in {"iam:*", "ec2:*", "ec2:RunInstances", "iam:PassRole"}
                    for a in statement["Action"]
                )
                assert statement["Condition"] if statement["Resource"] == "*" else True


def test_eventbridge_and_dead_letter_delivery_are_account_bound():
    resources = TEMPLATE["Resources"]
    for name in ("InterruptionQueue", "DeadLetterQueue"):
        queue = resources[name]
        assert queue["DeletionPolicy"] == "Retain" and queue["UpdateReplacePolicy"] == "Retain"
        assert queue["Properties"]["SqsManagedSseEnabled"]
    policy = resolve(resources["QueuePolicy"]["Properties"]["PolicyDocument"])
    attributes = queue_attributes()
    attributes["Policy"] = json.dumps(policy)
    assert queue_rules(attributes, "us-west-2", "123456789012") == ["interruptions"]
    pattern = resolve(resources["InterruptionRule"]["Properties"]["EventPattern"])
    assert set(pattern["detail-type"]) == EVENT_TYPES
    assert pattern["account"] == ["123456789012"]
    assert pattern["region"] == ["us-west-2"]
    target = resources["InterruptionRule"]["Properties"]["Targets"][0]
    assert target["DeadLetterConfig"]["Arn"] == {"Fn::GetAtt": ["DeadLetterQueue", "Arn"]}


def test_sqs_statements_target_only_the_queue_receiving_the_policy():
    # SQS rejects multi-resource statements even though IAM syntax accepts them.
    # CloudFormation validate-template cannot catch this service-side constraint.
    for name, queue in (("QueuePolicy", "InterruptionQueue"), ("DeadLetterQueuePolicy", "DeadLetterQueue")):
        properties = TEMPLATE["Resources"][name]["Properties"]
        assert properties["Queues"] == [{"Ref": queue}]
        for statement in properties["PolicyDocument"]["Statement"]:
            assert statement["Resource"] == {"Fn::GetAtt": [queue, "Arn"]}
        delivery = properties["PolicyDocument"]["Statement"][0]
        assert delivery["Condition"]["StringEquals"]["aws:SourceAccount"] == {"Ref": "AWS::AccountId"}
        assert delivery["Condition"]["ArnEquals"]["aws:SourceArn"] == {"Fn::GetAtt": ["InterruptionRule", "Arn"]}


def test_cleanup_and_creation_have_distinct_ownership_conditions():
    statements = TEMPLATE["Resources"]["RecoveryPolicy"]["Properties"]["PolicyDocument"][
        "Statement"
    ]
    by_id = {s["Sid"]: s for s in statements}
    for name in ("DeleteOwnedVolumes", "DeleteOwnedImages", "DeleteOwnedSnapshots"):
        assert by_id[name]["Condition"]["StringEquals"]["aws:ResourceTag/spotbot-managed"] == "true"
        assert by_id[name]["Condition"]["Null"]["aws:ResourceTag/spotbot-rental"] == "false"
    for name in ("CreateTaggedSnapshots", "RegisterTaggedImage"):
        assert by_id[name]["Condition"]["StringEquals"]["aws:RequestTag/spotbot-managed"] == "true"
        assert by_id[name]["Condition"]["Null"]["aws:RequestTag/spotbot-backup"] == "false"
    assert (
        "ec2:CreateAction" in by_id["TagRecoveryResourcesAtCreation"]["Condition"]["StringEquals"]
    )


def test_permissions_are_managed_policies_within_size_limits():
    import json

    # Inline policies share one 10,240-byte budget per role; three Regions would not fit.
    for name in ("RecoveryPolicy", "CopyPolicy", "KmsPolicy"):
        resource = TEMPLATE["Resources"][name]
        assert resource["Type"] == "AWS::IAM::ManagedPolicy"
        assert resource["Properties"]["ManagedPolicyName"]["Fn::Sub"].startswith("${AWS::StackName}-")
        document = json.dumps(resource["Properties"]["PolicyDocument"], separators=(",", ":"))
        assert len(document) < 6144

