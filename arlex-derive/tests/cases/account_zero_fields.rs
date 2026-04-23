use arlex_lang::prelude::*;
#[account]
pub struct Empty {}
fn main() {
    assert_eq!(Empty::SIZE, 0);
    assert_eq!(Empty::SPACE, 8);
}
