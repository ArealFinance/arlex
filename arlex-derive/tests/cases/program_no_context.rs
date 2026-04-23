use arlex_lang::prelude::*;
#[derive(Accounts)]
pub struct NoArgs<'info> {
    #[account(signer)]
    pub auth: &'info AccountView,
}
#[program]
pub mod test_prog {
    use super::*;
    pub fn simple(ctx: Context<NoArgs>) -> Result<()> {
        Ok(())
    }
}
fn main() {}
