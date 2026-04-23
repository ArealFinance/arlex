use arlex_lang::prelude::*;
// Should fail: module must have a body
#[program]
pub mod empty;
fn main() {}
