use colored::Colorize;
use std::process::Command;
use std::path::Path;
use std::time::Instant;
use crate::common;

pub fn run() -> Result<(), String> {
    if !Path::new("Cargo.toml").exists() {
        return Err("No Cargo.toml found. Are you in an Arlex project?".into());
    }

    println!("{} Building program...", "→".cyan());
    let start = Instant::now();

    let output = Command::new("cargo")
        .args(["build-sbf"])
        .output()
        .map_err(|e| format!("Failed to run cargo build-sbf: {}. Is the Solana toolchain installed?", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Build failed:\n{}", stderr));
    }

    let elapsed = start.elapsed();
    let sol_price = common::get_sol_price();

    let so_files = find_so_files()?;
    if so_files.is_empty() {
        return Err("No .so file found in target/deploy".into());
    }

    for (name, size) in &so_files {
        let rent = common::calculate_rent(*size);
        let anchor_size = *size * 14;
        let anchor_rent = common::calculate_rent(anchor_size);
        let saved = (anchor_rent - rent) * sol_price;

        println!("");
        println!("  {} {}", "Program:".white().bold(), name);
        println!("  {} {}", "Size:".white().bold(), common::format_size(*size));
        println!("  {} {:.4} SOL ({})", "Rent:".white().bold(), rent, common::format_usd(rent * sol_price));
        println!("");
        println!("  {} {} (est)", "Anchor:".dimmed(), common::format_size(anchor_size));
        println!("  {} {:.4} SOL ({})", "Anchor rent:".dimmed(), anchor_rent, common::format_usd(anchor_rent * sol_price));
        println!("  {} {} ({}x cheaper)",
            "Savings:".green().bold(),
            common::format_usd(saved).green(),
            anchor_size / size);
    }

    // Generate IDL
    let cargo_content = std::fs::read_to_string("Cargo.toml").unwrap_or_default();
    let project_name = cargo_content.lines()
        .find(|l| l.starts_with("name"))
        .and_then(|l| l.split('"').nth(1))
        .unwrap_or("program");

    match crate::idl::generate_idl(project_name) {
        Ok(idl_data) => {
            let idl_dir = std::path::Path::new("target/idl");
            let _ = std::fs::create_dir_all(idl_dir);
            let idl_path = idl_dir.join(format!("{}.json", project_name));
            if let Ok(json) = serde_json::to_string_pretty(&idl_data) {
                let _ = std::fs::write(&idl_path, &json);
                println!("  {} {} ({} instructions)",
                    "IDL:".white().bold(),
                    idl_path.display(),
                    idl_data.instructions.len());
            }
        }
        Err(e) => {
            println!("  {} IDL generation: {}", "⚠".yellow(), e);
        }
    }

    println!("");
    println!("  {} SOL price: ${:.0} (live)", "ℹ".dimmed(), sol_price);
    println!("");
    println!("{} in {:.1}s", "✓ Build complete".green().bold(), elapsed.as_secs_f64());
    println!("  Next: {} to deploy to devnet", "arlex deploy --network devnet".cyan());

    Ok(())
}

fn find_so_files() -> Result<Vec<(String, u64)>, String> {
    let deploy_dir = Path::new("target/deploy");
    if !deploy_dir.exists() {
        return Ok(vec![]);
    }
    let files: Vec<_> = std::fs::read_dir(deploy_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "so").unwrap_or(false))
        .map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let size = e.metadata().map(|m| m.len()).unwrap_or(0);
            (name, size)
        })
        .collect();
    Ok(files)
}
