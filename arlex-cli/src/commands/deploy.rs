use colored::Colorize;
use std::process::Command;
use std::path::Path;
use std::io::{self, Write};
use crate::common;

pub fn run(network: &str, program_id: Option<&str>) -> Result<(), String> {
    common::validate_network(network)?;

    // Mainnet confirmation
    if network == "mainnet" || network == "mainnet-beta" {
        let sol_price = common::get_sol_price();
        let so_file = find_first_so()?;
        let size = std::fs::metadata(&so_file).map(|m| m.len()).unwrap_or(0);
        let rent = common::calculate_rent(size);

        println!("{}", "⚠ MAINNET DEPLOYMENT".yellow().bold());
        println!("  Binary: {} ({})", so_file, common::format_size(size));
        println!("  Cost: {:.4} SOL ({})", rent, common::format_usd(rent * sol_price));
        println!("");
        print!("  Type 'yes' to confirm mainnet deploy: ");
        io::stdout().flush().unwrap();

        let mut input = String::new();
        io::stdin().read_line(&mut input).map_err(|e| e.to_string())?;
        if input.trim() != "yes" {
            println!("{}", "Deploy cancelled.".yellow());
            return Ok(());
        }
    }

    let so_path = find_first_so()?;
    let size = std::fs::metadata(&so_path).map(|m| m.len()).unwrap_or(0);
    let sol_price = common::get_sol_price();
    let rent = common::calculate_rent(size);

    let url = match network {
        "mainnet" | "mainnet-beta" => "mainnet-beta",
        "devnet" => "devnet",
        "localnet" | "localhost" => "localhost",
        other => other,
    };

    println!("{} Deploying to {}...", "→".cyan(), network.yellow());
    println!("  Binary: {} ({})", so_path, common::format_size(size));
    println!("  Rent: {:.4} SOL ({})", rent, common::format_usd(rent * sol_price));
    println!("");

    let mut args = vec![
        "program".to_string(), "deploy".to_string(),
        so_path.clone(), "--url".to_string(), url.to_string(),
    ];
    if let Some(pid) = program_id {
        common::validate_address(pid)?;
        args.push("--program-id".to_string());
        args.push(pid.to_string());
    }

    let output = Command::new("solana")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run solana CLI: {}. Is it installed?", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        return Err(format!("Deploy failed:\n{}{}", stdout, stderr));
    }

    // Extract Program ID
    let mut pid = String::new();
    for line in stdout.lines() {
        if line.contains("Program Id:") {
            pid = line.split(':').nth(1).unwrap_or("").trim().to_string();
        }
    }

    let anchor_rent = common::calculate_rent(size * 14);
    let saved = (anchor_rent - rent) * sol_price;

    println!("");
    println!("  {} {}", "Program ID:".white().bold(), pid.cyan().bold());
    println!("  {} {}", "Explorer:".white().bold(),
        common::explorer_url(&pid, network).cyan().underline());
    println!("");
    println!("  {} {} vs Anchor ({} → {})",
        "Saved:".green().bold(),
        common::format_usd(saved).green().bold(),
        common::format_usd(anchor_rent * sol_price),
        common::format_usd(rent * sol_price));
    println!("  {} SOL price: ${:.0} (live)", "ℹ".dimmed(), sol_price);
    println!("");
    println!("{}", "✓ Deployed successfully".green().bold());

    Ok(())
}

fn find_first_so() -> Result<String, String> {
    let deploy_dir = Path::new("target/deploy");
    if !deploy_dir.exists() {
        return Err("No build found. Run 'arlex build' first.".into());
    }
    std::fs::read_dir(deploy_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .find(|e| e.path().extension().map(|x| x == "so").unwrap_or(false))
        .map(|e| e.path().to_string_lossy().to_string())
        .ok_or("No .so file found. Run 'arlex build' first.".into())
}
