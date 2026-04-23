use arlex_lang::prelude::*;

// Should fail: Accounts must be a struct, not enum
#[derive(Accounts)]
pub enum Bad {
    A,
    B,
}

fn main() {}
