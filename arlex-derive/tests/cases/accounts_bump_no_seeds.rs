use arlex_lang::prelude::*;

// FINDING 5: a standalone `bump` (without `seeds`) is a no-op in codegen and
// gives false Anchor-like PDA security. The macro must reject it at compile
// time. `seeds + bump` (see accounts_seeds_only.rs / accounts_init_pda.rs)
// remains valid.
#[derive(Accounts)]
pub struct StandaloneBump<'info> {
    #[account(signer)]
    pub authority: &'info AccountView,

    #[account(mut, bump)]
    pub vault: &'info AccountView,
}

fn main() {}
