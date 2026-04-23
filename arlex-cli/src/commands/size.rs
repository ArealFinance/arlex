use colored::Colorize;
use std::path::Path;
use crate::common;

pub fn run(program_id: Option<&str>) -> Result<(), String> {
    if let Some(pid) = program_id {
        common::validate_address(pid)?;
        check_onchain(pid)
    } else {
        check_local()
    }
}

fn check_local() -> Result<(), String> {
    let deploy_dir = Path::new("target/deploy");
    if !deploy_dir.exists() {
        return Err("No build found. Run 'arlex build' first, or provide a Program ID to check on-chain.".into());
    }

    let sol_price = common::get_sol_price();

    let so_files: Vec<_> = std::fs::read_dir(deploy_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "so").unwrap_or(false))
        .collect();

    if so_files.is_empty() {
        return Err("No .so files found in target/deploy. Run 'arlex build' first.".into());
    }

    println!("{}", "Program Size Report".white().bold());
    println!("{}", "═".repeat(55));

    for so_file in &so_files {
        let size = so_file.metadata().map(|m| m.len()).unwrap_or(0);
        let rent = common::calculate_rent(size);
        let anchor_size = size * 14;
        let anchor_rent = common::calculate_rent(anchor_size);
        let saved = (anchor_rent - rent) * sol_price;
        let name = so_file.file_name();

        println!("");
        println!("  {} {}", "Program:".white(), name.to_string_lossy().cyan());
        println!("");
        println!("  {:<14} {:>10} {:>12} {:>10}",
            "", "Size", "Rent", "Cost");
        println!("  {:<14} {:>10} {:>12} {:>10}",
            "Arlex".green(),
            common::format_size(size),
            format!("{:.4} SOL", rent),
            common::format_usd(rent * sol_price));
        println!("  {:<14} {:>10} {:>12} {:>10}",
            "Anchor (est)".red(),
            common::format_size(anchor_size),
            format!("{:.4} SOL", anchor_rent),
            common::format_usd(anchor_rent * sol_price));
        println!("");
        println!("  {} {} ({}x cheaper)",
            "You save:".green().bold(),
            common::format_usd(saved).green().bold(),
            anchor_size / size);
    }

    println!("");
    println!("  {} SOL price: ${:.0} (live)", "ℹ".dimmed(), sol_price);
    println!("");
    Ok(())
}

fn check_onchain(program_id: &str) -> Result<(), String> {
    println!("{} Checking {} on mainnet...", "→".cyan(), program_id);

    let output = std::process::Command::new("solana")
        .args(["program", "show", program_id, "--url", "mainnet-beta"])
        .output()
        .map_err(|e| format!("Failed to run solana CLI: {}. Is it installed?", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Could not fetch program info: {}", stderr.trim()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    // Parse data length from output
    for line in stdout.lines() {
        if line.contains("Data Length:") || line.contains("ProgramData Length:") {
            if let Some(size_str) = line.split(':').nth(1) {
                let cleaned = size_str.trim()
                    .replace(" bytes", "")
                    .replace(",", "")
                    .replace("(", "").replace(")", "");
                let parts: Vec<&str> = cleaned.split_whitespace().collect();
                if let Some(num_str) = parts.first() {
                    if let Ok(size) = num_str.parse::<u64>() {
                        return print_comparison(program_id, size);
                    }
                }
            }
        }
    }

    Err(format!("Could not parse program size from:\n{}", stdout))
}

fn print_comparison(program_id: &str, size: u64) -> Result<(), String> {
    let sol_price = common::get_sol_price();
    let rent = common::calculate_rent(size);
    let arlex_size = (size as f64 / 14.0) as u64;
    let arlex_rent = common::calculate_rent(arlex_size);
    let saved = (rent - arlex_rent) * sol_price;

    println!("");
    println!("{}", "Program Size Report".white().bold());
    println!("{}", "═".repeat(55));
    println!("  Program: {}", program_id.cyan());
    println!("");
    println!("  {:<14} {:>10} {:>12} {:>10}", "", "Size", "Rent", "Cost");
    println!("  {:<14} {:>10} {:>12} {:>10}",
        "Current".red(),
        common::format_size(size),
        format!("{:.4} SOL", rent),
        common::format_usd(rent * sol_price));
    println!("  {:<14} {:>10} {:>12} {:>10}",
        "Arlex (est)".green(),
        common::format_size(arlex_size),
        format!("{:.4} SOL", arlex_rent),
        common::format_usd(arlex_rent * sol_price));
    println!("");
    println!("  {} {} (14x cheaper)",
        "Potential savings:".green().bold(),
        common::format_usd(saved).green().bold());
    println!("  {} SOL price: ${:.0} (live)", "ℹ".dimmed(), sol_price);
    println!("");
    Ok(())
}
