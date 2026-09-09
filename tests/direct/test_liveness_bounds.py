"""Liveness probe: can a third party lock a case permanently?

The README calls budget exhaustion recoverable, with "authority budget
restoration as the explicit recovery path". This asks whether that path can run
out, and if it does, whether any route back to a usable case remains.

Epoch advance is the only thing that resets model_calls_this_epoch and
budget_grants_this_epoch. Epoch advance happens only in record_fresh_decision,
which requires AWAITING_FRESH_DECISION, which requires a MATERIAL_DELTA verdict,
which requires a model call. So if model calls can be exhausted past the grant
cap, the reset that would restore them is itself unreachable.
"""
import json

import pytest

BASE = [
    "Invoice #104 exists.",
    "Carrier status says handed to last-mile partner.",
]


def evidence(items):
    return json.dumps(items)


def seed(contract, direct_vm, authority, ref="lock-me"):
    direct_vm.sender = authority
    return contract.seed_rejected_case(
        ref,
        "Rejected because the evidence did not show completed delivery.",
        evidence(BASE),
    )


def test_a_third_party_can_lock_a_case_permanently(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = direct_deploy("contracts/MeaningNonce.py")
    case_id = seed(contract, direct_vm, direct_alice)

    direct_vm.clear_mocks()
    direct_vm.mock_llm(
        r".*anti-verdict-shopping gate.*",
        json.dumps({"decision": "IMMATERIAL_DELTA"}),
    )

    # Charlie is neither the authority nor the legitimate requester. Every
    # submission is a distinct junk item, so each one is a new candidate key and
    # spends a real model call.
    junk = 0

    def burn_three():
        nonlocal junk
        for _ in range(3):
            junk += 1
            direct_vm.sender = direct_charlie
            aid = contract.submit_retry(
                case_id, f"noise {junk}", evidence(BASE + [f"junk item {junk}"])
            )
            assert json.loads(contract.get_attempt(aid))["model_called"] is True

    burn_three()

    # Authority restores the budget as the README says it can -- five times, the
    # documented cap. Charlie burns each restoration immediately.
    for grant in range(5):
        direct_vm.sender = direct_alice
        contract.grant_retry_budget(case_id)
        burn_three()

    case = json.loads(contract.get_case(case_id))
    assert case["budget_grants_this_epoch"] == 5
    assert case["model_calls_this_epoch"] == 3
    assert case["status"] == "LOCKED_REJECTED"

    # 1. No further restoration.
    direct_vm.sender = direct_alice
    with pytest.raises(Exception, match="BUDGET_GRANT_LIMIT_REACHED"):
        contract.grant_retry_budget(case_id)

    # 2. A legitimate requester with genuinely material new evidence is refused
    #    without the model ever being consulted.
    direct_vm.clear_mocks()
    direct_vm.mock_llm(
        r".*anti-verdict-shopping gate.*",
        json.dumps({"decision": "MATERIAL_DELTA"}),
    )
    direct_vm.sender = direct_bob
    aid = contract.submit_retry(
        case_id,
        "The signed proof of delivery has now been obtained.",
        evidence(BASE + ["Signed proof of delivery, countersigned by the recipient."]),
    )
    attempt = json.loads(contract.get_attempt(aid))
    assert attempt["outcome"] == "RETRY_BUDGET_EXHAUSTED"
    assert attempt["model_called"] is False

    # 3. The authority cannot advance the epoch to reset the counters, because
    #    every epoch-advancing path needs a pending MATERIAL attempt it can no
    #    longer obtain.
    direct_vm.sender = direct_alice
    with pytest.raises(Exception, match="NO_FRESH_DECISION_PENDING"):
        contract.record_fresh_decision(
            case_id,
            "REJECTED",
            "Closing this epoch.",
            evidence(BASE),
        )
    with pytest.raises(Exception, match="NO_FRESH_DECISION_PENDING"):
        contract.decline_reopening(case_id, "Closing this epoch.")

    # The case is now permanently unreopenable. No caller, authority included,
    # has any transition left.
    case = json.loads(contract.get_case(case_id))
    assert case["status"] == "LOCKED_REJECTED"
    assert case["epoch"] == 1


def test_one_wide_material_delta_can_brick_the_case(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    """MAX_EVIDENCE_ITEMS is 12, and a retry must carry the whole baseline plus
    at least one addition. So the moment a baseline reaches 12 items, every
    possible future retry is 13 items and dies in canonicalisation before any
    gate runs. That does not take ten epochs -- one accepted-as-material wide
    delta gets there, and the authority is given no warning that recording it
    ends the case's ability to ever reopen again.
    """
    contract = direct_deploy("contracts/MeaningNonce.py")
    direct_vm.sender = direct_alice
    case_id = contract.seed_rejected_case(
        "wide-delta",
        "Rejected because the evidence did not show completed delivery.",
        evidence(BASE),
    )

    direct_vm.clear_mocks()
    direct_vm.mock_llm(
        r".*anti-verdict-shopping gate.*",
        json.dumps({"decision": "MATERIAL_DELTA"}),
    )

    wide = BASE + [f"additional exhibit {i}" for i in range(10)]
    assert len(wide) == 12

    direct_vm.sender = direct_bob
    contract.submit_retry(case_id, "reopen with the full exhibit set", evidence(wide))
    assert json.loads(contract.get_case(case_id))["status"] == "AWAITING_FRESH_DECISION"

    direct_vm.sender = direct_alice
    contract.record_fresh_decision(
        case_id, "REJECTED", "Still rejected on the merits.", evidence(wide)
    )

    case = json.loads(contract.get_case(case_id))
    assert case["status"] == "LOCKED_REJECTED"
    assert case["epoch"] == 2
    assert len(case["baseline_hashes"]) == 12

    # A genuinely decisive new exhibit can never be submitted again.
    direct_vm.sender = direct_bob
    with pytest.raises(Exception, match="TOO_MANY_EVIDENCE_ITEMS"):
        contract.submit_retry(
            case_id,
            "the signed proof of delivery has arrived",
            evidence(wide + ["Signed proof of delivery, countersigned by the recipient."]),
        )

    # And dropping anything to make room is blocked by design.
    direct_vm.sender = direct_bob
    aid = contract.submit_retry(
        case_id,
        "swap one exhibit for the decisive one",
        evidence(wide[:-1] + ["Signed proof of delivery, countersigned by the recipient."]),
    )
    assert json.loads(contract.get_attempt(aid))["outcome"] == "BASELINE_REMOVAL_BLOCKED"
