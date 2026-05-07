use serde::Serialize;
use std::path::Path;

#[derive(Serialize, Default)]
pub struct Idl {
    pub version: String,
    pub name: String,
    pub metadata: IdlMetadata,
    pub instructions: Vec<IdlInstruction>,
    pub accounts: Vec<IdlAccountDef>,
    pub types: Vec<serde_json::Value>,
    pub events: Vec<IdlEvent>,
    pub errors: Vec<IdlError>,
}

#[derive(Serialize, Default)]
pub struct IdlMetadata {
    pub address: String,
}

#[derive(Serialize)]
pub struct IdlInstruction {
    pub name: String,
    pub accounts: Vec<IdlAccountItem>,
    pub args: Vec<IdlField>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdlAccountItem {
    pub name: String,
    pub is_mut: bool,
    pub is_signer: bool,
}

#[derive(Serialize)]
pub struct IdlField {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: serde_json::Value,
}

#[derive(Serialize)]
pub struct IdlAccountDef {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: IdlAccountType,
}

#[derive(Serialize)]
pub struct IdlAccountType {
    pub kind: String,
    pub fields: Vec<IdlField>,
}

#[derive(Serialize)]
pub struct IdlEvent {
    pub name: String,
    pub fields: Vec<IdlField>,
}

#[derive(Serialize)]
pub struct IdlError {
    pub code: u32,
    pub name: String,
    pub msg: String,
}

pub fn generate_idl(project_name: &str) -> Result<Idl, String> {
    let src_dir = Path::new("src");
    if !src_dir.exists() {
        return Err("src/ directory not found".into());
    }

    let source = collect_sources(src_dir)?;

    // Join multi-line signatures into single lines for parsing
    let source = normalize_source(&source);

    let mut idl = Idl {
        version: "0.1.0".into(),
        name: project_name.into(),
        metadata: IdlMetadata { address: parse_declare_id(&source) },
        ..Default::default()
    };

    parse_program(&source, &mut idl);
    parse_account_structs(&source, &mut idl);
    parse_derive_accounts(&source, &mut idl);
    parse_errors(&source, &mut idl);
    parse_events(&source, &mut idl);

    Ok(idl)
}

fn collect_sources(dir: &Path) -> Result<String, String> {
    let mut all = String::new();
    let mut entries: Vec<_> = std::fs::read_dir(dir).map_err(|e| e.to_string())?
        .filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.path()); // deterministic order
    for entry in entries {
        let path = entry.path();
        if path.extension().map(|e| e == "rs").unwrap_or(false) {
            let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            all.push_str(&content);
            all.push('\n');
        } else if path.is_dir() {
            all.push_str(&collect_sources(&path)?);
        }
    }
    Ok(all)
}

/// Normalize source: join multi-line function signatures into single lines
fn normalize_source(source: &str) -> String {
    let mut result = String::new();
    let mut pending = String::new();
    let mut open_parens = 0i32;

    for line in source.lines() {
        let trimmed = line.trim();

        if open_parens > 0 {
            // Continue accumulating multi-line signature
            pending.push(' ');
            pending.push_str(trimmed);
            open_parens += trimmed.matches('(').count() as i32;
            open_parens -= trimmed.matches(')').count() as i32;
            if open_parens <= 0 {
                result.push_str(&pending);
                result.push('\n');
                pending.clear();
                open_parens = 0;
            }
            continue;
        }

        // Detect start of multi-line fn signature
        if trimmed.starts_with("pub fn ") && trimmed.contains('(') && !trimmed.contains(')') {
            pending = trimmed.to_string();
            open_parens = trimmed.matches('(').count() as i32 - trimmed.matches(')').count() as i32;
            continue;
        }

        result.push_str(trimmed);
        result.push('\n');
    }

    result
}

/// Extract program address from declare_id!("...")
fn parse_declare_id(source: &str) -> String {
    for line in source.lines() {
        let t = line.trim();
        if t.starts_with("declare_id!(") || t.starts_with("declare_id_bytes!(") {
            if let Some(addr) = t.split('"').nth(1) {
                return addr.to_string();
            }
        }
    }
    String::new()
}

fn parse_program(source: &str, idl: &mut Idl) {
    let mut in_program = false;
    let mut depth = 0i32;

    for line in source.lines() {
        let t = line.trim();
        if t.contains("#[program]") { in_program = true; continue; }
        if in_program {
            depth += t.matches('{').count() as i32 - t.matches('}').count() as i32;
            if depth <= 0 && in_program { in_program = false; continue; }
            if t.starts_with("pub fn ") {
                if let Some(ix) = parse_fn_sig(t) {
                    idl.instructions.push(ix);
                }
            }
        }
    }
}

