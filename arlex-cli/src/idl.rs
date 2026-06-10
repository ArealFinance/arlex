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
    #[serde(skip_serializing)]
    account_context: Option<String>,
}

#[derive(Serialize, Clone)]
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
        version: "0.1.2".into(),
        name: project_name.into(),
        metadata: IdlMetadata {
            address: parse_declare_id(&source),
        },
        ..Default::default()
    };

    let pub_fn_count = parse_program(&source, &mut idl);
    parse_account_structs(&source, &mut idl);
    parse_derive_accounts(&source, &mut idl);
    parse_errors(&source, &mut idl);
    parse_events(&source, &mut idl);

    // FINDING 2: cross-check that every `pub fn` inside #[program] produced an
    // instruction. A mismatch means an instruction was silently dropped (e.g.
    // a signature parse_fn_sig couldn't handle, or — before the literal/comment
    // stripping fix — a brace inside a string prematurely closing the module).
    // Hard-error rather than emit an incomplete IDL.
    if idl.instructions.len() != pub_fn_count {
        return Err(format!(
            "IDL instruction count mismatch: found {} `pub fn` declaration(s) \
             inside #[program] but emitted {} instruction(s). An instruction \
             was dropped during parsing.",
            pub_fn_count,
            idl.instructions.len(),
        ));
    }

    Ok(idl)
}

