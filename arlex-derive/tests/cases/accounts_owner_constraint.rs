use arlex_lang::prelude::*;
const MY_PROGRAM: Address = Address::new_from_array([1u8; 32]);
#[derive(Accounts)]
pub struct WithOwner<'info> {
    #[account(owner = MY_PROGRAM)]
    pub data: &'info AccountView,
}
fn main() { assert_eq!(WithOwner::ACCOUNT_COUNT, 1); }