fn parse_fn_sig(line: &str) -> Option<IdlInstruction> {
    let after_fn = line.strip_prefix("pub fn ")?;
    let fn_name = after_fn.split('(').next()?.trim().to_string();

    // Find the opening `(` of the fn argument list, then walk forward
    // tracking paren depth so we stop at its matching `)`. Using
    // `line.rfind(')')` is unsound here: the line may contain `Result<()>`
    // or an inline body like `{ Ok(()) }`, and the last `)` would belong
    // to one of those, polluting `args_str` with `") -> Result<("` that
    // then yields phantom IDL args.
    let start = line.find('(')?;
    let bytes = line.as_bytes();
    let mut depth: i32 = 1;
    let mut end: Option<usize> = None;
    for (i, &b) in bytes.iter().enumerate().skip(start + 1) {
        match b {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    end = Some(i);
                    break;
                }
            }
            _ => {}
        }
    }
    let end = end?;
    let args_str = &line[start + 1..end];

    // Split args on top-level commas only — commas inside generics
    // (`Context<Foo, Bar>`), arrays (`[u8; 32]`) or tuples must not split.
    let mut args = Vec::new();
    for param in split_top_level_commas(args_str) {
        let param = param.trim();
        if param.is_empty() { continue; }
        // Skip `ctx: Context<...>` — the first arg of every Arlex handler.
        // Match on the identifier so we don't accidentally drop a future
        // arg that happens to start with the letters `ctx`.
        let ident = param.split(':').next().unwrap_or("").trim();
        if ident == "ctx" || ident == "_ctx" { continue; }
        if let Some((name, ty)) = param.split_once(':') {
            args.push(IdlField {
                name: name.trim().to_string(),
                ty: map_type(ty.trim()),
            });
        }
    }

    Some(IdlInstruction { name: fn_name, accounts: Vec::new(), args })
}

/// Split a parameter list on commas that are at depth 0 with respect to
/// `()`, `[]` and `<>`. Required so types like `Context<Foo, Bar>`,
/// `[u8; 32]`, `alloc::vec::Vec<[u8; 32]>` or tuples stay intact.
fn split_top_level_commas(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut buf = String::new();
    let mut paren = 0i32;
    let mut bracket = 0i32;
    let mut angle = 0i32;
    for c in s.chars() {
        match c {
            '(' => { paren += 1; buf.push(c); }
            ')' => { paren -= 1; buf.push(c); }
            '[' => { bracket += 1; buf.push(c); }
            ']' => { bracket -= 1; buf.push(c); }
            '<' => { angle += 1; buf.push(c); }
            '>' => { angle -= 1; buf.push(c); }
            ',' if paren == 0 && bracket == 0 && angle == 0 => {
                out.push(std::mem::take(&mut buf));
            }
            _ => buf.push(c),
        }
    }
    if !buf.trim().is_empty() {
        out.push(buf);
    }
    out
}

fn parse_account_structs(source: &str, idl: &mut Idl) {
    let mut in_account = false;
    let mut name = String::new();
    let mut fields = Vec::new();
    let mut depth = 0i32;

    for line in source.lines() {
        let t = line.trim();
        if t == "#[account]" { in_account = true; continue; }
        if in_account && name.is_empty() {
            if t.starts_with("pub struct ") {
                name = extract_struct_name(t);
                depth = t.matches('{').count() as i32 - t.matches('}').count() as i32;
                continue;
            }
        }
        if in_account && !name.is_empty() {
            depth += t.matches('{').count() as i32 - t.matches('}').count() as i32;
            if t.starts_with("pub ") && t.contains(':') {
                if let Some(f) = parse_field(t) { fields.push(f); }
            }
            if depth <= 0 {
                idl.accounts.push(IdlAccountDef {
                    name: name.clone(),
                    ty: IdlAccountType { kind: "struct".into(), fields: std::mem::take(&mut fields) },
                });
                name.clear(); in_account = false;
            }
        }
    }
}

