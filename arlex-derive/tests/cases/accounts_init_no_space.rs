use arlex_lang::prelude::*;

// Should fail: init requires space
#[derive(Accounts)]
pub struct Bad<'info> {
    #[account(mut, signer)]
    pub payer: &'info AccountView,

    #[account(init, payer = payer)]
    pub data: &'info AccountView,
}

fn main() {}
