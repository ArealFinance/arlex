use arlex_lang::prelude::*;
// Should fail: has_one without account_type is not allowed (security)
#[derive(Accounts)]
pub struct Bad<'info> {
    #[account(signer)]
    pub authority: &'info AccountView,

    #[account(mut, has_one = authority)]
    pub data: &'info AccountView,
}
fn main() {}
