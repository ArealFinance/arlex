/// Shared constants and utilities for Arlex CLI

/// Default SOL price fallback (updated manually)
const DEFAULT_SOL_PRICE: f64 = 85.0;

/// Get current SOL price. Tries CoinGecko API, falls back to default.
pub fn get_sol_price() -> f64 {
    // Try to fetch live price (non-blocking, quick timeout)
    if let Ok(price) = fetch_sol_price() {
        return price;
    }
    DEFAULT_SOL_PRICE
}

fn fetch_sol_price() -> Result<f64, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd")
        .send()
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = resp.json().map_err(|e| e.to_string())?;
    json["solana"]["usd"]
        .as_f64()
        .ok_or("No price in response".into())
}

/// Calculate rent-exempt minimum for an account of given size in bytes.
/// Formula: (bytes + 128) * 3480 * 2 / 10^9
/// This is an approximation matching Solana's rent calculation.
pub fn calculate_rent(bytes: u64) -> f64 {
    ((bytes + 128) as f64 * 3480.0 * 2.0) / 1_000_000_000.0
}

/// Format byte size for display
pub fn format_size(bytes: u64) -> String {
    if bytes < 1024 { return format!("{} B", bytes); }
    if bytes < 1024 * 1024 { return format!("{:.1} KB", bytes as f64 / 1024.0); }
    format!("{:.2} MB", bytes as f64 / 1024.0 / 1024.0)
}

/// Format USD amount
pub fn format_usd(amount: f64) -> String {
    if amount < 1.0 { return "<$1".to_string(); }
    if amount >= 1000.0 { return format!("${:.1}K", amount / 1000.0); }
    format!("${:.0}", amount)
}

/// Validate project name — must be a valid Rust/Cargo identifier
pub fn validate_project_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Project name cannot be empty".into());
    }
    let first = name.chars().next().unwrap();
    if !first.is_ascii_alphabetic() {
        return Err("Project name must start with a letter".into());
    }
    if name.starts_with('-') {
        return Err("Project name cannot start with a dash".into());
    }
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("Project name can only contain letters, digits, '_' and '-'".into());
    }
    if name.contains("..") || name.contains('/') || name.contains('\\') {
        return Err("Project name cannot contain path separators".into());
    }
    // Check Rust reserved words
    let reserved = ["self", "super", "crate", "Self", "mod", "fn", "struct",
                     "enum", "impl", "trait", "type", "pub", "use", "let", "mut",
                     "ref", "return", "if", "else", "for", "while", "loop", "match"];
    if reserved.contains(&name) {
        return Err(format!("'{}' is a Rust reserved word", name));
    }
    Ok(())
}

/// Validate Solana address format (base58, 32-44 chars)
pub fn validate_address(addr: &str) -> Result<(), String> {
    if addr.len() < 32 || addr.len() > 44 {
        return Err("Invalid Solana address length (expected 32-44 chars)".into());
    }
    const BASE58: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    if !addr.bytes().all(|b| BASE58.contains(&b)) {
        return Err("Invalid base58 characters in address".into());
    }
    Ok(())
}

/// Solana explorer URL for a program
pub fn explorer_url(program_id: &str, network: &str) -> String {
    let cluster = match network {
        "mainnet" | "mainnet-beta" => "",
        "devnet" => "?cluster=devnet",
        "localnet" | "localhost" => "?cluster=custom&customUrl=http://localhost:8899",
        _ => "?cluster=devnet",
    };
    format!("https://explorer.solana.com/address/{}{}", program_id, cluster)
}

