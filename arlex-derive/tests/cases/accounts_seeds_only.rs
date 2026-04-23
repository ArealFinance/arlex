use arlex_lang::prelude::*;

#[derive(Accounts)]
pub struct VerifyPda<'info> {
    #[account(signer)]
    pub authority: &'info AccountView,

    #[account(seeds = [b"vault", authority.address().as_ref()], bump)]
    pub vault: &'info AccountView,
}

fn main() {
    assert_eq!(VerifyPda::ACCOUNT_COUNT, 2);
}