fn collect_sources(dir: &Path) -> Result<String, String> {
    let mut all = String::new();
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .collect();
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

/// Parse the `#[program]` module, pushing one instruction per `pub fn`.
/// Returns the number of `pub fn` declarations seen inside the module, so the
/// caller can cross-check it against the number of instructions actually
/// emitted (FINDING 2: detect silently-dropped instructions).
fn parse_program(source: &str, idl: &mut Idl) -> usize {
    let mut in_program = false;
    let mut depth = 0i32;
    let mut in_block_comment = false;
    let mut pub_fn_count = 0usize;

    for line in source.lines() {
        let t = line.trim();
        // Use the raw line for brace counting so block-comment state stays
        // consistent regardless of trimming.
        if t.contains("#[program]") {
            in_program = true;
            // Account for any braces on the attribute line itself.
            depth += brace_delta(line, &mut in_block_comment);
            continue;
        }
        if in_program {
            depth += brace_delta(line, &mut in_block_comment);
            if depth <= 0 && in_program {
                in_program = false;
                continue;
            }
            if t.starts_with("pub fn ") {
                pub_fn_count += 1;
                if let Some(ix) = parse_fn_sig(t) {
                    idl.instructions.push(ix);
                }
            }
        } else {
            // Keep block-comment state coherent across the whole file even
            // outside the program module.
            let _ = brace_delta(line, &mut in_block_comment);
        }
    }

    pub_fn_count
}

fn parse_fn_sig(line: &str) -> Option<IdlInstruction> {
    let after_fn = line.strip_prefix("pub fn ")?;
    let fn_name = after_fn.split('(').next()?.trim().to_string();

    // Get only the function argument list, not the return type.
    let start = line.find('(')?;
    let end = find_matching_delimiter(line, start, '(', ')')?;
    let args_str = &line[start + 1..end];

    let mut args = Vec::new();
    let mut account_context = None;
    for param in split_top_level_commas(args_str) {
        let param = param.trim();
        if param.is_empty() {
            continue;
        }
        let ident = param.split(':').next().unwrap_or("").trim();
        if let Some(context) = parse_context_param(param) {
            account_context = Some(context);
            continue;
        }
        if ident == "ctx" || ident == "_ctx" {
            continue;
        }
        if let Some((name, ty)) = param.split_once(':') {
            args.push(IdlField {
                name: name.trim().to_string(),
                ty: map_type(ty.trim()),
            });
        }
    }

    Some(IdlInstruction {
        name: fn_name,
        accounts: Vec::new(),
        args,
        account_context,
    })
}

fn parse_account_structs(source: &str, idl: &mut Idl) {
    let mut in_account = false;
    let mut name = String::new();
    let mut fields = Vec::new();
    let mut depth = 0i32;
    let mut in_block_comment = false;

    for line in source.lines() {
        let t = line.trim();
        if t == "#[account]" {
            in_account = true;
            continue;
        }
        if in_account && name.is_empty() {
            if t.starts_with("pub struct ") {
                name = extract_struct_name(t);
                depth = brace_delta(line, &mut in_block_comment);
                continue;
            }
        }
        if in_account && !name.is_empty() {
            depth += brace_delta(line, &mut in_block_comment);
            if t.starts_with("pub ") && t.contains(':') {
                if let Some(f) = parse_field(t) {
                    fields.push(f);
                }
            }
            if depth <= 0 {
                idl.accounts.push(IdlAccountDef {
                    name: name.clone(),
                    ty: IdlAccountType {
                        kind: "struct".into(),
                        fields: std::mem::take(&mut fields),
                    },
                });
                name.clear();
                in_account = false;
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
    let mut account_attr = String::new();
    let mut in_account_attr = false;
    let mut in_block_comment = false;

    for line in source.lines() {
        let t = line.trim();
        if t.contains("#[derive(Accounts)]") {
            in_derive = true;
            continue;
        }
        if in_derive && name.is_empty() {
            if t.starts_with("pub struct ") {
                name = extract_struct_name(t);
                depth = brace_delta(line, &mut in_block_comment);
                continue;
            }
        }
        if in_derive && !name.is_empty() {
            depth += brace_delta(line, &mut in_block_comment);

            if in_account_attr {
                account_attr.push(' ');
                account_attr.push_str(t);
                if t.contains(")]") {
                    let (is_mut, is_signer) = parse_account_attr_flags(&account_attr);
                    next_mut = is_mut;
                    next_signer = is_signer;
                    account_attr.clear();
                    in_account_attr = false;
                }
                continue;
            }

            if t.starts_with("#[account") {
                account_attr = t.to_string();
                if t.contains(")]") || t == "#[account]" {
                    let (is_mut, is_signer) = parse_account_attr_flags(&account_attr);
                    next_mut = is_mut;
                    next_signer = is_signer;
                    account_attr.clear();
                } else {
                    in_account_attr = true;
                }
                continue;
            }

            if t.starts_with("pub ") && t.contains(':') {
                let field_name = t
                    .strip_prefix("pub ")
                    .unwrap_or("")
                    .split(':')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if !field_name.is_empty() {
                    accounts.push(IdlAccountItem {
                        name: field_name,
                        is_mut: next_mut,
                        is_signer: next_signer,
                    });
                    next_mut = false;
                    next_signer = false;
                }
            }
            if depth <= 0 {
                let mut matched = false;
                for ix in idl.instructions.iter_mut() {
                    if ix.account_context.as_deref() == Some(name.as_str()) {
                        ix.accounts = accounts.clone();
                        matched = true;
                    }
                }
                if !matched {
                    let ix_name = to_snake_case(&name);
                    for ix in idl.instructions.iter_mut() {
                        if ix.name == ix_name {
                            ix.accounts = accounts.clone();
                        }
                    }
                }
                accounts.clear();
                name.clear();
                in_derive = false;
            }
        }
    }
}

fn find_matching_delimiter(s: &str, start: usize, open: char, close: char) -> Option<usize> {
    let mut depth = 0i32;
    for (offset, c) in s[start..].char_indices() {
        if c == open {
            depth += 1;
        } else if c == close {
            depth -= 1;
            if depth == 0 {
                return Some(start + offset);
            }
        }
    }
    None
}

fn split_top_level_commas(s: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0usize;
    let mut paren_depth = 0i32;
    let mut bracket_depth = 0i32;
    let mut angle_depth = 0i32;

    for (i, c) in s.char_indices() {
        match c {
            '(' => paren_depth += 1,
            ')' => paren_depth -= 1,
            '[' => bracket_depth += 1,
            ']' => bracket_depth -= 1,
            '<' => angle_depth += 1,
            '>' => angle_depth -= 1,
            ',' if paren_depth == 0 && bracket_depth == 0 && angle_depth == 0 => {
                parts.push(&s[start..i]);
                start = i + c.len_utf8();
            }
            _ => {}
        }
    }
    parts.push(&s[start..]);
    parts
}

fn parse_context_param(param: &str) -> Option<String> {
    let (name, ty) = param.split_once(':')?;
    let ident = name.trim();
    if ident != "ctx" && ident != "_ctx" {
        return None;
    }
    let compact: String = ty.chars().filter(|c| !c.is_whitespace()).collect();
    let context_ty = strip_path_prefix(&compact);
    let inner = context_ty.strip_prefix("Context<")?.strip_suffix('>')?;
    let account_ty = strip_path_prefix(inner);
    let account_name = account_ty.split('<').next().unwrap_or(account_ty);
    if account_name.is_empty() {
        None
    } else {
        Some(account_name.to_string())
    }
}

/// Blank out the contents of string/char literals and `//` / `/* */` comments
/// in a single line, so that brace counting (`.matches('{')` / `.matches('}')`)
/// ignores braces that appear inside literals or comments.
///
/// FINDING 2: the brace-depth parsers counted braces per line without this,
/// so an unbalanced `}` inside a string (e.g. `log("close brace } here")`) or
/// a comment would prematurely close the `#[program]` / struct / enum block
/// and silently drop every later instruction, account field, error, or event.
///
/// `in_block_comment` carries `/* ... */` state across lines and is updated in
/// place. Stripped regions are replaced with spaces (braces become spaces);
/// the returned string is brace-count-equivalent to the original code minus
/// literal/comment braces.
fn strip_literals_and_comments(line: &str, in_block_comment: &mut bool) -> String {
    let bytes = line.as_bytes();
    let mut out = String::with_capacity(line.len());
    let mut i = 0;

    #[derive(PartialEq)]
    enum State {
        Code,
        Str,
        Char,
    }
    let mut state = State::Code;

    while i < bytes.len() {
        let c = bytes[i];

        if *in_block_comment {
            // Inside /* ... */ — look for the closing */
            if c == b'*' && i + 1 < bytes.len() && bytes[i + 1] == b'/' {
                *in_block_comment = false;
                out.push(' ');
                out.push(' ');
                i += 2;
            } else {
                out.push(' ');
                i += 1;
            }
            continue;
        }

        match state {
            State::Str => {
                if c == b'\\' && i + 1 < bytes.len() {
                    // Skip escaped character (e.g. \" or \\)
                    out.push(' ');
                    out.push(' ');
                    i += 2;
                    continue;
                }
                if c == b'"' {
                    state = State::Code;
                }
                out.push(' ');
                i += 1;
            }
            State::Char => {
                if c == b'\\' && i + 1 < bytes.len() {
                    out.push(' ');
                    out.push(' ');
                    i += 2;
                    continue;
                }
                if c == b'\'' {
                    state = State::Code;
                }
                out.push(' ');
                i += 1;
            }
            State::Code => {
                // Line comment — blank the rest of the line.
                if c == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'/' {
                    break;
                }
                // Block comment start.
                if c == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'*' {
                    *in_block_comment = true;
                    out.push(' ');
                    out.push(' ');
                    i += 2;
                    continue;
                }
                if c == b'"' {
                    state = State::Str;
                    out.push(' ');
                    i += 1;
                    continue;
                }
                if c == b'\'' {
                    // Distinguish a char literal (`'x'`, `'\n'`) from a Rust
                    // lifetime (`'info`, `'a`). A char literal is `'` followed
                    // by either a backslash escape, or a single char then `'`.
                    // Anything else is a lifetime — treat `'` as ordinary code.
                    let is_char_literal = (i + 1 < bytes.len() && bytes[i + 1] == b'\\')
                        || (i + 2 < bytes.len() && bytes[i + 2] == b'\'');
                    if is_char_literal {
                        state = State::Char;
                        out.push(' ');
                        i += 1;
                        continue;
                    }
                    // Lifetime tick — keep as code (it has no braces anyway).
                    out.push('\'');
                    i += 1;
                    continue;
                }
                // Regular code byte — preserve. `line` is valid UTF-8 and we
                // only special-case ASCII bytes, so pushing the byte as a char
                // is safe for the ASCII subset; for multi-byte UTF-8 we copy
                // the raw bytes through.
                out.push(c as char);
                i += 1;
            }
        }
    }

    out
}

/// Count `{`/`}` in a line after stripping literals and comments, returning the
/// net brace depth delta. Carries block-comment state across lines.
fn brace_delta(line: &str, in_block_comment: &mut bool) -> i32 {
    let stripped = strip_literals_and_comments(line, in_block_comment);
    stripped.matches('{').count() as i32 - stripped.matches('}').count() as i32
}

fn parse_account_attr_flags(attr: &str) -> (bool, bool) {
    let Some(start) = attr.find('(') else {
        return (false, false);
    };
    let Some(end) = attr.rfind(')') else {
        return (false, false);
    };
    let inner = &attr[start + 1..end];
    let tokens: Vec<&str> = inner.split(',').map(|s| s.trim()).collect();
    let is_mut = tokens.iter().any(|t| *t == "mut" || t.starts_with("init"));
    let is_signer = tokens.iter().any(|t| *t == "signer");
    (is_mut, is_signer)
}

/// Decide whether a stripped, trimmed line inside an `#[error_code]` enum is a
/// variant declaration. A variant is any line that starts with an identifier
/// character (letter or `_`), regardless of leading case, and is not the
/// `pub enum` header, an attribute, a brace, or empty. This counts every real
/// variant structurally so IDL codes align with the runtime's 6000 + index.
fn is_error_variant_line(st: &str) -> bool {
    if st.is_empty() || st == "{" || st == "}" {
        return false;
    }
    if st.starts_with('#') {
        return false; // attribute
    }
    // Skip the enum header (`pub enum Name {`) and any visibility/keyword lines.
    if st.starts_with("pub enum") || st.starts_with("enum ") {
        return false;
    }
    // A variant name begins with an ASCII letter or underscore.
    matches!(st.as_bytes().first(), Some(b) if b.is_ascii_alphabetic() || *b == b'_')
}

fn parse_errors(source: &str, idl: &mut Idl) {
    let mut in_error = false;
    let mut depth = 0i32;
    let mut variant_index: u32 = 0; // STRUCTURAL position; code = 6000 + index
    let mut next_msg = String::new();
    let mut in_block_comment = false;
    let errors_before = idl.errors.len();

    for line in source.lines() {
        let t = line.trim();
        if t == "#[error_code]" {
            in_error = true;
            continue;
        }
        if in_error {
            // Strip literals/comments ONCE per line; derive both brace depth
            // and variant detection from the same stripped text so a brace
            // inside a literal can't confuse either.
            let stripped = strip_literals_and_comments(line, &mut in_block_comment);
            depth += stripped.matches('{').count() as i32 - stripped.matches('}').count() as i32;

            if t.starts_with("#[msg(") {
                next_msg = t
                    .strip_prefix("#[msg(\"")
                    .unwrap_or("")
                    .strip_suffix("\")]")
                    .unwrap_or("")
                    .to_string();
            }

            // FINDING 3 (IDL side): count EVERY enum variant structurally so the
            // IDL code matches the runtime's `6000 + structural index`. The old
            // logic only counted lines whose first char was uppercase, so a
            // lowercase-leading variant was skipped and misaligned every later
            // code. The variant name comes from the original trimmed line (the
            // stripped one preserves identifiers as code, so either works, but
            // the original keeps non-ASCII identifier bytes intact).
            let st = stripped.trim();
            if is_error_variant_line(st) {
                let vname = t.trim_end_matches(',').trim().to_string();
                idl.errors.push(IdlError {
                    code: 6000 + variant_index,
                    name: vname.clone(),
                    msg: if next_msg.is_empty() {
                        vname
                    } else {
                        std::mem::take(&mut next_msg)
                    },
                });
                variant_index += 1;
            }
            if depth <= 0 {
                in_error = false;
            }
        }
    }

    // Cross-check: the number of IDL errors emitted for this enum must equal
    // the number of variants structurally counted.
    debug_assert_eq!(
        idl.errors.len() - errors_before,
        variant_index as usize,
        "error variant count mismatch"
    );
}

fn parse_events(source: &str, idl: &mut Idl) {
    let mut in_event = false;
    let mut name = String::new();
    let mut fields = Vec::new();
    let mut depth = 0i32;
    let mut in_block_comment = false;

    for line in source.lines() {
        let t = line.trim();
        if t == "#[event]" {
            in_event = true;
            continue;
        }
        if in_event && name.is_empty() {
            if t.starts_with("pub struct ") {
                name = extract_struct_name(t);
                depth = brace_delta(line, &mut in_block_comment);
                continue;
            }
        }
        if in_event && !name.is_empty() {
            depth += brace_delta(line, &mut in_block_comment);
            if t.starts_with("pub ") && t.contains(':') {
                if let Some(f) = parse_field(t) {
                    fields.push(f);
                }
            }
            if depth <= 0 {
                idl.events.push(IdlEvent {
                    name: name.clone(),
                    fields: std::mem::take(&mut fields),
                });
                name.clear();
                in_event = false;
            }
        }
    }
}

fn extract_struct_name(line: &str) -> String {
    line.strip_prefix("pub struct ")
        .unwrap_or(line)
        .split(|c: char| c == '{' || c == '<' || c == ' ')
        .next()
        .unwrap_or("")
        .trim()
        .to_string()
}

fn parse_field(line: &str) -> Option<IdlField> {
    let field_part = line.strip_prefix("pub ")?;
    let (name, ty) = field_part.split_once(':')?;
    // Strip trailing comma and comments
    let ty_clean = ty
        .split("//")
        .next()
        .unwrap_or(ty)
        .trim()
        .trim_end_matches(',')
        .trim();
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
            if normalized.starts_with('[') && normalized.ends_with(']') && normalized.contains(';')
            {
                let inner = &normalized[1..normalized.len() - 1];
                if let Some((t, n)) = inner.split_once(';') {
                    if let Ok(size) = n.parse::<usize>() {
                        return serde_json::json!({"array": [map_type(t), size]});
                    }
                }
            }
            // Vec<T>, including fully qualified no_std paths.
            if let Some(inner) = vec_inner_type(ty) {
                return serde_json::json!({"vec": map_type(inner)});
            }
            // Option<T>
            if ty.starts_with("Option<") && ty.ends_with('>') {
                let inner = &ty[7..ty.len() - 1];
                return serde_json::json!({"option": map_type(inner)});
            }
            // Custom type reference
            serde_json::json!({"defined": ty})
        }
    }
}

fn vec_inner_type(ty: &str) -> Option<&str> {
    for prefix in ["Vec<", "alloc::vec::Vec<", "std::vec::Vec<"] {
        if ty.starts_with(prefix) && ty.ends_with('>') {
            return Some(&ty[prefix.len()..ty.len() - 1]);
        }
    }
    None
}

fn strip_path_prefix(ty: &str) -> &str {
    let bytes = ty.as_bytes();
    let mut depth = 0i32;
    let mut last_sep = None;
    let mut i = 0;
    while i + 1 < bytes.len() {
        match bytes[i] {
            b'<' => depth += 1,
            b'>' => depth -= 1,
            b':' if depth == 0 && bytes[i + 1] == b':' => {
                last_sep = Some(i + 2);
                i += 2;
                continue;
            }
            _ => {}
        }
        i += 1;
    }
    match last_sep {
        Some(idx) => &ty[idx..],
        None => ty,
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
        assert_eq!(
            map_type("[u8; 32]"),
            serde_json::json!({"array": ["u8", 32]})
        );
        assert_eq!(
            map_type("[u8;32]"),
            serde_json::json!({"array": ["u8", 32]})
        );
        assert_eq!(
            map_type("[u8;  4]"),
            serde_json::json!({"array": ["u8", 4]})
        );
    }

    #[test]
    fn test_map_type_vec_option() {
        assert_eq!(map_type("Vec<u64>"), serde_json::json!({"vec": "u64"}));
        assert_eq!(
            map_type("alloc::vec::Vec<[u8; 32]>"),
            serde_json::json!({"vec": {"array": ["u8", 32]}})
        );
        assert_eq!(
            map_type("Vec<Pubkey>"),
            serde_json::json!({"vec": "publicKey"})
        );
        assert_eq!(
            map_type("Option<Pubkey>"),
            serde_json::json!({"option": "publicKey"})
        );
        assert_eq!(map_type("Option<u8>"), serde_json::json!({"option": "u8"}));
    }

    #[test]
    fn test_map_type_custom() {
        assert_eq!(
            map_type("MyCustomType"),
            serde_json::json!({"defined": "MyCustomType"})
        );
        assert_eq!(
            map_type("StakeInfo"),
            serde_json::json!({"defined": "StakeInfo"})
        );
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
        let source =
            "pub fn transfer(\n    ctx: Context<Transfer>,\n    amount: u64,\n) -> Result<()> {";
        let normalized = normalize_source(source);
        assert!(normalized
            .contains("pub fn transfer( ctx: Context<Transfer>, amount: u64, ) -> Result<()> {"));
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
        assert_eq!(
            parse_declare_id(source),
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        );
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
    fn test_parse_fn_sig_stops_before_return_type() {
        let ix = parse_fn_sig(
            "pub fn stake(ctx: Context<Stake>, rwt_amount: u64, min_strwt_out: u64) -> Result<()> {",
        )
        .unwrap();
        assert_eq!(ix.name, "stake");
        assert_eq!(ix.account_context.as_deref(), Some("Stake"));
        assert_eq!(ix.args.len(), 2);
        assert_eq!(ix.args[0].name, "rwt_amount");
        assert_eq!(ix.args[0].ty, serde_json::json!("u64"));
        assert_eq!(ix.args[1].name, "min_strwt_out");
        assert_eq!(ix.args[1].ty, serde_json::json!("u64"));
    }

    #[test]
    fn test_parse_fn_sig_context_edge_cases() {
        let ix = parse_fn_sig(
            "pub fn pause(_ctx: arlex_lang::prelude::Context<crate::PauseEarn<'info>>, ctx_amount: u64) -> Result<()> {",
        )
        .unwrap();
        assert_eq!(ix.account_context.as_deref(), Some("PauseEarn"));
        assert_eq!(ix.args.len(), 1);
        assert_eq!(ix.args[0].name, "ctx_amount");
        assert_eq!(ix.args[0].ty, serde_json::json!("u64"));
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
    fn test_parse_derive_accounts_uses_context_struct_name() {
        let source = r#"
#[derive(Accounts)]
pub struct PauseEarn<'info> {
    #[account(signer)]
    pub pause_authority: &'info AccountView,
    #[account(mut, seeds = [EARN_CONFIG_SEED], bump)]
    pub earn_config: &'info AccountView,
}

#[program]
pub mod test {
    use super::*;
    pub fn pause(ctx: Context<PauseEarn>) -> Result<()> { Ok(()) }
}
"#;
        let mut idl = Idl::default();
        parse_program(source, &mut idl);
        parse_derive_accounts(source, &mut idl);
        assert_eq!(idl.instructions[0].name, "pause");
        assert_eq!(idl.instructions[0].accounts.len(), 2);
        assert_eq!(idl.instructions[0].accounts[0].name, "pause_authority");
        assert!(!idl.instructions[0].accounts[0].is_mut);
        assert!(idl.instructions[0].accounts[0].is_signer);
        assert_eq!(idl.instructions[0].accounts[1].name, "earn_config");
        assert!(idl.instructions[0].accounts[1].is_mut);
        assert!(!idl.instructions[0].accounts[1].is_signer);
    }

    #[test]
    fn test_parse_derive_accounts_reuses_context_struct_for_multiple_ixs() {
        let source = r#"
#[derive(Accounts)]
pub struct Toggle<'info> {
    #[account(signer)]
    pub authority: &'info AccountView,
    #[account(mut)]
    pub config: &'info AccountView,
}

#[program]
pub mod test {
    use super::*;
    pub fn pause(ctx: Context<Toggle>) -> Result<()> { Ok(()) }
    pub fn unpause(ctx: Context<Toggle>) -> Result<()> { Ok(()) }
}
"#;
        let mut idl = Idl::default();
        parse_program(source, &mut idl);
        parse_derive_accounts(source, &mut idl);
        assert_eq!(idl.instructions[0].accounts.len(), 2);
        assert_eq!(idl.instructions[1].accounts.len(), 2);
        assert_eq!(idl.instructions[0].accounts[1].name, "config");
        assert_eq!(idl.instructions[1].accounts[1].name, "config");
        assert!(idl.instructions[0].accounts[1].is_mut);
        assert!(idl.instructions[1].accounts[1].is_mut);
    }

    #[test]
    fn test_parse_multiline_account_attr_flags() {
        let source = r#"
#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(signer)]
    pub authority: &'info AccountView,

    #[account(
        mut, has_one = authority, account_type = "EarnConfig",
        seeds = [EARN_CONFIG_SEED], bump
    )]
    pub earn_config: &'info AccountView,
}

#[program]
pub mod test {
    use super::*;
    pub fn update_config(ctx: Context<UpdateConfig>, mint_fee_bps: u16) -> Result<()> { Ok(()) }
}
"#;
        let mut idl = Idl::default();
        parse_program(source, &mut idl);
        parse_derive_accounts(source, &mut idl);
        assert_eq!(idl.instructions[0].accounts.len(), 2);
        assert_eq!(idl.instructions[0].accounts[0].name, "authority");
        assert!(!idl.instructions[0].accounts[0].is_mut);
        assert!(idl.instructions[0].accounts[0].is_signer);
        assert_eq!(idl.instructions[0].accounts[1].name, "earn_config");
        assert!(idl.instructions[0].accounts[1].is_mut);
        assert!(!idl.instructions[0].accounts[1].is_signer);
        assert_eq!(idl.instructions[0].args[0].ty, serde_json::json!("u16"));
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

    // ==================== FINDING 3 (IDL side): structural error indexing ====================

    #[test]
    fn test_parse_errors_lowercase_variant_keeps_codes_aligned() {
        // A lowercase-leading variant (unconventional but valid Rust) must be
        // counted structurally so later codes stay aligned with the runtime's
        // 6000 + position. The old uppercase-only counter would skip `lower`
        // and shift `Third` to 6001 instead of the correct 6002.
        let source = r#"
#[error_code]
pub enum MixedCase {
    First,
    lower,
    Third,
}
"#;
        let mut idl = Idl::default();
        parse_errors(source, &mut idl);
        assert_eq!(idl.errors.len(), 3, "every variant counted structurally");
        assert_eq!(idl.errors[0].name, "First");
        assert_eq!(idl.errors[0].code, 6000);
        assert_eq!(idl.errors[1].name, "lower");
        assert_eq!(idl.errors[1].code, 6001);
        assert_eq!(idl.errors[2].name, "Third");
        assert_eq!(idl.errors[2].code, 6002, "Third must be 6002, not 6001");
    }

    #[test]
    fn test_parse_errors_counts_all_variants() {
        let source = r#"
#[error_code]
pub enum Errs {
    A,
    b,
    C,
    d,
    E,
}
"#;
        let mut idl = Idl::default();
        parse_errors(source, &mut idl);
        assert_eq!(idl.errors.len(), 5, "all five variants counted");
        // Codes are dense and structural: 6000..=6004.
        for (i, e) in idl.errors.iter().enumerate() {
            assert_eq!(e.code, 6000 + i as u32);
        }
    }

    #[test]
    fn test_is_error_variant_line_excludes_non_variants() {
        assert!(is_error_variant_line("First,"));
        assert!(is_error_variant_line("lower,"));
        assert!(is_error_variant_line("_Hidden,"));
        assert!(!is_error_variant_line("#[msg(\"x\")]"));
        assert!(!is_error_variant_line("pub enum Foo {"));
        assert!(!is_error_variant_line("{"));
        assert!(!is_error_variant_line("}"));
        assert!(!is_error_variant_line(""));
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
        assert_eq!(
            map_type("[Pubkey; 3]"),
            serde_json::json!({"array": ["publicKey", 3]})
        );
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

    // ==================== FINDING 2: literal/comment-safe brace parsing ====================

    #[test]
    fn test_strip_literals_and_comments_string_braces() {
        let mut block = false;
        let stripped = strip_literals_and_comments(r#"log("close brace } here");"#, &mut block);
        // The `}` inside the string must be blanked out.
        assert_eq!(stripped.matches('}').count(), 0);
        assert!(!block);
    }

    #[test]
    fn test_strip_literals_and_comments_line_comment() {
        let mut block = false;
        let stripped = strip_literals_and_comments("let x = 1; // trailing } brace", &mut block);
        assert_eq!(stripped.matches('}').count(), 0);
    }

    #[test]
    fn test_strip_literals_and_comments_block_comment_across_lines() {
        let mut block = false;
        // Opening line: code before the comment is kept, comment braces dropped.
        let l1 = strip_literals_and_comments("foo {  /* open } brace", &mut block);
        assert!(block, "block comment must stay open across lines");
        assert_eq!(l1.matches('{').count(), 1); // the real `{` before the comment
        assert_eq!(l1.matches('}').count(), 0); // `}` inside comment dropped
        // Middle line entirely inside the block comment.
        let l2 = strip_literals_and_comments("still } inside }", &mut block);
        assert!(block);
        assert_eq!(l2.matches('}').count(), 0);
        // Closing line: after */, real code resumes.
        let l3 = strip_literals_and_comments("end */ }", &mut block);
        assert!(!block, "block comment must close");
        assert_eq!(l3.matches('}').count(), 1); // the real `}` after */
    }

    #[test]
    fn test_strip_literals_char_literal_brace() {
        let mut block = false;
        // A char literal containing a brace must not affect counting.
        let stripped = strip_literals_and_comments("let c = '}';", &mut block);
        assert_eq!(stripped.matches('}').count(), 0);
    }

    #[test]
    fn test_parse_program_unbalanced_brace_in_string_keeps_all_instructions() {
        // The first fn body contains a string with an unbalanced `}`. Without
        // literal stripping this prematurely closes the module and drops the
        // later instructions. All three must be parsed.
        let source = r#"
#[program]
pub mod my_program {
    use super::*;
    pub fn first(ctx: Context<First>) -> Result<()> {
        log("close brace } here");
        Ok(())
    }
    pub fn second(ctx: Context<Second>) -> Result<()> { Ok(()) }
    pub fn third(ctx: Context<Third>) -> Result<()> { Ok(()) }
}
"#;
        let mut idl = Idl::default();
        let count = parse_program(source, &mut idl);
        assert_eq!(idl.instructions.len(), 3, "all instructions must be parsed");
        assert_eq!(count, 3);
        assert_eq!(idl.instructions[0].name, "first");
        assert_eq!(idl.instructions[1].name, "second");
        assert_eq!(idl.instructions[2].name, "third");
    }

    #[test]
    fn test_generate_idl_instruction_count_check() {
        // Simulate the cross-check logic directly: when the pub_fn count and the
        // emitted instruction count diverge, generate_idl returns Err. We can't
        // call generate_idl (it reads from src/), so we replicate its check.
        let mut idl = Idl::default();
        // A program where one `pub fn` has no argument list at all, so
        // parse_fn_sig rejects it (no `(`). It is counted as a `pub fn` but no
        // instruction is emitted — exactly the divergence generate_idl flags.
        let source =
            "#[program]\npub mod m {\n    pub fn ok(ctx: Context<A>) -> Result<()> { Ok(()) }\n    pub fn broken;\n}\n";
        let pub_fn_count = parse_program(source, &mut idl);
        assert_eq!(pub_fn_count, 2, "both pub fn lines counted");
        assert_eq!(idl.instructions.len(), 1, "broken signature not emitted");
        // The cross-check in generate_idl would fire on this mismatch.
        assert_ne!(idl.instructions.len(), pub_fn_count);
    }
}
