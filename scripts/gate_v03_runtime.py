#!/usr/bin/env python3
"""
Gate v0.3 MẠNH HƠN probe_v03_schema.py: ngoài nạp module + trích schema, gate này
còn CHẠY THẬT `__init__` và các đường deterministic bằng storage in-memory của
SDK py-genlayer v0.3.0-rc7.

Lý do tồn tại: gate schema KHÔNG chạy `__init__`, nên nó không bắt được lỗi
    GenerationError: generic storage classes can not be instantiated with __init__
(`self.cases = TreeMap()` — hợp lệ ở v0.2, chết ở v0.3). Lỗi đó chỉ lộ ra lúc
deploy thật trên Studio. Gate này bắt được ngay offline.

KHÔNG phủ được: mọi thứ đi qua `gl.vm.run_nondet` / `gl.nondet.exec_prompt`
(cần GenVM thật). Đường EXACT_REPLAY được phủ vì nó chặn trước khi gọi model.

Dùng:
  PYTHONPATH="<stub>:<sdk_src>" python3.13 scripts/gate_v03_runtime.py contracts/MeaningNonce.py
"""
import importlib.util
import json
import sys
import traceback

ALICE = "0x" + "11" * 20
BOB = "0x" + "22" * 20
STAMP = "2026-09-15T10:00:00Z"

_failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("  PASS  " if ok else "  FAIL  ") + name + ((" -> " + detail) if detail else ""))
    if not ok:
        _failures.append(name)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: gate_v03_runtime.py <contract.py>", file=sys.stderr)
        return 2

    spec = importlib.util.spec_from_file_location("contract_under_test", sys.argv[1])
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except Exception as exc:
        print("MODULE LOAD: FAIL -> " + type(exc).__name__ + ": " + str(exc))
        traceback.print_exc()
        return 1
    print("MODULE LOAD: OK")

    import genlayer as gl
    from genlayer.types import Address

    cls = [
        o for o in vars(module).values()
        if isinstance(o, type) and issubclass(o, gl.contract.Contract)
        and o is not gl.contract.Contract
    ][0]

    from genlayer._internal.get_schema import get_schema
    schema = get_schema(cls)
    print("SCHEMA: OK methods=" + str(len(schema["methods"])))

    # --- 1. constructor -----------------------------------------------------
    print("\n[1] constructor (chạy thật __init__ trên storage in-memory)")
    try:
        c = gl.storage.inmem_allocate(cls)
        check("__init__ không raise", True)
    except Exception as exc:
        check("__init__ không raise", False, type(exc).__name__ + ": " + str(exc)[:200])
        traceback.print_exc()
        return 1

    check("storage TreeMap tự cấp phát", len(c.cases) == 0 and len(c.attempts) == 0)
    check("counters = 0", c.case_count == 0 and c.attempt_seq == 0)

    # --- 2. giả lập message context ----------------------------------------
    import genlayer.message as msg
    msg.raw = {"datetime": STAMP, "sender_address": Address(ALICE)}
    msg.sender_address = Address(ALICE)

    # --- 3. seed_rejected_case ---------------------------------------------
    print("\n[2] seed_rejected_case (deterministic, không gọi model)")
    ev = json.dumps(["receipt A", "email B"])
    try:
        case_id = c.seed_rejected_case("CASE-1", "Không đủ chứng cứ", ev)
        check("seed trả case_id", isinstance(case_id, str) and len(case_id) > 0, case_id[:24] + "…")
    except Exception as exc:
        check("seed trả case_id", False, type(exc).__name__ + ": " + str(exc)[:200])
        traceback.print_exc()
        return 1

    check("case_count = 1", c.case_count == 1)
    case = json.loads(c.get_case(case_id))
    check("status = LOCKED_REJECTED", case["status"] == "LOCKED_REJECTED", case["status"])
    check("authority = sender", case["authority"].lower() == ALICE.lower())
    check("created_at = gl.message.raw datetime", case["created_at"] == STAMP, case["created_at"])
    check("derive_case_id khớp", c.derive_case_id(ALICE, "CASE-1") == case_id)

    # --- 4. các nhánh revert deterministic ----------------------------------
    print("\n[3] nhánh revert deterministic")

    def expect_user_error(name: str, fn, code: str) -> None:
        try:
            fn()
        except gl.vm.UserError as exc:
            got = str(getattr(exc, "data", exc))
            check(name, code in got, got[:120])
            return
        except Exception as exc:
            check(name, False, "sai loại exception: " + type(exc).__name__ + ": " + str(exc)[:120])
            return
        check(name, False, "không raise")

    expect_user_error(
        "seed trùng -> CASE_ALREADY_EXISTS",
        lambda: c.seed_rejected_case("CASE-1", "x", ev), "CASE_ALREADY_EXISTS")
    expect_user_error(
        "case_ref rỗng -> CASE_REF_REQUIRED",
        lambda: c.seed_rejected_case("   ", "x", ev), "CASE_REF_REQUIRED")
    expect_user_error(
        "evidence không phải JSON -> EVIDENCE_JSON_INVALID",
        lambda: c.seed_rejected_case("CASE-2", "x", "{oops"), "EVIDENCE_JSON_INVALID")
    expect_user_error(
        "evidence không phải array -> EVIDENCE_MUST_BE_JSON_ARRAY",
        lambda: c.seed_rejected_case("CASE-3", "x", '{"a":1}'), "EVIDENCE_MUST_BE_JSON_ARRAY")
    expect_user_error(
        "evidence rỗng -> EVIDENCE_REQUIRED",
        lambda: c.seed_rejected_case("CASE-4", "x", "[]"), "EVIDENCE_REQUIRED")
    expect_user_error(
        "authority tự retry -> AUTHORITY_CANNOT_SUBMIT_RETRY",
        lambda: c.submit_retry(case_id, "xin mở lại", ev), "AUTHORITY_CANNOT_SUBMIT_RETRY")
    expect_user_error(
        "case_id không tồn tại -> CASE_NOT_FOUND",
        lambda: c.submit_retry("0" * 64, "x", ev), "CASE_NOT_FOUND")

    # --- 5. EXACT_REPLAY: bên thứ ba nộp lại y hệt baseline -----------------
    print("\n[4] submit_retry EXACT_REPLAY (chặn trước khi gọi model)")
    msg.raw = {"datetime": STAMP, "sender_address": Address(BOB)}
    msg.sender_address = Address(BOB)
    try:
        attempt_id = c.submit_retry(case_id, "Xin xem xét lại", ev)
        att = json.loads(c.get_attempt(attempt_id))
        check("outcome = EXACT_REPLAY", att.get("outcome") == "EXACT_REPLAY", str(att.get("outcome")))
        check("model_called = false", att.get("model_called") is False, str(att.get("model_called")))
        after = json.loads(c.get_case(case_id))
        check("case vẫn LOCKED_REJECTED", after["status"] == "LOCKED_REJECTED", after["status"])
        check("blocked_count tăng", after["blocked_count"] >= 1, str(after["blocked_count"]))
    except Exception as exc:
        check("EXACT_REPLAY chạy được", False, type(exc).__name__ + ": " + str(exc)[:200])
        traceback.print_exc()

    # --- 6. quyền của authority --------------------------------------------
    print("\n[5] kiểm soát quyền authority")
    expect_user_error(
        "người khác grant budget -> ONLY_AUTHORITY",
        lambda: c.grant_retry_budget(case_id), "ONLY_AUTHORITY")
    msg.raw = {"datetime": STAMP, "sender_address": Address(ALICE)}
    msg.sender_address = Address(ALICE)
    try:
        c.grant_retry_budget(case_id)
        g = json.loads(c.get_case(case_id))
        check("authority grant budget được", g["budget_grants_this_epoch"] == 1,
              str(g["budget_grants_this_epoch"]))
    except Exception as exc:
        check("authority grant budget được", False, type(exc).__name__ + ": " + str(exc)[:200])
    expect_user_error(
        "decline khi không có pending -> NO_FRESH_DECISION_PENDING",
        lambda: c.decline_reopening(case_id, "không"), "NO_FRESH_DECISION_PENDING")

    print("\n" + ("=" * 60))
    if _failures:
        print("GATE: FAIL (" + str(len(_failures)) + ")")
        for f in _failures:
            print("  - " + f)
        return 1
    print("GATE: ALL PASS")
    print("LƯU Ý: gate này KHÔNG phủ nhánh semantic (gl.vm.run_nondet /")
    print("gl.nondet.exec_prompt) — phải chứng minh trên GenVM/Studio thật.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
