use arlex_lang::prelude::*;

#[account]
pub struct Data {
    pub value: u64,
}

#[derive(Accounts)]
pub struct InitPda<'info> {
    #[account(mut, signer)]
    pub payer: &'info AccountView,

    #[account(init, payer = payer, space = Data::SPACE, seeds = [b"data", payer.address().as_ref()], bump)]
    pub data_account: &'info AccountView,

    pub system_program: &'info AccountView,
}

fn main() {
    assert_eq!(InitPda::ACCOUNT_COUNT, 3);
}
