use arlex_lang::prelude::*;
// Should fail: account_type without has_one
#[derive(Accounts)]
pub struct Bad<'info> {
    #[account(mut, account_type = "SomeType")]
    pub data: &'info AccountView,
}
fn main() {}
