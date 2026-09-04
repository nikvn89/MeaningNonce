import json


def evidence(items):
    return json.dumps(items)


def seed(contract, direct_vm, authority):
    direct_vm.sender = authority
    return contract.seed_rejected_case(
        "agent-case-104",
        "The prior request was rejected because the submitted evidence did not show completed delivery.",
        evidence([
            "Invoice #104 exists.",
            "Carrier status says handed to last-mile partner.",
        ]),
    )


def test_exact_replay_and_rewording_skip_model(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/MeaningNonce.py")
    case_id = seed(contract, direct_vm, direct_alice)

    direct_vm.sender = direct_bob
    attempt_id = contract.submit_retry(
        case_id,
        "Please reconsider this immediately — I am asking in a totally different way.",
        evidence([
            "Carrier status says handed to last-mile partner.",
            "Invoice #104 exists.",
            "Invoice #104 exists.",
        ]),
    )
    attempt = json.loads(contract.get_attempt(attempt_id))
    assert attempt["outcome"] == "EXACT_REPLAY"
    assert attempt["model_called"] is False


def test_removal_is_blocked_before_model(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/MeaningNonce.py")
    case_id = seed(contract, direct_vm, direct_alice)
    direct_vm.sender = direct_bob
    attempt_id = contract.submit_retry(
        case_id,
        "Try again",
        evidence(["Invoice #104 exists."]),
    )
    attempt = json.loads(contract.get_attempt(attempt_id))
    assert attempt["outcome"] == "BASELINE_REMOVAL_BLOCKED"
    assert attempt["model_called"] is False


def test_material_delta_reopens_and_validator_matches(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/MeaningNonce.py")
    case_id = seed(contract, direct_vm, direct_alice)
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r".*anti-verdict-shopping gate.*", json.dumps({"decision": "MATERIAL_DELTA"}))

    direct_vm.sender = direct_bob
    full = [
        "Invoice #104 exists.",
        "Carrier status says handed to last-mile partner.",
        "Signed recipient receipt was uploaded after the rejection.",
    ]
    attempt_id = contract.submit_retry(case_id, "Same goal, new evidence attached.", evidence(full))
    assert direct_vm.run_validator() is True
    attempt = json.loads(contract.get_attempt(attempt_id))
    case = json.loads(contract.get_case(case_id))
    assert attempt["outcome"] == "MATERIAL_DELTA"
    assert attempt["model_called"] is True
    assert case["status"] == "AWAITING_FRESH_DECISION"
    assert case["pending_attempt_id"] == attempt_id


def test_immaterial_delta_stays_locked(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/MeaningNonce.py")
    case_id = seed(contract, direct_vm, direct_alice)
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r".*anti-verdict-shopping gate.*", json.dumps({"decision": "IMMATERIAL_DELTA"}))

    direct_vm.sender = direct_bob
    attempt_id = contract.submit_retry(
        case_id,
        "Try again please",
        evidence([
            "Invoice #104 exists.",
            "Carrier status says handed to last-mile partner.",
            "The requester says this is very urgent.",
        ]),
    )
    assert direct_vm.run_validator() is True
    attempt = json.loads(contract.get_attempt(attempt_id))
    case = json.loads(contract.get_case(case_id))
    assert attempt["outcome"] == "IMMATERIAL_DELTA"
    assert case["status"] == "LOCKED_REJECTED"


def test_only_authority_can_record_fresh_decision(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/MeaningNonce.py")
    case_id = seed(contract, direct_vm, direct_alice)
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r".*anti-verdict-shopping gate.*", json.dumps({"decision": "MATERIAL_DELTA"}))
    full = [
        "Invoice #104 exists.",
        "Carrier status says handed to last-mile partner.",
        "Signed recipient receipt was uploaded after the rejection.",
    ]
    direct_vm.sender = direct_bob
    contract.submit_retry(case_id, "retry", evidence(full))

    with direct_vm.expect_revert("ONLY_AUTHORITY"):
        contract.record_fresh_decision(case_id, "REJECTED", "Still insufficient.", evidence(full))


def test_fresh_rejection_sets_full_new_baseline(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract = direct_deploy("contracts/MeaningNonce.py")
    case_id = seed(contract, direct_vm, direct_alice)
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r".*anti-verdict-shopping gate.*", json.dumps({"decision": "MATERIAL_DELTA"}))
    full = [
        "Invoice #104 exists.",
        "Carrier status says handed to last-mile partner.",
        "Signed recipient receipt was uploaded after the rejection.",
    ]
    direct_vm.sender = direct_bob
    contract.submit_retry(case_id, "retry", evidence(full))

    direct_vm.sender = direct_alice
    contract.record_fresh_decision(case_id, "REJECTED", "Receipt signature could not be tied to the intended recipient.", evidence(full))
    case = json.loads(contract.get_case(case_id))
    assert case["epoch"] == 2
    assert len(case["baseline_hashes"]) == 3
    assert case["status"] == "LOCKED_REJECTED"

    direct_vm.sender = direct_charlie
    attempt_id = contract.submit_retry(case_id, "different wallet, same evidence", evidence(full))
    attempt = json.loads(contract.get_attempt(attempt_id))
    assert attempt["outcome"] == "EXACT_REPLAY"


def test_fresh_acceptance_closes_case(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/MeaningNonce.py")
    case_id = seed(contract, direct_vm, direct_alice)
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r".*anti-verdict-shopping gate.*", json.dumps({"decision": "MATERIAL_DELTA"}))
    full = [
        "Invoice #104 exists.",
        "Carrier status says handed to last-mile partner.",
        "Signed recipient receipt was uploaded after the rejection.",
    ]
    direct_vm.sender = direct_bob
    contract.submit_retry(case_id, "retry", evidence(full))
    direct_vm.sender = direct_alice
    contract.record_fresh_decision(case_id, "ACCEPTED", "The new evidence supports reopening and the upstream authority accepted the case.", evidence(full))
    case = json.loads(contract.get_case(case_id))
    assert case["status"] == "CLOSED_ACCEPTED"

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("CASE_NOT_RETRYABLE"):
        contract.submit_retry(case_id, "again", evidence(full))


def test_identical_immaterial_candidate_is_adjudicated_once(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/MeaningNonce.py")
    case_id = seed(contract, direct_vm, direct_alice)
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r".*anti-verdict-shopping gate.*", json.dumps({"decision": "IMMATERIAL_DELTA"}))
    full = [
        "Invoice #104 exists.",
        "Carrier status says handed to last-mile partner.",
        "The requester says this is urgent.",
    ]
    direct_vm.sender = direct_bob
    first_id = contract.submit_retry(case_id, "wording one", evidence(full))
    second_id = contract.submit_retry(case_id, "wording two", evidence(full))
    first = json.loads(contract.get_attempt(first_id))
    second = json.loads(contract.get_attempt(second_id))
    assert first["outcome"] == "IMMATERIAL_DELTA"
    assert first["model_called"] is True
    assert second["outcome"] == "ALREADY_ADJUDICATED"
    assert second["model_called"] is False
    assert second["prior_semantic_outcome"] == "IMMATERIAL_DELTA"


def test_epoch_model_budget_and_authority_grant(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/MeaningNonce.py")
    case_id = seed(contract, direct_vm, direct_alice)
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r".*anti-verdict-shopping gate.*", json.dumps({"decision": "IMMATERIAL_DELTA"}))
    direct_vm.sender = direct_bob
    for i in range(3):
        aid = contract.submit_retry(
            case_id,
            f"retry {i}",
            evidence([
                "Invoice #104 exists.",
                "Carrier status says handed to last-mile partner.",
                f"Distinct junk delta {i}.",
            ]),
        )
        assert json.loads(contract.get_attempt(aid))["outcome"] == "IMMATERIAL_DELTA"

    fourth = [
        "Invoice #104 exists.",
        "Carrier status says handed to last-mile partner.",
        "Distinct junk delta 4.",
    ]
    fourth_id = contract.submit_retry(case_id, "retry 4", evidence(fourth))
    fourth_attempt = json.loads(contract.get_attempt(fourth_id))
    assert fourth_attempt["outcome"] == "RETRY_BUDGET_EXHAUSTED"
    assert fourth_attempt["model_called"] is False

    with direct_vm.expect_revert("ONLY_AUTHORITY"):
        contract.grant_retry_budget(case_id)

    direct_vm.sender = direct_alice
    contract.grant_retry_budget(case_id)
    direct_vm.sender = direct_bob
    after_id = contract.submit_retry(case_id, "retry after grant", evidence(fourth))
    after = json.loads(contract.get_attempt(after_id))
    assert after["outcome"] == "IMMATERIAL_DELTA"
    assert after["model_called"] is True


def test_authority_can_decline_reopening_without_changing_baseline(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/MeaningNonce.py")
    case_id = seed(contract, direct_vm, direct_alice)
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r".*anti-verdict-shopping gate.*", json.dumps({"decision": "MATERIAL_DELTA"}))
    full = [
        "Invoice #104 exists.",
        "Carrier status says handed to last-mile partner.",
        "Signed recipient receipt was uploaded after the rejection.",
    ]
    direct_vm.sender = direct_bob
    contract.submit_retry(case_id, "retry", evidence(full))
    before = json.loads(contract.get_case(case_id))
    assert before["status"] == "AWAITING_FRESH_DECISION"

    with direct_vm.expect_revert("ONLY_AUTHORITY"):
        contract.decline_reopening(case_id, "not authorized")

    direct_vm.sender = direct_alice
    contract.decline_reopening(case_id, "The authority declines this reopening.")
    after = json.loads(contract.get_case(case_id))
    assert after["status"] == "LOCKED_REJECTED"
    assert len(after["baseline_hashes"]) == 2

    direct_vm.sender = direct_bob
    rerun_id = contract.submit_retry(case_id, "same evidence again", evidence(full))
    rerun = json.loads(contract.get_attempt(rerun_id))
    assert rerun["outcome"] == "ALREADY_ADJUDICATED"
    assert rerun["model_called"] is False


def test_malformed_model_decision_fails_closed(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/MeaningNonce.py")
    case_id = seed(contract, direct_vm, direct_alice)
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r".*anti-verdict-shopping gate.*", json.dumps({"decision": "MAYBE"}))
    direct_vm.sender = direct_bob
    aid = contract.submit_retry(
        case_id,
        "retry",
        evidence([
            "Invoice #104 exists.",
            "Carrier status says handed to last-mile partner.",
            "Some new evidence.",
        ]),
    )
    attempt = json.loads(contract.get_attempt(aid))
    assert attempt["outcome"] == "IMMATERIAL_DELTA"
    assert attempt["model_called"] is True


def test_authority_cannot_submit_retry_against_own_case(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/MeaningNonce.py")
    case_id = seed(contract, direct_vm, direct_alice)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("AUTHORITY_CANNOT_SUBMIT_RETRY"):
        contract.submit_retry(
            case_id,
            "authority attempts a semantic reroll",
            evidence([
                "Invoice #104 exists.",
                "Carrier status says handed to last-mile partner.",
                "New evidence item.",
            ]),
        )
