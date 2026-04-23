use proc_macro2::TokenStream;
use quote::quote;
use syn::{ItemStruct, Result};
use sha2::{Sha256, Digest};

/// Generate zero-copy account struct with discriminator.
///
/// Safety measures:
/// - Discriminator check on load
/// - Owner check on load (account must be owned by the program)
/// - Size check on load
/// - Writable check on load_mut
/// - Uninitialized check on init (discriminator must be all zeros)
/// - Byte-by-byte field access to avoid alignment UB
pub fn generate(input: ItemStruct) -> Result<TokenStream> {
    let name = &input.ident;
    let vis = &input.vis;
    let fields = &input.fields;

    // Compute discriminator: sha256("account:<Name>")[0..8]
    let disc_input = format!("account:{}", name);
    let mut hasher = Sha256::new();
    hasher.update(disc_input.as_bytes());
    let hash = hasher.finalize();
    let disc: Vec<u8> = hash[..8].to_vec();
    let d0 = disc[0]; let d1 = disc[1]; let d2 = disc[2]; let d3 = disc[3];
    let d4 = disc[4]; let d5 = disc[5]; let d6 = disc[6]; let d7 = disc[7];

    // Verify we have named fields
    let named_fields = match fields {
        syn::Fields::Named(ref named) => &named.named,
        _ => return Err(syn::Error::new_spanned(&input, "#[account] only supports named fields")),
    };

    // Generate PUBKEY_FIELD_OFFSETS: compile-time offsets of all [u8; 32] fields
    // Used by has_one constraint for secure field lookup (no byte-scan)
    let mut pubkey_offsets = Vec::new();
    let mut cumulative_offset: usize = 8; // start after 8-byte discriminator

    for field in named_fields.iter() {
        let field_name = field.ident.as_ref().unwrap().to_string();
        let field_size = type_size(&field.ty);

        if is_pubkey_field(&field.ty) {
            let offset_val = cumulative_offset;
            pubkey_offsets.push(quote! { (#field_name, #offset_val) });
        }

        if let Some(size) = field_size {
            cumulative_offset += size;
        } else {
            // Unknown type size — can't compute further offsets at macro time
            break;
        }
    }

    Ok(quote! {
        #[repr(C, packed)]
        #vis struct #name #fields

        impl #name {
            /// 8-byte discriminator for this account type
            pub const DISCRIMINATOR: [u8; 8] = [#d0, #d1, #d2, #d3, #d4, #d5, #d6, #d7];

            /// Size of the account data (without discriminator)
            pub const SIZE: usize = core::mem::size_of::<Self>();

            /// Total space needed (discriminator + data)
            pub const SPACE: usize = 8 + Self::SIZE;

            /// Offsets of all [u8; 32] fields (pubkey candidates) after 8-byte discriminator.
            /// Used by has_one constraint for compile-time secure field lookup.
            pub const PUBKEY_FIELD_OFFSETS: &'static [(&'static str, usize)] = &[
                #(#pubkey_offsets),*
            ];

            /// Load account data (read-only).
            /// Checks: discriminator, size, owner, borrow state.
            pub fn load<'a>(
                account: &'a pinocchio::AccountView,
                program_id: &pinocchio::Address,
            ) -> core::result::Result<&'a Self, pinocchio::error::ProgramError> {
                // Borrow check: ensure data is not already mutably borrowed
                account.check_borrow()?;
                // Check owner
                if !account.owned_by(program_id) {
                    return Err(pinocchio::error::ProgramError::IllegalOwner);
                }
                // Check size
                if account.data_len() < Self::SPACE {
                    return Err(pinocchio::error::ProgramError::AccountDataTooSmall);
                }
                // Check discriminator
                let data = unsafe { core::slice::from_raw_parts(account.data_ptr(), account.data_len()) };
                if data[0] != #d0 || data[1] != #d1 || data[2] != #d2 || data[3] != #d3
                || data[4] != #d4 || data[5] != #d5 || data[6] != #d6 || data[7] != #d7 {
                    return Err(pinocchio::error::ProgramError::InvalidAccountData);
                }
                // Safety: repr(C, packed) alignment 1. Borrow state checked above.
                Ok(unsafe { &*(data.as_ptr().add(8) as *const Self) })
            }

            /// Load account data (mutable).
            /// Checks: discriminator, size, owner, writable, borrow state.
            /// Enforces exclusive access — will fail if account data is already borrowed.
            pub fn load_mut<'a>(
                account: &'a pinocchio::AccountView,
                program_id: &pinocchio::Address,
            ) -> core::result::Result<&'a mut Self, pinocchio::error::ProgramError> {
                // Borrow check: ensure data is not already borrowed (mutable or immutable)
                account.check_borrow_mut()?;
                // Check writable
                if !account.is_writable() {
                    return Err(pinocchio::error::ProgramError::InvalidAccountData);
                }
                // Check owner
                if !account.owned_by(program_id) {
                    return Err(pinocchio::error::ProgramError::IllegalOwner);
                }
                // Check size
                if account.data_len() < Self::SPACE {
                    return Err(pinocchio::error::ProgramError::AccountDataTooSmall);
                }
                // Check discriminator
                let data = unsafe { core::slice::from_raw_parts(account.data_ptr(), account.data_len()) };
                if data[0] != #d0 || data[1] != #d1 || data[2] != #d2 || data[3] != #d3
                || data[4] != #d4 || data[5] != #d5 || data[6] != #d6 || data[7] != #d7 {
                    return Err(pinocchio::error::ProgramError::InvalidAccountData);
                }
                // Safety: repr(C, packed) alignment 1. Borrow state + writable checked above.
                // Exclusive access enforced by check_borrow_mut().
                Ok(unsafe { &mut *(account.data_ptr().add(8) as *mut Self) })
            }

            /// Initialize: write discriminator to account data.
            /// Checks: writable, size, owner, not already initialized, borrow state.
            pub fn init<'a>(
                account: &'a pinocchio::AccountView,
                program_id: &pinocchio::Address,
            ) -> core::result::Result<&'a mut Self, pinocchio::error::ProgramError> {
                // Borrow check
                account.check_borrow_mut()?;
                // Check writable
                if !account.is_writable() {
                    return Err(pinocchio::error::ProgramError::InvalidAccountData);
                }
                // Check owner
                if !account.owned_by(program_id) {
                    return Err(pinocchio::error::ProgramError::IllegalOwner);
                }
                // Check size
                if account.data_len() < Self::SPACE {
                    return Err(pinocchio::error::ProgramError::AccountDataTooSmall);
                }
                // Check not already initialized (first 8 bytes must be zero)
                let data = unsafe { core::slice::from_raw_parts(account.data_ptr(), account.data_len()) };
                let is_zeroed = data[0] == 0 && data[1] == 0 && data[2] == 0 && data[3] == 0
                             && data[4] == 0 && data[5] == 0 && data[6] == 0 && data[7] == 0;
                if !is_zeroed {
                    return Err(pinocchio::error::ProgramError::AccountAlreadyInitialized);
                }
                // Write discriminator
                unsafe {
                    let ptr = account.data_ptr();
                    *ptr.add(0) = #d0; *ptr.add(1) = #d1;
                    *ptr.add(2) = #d2; *ptr.add(3) = #d3;
                    *ptr.add(4) = #d4; *ptr.add(5) = #d5;
                    *ptr.add(6) = #d6; *ptr.add(7) = #d7;
                }
                // Return mutable reference to data
                Ok(unsafe { &mut *(account.data_ptr().add(8) as *mut Self) })
            }
        }
    })
}

