use colored::Colorize;
use std::fs;
use std::path::Path;
use crate::common;

pub fn run(name: &str) -> Result<(), String> {
    common::validate_project_name(name)?;

    let project_dir = Path::new(name);
    if project_dir.exists() {
        return Err(format!("Directory '{}' already exists", name));
    }

    // Resolve arlex-lang path relative to the CLI binary
    let arlex_lang_path = resolve_arlex_lang_path();

    println!("{} Creating Arlex project '{}'...", "→".cyan(), name);

    let src_dir = project_dir.join("src");
    let tests_dir = project_dir.join("tests");
    fs::create_dir_all(&src_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&tests_dir).map_err(|e| e.to_string())?;

    let cargo_toml = format!(r#"[package]
name = "{name}"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]

[dependencies]
arlex-lang = {{ path = "{arlex_lang_path}" }}

[profile.release]
opt-level = "z"
lto = "fat"
codegen-units = 1
strip = true
"#);
    fs::write(project_dir.join("Cargo.toml"), cargo_toml).map_err(|e| e.to_string())?;

    let name_pascal = to_pascal_case(name);
    let lib_rs = format!(r#"use arlex_lang::prelude::*;

declare_id!("11111111111111111111111111111112");

#[account]
pub struct Counter {{
    pub authority: [u8; 32],
    pub count: u64,
}}

#[derive(Accounts)]
pub struct Initialize<'info> {{
    #[account(mut, signer)]
    pub authority: &'info AccountView,

    #[account(mut)]
    pub counter: &'info AccountView,

    pub system_program: &'info AccountView,
}}

#[derive(Accounts)]
pub struct Increment<'info> {{
    #[account(signer)]
    pub authority: &'info AccountView,

    #[account(mut)]
    pub counter: &'info AccountView,
}}

#[error_code]
pub enum {name_pascal}Error {{
    #[msg("Unauthorized")]
    Unauthorized,
}}

#[program]
pub mod {name} {{
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {{
        let counter = Counter::init(ctx.accounts.counter, ctx.program_id)?;
        counter.authority.copy_from_slice(ctx.accounts.authority.address().as_ref());
        counter.count = 0;
        arlex_lang::log("Initialized");
        Ok(())
    }}

    pub fn increment(ctx: Context<Increment>) -> Result<()> {{
        let counter = Counter::load_mut(ctx.accounts.counter, ctx.program_id)?;
        if counter.authority != *ctx.accounts.authority.address().as_ref() {{
            return Err(ProgramError::from({name_pascal}Error::Unauthorized));
        }}
        counter.count = counter.count.checked_add(1)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        arlex_lang::log("Incremented");
        Ok(())
    }}
}}
"#);
    fs::write(src_dir.join("lib.rs"), lib_rs).map_err(|e| e.to_string())?;
    fs::write(project_dir.join(".gitignore"), "target/\n").map_err(|e| e.to_string())?;

    println!("{}", "✓ Project created!".green().bold());
    println!("");
    println!("  cd {}", name);
    println!("  arlex build");
    println!("  arlex deploy --network devnet");
    println!("");

    Ok(())
}

fn resolve_arlex_lang_path() -> String {
    // Try to find arlex-lang relative to the binary location
    if let Ok(exe) = std::env::current_exe() {
        // Binary is in target/release/arlex or target/debug/arlex
        // Walk up to find framework/arlex-lang
        let mut dir = exe.parent().map(|p| p.to_path_buf());
        for _ in 0..5 {
            if let Some(ref d) = dir {
                let candidate = d.join("arlex-lang");
                if candidate.join("Cargo.toml").exists() {
                    return candidate.to_string_lossy().to_string();
                }
                // Also check sibling
                let candidate2 = d.join("framework").join("arlex-lang");
                if candidate2.join("Cargo.toml").exists() {
                    return candidate2.to_string_lossy().to_string();
                }
                dir = d.parent().map(|p| p.to_path_buf());
            }
        }
    }

    // Fallback: check well-known locations
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        format!("{}/Documents/Solana/arlex/framework/arlex-lang", home),
        format!("{}/.arlex/framework/arlex-lang", home),
    ];
    for c in &candidates {
        if Path::new(c).join("Cargo.toml").exists() {
            return c.clone();
        }
    }

    // Last resort: crates.io version (won't work until published)
    "arlex-lang".to_string()
}

fn to_pascal_case(s: &str) -> String {
    s.split(|c: char| c == '_' || c == '-')
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(c) => c.to_uppercase().to_string() + &chars.as_str().to_lowercase(),
            }
        })
        .collect()
}
