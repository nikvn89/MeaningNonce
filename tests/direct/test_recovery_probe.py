"""Is the deadlock actually terminal, or is there an existing recovery path?

`_case_id_for(authority, case_ref)` namespaces a case by the authority wallet
plus an opaque reference the authority chooses. Nothing stops the authority
seeding a second reference carrying the same baseline. If that works, a bricked
case is a griefing tax on one reference, not a permanent loss of the decision.
"""
import json
import pytest

BASE = [
    "Invoice #104 exists.",
    "Carrier status says handed to last-mile partner.",
]
REASON = "Rejected because the evidence did not show completed delivery."


def ev(items):
    return json.dumps(items)


def brick(contract, direct_vm, alice, charlie, ref):
    direct_vm.sender = alice
    case_id = contract.seed_rejected_case(ref, REASON, ev(BASE))
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r".*anti-verdict-shopping gate.*",
                       json.dumps({"decision": "IMMATERIAL_DELTA"}))
    n = 0

    def burn():
        nonlocal n
        for _ in range(3):
            n += 1
            direct_vm.sender = charlie
            contract.submit_retry(case_id, f"noise {n}", ev(BASE + [f"junk {n}"]))

    burn()
    for _ in range(5):
        direct_vm.sender = alice
        contract.grant_retry_budget(case_id)
        burn()
    return case_id


def test_authority_can_reseed_under_a_new_reference_after_a_brick(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    contract = direct_deploy("contracts/MeaningNonce.py")
    dead = brick(contract, direct_vm, direct_alice, direct_charlie, "case-104")

    # Confirm it is really dead.
    direct_vm.sender = direct_alice
    with pytest.raises(Exception, match="BUDGET_GRANT_LIMIT_REACHED"):
        contract.grant_retry_budget(dead)

    # The authority re-namespaces the same decision.
    direct_vm.sender = direct_alice
    fresh = contract.seed_rejected_case("case-104-r2", REASON, ev(BASE))
    assert fresh != dead

    case = json.loads(contract.get_case(fresh))
    assert case["status"] == "LOCKED_REJECTED"
    assert case["model_calls_this_epoch"] == 0
    assert case["budget_grants_this_epoch"] == 0
    assert case["baseline_hashes"] == json.loads(contract.get_case(dead))["baseline_hashes"]

    # A legitimate requester works again on the new reference.
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r".*anti-verdict-shopping gate.*",
                       json.dumps({"decision": "MATERIAL_DELTA"}))
    direct_vm.sender = direct_bob
    aid = contract.submit_retry(
        fresh,
        "The signed proof of delivery has now been obtained.",
        ev(BASE + ["Signed proof of delivery, countersigned by the recipient."]),
    )
    attempt = json.loads(contract.get_attempt(aid))
    assert attempt["outcome"] == "MATERIAL_DELTA"
    assert attempt["model_called"] is True
    assert json.loads(contract.get_case(fresh))["status"] == "AWAITING_FRESH_DECISION"


def test_reseeding_does_not_launder_a_closed_acceptance(
    direct_vm, direct_deploy, direct_alice, direct_bob
):
    """Re-namespacing is a recovery path, not a verdict-shopping bypass: it is
    authority-only, and the authority is the party the lock protects."""
    contract = direct_deploy("contracts/MeaningNonce.py")
    direct_vm.sender = direct_alice
    case_id = contract.seed_rejected_case("case-777", REASON, ev(BASE))

    # A requester cannot create a competing namespace for the same decision:
    # any case they seed is namespaced to their own wallet, so they become its
    # authority and are then barred from submitting retries to it at all.
    direct_vm.sender = direct_bob
    self_owned = contract.seed_rejected_case("case-777", REASON, ev(BASE))
    assert self_owned != case_id
    with pytest.raises(Exception, match="AUTHORITY_CANNOT_SUBMIT_RETRY"):
        contract.submit_retry(self_owned, "let me in", ev(BASE + ["something new"]))
