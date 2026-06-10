use arlex_lang::prelude::*;

// FINDING 3: an explicit discriminant would silently corrupt the
// IDL <-> runtime error-code mapping (codes are 6000 + position, not the
// written value). The macro must reject it.
#[error_code]
pub enum MyError {
    Alpha,
    Beta = 99,
}

fn main() {}
