use proc_macro2::TokenStream;
use quote::quote;
use syn::{ItemStruct, Result, Fields};
use sha2::{Sha256, Digest};

/// Generate event struct with discriminator and emit via sol_log_data.
/// Discriminator: sha256("event:<EventName>")[0..8] — Anchor-compatible.
pub fn generate(input: ItemStruct) -> Result<TokenStream> {
    let name = &input.ident;
    let vis = &input.vis;
    let fields = &input.fields;

    match fields {
        Fields::Named(_) => {},
        _ => return Err(syn::Error::new_spanned(&input, "#[event] requires named fields")),
    };

    // Compute event discriminator: sha256("event:<Name>")[0..8]
    let disc_input = format!("event:{}", name);
    let mut hasher = Sha256::new();
    hasher.update(disc_input.as_bytes());
    let hash = hasher.finalize();
    let disc: Vec<u8> = hash[..8].to_vec();
    let d0 = disc[0]; let d1 = disc[1]; let d2 = disc[2]; let d3 = disc[3];
    let d4 = disc[4]; let d5 = disc[5]; let d6 = disc[6]; let d7 = disc[7];

    Ok(quote! {
        #[repr(C, packed)]
        #vis struct #name #fields

        impl #name {
            /// 8-byte event discriminator (Anchor-compatible)
            pub const DISCRIMINATOR: [u8; 8] = [#d0, #d1, #d2, #d3, #d4, #d5, #d6, #d7];

            /// Emit event via sol_log_data with discriminator prefix
            pub fn emit(&self) {
                let disc = Self::DISCRIMINATOR;
                let data = unsafe {
                    core::slice::from_raw_parts(
                        self as *const Self as *const u8,
                        core::mem::size_of::<Self>(),
                    )
                };
                // Use arlex_lang::solana_program_log::log_data for cross-target compatibility
                arlex_lang::solana_program_log::log_data(&[&disc, data]);
            }
        }
    })
}
