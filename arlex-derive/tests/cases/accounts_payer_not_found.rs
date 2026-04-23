use arlex_lang::prelude::*;
// Should fail: payer = ghost, ghost is not a field
#[derive(Accounts)]
pub struct Bad<'info> {
    #[account(init, payer = ghost, space = 100)]
    pub data: &'info AccountView,
}
fn main() {}
