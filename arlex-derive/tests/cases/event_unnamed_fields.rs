use arlex_lang::prelude::*;

// Should fail: #[event] requires named fields
#[event]
pub struct Bad(u64);

fn main() {}
