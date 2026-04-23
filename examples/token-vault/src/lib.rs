use arlex_lang::prelude::*;

declare_id!("11111111111111111111111111111112");

// Well-known program IDs for validation
const SPL_TOKEN_PROGRAM: [u8; 32] = [
    0x06, 0xdd, 0xf6, 0xe1, 0xd7, 0x65, 0xa1, 0x93,
    0xd9, 0xcb, 0xe1, 0x46, 0xce, 0xeb, 0x79, 0xac,
    0x1c, 0xb4, 0x85, 0xed, 0x5f, 0x5b, 0x37, 0x91,
    0x3a, 0x8c, 0xf5, 0x85, 0x7e, 0xff, 0x00, 0xa9,
];
const SYSTEM_PROGRAM: [u8; 32] = [0u8; 32];

// =============================================================================
// Account data
// =============================================================================

#[account]
pub struct Vault {
    pub authority: [u8; 32],
    pub token_mint: [u8; 32],
    pub vault_token_account: [u8; 32],
    pub total_deposited: u64,
    pub bump: u8,
}

// =============================================================================
// Instruction accounts
// =============================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut, signer)]
    pub authority: &'info AccountView,

    // Vault PDA — created and validated via seeds
    #[account(
        init,
        payer = authority,
        space = Vault::SPACE,
        seeds = [b"vault", authority.address().as_ref()],
        bump
    )]
    pub vault: &'info AccountView,

    // Vault's token account — must be writable, owned by SPL Token
    #[account(mut, owner = Address::new_from_array(SPL_TOKEN_PROGRAM))]
    pub vault_token_account: &'info AccountView,

    // Token mint — read-only
    pub token_mint: &'info AccountView,

    // Programs — validated by address
    #[account(constraint = token_program.address() == &Address::new_from_array(SPL_TOKEN_PROGRAM))]
    pub token_program: &'info AccountView,

    #[account(constraint = system_program.address() == &Address::new_from_array(SYSTEM_PROGRAM))]
    pub system_program: &'info AccountView,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(signer)]
    pub depositor: &'info AccountView,

    // Depositor's token account — must be writable, owned by SPL Token
    #[account(mut, owner = Address::new_from_array(SPL_TOKEN_PROGRAM))]
    pub depositor_token_account: &'info AccountView,

    // Vault state PDA — load and verify
    #[account(mut)]
    pub vault: &'info AccountView,

    // Vault's token account — must be writable, owned by SPL Token
    #[account(mut, owner = Address::new_from_array(SPL_TOKEN_PROGRAM))]
    pub vault_token_account: &'info AccountView,

    // Token program — validated
    #[account(constraint = token_program.address() == &Address::new_from_array(SPL_TOKEN_PROGRAM))]
    pub token_program: &'info AccountView,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(signer)]
    pub authority: &'info AccountView,

    // Vault state PDA
    #[account(mut)]
    pub vault: &'info AccountView,

    // Vault's token account — writable, owned by SPL Token
    #[account(mut, owner = Address::new_from_array(SPL_TOKEN_PROGRAM))]
    pub vault_token_account: &'info AccountView,

    // Recipient token account — writable, owned by SPL Token
    #[account(mut, owner = Address::new_from_array(SPL_TOKEN_PROGRAM))]
    pub recipient_token_account: &'info AccountView,

    // Token program — validated
    #[account(constraint = token_program.address() == &Address::new_from_array(SPL_TOKEN_PROGRAM))]
    pub token_program: &'info AccountView,
}

// =============================================================================
// Errors
// =============================================================================

#[error_code]
pub enum VaultError {
    #[msg("Unauthorized: signer is not the vault authority")]
    Unauthorized,
    #[msg("Insufficient vault balance")]
    InsufficientBalance,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Vault token account does not match stored address")]
    InvalidVaultTokenAccount,
    #[msg("Token mint does not match vault configuration")]
    InvalidTokenMint,
}

// =============================================================================
// Events
// =============================================================================

#[event]
pub struct Deposited {
    pub depositor: [u8; 32],
    pub amount: u64,
    pub new_total: u64,
}

#[event]
pub struct Withdrawn {
    pub authority: [u8; 32],
    pub amount: u64,
    pub new_total: u64,
}

// =============================================================================
// Program
// =============================================================================

#[program]
pub mod token_vault {
    use super::*;