fn parse_derive_accounts(source: &str, idl: &mut Idl) {
    let mut in_derive = false;
    let mut name = String::new();
    let mut accounts = Vec::new();
    let mut depth = 0i32;
    let mut next_mut = false;
    let mut next_signer = false;

    for line in source.lines() {
        let t = line.trim();
        if t.contains("#[derive(Accounts)]") { in_derive = true; continue; }
        if in_derive && name.is_empty() {
            if t.starts_with("pub struct ") {
                name = extract_struct_name(t);
                depth = t.matches('{').count() as i32 - t.matches('}').count() as i32;
                continue;
            }
        }
        if in_derive && !name.is_empty() {
            depth += t.matches('{').count() as i32 - t.matches('}').count() as i32;
            if t.starts_with("#[account(") {
                let inner = t.strip_prefix("#[account(").unwrap_or("")
                    .strip_suffix(")]").unwrap_or("");
                // Token-level matching to avoid "mut" matching "immutable"
                let tokens: Vec<&str> = inner.split(',').map(|s| s.trim()).collect();
                next_mut = tokens.iter().any(|t| *t == "mut" || t.starts_with("init"));
                next_signer = tokens.iter().any(|t| *t == "signer");
            }
            if t.starts_with("pub ") && t.contains(':') {
                let field_name = t.strip_prefix("pub ").unwrap_or("")
                    .split(':').next().unwrap_or("").trim().to_string();
                if !field_name.is_empty() {
                    accounts.push(IdlAccountItem {
                        name: field_name, is_mut: next_mut, is_signer: next_signer,
                    });
                    next_mut = false; next_signer = false;
                }
            }
            if depth <= 0 {
                let ix_name = to_snake_case(&name);
                for ix in idl.instructions.iter_mut() {
                    if ix.name == ix_name { ix.accounts = std::mem::take(&mut accounts); break; }
                }
                accounts.clear(); name.clear(); in_derive = false;
            }
        }
    }
}

fn parse_errors(source: &str, idl: &mut Idl) {
    let mut in_error = false;
    let mut depth = 0i32;
    let mut code: u32 = 6000;
    let mut next_msg = String::new();

    for line in source.lines() {
        let t = line.trim();
        if t == "#[error_code]" { in_error = true; continue; }
        if in_error {
            depth += t.matches('{').count() as i32 - t.matches('}').count() as i32;
            if t.starts_with("#[msg(") {
                next_msg = t.strip_prefix("#[msg(\"").unwrap_or("")
                    .strip_suffix("\")]").unwrap_or("").to_string();
            }
            if !t.starts_with('#') && !t.starts_with("pub enum") && !t.is_empty()
                && t != "{" && t != "}" && t.chars().next().map(|c| c.is_uppercase()).unwrap_or(false)
            {
                let vname = t.trim_end_matches(',').to_string();
                idl.errors.push(IdlError {
                    code, name: vname.clone(),
                    msg: if next_msg.is_empty() { vname } else { std::mem::take(&mut next_msg) },
                });
                code += 1;
            }
            if depth <= 0 { in_error = false; }
        }
    }
}

fn parse_events(source: &str, idl: &mut Idl) {
    let mut in_event = false;
    let mut name = String::new();
    let mut fields = Vec::new();
    let mut depth = 0i32;

    for line in source.lines() {
        let t = line.trim();
        if t == "#[event]" { in_event = true; continue; }
        if in_event && name.is_empty() {
            if t.starts_with("pub struct ") {
                name = extract_struct_name(t);
                depth = t.matches('{').count() as i32 - t.matches('}').count() as i32;
                continue;
            }
        }
        if in_event && !name.is_empty() {
            depth += t.matches('{').count() as i32 - t.matches('}').count() as i32;
            if t.starts_with("pub ") && t.contains(':') {
                if let Some(f) = parse_field(t) { fields.push(f); }
            }
            if depth <= 0 {
                idl.events.push(IdlEvent { name: name.clone(), fields: std::mem::take(&mut fields) });
                name.clear(); in_event = false;
            }
        }
    }
}

fn extract_struct_name(line: &str) -> String {
    line.strip_prefix("pub struct ").unwrap_or(line)
        .split(|c: char| c == '{' || c == '<' || c == ' ')
        .next().unwrap_or("").trim().to_string()
}

fn parse_field(line: &str) -> Option<IdlField> {
    let field_part = line.strip_prefix("pub ")?;
    let (name, ty) = field_part.split_once(':')?;
    // Strip trailing comma and comments
    let ty_clean = ty.split("//").next().unwrap_or(ty).trim().trim_end_matches(',').trim();
    Some(IdlField {
        name: name.trim().to_string(),
        ty: map_type(ty_clean),
    })
}

