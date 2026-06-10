/// Shared constants and utilities for Arlex CLI

/// Default SOL price fallback (updated manually)
const DEFAULT_SOL_PRICE: f64 = 85.0;

/// Get current SOL price.
///
/// Returns the manually-maintained `DEFAULT_SOL_PRICE` constant. The price is
/// used only for a cosmetic USD estimate in the deploy/size output, so the CLI
/// does not make a live network call (which previously hit CoinGecko via
/// reqwest, adding a heavy HTTP/TLS dependency and a startup network round-trip
/// for a non-essential display value). Kept as a thin wrapper so call sites and
/// the public surface are unchanged.
pub fn get_sol_price() -> f64 {
    DEFAULT_SOL_PRICE
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

/// Validate a Solana address: base58 that decodes to exactly 32 bytes.
///
/// The char-length (32-44) and base58-alphabet checks are kept as fast-fail
/// pre-checks, but they are not sufficient — a 32-char base58 string such as
/// `"A".repeat(32)` decodes to only 24 bytes and is NOT a valid 32-byte address.
/// The authoritative check decodes the string and requires exactly 32 bytes.
pub fn validate_address(addr: &str) -> Result<(), String> {
    // Fast-fail pre-checks (cheap, reject obvious garbage before decoding).
    if addr.len() < 32 || addr.len() > 44 {
        return Err("Invalid Solana address length (expected 32-44 chars)".into());
    }
    const BASE58: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    if !addr.bytes().all(|b| BASE58.contains(&b)) {
        return Err("Invalid base58 characters in address".into());
    }

    // Authoritative check: decode and require exactly 32 bytes. `into_vec`
    // returns a Result and must NOT panic on malformed input.
    let decoded = bs58::decode(addr)
        .into_vec()
        .map_err(|e| format!("Address is not valid base58: {}", e))?;
    if decoded.len() != 32 {
        return Err(format!(
            "Invalid Solana address: decodes to {} bytes, expected exactly 32",
            decoded.len()
        ));
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

    // ==================== get_sol_price ====================

    #[test]
    fn test_get_sol_price_is_deterministic_fallback() {
        // No network call: get_sol_price always returns the manual constant.
        assert_eq!(get_sol_price(), DEFAULT_SOL_PRICE);
        assert_eq!(get_sol_price(), 85.0);
    }

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
        // Real addresses that decode to exactly 32 bytes.
        assert!(validate_address("So11111111111111111111111111111111111111112").is_ok());
        assert!(validate_address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").is_ok());
        // 32 zero bytes (System Program) — 32 chars, decodes to 32 bytes.
        assert!(validate_address("11111111111111111111111111111111").is_ok());
    }

    #[test]
    fn test_address_decodes_to_wrong_byte_length_rejected() {
        // A base58 string that decodes to 31 bytes must be rejected. Build one
        // by encoding exactly 31 bytes.
        let thirty_one = bs58::encode(&[1u8; 31]).into_string();
        assert!(
            validate_address(&thirty_one).is_err(),
            "31-byte decode must be rejected"
        );
        // A base58 string that decodes to 33 bytes must be rejected.
        let thirty_three = bs58::encode(&[1u8; 33]).into_string();
        assert!(
            validate_address(&thirty_three).is_err(),
            "33-byte decode must be rejected"
        );
    }

    #[test]
    fn test_address_non_base58_is_err_no_panic() {
        // '0', 'O', 'I', 'l' are not in the base58 alphabet — the alphabet
        // pre-check rejects this, and decoding never panics regardless.
        assert!(validate_address("0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl").is_err());
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
        // Characterizes the CORRECTED (stricter) byte-count behavior: a 32-char
        // base58 string of all 'A' decodes to only 24 bytes, not 32, so it must
        // now be REJECTED. The old char-only check wrongly accepted it.
        assert!(validate_address(&"A".repeat(32)).is_err());
    }

    #[test]
    fn test_address_boundary_44_chars() {
        // Characterizes byte-count semantics: a 44-char string of all 'A'
        // decodes to exactly 32 bytes, so it remains accepted — but now because
        // the decoded length is 32, not merely because the char count is in
        // range.
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
