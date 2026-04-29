use proc_macro2::TokenStream;
use quote::quote;
use syn::{DeriveInput, Result, Data, Fields, Error, Expr, Ident, Token, parse::Parse, parse::ParseStream};

// ============================================================
// Constraint types
// ============================================================

struct HasOneConstraint {
    target: Ident,
    account_type: Option<Ident>,
}

struct AccountConstraints {
    is_signer: bool,
    is_mut: bool,
    is_init: bool,
    payer: Option<Ident>,
    space: Option<Expr>,
    seeds: Option<Vec<Expr>>,
    bump: bool,
    has_one: Vec<HasOneConstraint>,
    close: Option<Ident>,
    constraint: Option<Expr>,
    owner: Option<Expr>,
}

impl Default for AccountConstraints {
    fn default() -> Self {
        Self {
            is_signer: false, is_mut: false, is_init: false,
            payer: None, space: None, seeds: None, bump: false,
            has_one: Vec::new(), close: None, constraint: None, owner: None,
        }
    }
}

// ============================================================
// Custom parser for #[account(...)] — handles seeds = [expr, expr, ...]
// ============================================================

enum Constraint {
    Signer,
    Mut,
    Init,
    Bump,
    Payer(Ident),
    Space(Expr),
    Seeds(Vec<Expr>),
    HasOne { target: Ident, account_type: Option<Ident> },
    AccountType(Ident),
    Close(Ident),
    ConstraintExpr(Expr),
    Owner(Expr),
}

impl Parse for Constraint {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        // Handle `mut` keyword specially — it's a Rust keyword, not an ident
        if input.peek(Token![mut]) {
            let _: Token![mut] = input.parse()?;
            return Ok(Constraint::Mut);
        }

        let ident: Ident = input.parse()?;
        let name = ident.to_string();

        match name.as_str() {
            "signer" => Ok(Constraint::Signer),
            "writable" => Ok(Constraint::Mut),
            "init" => Ok(Constraint::Init),
            "bump" => Ok(Constraint::Bump),
            "payer" => {
                let _: Token![=] = input.parse()?;
                let val: Ident = input.parse()?;
                Ok(Constraint::Payer(val))
            }
            "space" => {
                let _: Token![=] = input.parse()?;
                let val: Expr = input.parse()?;
                Ok(Constraint::Space(val))
            }
            "seeds" => {
                let _: Token![=] = input.parse()?;
                let content;
                syn::bracketed!(content in input);
                let exprs = content.parse_terminated(Expr::parse, Token![,])?;
                Ok(Constraint::Seeds(exprs.into_iter().collect()))
            }
            "has_one" => {
                let _: Token![=] = input.parse()?;
                let val: Ident = input.parse()?;
                Ok(Constraint::HasOne { target: val, account_type: None })
            }
            "account_type" => {
                let _: Token![=] = input.parse()?;
                // Parse as string literal: account_type = "TypeName"
                let lit: syn::LitStr = input.parse()?;
                let ty_ident = Ident::new(&lit.value(), lit.span());
                Ok(Constraint::AccountType(ty_ident))
            }
            "close" => {
                let _: Token![=] = input.parse()?;
                let val: Ident = input.parse()?;
                Ok(Constraint::Close(val))
            }
            "constraint" => {
                let _: Token![=] = input.parse()?;
                let val: Expr = input.parse()?;
                Ok(Constraint::ConstraintExpr(val))
            }
            "owner" => {
                let _: Token![=] = input.parse()?;
                let val: Expr = input.parse()?;
                Ok(Constraint::Owner(val))
            }
            _ => Err(syn::Error::new(ident.span(), format!("unknown constraint: {}", name))),
        }
    }
}

struct ConstraintList(Vec<Constraint>);

impl Parse for ConstraintList {
    fn parse(input: ParseStream) -> syn::Result<Self> {
        let items = input.parse_terminated(Constraint::parse, Token![,])?;
        Ok(ConstraintList(items.into_iter().collect()))
    }
}

