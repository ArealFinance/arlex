use arlex_lang::prelude::*;

#[derive(Accounts)]
pub struct WithConstraint<'info> {
    #[account(signer)]
    pub auth: &'info AccountView,

    #[account(mut, constraint = auth.is_signer())]
    pub data: &'info AccountView,
}

fn main() {
    assert_eq!(WithConstraint::ACCOUNT_COUNT, 2);
}
