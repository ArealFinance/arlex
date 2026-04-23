use arlex_lang::prelude::*;

// Should fail: init requires payer
#[derive(Accounts)]
pub struct Bad<'info> {
    #[account(init, space = 100)]
    pub data: &'info AccountView,
}

fn main() {}