fn parse_constraints(attr: &syn::Attribute) -> Result<AccountConstraints> {
    let list: ConstraintList = attr.parse_args()?;
    let mut c = AccountConstraints::default();

    for item in list.0 {
        match item {
            Constraint::Signer => c.is_signer = true,
            Constraint::Mut => c.is_mut = true,
            Constraint::Init => { c.is_init = true; c.is_mut = true; }
            Constraint::Bump => c.bump = true,
            Constraint::Payer(id) => c.payer = Some(id),
            Constraint::Space(e) => c.space = Some(e),
            Constraint::Seeds(s) => c.seeds = Some(s),
            Constraint::HasOne { target, account_type } => {
                c.has_one.push(HasOneConstraint { target, account_type });
            }
            Constraint::AccountType(ty) => {
                // Associate account_type with the most recently added has_one
                if let Some(last) = c.has_one.last_mut() {
                    last.account_type = Some(ty);
                } else {
                    return Err(Error::new(
                        ty.span(),
                        "account_type must follow a has_one constraint",
                    ));
                }
            }
            Constraint::Close(id) => { c.close = Some(id); c.is_mut = true; }
            Constraint::ConstraintExpr(e) => c.constraint = Some(e),
            Constraint::Owner(e) => c.owner = Some(e),
        }
    }

    Ok(c)
}

// ============================================================
// Code generation
// ============================================================

