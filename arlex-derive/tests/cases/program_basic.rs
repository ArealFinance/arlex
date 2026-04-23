use arlex_lang::prelude::*;

#[derive(Accounts)]
pub struct Init<'info> {
    #[account(signer)]
    pub authority: &'info AccountView,
}

#[program]
pub mod my_program {
    use super::*;

    pub fn initialize(ctx: Context<Init>) -> Result<()> {
        arlex_lang::log("initialized");
        Ok(())
    }
}

fn main() {}
