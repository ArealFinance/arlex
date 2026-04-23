use arlex_lang::prelude::*;

#[event]
pub struct Transferred {
    pub amount: u64,
    pub from: [u8; 32],
}

fn main() {
    // Verify discriminator exists and is 8 bytes
    assert_eq!(Transferred::DISCRIMINATOR.len(), 8);
    assert!(Transferred::DISCRIMINATOR.iter().any(|&b| b != 0));

    // Verify struct can be instantiated
    // Note: packed structs can't use assert_eq! on fields directly
    // (would create unaligned reference). Use raw read instead.
    let evt = Transferred {
        amount: 100,
        from: [0u8; 32],
    };
    let amount = unsafe { core::ptr::addr_of!(evt.amount).read_unaligned() };
    assert_eq!(amount, 100);

    // Note: emit() calls sol_log_data which is a syscall
    // — can't test on native, only verify struct compiles
}
