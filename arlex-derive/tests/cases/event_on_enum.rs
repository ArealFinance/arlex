use arlex_lang::prelude::*;

// Should fail: #[event] requires named-field struct
#[event]
pub enum Bad {
    A,
    B,
}

fn main() {}
