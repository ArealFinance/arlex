use arlex_lang::prelude::*;
// Should fail: #[error_code] expects enum
#[error_code]
pub struct Bad {
    pub code: u32,
}
fn main() {}
