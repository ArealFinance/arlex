use arlex_lang::prelude::*;

#[derive(Accounts)]
pub struct Transfer<'info> {
    #[account(signer)]
    pub authority: &'info AccountView,
    #[account(mut)]
    pub dest: &'info AccountView,
}

#[program]
pub mod my_program {
    use super::*;

    pub fn transfer(ctx: Context<Transfer>, amount: u64, flag: bool) -> Result<()> {
        arlex_lang::log("transferred");
        Ok(())
    }
}

fn main() {}
