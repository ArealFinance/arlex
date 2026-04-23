use arlex_lang::prelude::*;

// Should fail: #[account] only supports named-field structs, not enums
#[account]
pub enum Bad {
    A,
    B,
}

fn main() {}
