use arlex_lang::prelude::*;

// FINDING 3: a non-unit variant (one carrying fields) is incompatible with the
// generated bare-variant codegen and the IDL mapping. The macro must reject it.
#[error_code]
pub enum MyError {
    Alpha,
    Beta(u64),
}

fn main() {}