/// Map Rust type to Anchor IDL type representation
fn map_type(ty: &str) -> serde_json::Value {
    let ty = ty.trim();
    match ty {
        "u8" => serde_json::json!("u8"),
        "u16" => serde_json::json!("u16"),
        "u32" => serde_json::json!("u32"),
        "u64" => serde_json::json!("u64"),
        "u128" => serde_json::json!("u128"),
        "i8" => serde_json::json!("i8"),
        "i16" => serde_json::json!("i16"),
        "i32" => serde_json::json!("i32"),
        "i64" => serde_json::json!("i64"),
        "i128" => serde_json::json!("i128"),
        "f32" => serde_json::json!("f32"),
        "f64" => serde_json::json!("f64"),
        "bool" => serde_json::json!("bool"),
        "Pubkey" | "Address" => serde_json::json!("publicKey"),
        "String" => serde_json::json!("string"),
        _ => {
            // [u8; N] — handle with or without spaces
            let normalized = ty.replace(' ', "");
            if normalized.starts_with("[u8;") && normalized.ends_with(']') {
                let n = normalized.trim_start_matches("[u8;").trim_end_matches(']');
                if let Ok(size) = n.parse::<usize>() {
                    return serde_json::json!({"array": ["u8", size]});
                }
            }
            // [T; N]
            if normalized.starts_with('[') && normalized.ends_with(']') && normalized.contains(';') {
                let inner = &normalized[1..normalized.len()-1];
                if let Some((t, n)) = inner.split_once(';') {
                    if let Ok(size) = n.parse::<usize>() {
                        return serde_json::json!({"array": [map_type(t), size]});
                    }
                }
            }
            // Vec<T>
            if ty.starts_with("Vec<") && ty.ends_with('>') {
                let inner = &ty[4..ty.len()-1];
                return serde_json::json!({"vec": map_type(inner)});
            }
            // Option<T>
            if ty.starts_with("Option<") && ty.ends_with('>') {
                let inner = &ty[7..ty.len()-1];
                return serde_json::json!({"option": map_type(inner)});
            }
            // Custom type reference
            serde_json::json!({"defined": ty})
        }
    }
}

