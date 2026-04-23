use arlex_lang::prelude::*;

#[account]
pub struct Complex {
    pub authority: [u8; 32],
    pub count: u64,
    pub flag: u8,
    pub balance: u64,
    pub name: [u8; 16],
}

fn main() {
    // Verify SIZE = sum of all field sizes
    assert_eq!(Complex::SIZE, 32 + 8 + 1 + 8 + 16);
    assert_eq!(Complex::SPACE, 8 + Complex::SIZE);
    assert_eq!(Complex::DISCRIMINATOR.len(), 8);
}