/// Known valid networks
pub fn validate_network(network: &str) -> Result<(), String> {
    match network {
        "devnet" | "mainnet" | "mainnet-beta" | "localnet" | "localhost" => Ok(()),
        other => {
            if other.starts_with("http://") || other.starts_with("https://") {
                Ok(())
            } else {
                Err(format!(
                    "Unknown network '{}'. Did you mean: devnet, mainnet, localnet? Or provide a URL.",
                    other
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==================== validate_project_name ====================

    #[test]
    fn test_valid_names() {
        assert!(validate_project_name("my_project").is_ok());
        assert!(validate_project_name("counter").is_ok());
        assert!(validate_project_name("token-vault").is_ok());
        assert!(validate_project_name("a").is_ok());
        assert!(validate_project_name("abc123").is_ok());
    }

    #[test]
    fn test_empty_name() {
        assert!(validate_project_name("").is_err());
    }

    #[test]
    fn test_starts_with_digit() {
        assert!(validate_project_name("123abc").is_err());
    }

    #[test]
    fn test_special_chars() {
        assert!(validate_project_name("my project").is_err());
        assert!(validate_project_name("my@project").is_err());
        assert!(validate_project_name("hello!").is_err());
    }

    #[test]
    fn test_path_traversal() {
        assert!(validate_project_name("../evil").is_err());
        assert!(validate_project_name("foo/bar").is_err());
        assert!(validate_project_name("foo\\bar").is_err());
    }

    #[test]
    fn test_reserved_words() {
        assert!(validate_project_name("self").is_err());
        assert!(validate_project_name("super").is_err());
        assert!(validate_project_name("crate").is_err());
        assert!(validate_project_name("fn").is_err());
        assert!(validate_project_name("struct").is_err());
        assert!(validate_project_name("mod").is_err());
    }

    // ==================== validate_address ====================

    #[test]
    fn test_valid_addresses() {
        assert!(validate_address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").is_ok());
        assert!(validate_address("11111111111111111111111111111111").is_ok());
    }

    #[test]
    fn test_short_address() {
        assert!(validate_address("abc").is_err());
    }

    #[test]
    fn test_long_address() {
        assert!(validate_address(&"A".repeat(50)).is_err());
    }

    #[test]
    fn test_invalid_base58_chars() {
        assert!(validate_address("0OIl11111111111111111111111111111").is_err()); // 0, O, I, l not in base58
    }

    // ==================== validate_network ====================

    #[test]
    fn test_known_networks() {
        assert!(validate_network("devnet").is_ok());
        assert!(validate_network("mainnet").is_ok());
        assert!(validate_network("mainnet-beta").is_ok());
        assert!(validate_network("localnet").is_ok());
        assert!(validate_network("localhost").is_ok());
    }

    #[test]
    fn test_url_network() {
        assert!(validate_network("https://my-rpc.example.com").is_ok());
        assert!(validate_network("http://localhost:8899").is_ok());
    }

    #[test]
    fn test_unknown_network() {
        assert!(validate_network("foobar").is_err());
        assert!(validate_network("devnt").is_err());
    }

    // ==================== calculate_rent ====================

    #[test]
    fn test_rent_zero_bytes() {
        let rent = calculate_rent(0);
        assert!(rent > 0.0); // even 0 bytes has 128-byte overhead
    }

    #[test]
    fn test_rent_increases_with_size() {
        let small = calculate_rent(100);
        let large = calculate_rent(100_000);
        assert!(large > small);
    }

    #[test]
    fn test_rent_known_value() {
        // 14000 bytes → should be close to solana CLI output
        let rent = calculate_rent(14000);
        // (14000 + 128) * 3480 * 2 / 1e9 ≈ 0.09833
        assert!((rent - 0.09833).abs() < 0.001);
    }

    // ==================== format_size ====================

    #[test]
    fn test_format_size_bytes() {
        assert_eq!(format_size(500), "500 B");
    }

    #[test]
    fn test_format_size_kb() {
        assert_eq!(format_size(14000), "13.7 KB");
    }

    #[test]
    fn test_format_size_mb() {
        assert_eq!(format_size(1_500_000), "1.43 MB");
    }

    // ==================== format_usd ====================

    #[test]
    fn test_format_usd_small() {
        assert_eq!(format_usd(0.5), "<$1");
    }

    #[test]
    fn test_format_usd_normal() {
        assert_eq!(format_usd(18.0), "$18");
    }

    #[test]
    fn test_format_usd_large() {
        assert_eq!(format_usd(1500.0), "$1.5K");
    }

    // ==================== explorer_url ====================

    #[test]
    fn test_explorer_devnet() {
        let url = explorer_url("ABC123", "devnet");
        assert!(url.contains("ABC123"));
        assert!(url.contains("cluster=devnet"));
    }

    #[test]
    fn test_explorer_mainnet() {
        let url = explorer_url("ABC123", "mainnet");
        assert_eq!(url, "https://explorer.solana.com/address/ABC123");
    }

    #[test]
    fn test_explorer_localnet() {
        let url = explorer_url("ABC", "localnet");
        assert!(url.contains("customUrl=http://localhost:8899"));
    }

    #[test]
    fn test_explorer_unknown_network() {
        let url = explorer_url("ABC", "foobar");
        assert!(url.contains("cluster=devnet")); // fallback to devnet
    }

    // ==================== Additional edge cases ====================

    #[test]
    fn test_name_starting_with_dash() {
        assert!(validate_project_name("-rf").is_err());
    }

    #[test]
    fn test_name_very_long() {
        let long_name = format!("a{}", "b".repeat(200));
        // Should pass — no length limit currently
        assert!(validate_project_name(&long_name).is_ok());
    }

    #[test]
    fn test_address_empty() {
        assert!(validate_address("").is_err());
    }

    #[test]
    fn test_address_boundary_31_chars() {
        assert!(validate_address(&"A".repeat(31)).is_err());
    }

    #[test]
    fn test_address_boundary_32_chars() {
        assert!(validate_address(&"A".repeat(32)).is_ok());
    }

    #[test]
    fn test_address_boundary_44_chars() {
        assert!(validate_address(&"A".repeat(44)).is_ok());
    }

    #[test]
    fn test_address_boundary_45_chars() {
        assert!(validate_address(&"A".repeat(45)).is_err());
    }

    #[test]
    fn test_rent_canonical_zero_bytes() {
        let rent = calculate_rent(0);
        // 0 bytes: (0 + 128) * 3480 * 2 / 1e9 = 0.00089088
        assert!((rent - 0.00089088).abs() < 0.0000001);
    }

    #[test]
    fn test_format_usd_exactly_one() {
        assert_eq!(format_usd(1.0), "$1");
    }

    #[test]
    fn test_format_usd_just_below_1k() {
        assert_eq!(format_usd(999.99), "$1000"); // rounds to $1000, not $1.0K
    }

    #[test]
    fn test_format_size_zero() {
        assert_eq!(format_size(0), "0 B");
    }

    #[test]
    fn test_format_size_exactly_1024() {
        assert_eq!(format_size(1024), "1.0 KB");
    }

    #[test]
    fn test_format_size_just_below_1024() {
        assert_eq!(format_size(1023), "1023 B");
    }
}
