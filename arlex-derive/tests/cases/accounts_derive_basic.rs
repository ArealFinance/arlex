use arlex_lang::prelude::*;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut, signer)]
    pub authority: &'info AccountView,

    #[account(mut)]
    pub counter: &'info AccountView,

    pub system_program: &'info AccountView,
}

fn main() {
    // Verify ACCOUNT_COUNT generated
    assert_eq!(Initialize::ACCOUNT_COUNT, 3);
}
