use arlex_lang::prelude::*;
// Should fail: has_one = ghost
#[derive(Accounts)]
pub struct Bad<'info> {
    #[account(has_one = ghost)]
    pub data: &'info AccountView,
}
fn main() {}