pub fn generate(input: DeriveInput) -> Result<TokenStream> {
    let name = &input.ident;
    let generics = &input.generics;

    let fields = match &input.data {
        Data::Struct(data) => match &data.fields {
            Fields::Named(named) => &named.named,
            _ => return Err(Error::new_spanned(&input, "Accounts must have named fields")),
        },
        _ => return Err(Error::new_spanned(&input, "Accounts must be a struct")),
    };

    let mut pre_validations = Vec::new();
    let mut validations = Vec::new();
    let mut post_validations = Vec::new();
    let mut field_assignments = Vec::new();
    let field_count = fields.len();

    let field_names: Vec<&Ident> = fields.iter()
        .map(|f| f.ident.as_ref().unwrap())
        .collect();

    // Pre-validation: account count + duplicates
    pre_validations.push(quote! {
        if accounts.len() < #field_count {
            arlex_lang::log("Arlex: not enough accounts");
            return Err(pinocchio::error::ProgramError::NotEnoughAccountKeys);
        }
        // NOTE: No blanket duplicate check. Solana runtime allows the same account
        // to appear multiple times (e.g. authority == payer, common in DeFi).
        // Security-critical uniqueness is enforced by PDA seeds + has_one constraints.
    });

    for (i, field) in fields.iter().enumerate() {
        let field_name = field.ident.as_ref().unwrap();
        let idx = i;

        let mut constraints = AccountConstraints::default();
        for attr in &field.attrs {
            if attr.path().is_ident("account") {
                constraints = parse_constraints(attr)?;
            }
        }

        // --- Signer ---
        if constraints.is_signer {
            validations.push(quote! {
                if !accounts[#idx].is_signer() {
                    arlex_lang::log(concat!("Arlex: missing signer for '", stringify!(#field_name), "'"));
                    return Err(pinocchio::error::ProgramError::MissingRequiredSignature);
                }
            });
        }

        // --- Writable ---
        if constraints.is_mut {
            validations.push(quote! {
                if !accounts[#idx].is_writable() {
                    arlex_lang::log(concat!("Arlex: '", stringify!(#field_name), "' must be writable"));
                    return Err(pinocchio::error::ProgramError::InvalidAccountData);
                }
            });
        }

        // --- Init: CPI create_account + check uninitialized ---
        if constraints.is_init {
            if let (Some(payer), Some(space_expr)) = (&constraints.payer, &constraints.space) {
                let payer_idx = field_names.iter().position(|n| **n == *payer)
                    .ok_or_else(|| Error::new_spanned(payer, "payer field not found"))?;

                // If seeds + bump present, init PDA via create_account_with_seed or invoke_signed
                if let Some(ref seed_exprs) = constraints.seeds {
                    post_validations.push(quote! {
                        {
                            let space: u64 = (#space_expr) as u64;
                            let seed_slices: &[&[u8]] = &[#(#seed_exprs),*];
                            let (expected_key, bump_seed) = arlex_lang::find_program_address(
                                seed_slices,
                                program_id,
                            );
                            if accounts[#idx].address() != &expected_key {
                                arlex_lang::log(concat!("Arlex: PDA mismatch for '", stringify!(#field_name), "'"));
                                return Err(pinocchio::error::ProgramError::InvalidSeeds);
                            }
                            let bump_arr = [bump_seed];
                            let mut signer_seeds: Vec<&[u8]> = seed_slices.to_vec();
                            signer_seeds.push(&bump_arr);

                            let rent_lamports: u64 = {
                                use pinocchio::sysvars::Sysvar;
                                pinocchio::sysvars::rent::Rent::get()
                                    .map(|r| r.minimum_balance(space as usize))
                                    .unwrap_or((space + 128) * 6960 * 3 / 2)
                            };

                            arlex_lang::create_pda_account(
                                &accounts[#payer_idx],
                                &accounts[#idx],
                                rent_lamports,
                                space,
                                program_id,
                                &signer_seeds,
                                accounts,
                            )?;
                        }
                    });
                } else {
                    // Init without PDA — simple create_account (no signer seeds)
                    post_validations.push(quote! {
                        {
                            let space: u64 = (#space_expr) as u64;
                            let rent_lamports: u64 = {
                                use pinocchio::sysvars::Sysvar;
                                pinocchio::sysvars::rent::Rent::get()
                                    .map(|r| r.minimum_balance(space as usize))
                                    .unwrap_or((space + 128) * 6960 * 3 / 2)
                            };

                            arlex_lang::create_pda_account(
                                &accounts[#payer_idx],
                                &accounts[#idx],
                                rent_lamports,
                                space,
                                program_id,
                                &[],  // no signer seeds for non-PDA
                                accounts,
                            )?;
                        }
                    });
                }
            } else if constraints.payer.is_none() || constraints.space.is_none() {
                return Err(Error::new_spanned(field_name,
                    "init requires both 'payer' and 'space' constraints"));
            }

            // Check uninitialized (data must be zeroed)
            validations.push(quote! {
                {
                    if accounts[#idx].data_len() >= 8 {
                        let init_data = unsafe {
                            core::slice::from_raw_parts(accounts[#idx].data_ptr(), 8)
                        };
                        if init_data.iter().any(|&b| b != 0) {
                            arlex_lang::log(concat!("Arlex: '", stringify!(#field_name), "' already initialized"));
                            return Err(pinocchio::error::ProgramError::AccountAlreadyInitialized);
                        }
                    }
                }
            });
        }

        // --- Seeds + bump without init: PDA verification only ---
        if !constraints.is_init {
            if let Some(ref seed_exprs) = constraints.seeds {
                post_validations.push(quote! {
                    {
                        let seed_slices: &[&[u8]] = &[#(#seed_exprs),*];
                        let (expected_key, _bump) = arlex_lang::find_program_address(
                            seed_slices,
                            program_id,
                        );
                        if accounts[#idx].address() != &expected_key {
                            arlex_lang::log(concat!("Arlex: PDA mismatch for '", stringify!(#field_name), "'"));
                            return Err(pinocchio::error::ProgramError::InvalidSeeds);
                        }
                    }
                });
            }
        }

        // --- has_one: verify account data contains a pubkey matching another account ---
        // SECURITY: account_type is REQUIRED. No byte-scan fallback.
        // Byte-scan is exploitable when account contains user-controllable non-pubkey fields
        // (attacker can craft adjacent numeric fields whose bytes match a target pubkey).
        for has_one_constraint in &constraints.has_one {
            let has_one_target = &has_one_constraint.target;
            let _target_idx = field_names.iter().position(|n| **n == *has_one_target)
                .ok_or_else(|| Error::new_spanned(has_one_target, "has_one target not found"))?;
            let target_name = has_one_target;

            let acct_type = has_one_constraint.account_type.as_ref()
                .ok_or_else(|| Error::new_spanned(
                    has_one_target,
                    "has_one requires account_type for security. \
                     Use: has_one = field, account_type = \"AccountStructName\"",
                ))?;

            let target_field_name = target_name.to_string();

            post_validations.push(quote! {
                {
                    // Owner check: account must belong to this program
                    if !#field_name.owned_by(program_id) {
                        arlex_lang::log(concat!(
                            "Arlex: has_one owner check failed for '",
                            stringify!(#field_name), "'"
                        ));
                        return Err(pinocchio::error::ProgramError::IllegalOwner);
                    }
                    // Secure lookup via compile-time PUBKEY_FIELD_OFFSETS
                    let data_len = #field_name.data_len();
                    let target_key = #target_name.address().as_ref();
                    let mut found = false;
                    let data = unsafe {
                        core::slice::from_raw_parts(#field_name.data_ptr(), data_len)
                    };
                    for &(name, offset) in #acct_type::PUBKEY_FIELD_OFFSETS {
                        if name == #target_field_name && offset + 32 <= data_len {
                            if &data[offset..offset + 32] == target_key {
                                found = true;
                                break;
                            }
                        }
                    }
                    if !found {
                        arlex_lang::log(concat!(
                            "Arlex: has_one failed: '",
                            stringify!(#field_name),
                            "' does not contain '",
                            stringify!(#has_one_target), "'"
                        ));
                        return Err(pinocchio::error::ProgramError::InvalidAccountData);
                    }
                }
            });
        }

        // --- close: transfer lamports to recipient, zero data via pinocchio API ---
        if let Some(ref close_to) = constraints.close {
            let _close_idx = field_names.iter().position(|n| **n == *close_to)
                .ok_or_else(|| Error::new_spanned(close_to, "close target not found"))?;
            let close_name = close_to;

            post_validations.push(quote! {
                {
                    // Transfer all lamports to close target using pinocchio's safe API
                    let source_lamports = #field_name.lamports();
                    let dest_lamports = #close_name.lamports();
                    let new_dest_lamports = dest_lamports.checked_add(source_lamports)
                        .ok_or(pinocchio::error::ProgramError::ArithmeticOverflow)?;
                    #close_name.set_lamports(new_dest_lamports);
                    #field_name.set_lamports(0);

                    // Zero out all account data (prevents resurrection/replay attacks)
                    // Then close the account (sets data_len to 0)
                    unsafe {
                        core::ptr::write_bytes(
                            #field_name.data_ptr(),
                            0,
                            #field_name.data_len(),
                        );
                    }
                    // Close the account via pinocchio (handles resize_delta)
                    #field_name.close()?;
                }
            });
        }

        // --- Custom constraint ---
        if let Some(ref expr) = constraints.constraint {
            validations.push(quote! {
                if !(#expr) {
                    arlex_lang::log(concat!("Arlex: constraint failed for '", stringify!(#field_name), "'"));
                    return Err(pinocchio::error::ProgramError::InvalidAccountData);
                }
            });
        }

        // --- Custom owner ---
        if let Some(ref owner_expr) = constraints.owner {
            validations.push(quote! {
                if !accounts[#idx].owned_by(&#owner_expr) {
                    arlex_lang::log(concat!("Arlex: wrong owner for '", stringify!(#field_name), "'"));
                    return Err(pinocchio::error::ProgramError::IllegalOwner);
                }
            });
        }

        field_assignments.push(quote! {
            #field_name: &accounts[#idx]
        });
    }

    // Generate let bindings so seed expressions can reference fields by name
    // e.g. seeds = [b"prefix", authority.address().as_ref()] works because
    // we emit: let authority = &accounts[0];
    let field_bindings: Vec<_> = field_names.iter().enumerate().map(|(i, name)| {
        quote! { let #name = &accounts[#i]; }
    }).collect();

    // Check if struct has lifetime parameter
    let has_lifetime = generics.lifetimes().count() > 0;

    // R46 (Layer 10 closure): validate returns `Box<Self>` so the SBF
    // dispatcher's worst-case match-arm union doesn't reserve worst-case
    // stack for the largest Accounts struct across all ix. Heap allocation
    // moves the field-references (~16-24B per field) off the dispatcher
    // frame; the Box itself is 8 bytes on stack. Consumers access fields
    // transparently via `Box<T>: Deref<Target = T>`.
    let (validate_sig, impl_block) = if has_lifetime {
        // Struct has 'info lifetime — tie it to accounts parameter
        (
            quote! {
                pub fn validate(
                    accounts: &'info [pinocchio::AccountView],
                    program_id: &pinocchio::Address,
                ) -> core::result::Result<arlex_lang::Box<Self>, pinocchio::error::ProgramError>
            },
            quote! { impl #generics #name #generics },
        )
    } else {
        (
            quote! {
                pub fn validate(
                    accounts: &[pinocchio::AccountView],
                    program_id: &pinocchio::Address,
                ) -> core::result::Result<arlex_lang::Box<Self>, pinocchio::error::ProgramError>
            },
            quote! { impl #name },
        )
    };

    Ok(quote! {
        #impl_block {
            pub const ACCOUNT_COUNT: usize = #field_count;

            #validate_sig {
                #(#pre_validations)*

                // Bind field names to account references so constraint expressions
                // (seeds, has_one, constraint) can reference accounts by name.
                #(#field_bindings)*

                #(#validations)*
                #(#post_validations)*

                Ok(arlex_lang::Box::new(Self {
                    #(#field_assignments),*
                }))
            }
        }
    })
}
