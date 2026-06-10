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
/// - Borrow flag ENGAGED (not merely read) on load_mut/init via the RAII guard
///   `arlex_lang::AccountRefMut` (constructed by `try_account_ref_mut`), so a
///   second `load_mut` of the same account fails WHILE the guard is live —
///   closing the aliasing `&mut`/`&mut` window. Unlike the removed
///   engage-and-forget helper, the guard's `Drop` RELEASES the borrow flag, so
///   a handler can scope/drop the guard before a CPI on the same account (PDA
///   signer or writable) and the checked CPI invoke succeeds. The immutable
///   `load` path uses the NON-ENGAGING `check_borrow` and returns `&Self` so
///   the legitimate read-then-mutate-same-account pattern stays legal. See
///   FINDING 1 in arlex-lang for the full rationale.
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
    // Used by has_one constraint for secure field lookup (no byte-scan).
    //
    // FINDING 4 (refined): If a field's size cannot be computed at macro time
    // (e.g. a type alias, or an array of a user struct), offsets of all
    // SUBSEQUENT fields are unknown. The ORIGINAL Medium bug silently `break`ed
    // here, dropping any later [u8; 32] pubkey field from the offset table —
    // has_one would then find no offset and ALWAYS fail (fail-closed DoS) with
    // no compile-time signal. A first fix hard-errored at the `#[account]`
    // definition whenever a pubkey followed an unsized field, but that
    // false-positives: it rejects a struct whose trailing pubkey is NEVER used
    // in a has_one (e.g. ownership-token's RevenueConfig, whose doc-mandated
    // layout places `areal_fee_destination: [u8;32]` after a user-struct array
    // and validates it manually in handlers).
    //
    // Refined model: `#[account]` records offsets only for pubkey fields it can
    // locate (those before the first unsized field) in PUBKEY_FIELD_OFFSETS,
    // and records the NAMES of the pubkey fields it CANNOT locate (those after
    // an unsized field) in PUBKEY_FIELDS_UNRESOLVABLE. The struct ALWAYS
    // compiles. The enforcement moves to the has_one usage site (in
    // accounts.rs): a `has_one` on a field listed in PUBKEY_FIELDS_UNRESOLVABLE
    // emits a compile_error there, while a has_one on a resolvable field works
    // as before. A struct that never uses has_one on the trailing pubkey
    // compiles cleanly; a has_one on an unresolvable pubkey still fails LOUDLY
    // at compile time. The security property (no silent fail-closed) is kept.
    let named: Vec<&syn::Field> = named_fields.iter().collect();
    let mut pubkey_offsets = Vec::new();
    let mut pubkey_unresolvable = Vec::new();
    let mut cumulative_offset: usize = 8; // start after 8-byte discriminator
    let mut offsets_known = true; // false once we pass a field of unknown size

    for field in named.iter() {
        let field_name = field.ident.as_ref().unwrap().to_string();
        let field_size = type_size(&field.ty);

        if is_pubkey_field(&field.ty) {
            if offsets_known {
                let offset_val = cumulative_offset;
                pubkey_offsets.push(quote! { (#field_name, #offset_val) });
            } else {
                // This pubkey field follows a field of macro-unknown size, so
                // its byte offset cannot be computed. Record it as unresolvable
                // so that any has_one referencing it fails at compile time
                // rather than silently failing closed at runtime.
                pubkey_unresolvable.push(quote! { #field_name });
            }
        }

        match field_size {
            Some(size) if offsets_known => cumulative_offset += size,
            // Once a field of unknown size is seen, every later offset is
            // unknowable. Keep scanning to catch all later pubkey fields, but
            // stop advancing the (now meaningless) cumulative offset.
            _ => offsets_known = false,
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

            /// Offsets of all [u8; 32] fields (pubkey candidates) whose byte
            /// offset the macro could compute (i.e. fields before the first
            /// field of macro-unknown size), measured after the 8-byte
            /// discriminator. Used by has_one for compile-time secure lookup.
            pub const PUBKEY_FIELD_OFFSETS: &'static [(&'static str, usize)] = &[
                #(#pubkey_offsets),*
            ];

            /// Names of [u8; 32] pubkey fields whose byte offset the macro
            /// could NOT compute, because a field of macro-unknown size (e.g. a
            /// type alias or an array of a user struct) precedes them. These
            /// are intentionally absent from PUBKEY_FIELD_OFFSETS. A `has_one`
            /// constraint targeting one of these fails at COMPILE time (see
            /// `accounts.rs`) instead of silently failing closed at runtime
            /// (the original FINDING 4 Medium bug). Validate such fields
            /// manually in handlers.
            pub const PUBKEY_FIELDS_UNRESOLVABLE: &'static [&'static str] = &[
                #(#pubkey_unresolvable),*
            ];

            /// Load account data (read-only).
            /// Checks: discriminator, size, owner, borrow state.
            ///
            /// Uses the NON-ENGAGING read-only borrow check (`check_borrow`):
            /// it verifies the account is not currently mutably borrowed but
            /// does NOT engage the borrow flag. This keeps the legitimate
            /// read-then-mutate-same-account pattern legal — a `load_mut` of the
            /// same account after a `load` still succeeds (see FINDING 1 in
            /// arlex-lang; the mut path engagement is what closes the aliasing
            /// `&mut`/`&mut` UB, while engaging the read path would instead break
            /// read-then-mutate and is therefore intentionally NOT done here).
            pub fn load<'a>(
                account: &'a pinocchio::AccountView,
                program_id: &pinocchio::Address,
            ) -> core::result::Result<&'a Self, pinocchio::error::ProgramError> {
                // Borrow check: ensure data is not already mutably borrowed.
                // Read-only check — does NOT engage the flag, so a later
                // load_mut of the same account can still engage it.
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
            ///
            /// Returns an RAII guard `arlex_lang::AccountRefMut<Self>` that
            /// engages the mutable borrow flag (via `try_account_ref_mut`,
            /// which actually sets the flag, unlike the read-only
            /// `check_borrow_mut`). Field reads/writes work through
            /// `Deref`/`DerefMut`. While the guard is LIVE a second `load_mut`
            /// (or `load_mut` after `init`/`load_mut`) of the SAME account
            /// returns Err instead of producing a second aliasing `&mut Self`.
            /// `load_mut` of DIFFERENT accounts all succeed (independent flags).
            ///
            /// The guard's `Drop` RELEASES the borrow flag — drop or scope it
            /// (copying out any needed fields/bump first) before a CPI that
            /// passes the same account as a signer or writable, otherwise the
            /// checked CPI invoke would reject the still-borrowed account.
            ///
            /// Note: a prior `load` (immutable, non-engaging) of the SAME
            /// account does NOT block this `load_mut` — the read path leaves the
            /// flag NOT_BORROWED, so read-then-mutate-same-account is legal.
            pub fn load_mut<'a>(
                account: &'a pinocchio::AccountView,
                program_id: &pinocchio::Address,
            ) -> core::result::Result<arlex_lang::AccountRefMut<'a, Self>, pinocchio::error::ProgramError> {
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
                // Engage the mutable borrow flag and return the RAII guard.
                // Fails (AccountBorrowFailed) if the account is already borrowed,
                // closing the aliasing &mut window. The flag is RELEASED when the
                // returned guard is dropped (Self begins at offset 8, after the
                // 8-byte discriminator). Writable checked above; exclusive access
                // is enforced by the engaged mutable borrow held in the guard.
                arlex_lang::try_account_ref_mut::<Self>(account, 8)
            }

            /// Initialize: write discriminator to account data.
            /// Checks: writable, size, owner, not already initialized, borrow state.
            ///
            /// Returns an RAII guard `arlex_lang::AccountRefMut<Self>` that
            /// engages the mutable borrow flag (see `load_mut`) so an `init`
            /// followed by a `load_mut`/`init`/`load` of the SAME account while
            /// the guard is LIVE returns Err instead of a second aliasing `&mut`
            /// (a following `load`'s read-only `check_borrow` sees the engaged
            /// mut flag and fails — only the reverse order, load-then-load_mut,
            /// is intentionally allowed via the non-engaging read path). The
            /// guard's `Drop` RELEASES the flag, so a subsequent CPI on the same
            /// account succeeds once the guard is dropped/scoped.
            pub fn init<'a>(
                account: &'a pinocchio::AccountView,
                program_id: &pinocchio::Address,
            ) -> core::result::Result<arlex_lang::AccountRefMut<'a, Self>, pinocchio::error::ProgramError> {
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
                // Write the discriminator to the first 8 bytes BEFORE engaging
                // the borrow guard. All preconditions (writable, owner, zeroed)
                // are already verified; no borrow is held yet, so this direct
                // write is sound and matches the previous behavior.
                let base = account.data_ptr();
                unsafe {
                    *base.add(0) = #d0; *base.add(1) = #d1;
                    *base.add(2) = #d2; *base.add(3) = #d3;
                    *base.add(4) = #d4; *base.add(5) = #d5;
                    *base.add(6) = #d6; *base.add(7) = #d7;
                }
                // Engage the mutable borrow flag and return the RAII guard over
                // the data past the discriminator. Fails if already borrowed.
                // The flag is RELEASED when the returned guard is dropped.
                arlex_lang::try_account_ref_mut::<Self>(account, 8)
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