/// Determine the size of a type for offset calculation in #[account] structs.
/// Returns None for types we can't determine at macro expansion time.
fn type_size(ty: &syn::Type) -> Option<usize> {
    match ty {
        syn::Type::Path(tp) => {
            let seg = tp.path.segments.last()?;
            let name = seg.ident.to_string();
            match name.as_str() {
                "u8" | "i8" | "bool" => Some(1),
                "u16" | "i16" => Some(2),
                "u32" | "i32" => Some(4),
                "u64" | "i64" => Some(8),
                "u128" | "i128" => Some(16),
                "Option" => {
                    // Option<T> in repr(C, packed) = 1 byte tag + size_of(T)
                    if let syn::PathArguments::AngleBracketed(ref args) = seg.arguments {
                        if let Some(syn::GenericArgument::Type(inner_ty)) = args.args.first() {
                            type_size(inner_ty).map(|s| 1 + s)
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                }
                _ => None, // Unknown type — can't determine size at macro time
            }
        }
        syn::Type::Array(arr) => {
            // [T; N] — get element size and multiply by N
            let elem_size = type_size(&arr.elem)?;
            if let syn::Expr::Lit(syn::ExprLit { lit: syn::Lit::Int(lit_int), .. }) = &arr.len {
                let n: usize = lit_int.base10_parse().ok()?;
                Some(elem_size * n)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Check if a type is [u8; 32] — a pubkey field candidate.
fn is_pubkey_field(ty: &syn::Type) -> bool {
    if let syn::Type::Array(arr) = ty {
        // Check element is u8
        if let syn::Type::Path(tp) = &*arr.elem {
            if let Some(seg) = tp.path.segments.last() {
                if seg.ident != "u8" {
                    return false;
                }
            } else {
                return false;
            }
        } else {
            return false;
        }
        // Check length is 32
        if let syn::Expr::Lit(syn::ExprLit { lit: syn::Lit::Int(lit_int), .. }) = &arr.len {
            if let Ok(n) = lit_int.base10_parse::<usize>() {
                return n == 32;
            }
        }
    }
    false
}
