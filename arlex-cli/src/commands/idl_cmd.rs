use colored::Colorize;
use crate::idl;
use std::path::Path;

pub fn run() -> Result<(), String> {
    eprintln!("{} Generating IDL...", "→".cyan());

    let cargo_content = std::fs::read_to_string("Cargo.toml")
        .map_err(|_| "No Cargo.toml found. Are you in an Arlex project?")?;

    let name = cargo_content.lines()
        .find(|l| l.starts_with("name"))
        .and_then(|l| l.split('"').nth(1))
        .unwrap_or("program")
        .to_string();

    let idl_data = idl::generate_idl(&name)?;
    let json = serde_json::to_string_pretty(&idl_data)
        .map_err(|e| format!("JSON serialization failed: {}", e))?;

    let idl_dir = Path::new("target/idl");
    std::fs::create_dir_all(idl_dir).map_err(|e| e.to_string())?;
    let idl_path = idl_dir.join(format!("{}.json", name));
    std::fs::write(&idl_path, &json).map_err(|e| e.to_string())?;

    // Status to stderr, JSON to stdout (pipeable)
    eprintln!("  {} {}", "IDL:".white().bold(), idl_path.display());
    eprintln!("  {} instructions, {} accounts, {} errors, {} events",
        idl_data.instructions.len(),
        idl_data.accounts.len(),
        idl_data.errors.len(),
        idl_data.events.len(),
    );

    // Clean JSON to stdout
    println!("{}", json);

    eprintln!("{}", "✓ IDL generated".green().bold());
    Ok(())
}
