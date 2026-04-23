use colored::Colorize;
use std::process::Command;

pub fn run(filter: Option<&str>, skip_build: bool) -> Result<(), String> {
    println!("{} Running tests...", "→".cyan());

    if !skip_build {
        let build = Command::new("cargo")
            .args(["build-sbf"])
            .output()
            .map_err(|e| format!("Build failed: {}. Is the Solana toolchain installed?", e))?;

        if !build.status.success() {
            let stderr = String::from_utf8_lossy(&build.stderr);
            return Err(format!("Build failed:\n{}", stderr));
        }
        println!("  {} Build OK", "✓".green());
    }

    // TS/JS tests via npm
    let tests_dir = std::path::Path::new("tests");
    if tests_dir.exists() && std::path::Path::new("package.json").exists() {
        let mut args = vec!["test"];
        if let Some(f) = filter {
            args.push("--");
            args.push(f);
        }
        let test_output = Command::new("npm")
            .args(&args)
            .status()
            .map_err(|e| format!("Failed to run npm test: {}", e))?;

        if !test_output.success() {
            return Err("TypeScript tests failed".into());
        }
        println!("  {} TS tests OK", "✓".green());
    }

    // Rust tests
    let mut test_args = vec!["test"];
    if let Some(f) = filter {
        test_args.push(f);
    }
    let test_output = Command::new("cargo")
        .args(&test_args)
        .status()
        .map_err(|e| format!("Failed to run cargo test: {}", e))?;

    if !test_output.success() {
        return Err("Rust tests failed".into());
    }

    println!("{}", "✓ All tests passed".green().bold());
    Ok(())
}
