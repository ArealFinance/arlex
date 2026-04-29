use proc_macro2::TokenStream;
use quote::quote;
use syn::{ItemMod, Item, Result, Error, FnArg, Pat, Type, PathArguments, GenericArgument};
use sha2::{Sha256, Digest};

/// Extract the Accounts type name from Context<T> in the first parameter
fn extract_accounts_type(func: &syn::ItemFn) -> Result<Option<syn::Ident>> {
    let first_param = match func.sig.inputs.first() {
        Some(FnArg::Typed(pt)) => pt,
        _ => return Ok(None),
    };

    // Look for Context<SomeType> pattern
    if let Type::Path(type_path) = first_param.ty.as_ref() {
        if let Some(segment) = type_path.path.segments.last() {
            if segment.ident == "Context" {
                if let PathArguments::AngleBracketed(args) = &segment.arguments {
                    if let Some(GenericArgument::Type(Type::Path(inner_path))) = args.args.first() {
                        if let Some(inner_seg) = inner_path.path.segments.last() {
                            return Ok(Some(inner_seg.ident.clone()));
                        }
                    }
                }
            }
        }
    }
    Ok(None)
}

/// Generate entrypoint + dispatch from #[program] module
pub fn generate(module: ItemMod) -> Result<TokenStream> {
    let mod_name = &module.ident;

    let content = module.content.as_ref()
        .ok_or_else(|| Error::new_spanned(&module, "#[program] module must have a body"))?;

    let mut dispatch_arms = Vec::new();
    let mut fn_defs = Vec::new();

    for item in &content.1 {
        if let Item::Fn(func) = item {
            let fn_name = &func.sig.ident;
            let fn_name_str = fn_name.to_string();

            // Compute Anchor-compatible discriminator: sha256("global:<fn_name>")[0..8]
            let disc_input = format!("global:{}", fn_name_str);
            let mut hasher = Sha256::new();
            hasher.update(disc_input.as_bytes());
            let hash = hasher.finalize();
            let disc_bytes: [u8; 8] = hash[..8].try_into().unwrap();

            let d0 = disc_bytes[0]; let d1 = disc_bytes[1];
            let d2 = disc_bytes[2]; let d3 = disc_bytes[3];
            let d4 = disc_bytes[4]; let d5 = disc_bytes[5];
            let d6 = disc_bytes[6]; let d7 = disc_bytes[7];

            // Extract Accounts type from Context<T>
            let accounts_type = extract_accounts_type(func)?;

            // Build account validation call
            let validate_and_ctx = if let Some(ref acc_type) = accounts_type {
                quote! {
                    let validated = #acc_type::validate(accounts, program_id)?;
                    let ctx = arlex_lang::Context {
                        program_id,
                        accounts: validated,
                        remaining_accounts: if accounts.len() > #acc_type::ACCOUNT_COUNT {
                            &accounts[#acc_type::ACCOUNT_COUNT..]
                        } else {
                            &[]
                        },
                    };
                }
            } else {
                quote! {
                    let ctx = arlex_lang::Context {
                        program_id,
                        // R46: Context.accounts is Box<T> for stack-frame
                        // discipline; () handlers carry a zero-sized Box.
                        accounts: arlex_lang::Box::new(()),
                        remaining_accounts: accounts,
                    };
                }
            };

            // Collect arg names/types after ctx for deserialization
            // Use a single mutable slice reference for sequential deserialization
            let mut arg_names = Vec::new();
            let mut arg_types = Vec::new();

            for (i, param) in func.sig.inputs.iter().enumerate() {
                if i == 0 { continue; } // skip ctx
                if let FnArg::Typed(pat_type) = param {
                    if let Pat::Ident(ident) = pat_type.pat.as_ref() {
                        arg_names.push(ident.ident.clone());
                        arg_types.push(pat_type.ty.clone());
                    }
                }
            }

            // Generate sequential deserialization from a single mutable slice
            let deser_block = if arg_names.is_empty() {
                quote! {}
            } else {
                let reads: Vec<_> = arg_names.iter().zip(arg_types.iter()).map(|(name, ty)| {
                    quote! {
                        let #name = <#ty as arlex_lang::ArgsDeserialize>::deserialize(&mut ix_reader)?;
                    }
                }).collect();
                quote! {
                    let mut ix_reader: &[u8] = &data[8..];
                    #(#reads)*
                }
            };

            let arg_list = &arg_names;

            dispatch_arms.push(quote! {
                [#d0, #d1, #d2, #d3, #d4, #d5, #d6, #d7] => {
                    #deser_block
                    #validate_and_ctx
                    #mod_name::#fn_name(ctx, #(#arg_list),*)
                }
            });

            fn_defs.push(func.clone());
        }
    }

    let vis = &module.vis;

    Ok(quote! {
        #vis mod #mod_name {
            use super::*;

            #(#fn_defs)*
        }

        // Entrypoint generated by Arlex
        pinocchio::entrypoint!(__arlex_entrypoint);

        pub fn __arlex_entrypoint(
            program_id: &pinocchio::Address,
            accounts: &[pinocchio::AccountView],
            data: &[u8],
        ) -> pinocchio::ProgramResult {
            if data.len() < 8 {
                return Err(pinocchio::error::ProgramError::InvalidInstructionData);
            }

            let disc: [u8; 8] = data[..8].try_into().unwrap();

            match disc {
                #(#dispatch_arms,)*
                _ => Err(pinocchio::error::ProgramError::InvalidInstructionData),
            }
        }
    })
}
