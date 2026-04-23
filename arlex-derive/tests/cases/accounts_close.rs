use arlex_lang::prelude::*;

#[derive(Accounts)]
pub struct CloseAccount<'info> {
    #[account(signer)]
    pub authority: &'info AccountView,

    #[account(close = authority)]
    pub data: &'info AccountView,
}

fn main() {
    assert_eq!(CloseAccount::ACCOUNT_COUNT, 2);
}
