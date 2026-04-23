use arlex_lang::prelude::*;
// Should fail: close = ghost
#[derive(Accounts)]
pub struct Bad<'info> {
    #[account(close = ghost)]
    pub data: &'info AccountView,
}
fn main() {}
