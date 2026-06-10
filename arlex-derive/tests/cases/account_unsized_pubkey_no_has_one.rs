use arlex_lang::prelude::*;

// FINDING 4 (refined) — PASS case.
//
// An `#[account]` struct may place a [u8; 32] pubkey field AFTER a field whose
// size the macro cannot compute (here `[RevenueDestination; 3]`, an array of a
// user struct). The macro cannot compute the byte offset of the trailing
// pubkey `areal_fee_destination`, so it OMITS it from PUBKEY_FIELD_OFFSETS and
// records it in PUBKEY_FIELDS_UNRESOLVABLE instead of hard-erroring.
//
// As long as NO has_one references that trailing pubkey, the struct compiles
// fine. This mirrors ownership-token's RevenueConfig, whose doc-mandated
// layout requires this ordering and validates `areal_fee_destination` manually
// in handlers (never via has_one). Previously this shape was erroneously
// rejected at the #[account] definition.
#[derive(Copy, Clone)]
#[repr(C, packed)]
pub struct RevenueDestination {
    pub address: [u8; 32],
    pub allocation_bps: u16,
    pub label: [u8; 32],
}

#[account]
pub struct RevenueConfig {
    pub ot_mint: [u8; 32],                       // resolvable (offset 8)
    pub destinations: [RevenueDestination; 3],   // macro-unknown size
    pub active_count: u8,                        // unknowable offset
    pub config_version: u64,                     // unknowable offset
    pub areal_fee_destination: [u8; 32],         // unresolvable pubkey
    pub bump: u8,                                // unknowable offset
}

fn main() {
    // `ot_mint` precedes the unsized field — its offset is resolvable.
    assert_eq!(RevenueConfig::PUBKEY_FIELD_OFFSETS.len(), 1);
    assert_eq!(RevenueConfig::PUBKEY_FIELD_OFFSETS[0].0, "ot_mint");
    assert_eq!(RevenueConfig::PUBKEY_FIELD_OFFSETS[0].1, 8);

    // `areal_fee_destination` follows the unsized field — recorded as
    // unresolvable, NOT silently dropped.
    assert_eq!(RevenueConfig::PUBKEY_FIELDS_UNRESOLVABLE.len(), 1);
    assert_eq!(
        RevenueConfig::PUBKEY_FIELDS_UNRESOLVABLE[0],
        "areal_fee_destination"
    );
}
