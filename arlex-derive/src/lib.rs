extern crate proc_macro;

use proc_macro::TokenStream;
use syn::{parse_macro_input, ItemMod, ItemStruct, ItemEnum, DeriveInput};

mod program;
mod account;
mod accounts;
mod error;
mod event;

/// #[program] — Generates entrypoint + instruction dispatch with Anchor-compatible discriminators.
#[proc_macro_attribute]
pub fn program(_attr: TokenStream, item: TokenStream) -> TokenStream {
    let module = parse_macro_input!(item as ItemMod);
    program::generate(module)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

/// #[account] — Zero-copy account data with discriminator, owner checks, safe init.
#[proc_macro_attribute]
pub fn account(_attr: TokenStream, item: TokenStream) -> TokenStream {
    let input = parse_macro_input!(item as ItemStruct);
    account::generate(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

/// #[derive(Accounts)] — Account validation with signer/writable/init constraints.
#[proc_macro_derive(Accounts, attributes(account, instruction))]
pub fn derive_accounts(item: TokenStream) -> TokenStream {
    let input = parse_macro_input!(item as DeriveInput);
    accounts::generate(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

/// #[error_code] — Typed error enum with numeric codes (starting at 6000) and log messages.
#[proc_macro_attribute]
pub fn error_code(_attr: TokenStream, item: TokenStream) -> TokenStream {
    let input = parse_macro_input!(item as ItemEnum);
    error::generate(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

/// #[event] — Typed event with discriminator, emitted via sol_log_data.
#[proc_macro_attribute]
pub fn event(_attr: TokenStream, item: TokenStream) -> TokenStream {
    let input = parse_macro_input!(item as ItemStruct);
    event::generate(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}
