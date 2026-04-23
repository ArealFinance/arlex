use arlex_lang::prelude::*;
#[derive(Accounts)]
pub struct InitSimple<'info> {
    #[account(mut, signer)]
    pub payer: &'info AccountView,
    #[account(init, payer = payer, space = 48)]
    pub data: &'info AccountView,
    pub system_program: &'info AccountView,
}
fn main() { assert_eq!(InitSimple::ACCOUNT_COUNT, 3); }
