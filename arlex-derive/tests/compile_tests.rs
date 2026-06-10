#[test]
fn compile_tests() {
    let t = trybuild::TestCases::new();

    // ===== PASS: should compile =====

    // #[program]
    t.pass("tests/cases/program_basic.rs");
    t.pass("tests/cases/program_with_args.rs");
    t.pass("tests/cases/program_no_context.rs");

    // #[account]
    t.pass("tests/cases/account_basic.rs");
    t.pass("tests/cases/account_multiple_fields.rs");
    t.pass("tests/cases/account_zero_fields.rs");
    // FINDING 4 (refined): a [u8; 32] pubkey placed after a field of
    // macro-unknown size compiles fine as long as no has_one references it
    // (mirrors ownership-token's RevenueConfig layout).
    t.pass("tests/cases/account_unsized_pubkey_no_has_one.rs");

    // #[error_code]
    t.pass("tests/cases/error_code_basic.rs");

    // #[event]
    t.pass("tests/cases/event_basic.rs");

    // #[derive(Accounts)] — all constraint types
    t.pass("tests/cases/accounts_derive_basic.rs");
    t.pass("tests/cases/accounts_init_pda.rs");
    t.pass("tests/cases/accounts_init_no_pda.rs");
    t.pass("tests/cases/accounts_has_one.rs");
    t.pass("tests/cases/accounts_close.rs");
    t.pass("tests/cases/accounts_constraint_expr.rs");
    t.pass("tests/cases/accounts_seeds_only.rs");
    t.pass("tests/cases/accounts_owner_constraint.rs");

    // ===== FAIL: should not compile =====

    // #[program]
    t.compile_fail("tests/cases/program_empty_mod.rs");

    // #[account]
    t.compile_fail("tests/cases/account_unnamed_fields.rs");
    t.compile_fail("tests/cases/account_on_enum.rs");

    // #[error_code]
    t.compile_fail("tests/cases/error_code_on_struct.rs");
    t.compile_fail("tests/cases/error_code_explicit_discriminant.rs");
    t.compile_fail("tests/cases/error_code_non_unit_variant.rs");

    // #[event]
    t.compile_fail("tests/cases/event_unnamed_fields.rs");
    t.compile_fail("tests/cases/event_on_enum.rs");

    // #[derive(Accounts)] — error cases
    t.compile_fail("tests/cases/accounts_unknown_constraint.rs");
    t.compile_fail("tests/cases/accounts_init_no_payer.rs");
    t.compile_fail("tests/cases/accounts_init_no_space.rs");
    t.compile_fail("tests/cases/accounts_on_enum.rs");
    t.compile_fail("tests/cases/accounts_tuple_struct.rs");
    t.compile_fail("tests/cases/accounts_payer_not_found.rs");
    t.compile_fail("tests/cases/accounts_has_one_not_found.rs");
    t.compile_fail("tests/cases/accounts_has_one_no_type.rs");
    // FINDING 4 (refined): has_one on a pubkey whose offset is unresolvable
    // (preceded by a field of macro-unknown size) fails at compile time at the
    // has_one site rather than silently failing closed at runtime.
    t.compile_fail("tests/cases/accounts_has_one_unresolvable_offset.rs");
    t.compile_fail("tests/cases/accounts_account_type_no_has_one.rs");
    t.compile_fail("tests/cases/accounts_close_not_found.rs");
    t.compile_fail("tests/cases/accounts_bump_no_seeds.rs");
}
