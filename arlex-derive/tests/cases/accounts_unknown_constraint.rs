use arlex_lang::prelude::*;

// Should fail: unknown constraint "foobar"
#[derive(Accounts)]
pub struct Bad<'info> {
    #[account(foobar)]
    pub x: &'info AccountView,
}

fn main() {}
