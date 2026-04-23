use arlex_lang::prelude::*;

// Should fail: #[account] requires named fields, not tuple struct
#[account]
pub struct Bad(u64, u64);

fn main() {}