    /// Initialize a new token vault PDA.
    /// The vault PDA is derived from ["vault", authority].
    /// Caller must also create the vault's associated token account beforehand.
    pub fn initialize(ctx: Context<Initialize>, bump: u8) -> Result<()> {
        // Validate vault_token_account mint matches token_mint
        // SPL Token account layout: mint is first 32 bytes
        let vta_data = unsafe {
            core::slice::from_raw_parts(
                ctx.accounts.vault_token_account.data_ptr(),
                ctx.accounts.vault_token_account.data_len(),
            )
        };
        if vta_data.len() < 64 {
            return Err(ProgramError::InvalidAccountData);
        }
        // Check mint (bytes 0..32 of SPL Token account)
        if &vta_data[0..32] != ctx.accounts.token_mint.address().as_ref() {
            return Err(ProgramError::from(VaultError::InvalidTokenMint));
        }

        // Initialize vault state
        let vault = Vault::init(ctx.accounts.vault, ctx.program_id)?;
        vault.authority.copy_from_slice(ctx.accounts.authority.address().as_ref());
        vault.token_mint.copy_from_slice(ctx.accounts.token_mint.address().as_ref());
        vault.vault_token_account.copy_from_slice(ctx.accounts.vault_token_account.address().as_ref());
        vault.total_deposited = 0;
        vault.bump = bump;

        arlex_lang::log("Vault initialized");
        Ok(())
    }

    /// Deposit SPL tokens into the vault.
    /// Anyone can deposit. Checks-effects-interactions pattern:
    /// 1. Load and validate vault state (checks)
    /// 2. Update total_deposited (effects)
    /// 3. CPI transfer (interactions)
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        if amount == 0 {
            return Err(ProgramError::from(VaultError::ZeroAmount));
        }

        // CHECKS: Load vault, verify vault_token_account matches stored address
        let vault = Vault::load_mut(ctx.accounts.vault, ctx.program_id)?;
        if vault.vault_token_account != *ctx.accounts.vault_token_account.address().as_ref() {
            return Err(ProgramError::from(VaultError::InvalidVaultTokenAccount));
        }

        // Verify depositor_token_account mint matches vault token_mint
        let dta_data = unsafe {
            core::slice::from_raw_parts(
                ctx.accounts.depositor_token_account.data_ptr(),
                ctx.accounts.depositor_token_account.data_len(),
            )
        };
        if dta_data.len() >= 32 && &dta_data[0..32] != &vault.token_mint {
            return Err(ProgramError::from(VaultError::InvalidTokenMint));
        }

        // EFFECTS: Update state before CPI (checks-effects-interactions)
        vault.total_deposited = vault.total_deposited
            .checked_add(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        // INTERACTIONS: CPI transfer tokens from depositor to vault
        arlex_lang::token::instructions::Transfer {
            from: ctx.accounts.depositor_token_account,
            to: ctx.accounts.vault_token_account,
            authority: ctx.accounts.depositor,
            amount,
        }.invoke()?;

        emit!(Deposited {
            depositor: {
                let mut arr = [0u8; 32];
                arr.copy_from_slice(ctx.accounts.depositor.address().as_ref());
                arr
            },
            amount,
            new_total: vault.total_deposited,
        });

        arlex_lang::log("Deposit successful");
        Ok(())
    }

    /// Withdraw SPL tokens from the vault.
    /// Only the vault authority can withdraw.
    /// Uses PDA signing for the CPI transfer.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        if amount == 0 {
            return Err(ProgramError::from(VaultError::ZeroAmount));
        }

        // CHECKS: Load vault, verify authority, balance, and token account
        let vault = Vault::load_mut(ctx.accounts.vault, ctx.program_id)?;

        if vault.authority != *ctx.accounts.authority.address().as_ref() {
            return Err(ProgramError::from(VaultError::Unauthorized));
        }

        if vault.vault_token_account != *ctx.accounts.vault_token_account.address().as_ref() {
            return Err(ProgramError::from(VaultError::InvalidVaultTokenAccount));
        }

        if vault.total_deposited < amount {
            return Err(ProgramError::from(VaultError::InsufficientBalance));
        }

        // Verify recipient_token_account mint matches vault token_mint
        let rta_data = unsafe {
            core::slice::from_raw_parts(
                ctx.accounts.recipient_token_account.data_ptr(),
                ctx.accounts.recipient_token_account.data_len(),
            )
        };
        if rta_data.len() >= 32 && &rta_data[0..32] != &vault.token_mint {
            return Err(ProgramError::from(VaultError::InvalidTokenMint));
        }

        // EFFECTS: Update state before CPI
        vault.total_deposited = vault.total_deposited
            .checked_sub(amount)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        // INTERACTIONS: CPI transfer from vault to recipient (PDA signer)
        let bump_bytes = [vault.bump];
        let seeds = [
            arlex_lang::Seed::from(b"vault" as &[u8]),
            arlex_lang::Seed::from(vault.authority.as_ref()),
            arlex_lang::Seed::from(bump_bytes.as_ref()),
        ];
        let signer = arlex_lang::Signer::from(&seeds);

        arlex_lang::token::instructions::Transfer {
            from: ctx.accounts.vault_token_account,
            to: ctx.accounts.recipient_token_account,
            authority: ctx.accounts.vault,
            amount,
        }.invoke_signed(&[signer])?;

        emit!(Withdrawn {
            authority: vault.authority,
            amount,
            new_total: vault.total_deposited,
        });

        arlex_lang::log("Withdrawal successful");
        Ok(())
    }
}
