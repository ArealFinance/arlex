use arlex_lang::prelude::*;

#[error_code]
pub enum MyError {
    #[msg("Not authorized")]
    Unauthorized,
    #[msg("Amount is zero")]
    ZeroAmount,
}

fn main() {
    // Verify conversion to ProgramError
    let err: ProgramError = MyError::Unauthorized.into();
    match err {
        ProgramError::Custom(code) => assert_eq!(code, 6000),
        _ => panic!("Expected Custom error"),
    }

    let err2: ProgramError = MyError::ZeroAmount.into();
    match err2 {
        ProgramError::Custom(code) => assert_eq!(code, 6001),
        _ => panic!("Expected Custom error"),
    }
}
