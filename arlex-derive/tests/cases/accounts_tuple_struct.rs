use arlex_lang::prelude::*;
// Should fail: Accounts must have named fields
#[derive(Accounts)]
pub struct Bad<'info>(&'info AccountView);
fn main() {}
