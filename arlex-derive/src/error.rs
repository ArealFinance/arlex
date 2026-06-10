use proc_macro2::TokenStream;
use quote::quote;
use syn::{ItemEnum, Result};

/// Generate typed errors from #[error_code] enum.
/// Error codes start at 6000 (Anchor convention).
/// #[msg("...")] attributes are logged when error is converted.
pub fn generate(input: ItemEnum) -> Result<TokenStream> {
    let name = &input.ident;
    let vis = &input.vis;
    let variants = &input.variants;

    let base_code: u32 = 6000;

    let mut variant_defs = Vec::new();
    let mut match_arms = Vec::new();

    for (i, variant) in variants.iter().enumerate() {
        let var_name = &variant.ident;

        // FINDING 3 (macro side): error codes are assigned as 6000 + structural
        // position. An explicit discriminant (e.g. `Beta = 99`) or a non-unit
        // variant (one with fields) would silently corrupt the IDL <-> runtime
        // mapping, so reject both at compile time.
        if variant.discriminant.is_some() || !matches!(variant.fields, syn::Fields::Unit) {
            return Err(syn::Error::new_spanned(
                variant,
                "error_code variants must be unit variants without explicit \
                 discriminants (codes are assigned 6000 + position)",
            ));
        }

        let code = base_code + i as u32;

        // Extract #[msg("...")] attribute
        let mut msg = format!("Error: {}", var_name);
        for attr in &variant.attrs {
            if attr.path().is_ident("msg") {
                if let Ok(lit) = attr.parse_args::<syn::LitStr>() {
                    msg = lit.value();
                }
            }
        }

        variant_defs.push(quote! { #var_name });
        match_arms.push(quote! {
            #name::#var_name => {
                arlex_lang::log(#msg);
                pinocchio::error::ProgramError::Custom(#code)
            }
        });
    }

    Ok(quote! {
        #vis enum #name {
            #(#variant_defs,)*
        }

        impl From<#name> for pinocchio::error::ProgramError {
            fn from(e: #name) -> Self {
                match e {
                    #(#match_arms,)*
                }
            }
        }
    })
}
