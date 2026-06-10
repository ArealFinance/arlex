use arlex_lang::prelude::*;

// FINDING 4 (refined) — COMPILE-FAIL case.
//
// Same struct shape as the PASS case (a [u8; 32] pubkey placed AFTER a field
// of macro-unknown size), but this time a `has_one` DOES reference that
// trailing pubkey. The macro could not compute the field's byte offset, so it
// is listed in PUBKEY_FIELDS_UNRESOLVABLE. The `has_one` codegen detects this
// at COMPILE time and aborts the build at the has_one usage site — instead of
// silently failing closed at runtime (the original Medium bug / fail-closed
// DoS). This proves the security property is preserved: a has_one on a pubkey
// whose offset is unknowable still fails LOUDLY.
#[derive(Copy, Clone)]
#[repr(C, packed)]
pub struct RevenueDestination {
    pub address: [u8; 32],
    pub allocation_bps: u16,
    pub label: [u8; 32],
}

#[account]
pub struct RevenueConfig {
    pub ot_mint: [u8; 32],
    pub destinations: [RevenueDestination; 3], // macro-unknown size
    pub areal_fee_destination: [u8; 32],       // unresolvable pubkey
    pub bump: u8,
}

#[derive(Accounts)]
pub struct WithHasOne<'info> {
    #[account(signer)]
    pub areal_fee_destination: &'info AccountView,

    // has_one on `areal_fee_destination`, whose offset is unresolvable — must
    // be rejected at compile time.
    #[account(mut, has_one = areal_fee_destination, account_type = "RevenueConfig")]
    pub config: &'info AccountView,
}

fn main() {}