/// PascalCase to snake_case — handles acronyms correctly
/// NFTMint → nft_mint, AddLiquidity → add_liquidity
fn to_snake_case(s: &str) -> String {
    let mut result = String::new();
    let chars: Vec<char> = s.chars().collect();

    for (i, &c) in chars.iter().enumerate() {
        if c.is_uppercase() {
            if i > 0 {
                // Don't add underscore if previous was also uppercase AND next is uppercase or end
                // This handles acronyms: NFT → nft, not n_f_t
                let prev_upper = chars[i - 1].is_uppercase();
                let next_lower = chars.get(i + 1).map(|c| c.is_lowercase()).unwrap_or(false);

                if prev_upper && !next_lower {
                    // Middle of acronym: don't add underscore
                } else if !prev_upper {
                    // Start of new word after lowercase
                    result.push('_');
                } else if next_lower {
                    // End of acronym before lowercase (e.g., the M in NFTMint)
                    result.push('_');
                }
            }
            result.push(c.to_lowercase().next().unwrap());
        } else {
            result.push(c);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==================== snake_case ====================

    #[test]
    fn test_snake_case_simple() {
        assert_eq!(to_snake_case("Initialize"), "initialize");
        assert_eq!(to_snake_case("AddLiquidity"), "add_liquidity");
        assert_eq!(to_snake_case("DepositRevenue"), "deposit_revenue");
    }

    #[test]
    fn test_snake_case_acronyms() {
        assert_eq!(to_snake_case("NFTMint"), "nft_mint");
        assert_eq!(to_snake_case("MintOt"), "mint_ot");
        assert_eq!(to_snake_case("RPCEndpoint"), "rpc_endpoint");
    }

    #[test]
    fn test_snake_case_single_word() {
        assert_eq!(to_snake_case("Transfer"), "transfer");
        assert_eq!(to_snake_case("A"), "a");
    }

    // ==================== map_type ====================

    #[test]
    fn test_map_type_primitives() {
        assert_eq!(map_type("u8"), serde_json::json!("u8"));
        assert_eq!(map_type("u16"), serde_json::json!("u16"));
        assert_eq!(map_type("u32"), serde_json::json!("u32"));
        assert_eq!(map_type("u64"), serde_json::json!("u64"));
        assert_eq!(map_type("u128"), serde_json::json!("u128"));
        assert_eq!(map_type("i8"), serde_json::json!("i8"));
        assert_eq!(map_type("i16"), serde_json::json!("i16"));
        assert_eq!(map_type("i32"), serde_json::json!("i32"));
        assert_eq!(map_type("i64"), serde_json::json!("i64"));
        assert_eq!(map_type("i128"), serde_json::json!("i128"));
        assert_eq!(map_type("f32"), serde_json::json!("f32"));
        assert_eq!(map_type("f64"), serde_json::json!("f64"));
        assert_eq!(map_type("bool"), serde_json::json!("bool"));
        assert_eq!(map_type("String"), serde_json::json!("string"));
    }

    #[test]
    fn test_map_type_pubkey() {
        assert_eq!(map_type("Pubkey"), serde_json::json!("publicKey"));
        assert_eq!(map_type("Address"), serde_json::json!("publicKey"));
    }

    #[test]
    fn test_map_type_arrays() {
        assert_eq!(map_type("[u8; 32]"), serde_json::json!({"array": ["u8", 32]}));
        assert_eq!(map_type("[u8;32]"), serde_json::json!({"array": ["u8", 32]}));
        assert_eq!(map_type("[u8;  4]"), serde_json::json!({"array": ["u8", 4]}));
    }

    #[test]
    fn test_map_type_vec_option() {
        assert_eq!(map_type("Vec<u64>"), serde_json::json!({"vec": "u64"}));
        assert_eq!(map_type("Vec<Pubkey>"), serde_json::json!({"vec": "publicKey"}));
        assert_eq!(map_type("Option<Pubkey>"), serde_json::json!({"option": "publicKey"}));
        assert_eq!(map_type("Option<u8>"), serde_json::json!({"option": "u8"}));
    }

    #[test]
    fn test_map_type_custom() {
        assert_eq!(map_type("MyCustomType"), serde_json::json!({"defined": "MyCustomType"}));
        assert_eq!(map_type("StakeInfo"), serde_json::json!({"defined": "StakeInfo"}));
    }

    // ==================== parse_field ====================

    #[test]
    fn test_parse_field_simple() {
        let f = parse_field("pub count: u64,").unwrap();
        assert_eq!(f.name, "count");
        assert_eq!(f.ty, serde_json::json!("u64"));
    }

    #[test]
    fn test_parse_field_with_comment() {
        let f = parse_field("pub authority: [u8; 32],  // the owner").unwrap();
        assert_eq!(f.name, "authority");
        assert_eq!(f.ty, serde_json::json!({"array": ["u8", 32]}));
    }

    #[test]
    fn test_parse_field_no_pub() {
        assert!(parse_field("count: u64").is_none());
    }

    // ==================== normalize_source ====================

    #[test]
    fn test_normalize_multiline_fn() {
        let source = "pub fn transfer(\n    ctx: Context<Transfer>,\n    amount: u64,\n) -> Result<()> {";
        let normalized = normalize_source(source);
        assert!(normalized.contains("pub fn transfer( ctx: Context<Transfer>, amount: u64, ) -> Result<()> {"));
    }

    #[test]
    fn test_normalize_single_line_fn() {
        let source = "pub fn initialize(ctx: Context<Init>) -> Result<()> {";
        let normalized = normalize_source(source);
        assert!(normalized.contains("pub fn initialize(ctx: Context<Init>) -> Result<()> {"));
    }

    // ==================== parse_declare_id ====================

    #[test]
    fn test_parse_declare_id() {
        let source = r#"declare_id!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");"#;
        assert_eq!(parse_declare_id(source), "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    }

    #[test]
    fn test_parse_declare_id_missing() {
        assert_eq!(parse_declare_id("use arlex_lang::prelude::*;"), "");
    }

    // ==================== Full IDL parse ====================

    #[test]
    fn test_parse_program_instructions() {
        let source = r#"
#[program]
pub mod my_program {
    use super::*;
    pub fn initialize(ctx: Context<Init>) -> Result<()> { Ok(()) }
    pub fn transfer(ctx: Context<Xfer>, amount: u64) -> Result<()> { Ok(()) }
}
"#;
        let mut idl = Idl::default();
        parse_program(source, &mut idl);
        assert_eq!(idl.instructions.len(), 2);
        assert_eq!(idl.instructions[0].name, "initialize");
        assert_eq!(idl.instructions[0].args.len(), 0);
        assert_eq!(idl.instructions[1].name, "transfer");
        assert_eq!(idl.instructions[1].args.len(), 1);
        assert_eq!(idl.instructions[1].args[0].name, "amount");
    }

    #[test]
    fn test_parse_account_struct() {
        let source = r#"
#[account]
pub struct Counter {
    pub authority: [u8; 32],
    pub count: u64,
}
"#;
        let mut idl = Idl::default();
        parse_account_structs(source, &mut idl);
        assert_eq!(idl.accounts.len(), 1);
        assert_eq!(idl.accounts[0].name, "Counter");
        assert_eq!(idl.accounts[0].ty.fields.len(), 2);
        assert_eq!(idl.accounts[0].ty.fields[0].name, "authority");
        assert_eq!(idl.accounts[0].ty.fields[1].name, "count");
    }

    #[test]
    fn test_parse_derive_accounts() {
        let source = r#"
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut, signer)]
    pub authority: &'info AccountView,
    #[account(mut)]
    pub counter: &'info AccountView,
    pub system_program: &'info AccountView,
}

#[program]
pub mod test {
    use super::*;
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> { Ok(()) }
}
"#;
        let mut idl = Idl::default();
        parse_program(source, &mut idl);
        parse_derive_accounts(source, &mut idl);
        assert_eq!(idl.instructions[0].accounts.len(), 3);
        assert!(idl.instructions[0].accounts[0].is_mut);
        assert!(idl.instructions[0].accounts[0].is_signer);
        assert!(idl.instructions[0].accounts[1].is_mut);
        assert!(!idl.instructions[0].accounts[1].is_signer);
        assert!(!idl.instructions[0].accounts[2].is_mut);
        assert!(!idl.instructions[0].accounts[2].is_signer);
    }

    #[test]
    fn test_parse_errors() {
        let source = r#"
#[error_code]
pub enum MyError {
    #[msg("Not authorized")]
    Unauthorized,
    #[msg("Amount is zero")]
    ZeroAmount,
    Overflow,
}
"#;
        let mut idl = Idl::default();
        parse_errors(source, &mut idl);
        assert_eq!(idl.errors.len(), 3);
        assert_eq!(idl.errors[0].code, 6000);
        assert_eq!(idl.errors[0].name, "Unauthorized");
        assert_eq!(idl.errors[0].msg, "Not authorized");
        assert_eq!(idl.errors[1].code, 6001);
        assert_eq!(idl.errors[1].msg, "Amount is zero");
        assert_eq!(idl.errors[2].code, 6002);
        assert_eq!(idl.errors[2].name, "Overflow");
        assert_eq!(idl.errors[2].msg, "Overflow"); // no #[msg] → name as msg
    }

    #[test]
    fn test_parse_events() {
        let source = r#"
#[event]
pub struct Deposited {
    pub amount: u64,
    pub depositor: Pubkey,
}
"#;
        let mut idl = Idl::default();
        parse_events(source, &mut idl);
        assert_eq!(idl.events.len(), 1);
        assert_eq!(idl.events[0].name, "Deposited");
        assert_eq!(idl.events[0].fields.len(), 2);
        assert_eq!(idl.events[0].fields[0].name, "amount");
        assert_eq!(idl.events[0].fields[1].ty, serde_json::json!("publicKey"));
    }

    // ==================== Additional edge cases ====================

    #[test]
    fn test_snake_case_empty() {
        assert_eq!(to_snake_case(""), "");
    }

    #[test]
    fn test_snake_case_all_caps() {
        assert_eq!(to_snake_case("URL"), "url");
        assert_eq!(to_snake_case("API"), "api");
    }

    #[test]
    fn test_map_type_non_u8_array() {
        assert_eq!(map_type("[Pubkey; 3]"), serde_json::json!({"array": ["publicKey", 3]}));
    }

    #[test]
    fn test_multiple_account_structs() {
        let source = r#"
#[account]
pub struct Counter {
    pub count: u64,
}

#[account]
pub struct Vault {
    pub authority: Pubkey,
    pub balance: u64,
}
"#;
        let mut idl = Idl::default();
        parse_account_structs(source, &mut idl);
        assert_eq!(idl.accounts.len(), 2);
        assert_eq!(idl.accounts[0].name, "Counter");
        assert_eq!(idl.accounts[1].name, "Vault");
    }

    #[test]
    fn test_multiple_events() {
        let source = r#"
#[event]
pub struct Created {
    pub id: u64,
}

#[event]
pub struct Deleted {
    pub id: u64,
}
"#;
        let mut idl = Idl::default();
        parse_events(source, &mut idl);
        assert_eq!(idl.events.len(), 2);
        assert_eq!(idl.events[0].name, "Created");
        assert_eq!(idl.events[1].name, "Deleted");
    }

    #[test]
    fn test_unmatched_derive_accounts_silent() {
        // Derive struct that doesn't match any instruction → accounts stay empty
        let source = r#"
#[derive(Accounts)]
pub struct Orphan<'info> {
    #[account(signer)]
    pub auth: &'info AccountView,
}

#[program]
pub mod test {
    use super::*;
    pub fn different_name(ctx: Context<Different>) -> Result<()> { Ok(()) }
}
"#;
        let mut idl = Idl::default();
        parse_program(source, &mut idl);
        parse_derive_accounts(source, &mut idl);
        // Instruction exists but accounts didn't match
        assert_eq!(idl.instructions.len(), 1);
        assert_eq!(idl.instructions[0].accounts.len(), 0);
    }

    #[test]
    fn test_parse_errors_all_without_msg() {
        let source = r#"
#[error_code]
pub enum Errors {
    First,
    Second,
    Third,
}
"#;
        let mut idl = Idl::default();
        parse_errors(source, &mut idl);
        assert_eq!(idl.errors.len(), 3);
        assert_eq!(idl.errors[0].msg, "First"); // name used as msg
        assert_eq!(idl.errors[2].code, 6002);
    }

    // ==================== parse_fn_sig regression ====================
    // Bug: previous parser used line.rfind(')') to find the end of the
    // fn argument list. For any signature containing `Result<()>` or an
    // inline body it picked up a `)` outside the args, producing phantom
    // IDL args like `{ name: "amount", type: { defined: "u64) -> Result<(" }}`.

    #[test]
    fn test_parse_fn_sig_single_typed_arg_with_inline_body() {
        // Hits the rfind(')') trap via `Result<()>` AND inline body.
        let line = "pub fn mint_ot(ctx: Context<MintOt>, amount: u64) -> Result<()> { Ok(()) }";
        let ix = parse_fn_sig(line).unwrap();
        assert_eq!(ix.name, "mint_ot");
        assert_eq!(ix.args.len(), 1, "phantom args from rfind(')') regression");
        assert_eq!(ix.args[0].name, "amount");
        assert_eq!(ix.args[0].ty, serde_json::json!("u64"));
    }

    #[test]
    fn test_parse_fn_sig_no_args() {
        let line = "pub fn distribute_revenue(ctx: Context<DistributeRevenue>) -> Result<()> { Ok(()) }";
        let ix = parse_fn_sig(line).unwrap();
        assert_eq!(ix.name, "distribute_revenue");
        assert_eq!(ix.args.len(), 0);
    }

    #[test]
    fn test_parse_fn_sig_array_arg() {
        // [u8; 32] contains a `;` and brackets — must not split or pollute the type.
        let line = "pub fn update_publish_authority(ctx: Context<UpdatePublishAuthority>, new_publish_authority: [u8; 32]) -> Result<()>";
        let ix = parse_fn_sig(line).unwrap();
        assert_eq!(ix.name, "update_publish_authority");
        assert_eq!(ix.args.len(), 1);
        assert_eq!(ix.args[0].name, "new_publish_authority");
        assert_eq!(ix.args[0].ty, serde_json::json!({"array": ["u8", 32]}));
    }

    #[test]
    fn test_parse_fn_sig_vec_of_arrays_arg() {
        // alloc::vec::Vec<[u8; 32]> — the type contains commas-free generics
        // but earlier `,`-split would still trip on the inline body. Also
        // exercises the `Vec<...>` mapping with a path-prefixed name.
        let line = "pub fn claim(ctx: Context<Claim>, cumulative_amount: u64, proof: alloc::vec::Vec<[u8; 32]>) -> Result<()>";
        let ix = parse_fn_sig(line).unwrap();
        assert_eq!(ix.name, "claim");
        assert_eq!(ix.args.len(), 2);
        assert_eq!(ix.args[0].name, "cumulative_amount");
        assert_eq!(ix.args[0].ty, serde_json::json!("u64"));
        assert_eq!(ix.args[1].name, "proof");
        // alloc::vec::Vec<...> isn't recognized as `Vec<...>` (path prefix);
        // it should fall to a custom `defined` reference, but crucially the
        // value must be a clean type — not `") -> Result<("`-style garbage.
        // We assert it parses and the value matches a safe identifier shape
        // (no `)` or `(` or `>` interlopers from outside the arg list).
        let ty_str = ix.args[1].ty["defined"].as_str().unwrap_or("");
        assert!(!ty_str.is_empty(), "type should resolve, got {:?}", ix.args[1].ty);
        assert!(!ty_str.contains(')'), "type leaked closing paren: {ty_str:?}");
        assert!(!ty_str.contains("Result"), "type leaked return type: {ty_str:?}");
    }

    #[test]
    fn test_parse_fn_sig_three_args_with_bool() {
        // convert_to_rwt — three primitive args, must not split into 4+ phantoms.
        let line = "pub fn convert_to_rwt(ctx: Context<ConvertToRwt>, usdc_amount: u64, min_rwt_out: u64, swap_first: bool) -> Result<()>";
        let ix = parse_fn_sig(line).unwrap();
        assert_eq!(ix.name, "convert_to_rwt");
        assert_eq!(ix.args.len(), 3);
        assert_eq!(ix.args[0].name, "usdc_amount");
        assert_eq!(ix.args[0].ty, serde_json::json!("u64"));
        assert_eq!(ix.args[1].name, "min_rwt_out");
        assert_eq!(ix.args[2].name, "swap_first");
        assert_eq!(ix.args[2].ty, serde_json::json!("bool"));
    }

    #[test]
    fn test_parse_fn_sig_publish_root_normalized() {
        // publish_root in real source is multi-line; after normalize_source
        // it collapses to this. Was an offending case in ownership-token /
        // yield-distribution: `, max_total_claim: u64) -> Result<()> { ... }`
        // produced `{ defined: "u64) -> Result<(" }` for max_total_claim.
        let line = "pub fn publish_root( ctx: Context<PublishRoot>, merkle_root: [u8; 32], max_total_claim: u64, ) -> Result<()> { handler(ctx, merkle_root, max_total_claim) }";
        let ix = parse_fn_sig(line).unwrap();
        assert_eq!(ix.name, "publish_root");
        assert_eq!(ix.args.len(), 2);
        assert_eq!(ix.args[0].name, "merkle_root");
        assert_eq!(ix.args[0].ty, serde_json::json!({"array": ["u8", 32]}));
        assert_eq!(ix.args[1].name, "max_total_claim");
        assert_eq!(ix.args[1].ty, serde_json::json!("u64"));
    }

    #[test]
    fn test_parse_fn_sig_skips_underscore_ctx() {
        // _ctx (allowed when handler ignores ctx) must also be skipped.
        let line = "pub fn noop(_ctx: Context<Noop>, value: u64) -> Result<()>";
        let ix = parse_fn_sig(line).unwrap();
        assert_eq!(ix.args.len(), 1);
        assert_eq!(ix.args[0].name, "value");
    }

    // ==================== split_top_level_commas ====================

    #[test]
    fn test_split_top_level_commas_plain() {
        let parts = split_top_level_commas("a: u64, b: u64, c: bool");
        assert_eq!(parts.iter().map(|s| s.trim()).collect::<Vec<_>>(),
                   vec!["a: u64", "b: u64", "c: bool"]);
    }

    #[test]
    fn test_split_top_level_commas_inside_generics() {
        let parts = split_top_level_commas("ctx: Context<Foo, Bar>, amount: u64");
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0].trim(), "ctx: Context<Foo, Bar>");
        assert_eq!(parts[1].trim(), "amount: u64");
    }

    #[test]
    fn test_split_top_level_commas_inside_array() {
        let parts = split_top_level_commas("a: [u8; 32], b: u64");
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0].trim(), "a: [u8; 32]");
    }

    #[test]
    fn test_split_top_level_commas_trailing_comma() {
        let parts = split_top_level_commas("a: u64, b: u64,");
        // Trailing empty is dropped (whitespace-only after the last comma).
        assert_eq!(parts.iter().filter(|p| !p.trim().is_empty()).count(), 2);
    }

    #[test]
    fn test_parse_init_detected_as_mut() {
        let source = r#"
#[derive(Accounts)]
pub struct Init<'info> {
    #[account(init, payer = auth, space = 100)]
    pub data: &'info AccountView,
    #[account(mut, signer)]
    pub auth: &'info AccountView,
}

#[program]
pub mod test {
    use super::*;
    pub fn init(ctx: Context<Init>) -> Result<()> { Ok(()) }
}
"#;
        let mut idl = Idl::default();
        parse_program(source, &mut idl);
        parse_derive_accounts(source, &mut idl);
        assert!(idl.instructions[0].accounts[0].is_mut); // init implies mut
    }
}
