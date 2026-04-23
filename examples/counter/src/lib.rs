use arlex_lang::prelude::*;

declare_id!("11111111111111111111111111111112");

#[account]
pub struct Counter {
    pub authority: [u8; 32],  // Pubkey stored as raw bytes for repr(C, packed) compat
    pub count: u64,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut, signer)]
    pub authority: &'info AccountView,

    #[account(mut)]
    pub counter: &'info AccountView,

    pub system_program: &'info AccountView,
}

#[derive(Accounts)]
pub struct Increment<'info> {
    #[account(signer)]
    pub authority: &'info AccountView,

    #[account(mut)]
    pub counter: &'info AccountView,
}

#[error_code]
pub enum CounterError {
    #[msg("Unauthorized: signer does not match counter authority")]
    Unauthorized,
}

#[event]
pub struct CounterIncremented {
    pub authority: [u8; 32],
    pub new_count: u64,
}

#[program]
pub mod counter {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let counter = Counter::init(ctx.accounts.counter, ctx.program_id)?;
        counter.authority.copy_from_slice(ctx.accounts.authority.address().as_ref());
        counter.count = 0;
        arlex_lang::log("Counter initialized");
        Ok(())
    }

    pub fn increment(ctx: Context<Increment>) -> Result<()> {
        let counter = Counter::load_mut(ctx.accounts.counter, ctx.program_id)?;

        // Verify authority
        if counter.authority != *ctx.accounts.authority.address().as_ref() {
            return Err(ProgramError::from(CounterError::Unauthorized));
        }

        counter.count = counter.count.checked_add(1)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        emit!(CounterIncremented {
            authority: counter.authority,
            new_count: counter.count,
        });

        arlex_lang::log("Counter incremented");
        Ok(())
    }
}
