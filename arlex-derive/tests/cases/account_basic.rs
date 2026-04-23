use arlex_lang::prelude::*;

#[account]
pub struct Counter {
    pub authority: [u8; 32],
    pub count: u64,
}

fn main() {
    // Verify generated constants
    assert_eq!(Counter::SPACE, 8 + core::mem::size_of::<Counter>());
    assert_eq!(Counter::DISCRIMINATOR.len(), 8);

    // Verify discriminator is non-zero (sha256 output)
    assert!(Counter::DISCRIMINATOR.iter().any(|&b| b != 0));
}
