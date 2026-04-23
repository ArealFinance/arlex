use arlex_lang::prelude::*;

#[account]
pub struct DataAccount {
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

fn main() {
    assert_eq!(WithHasOne::ACCOUNT_COUNT, 2);
    // Verify PUBKEY_FIELD_OFFSETS was generated
    assert_eq!(DataAccount::PUBKEY_FIELD_OFFSETS.len(), 1);
    assert_eq!(DataAccount::PUBKEY_FIELD_OFFSETS[0].0, "authority");
    assert_eq!(DataAccount::PUBKEY_FIELD_OFFSETS[0].1, 8); // 8-byte discriminator
}
