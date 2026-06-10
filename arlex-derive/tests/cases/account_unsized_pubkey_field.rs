use arlex_lang::prelude::*;

// FINDING 4: a type alias has no macro-known size, so type_size() returns None.
// A [u8; 32] pubkey field AFTER it cannot have its offset computed. The macro
// must emit a compile_error! instead of silently dropping `authority` from
// PUBKEY_FIELD_OFFSETS (which would make has_one always fail — fail-closed DoS).
type Pk = [u8; 32];

#[account]
pub struct DataAccount {
    pub other: Pk,
    pub authority: [u8; 32],
    pub value: u64,
}

#[derive(Accounts)]
pub struct WithHasOne<'info> {
    #[account(signer)]
    pub authority: &'info AccountView,

    #[account(mut, has_one = authority, account_type = "DataAccount")]
    pub data: &'info AccountView,
}

fn main() {}
