//! Arlex — Solana framework built on Pinocchio
//! Deploy programs 14x cheaper. Same Rust, same DX.

extern crate alloc;

// Re-export proc macros
pub use arlex_derive::{program, account, Accounts, error_code, event};

// Re-export pinocchio core types
pub use pinocchio::{
    self,
    AccountView,
    Address,
    ProgramResult,
    error::ProgramError,
    cpi::{Seed, Signer},
};

// Re-export logging
pub use solana_program_log;
pub use solana_program_log::log;

// Re-export SPL programs
pub use pinocchio_token as token;
pub use pinocchio_system as system;
pub use pinocchio_associated_token_account as associated_token;
pub use pinocchio_memo as memo;

/// Context passed to instruction handlers.
/// `T` is the validated Accounts struct from #[derive(Accounts)].
pub struct Context<'a, T> {
    pub program_id: &'a Address,
    pub accounts: T,
    pub remaining_accounts: &'a [AccountView],
}

/// Result type alias for Arlex programs
pub type Result<T> = core::result::Result<T, ProgramError>;

/// Emit an event via sol_log_data
#[macro_export]
macro_rules! emit {
    ($event:expr) => {
        $event.emit()
    };
}

/// Declare the program ID from a base58 string.
/// Thread-safe: uses OnceLock on native, simple decode on SBF.
#[macro_export]
macro_rules! declare_id {
    ($id:literal) => {
        /// The program ID
        #[cfg(not(any(target_os = "solana", target_arch = "bpf")))]
        pub fn id() -> &'static arlex_lang::Address {
            use std::sync::OnceLock;
            static ID: OnceLock<arlex_lang::Address> = OnceLock::new();
            ID.get_or_init(|| {
                let bytes = arlex_lang::base58_decode($id);
                arlex_lang::Address::new_from_array(bytes)
            })
        }

        #[cfg(any(target_os = "solana", target_arch = "bpf"))]
        pub fn id() -> &'static arlex_lang::Address {
            // SBF is single-threaded — simple static init is safe
            static mut ID_BYTES: [u8; 32] = [0u8; 32];
            static mut INIT: bool = false;
            unsafe {
                if !INIT {
                    ID_BYTES = arlex_lang::base58_decode($id);
                    INIT = true;
                }
                core::mem::transmute(&ID_BYTES)
            }
        }
    };
}

/// Declare the program ID from raw bytes (compile-time safe)
#[macro_export]
macro_rules! declare_id_bytes {
    ($bytes:expr) => {
        pub fn id() -> &'static arlex_lang::Address {
            static ID: arlex_lang::Address = arlex_lang::Address::new_from_array($bytes);
            &ID
        }
    };
}

/// Prelude — import everything you need
pub mod prelude {
    pub use super::*;
    pub use super::Context;
    pub use super::Result;
    pub use pinocchio::AccountView;
    pub use pinocchio::Address;
    pub use pinocchio::Address as Pubkey;
}

// ============================================================
// Instruction argument deserialization
// Named ArgsDeserialize (not BorshDeserialize — we don't implement full Borsh)
// For Anchor client compatibility, we use little-endian fixed-width format
// which matches Borsh for primitive types.
// ============================================================

/// Trait for deserializing instruction arguments from a byte slice.
/// The slice is advanced past the consumed bytes.
pub trait ArgsDeserialize: Sized {
    fn deserialize(data: &mut &[u8]) -> core::result::Result<Self, ProgramError>;
}

impl ArgsDeserialize for u8 {
    fn deserialize(data: &mut &[u8]) -> core::result::Result<Self, ProgramError> {
        if data.is_empty() { return Err(ProgramError::InvalidInstructionData); }
        let val = data[0];
        *data = &data[1..];
        Ok(val)
    }
}

impl ArgsDeserialize for i8 {
    fn deserialize(data: &mut &[u8]) -> core::result::Result<Self, ProgramError> {
        if data.is_empty() { return Err(ProgramError::InvalidInstructionData); }
        let val = data[0] as i8;
        *data = &data[1..];
        Ok(val)
    }
}

impl ArgsDeserialize for u16 {
    fn deserialize(data: &mut &[u8]) -> core::result::Result<Self, ProgramError> {
        if data.len() < 2 { return Err(ProgramError::InvalidInstructionData); }
        let val = u16::from_le_bytes([data[0], data[1]]);
        *data = &data[2..];
        Ok(val)
    }
}

impl ArgsDeserialize for i16 {
    fn deserialize(data: &mut &[u8]) -> core::result::Result<Self, ProgramError> {
        if data.len() < 2 { return Err(ProgramError::InvalidInstructionData); }
        let val = i16::from_le_bytes([data[0], data[1]]);
        *data = &data[2..];
        Ok(val)
    }
}

impl ArgsDeserialize for u32 {
    fn deserialize(data: &mut &[u8]) -> core::result::Result<Self, ProgramError> {
        if data.len() < 4 { return Err(ProgramError::InvalidInstructionData); }
        let val = u32::from_le_bytes(data[..4].try_into().unwrap());
        *data = &data[4..];
        Ok(val)
    }
}

impl ArgsDeserialize for i32 {
    fn deserialize(data: &mut &[u8]) -> core::result::Result<Self, ProgramError> {
        if data.len() < 4 { return Err(ProgramError::InvalidInstructionData); }
        let val = i32::from_le_bytes(data[..4].try_into().unwrap());
        *data = &data[4..];
        Ok(val)
    }
}

impl ArgsDeserialize for u64 {
    fn deserialize(data: &mut &[u8]) -> core::result::Result<Self, ProgramError> {
        if data.len() < 8 { return Err(ProgramError::InvalidInstructionData); }
        let val = u64::from_le_bytes(data[..8].try_into().unwrap());
        *data = &data[8..];
        Ok(val)
    }
}

impl ArgsDeserialize for i64 {
    fn deserialize(data: &mut &[u8]) -> core::result::Result<Self, ProgramError> {
        if data.len() < 8 { return Err(ProgramError::InvalidInstructionData); }
        let val = i64::from_le_bytes(data[..8].try_into().unwrap());
        *data = &data[8..];
        Ok(val)
    }
}

impl ArgsDeserialize for u128 {
    fn deserialize(data: &mut &[u8]) -> core::result::Result<Self, ProgramError> {
        if data.len() < 16 { return Err(ProgramError::InvalidInstructionData); }
        let val = u128::from_le_bytes(data[..16].try_into().unwrap());
        *data = &data[16..];
        Ok(val)
    }
}

impl ArgsDeserialize for i128 {
    fn deserialize(data: &mut &[u8]) -> core::result::Result<Self, ProgramError> {
        if data.len() < 16 { return Err(ProgramError::InvalidInstructionData); }
        let val = i128::from_le_bytes(data[..16].try_into().unwrap());
        *data = &data[16..];
        Ok(val)
    }
}

impl ArgsDeserialize for bool {
    fn deserialize(data: &mut &[u8]) -> core::result::Result<Self, ProgramError> {
        if data.is_empty() { return Err(ProgramError::InvalidInstructionData); }
        let val = match data[0] {
            0 => false,
            1 => true,
            _ => return Err(ProgramError::InvalidInstructionData), // strict Borsh compliance
        };
        *data = &data[1..];
        Ok(val)
    }
}

impl ArgsDeserialize for Address {
    fn deserialize(data: &mut &[u8]) -> core::result::Result<Self, ProgramError> {
        if data.len() < 32 { return Err(ProgramError::InvalidInstructionData); }
        let bytes: [u8; 32] = data[..32].try_into().unwrap();
        *data = &data[32..];
        Ok(Address::new_from_array(bytes))
    }
}

impl<const N: usize> ArgsDeserialize for [u8; N] {
    fn deserialize(data: &mut &[u8]) -> core::result::Result<Self, ProgramError> {
        if data.len() < N { return Err(ProgramError::InvalidInstructionData); }
        let mut arr = [0u8; N];
        arr.copy_from_slice(&data[..N]);
        *data = &data[N..];
        Ok(arr)
    }
}

// String: u32 length prefix + utf8 bytes (Borsh format)
impl ArgsDeserialize for alloc::string::String {
    fn deserialize(data: &mut &[u8]) -> core::result::Result<Self, ProgramError> {
        if data.len() < 4 { return Err(ProgramError::InvalidInstructionData); }
        let len = u32::from_le_bytes(data[..4].try_into().unwrap()) as usize;
        *data = &data[4..];
        if data.len() < len { return Err(ProgramError::InvalidInstructionData); }
        let s = core::str::from_utf8(&data[..len])
            .map_err(|_| ProgramError::InvalidInstructionData)?
            .to_string();
        *data = &data[len..];
        Ok(s)
    }
}

// Vec<T>: u32 length prefix + items (Borsh format)
impl<T: ArgsDeserialize> ArgsDeserialize for alloc::vec::Vec<T> {
    fn deserialize(data: &mut &[u8]) -> core::result::Result<Self, ProgramError> {
        if data.len() < 4 { return Err(ProgramError::InvalidInstructionData); }
        let len = u32::from_le_bytes(data[..4].try_into().unwrap()) as usize;
        *data = &data[4..];
        if len > 10_000 { return Err(ProgramError::InvalidInstructionData); } // sanity limit
        let mut vec = alloc::vec::Vec::with_capacity(len);
        for _ in 0..len {
            vec.push(T::deserialize(data)?);
        }
        Ok(vec)
    }
}

// Option<T>: 1 byte tag (0=None, 1=Some) + value (Borsh format)
impl<T: ArgsDeserialize> ArgsDeserialize for Option<T> {
    fn deserialize(data: &mut &[u8]) -> core::result::Result<Self, ProgramError> {
        if data.is_empty() { return Err(ProgramError::InvalidInstructionData); }
        let tag = data[0];
        *data = &data[1..];
        match tag {
            0 => Ok(None),
            1 => Ok(Some(T::deserialize(data)?)),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}

// ============================================================
// Safe account loading helpers
// These use byte-by-byte reads to avoid alignment issues.
// ============================================================

/// Read a u64 from a byte slice at offset (little-endian, unaligned-safe)
#[inline]
pub fn read_u64_le(data: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(data[offset..offset+8].try_into().unwrap())
}

/// Read a u32 from a byte slice at offset (little-endian, unaligned-safe)
#[inline]
pub fn read_u32_le(data: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(data[offset..offset+4].try_into().unwrap())
}

/// Write a u64 to a mutable byte slice at offset (little-endian, unaligned-safe)
#[inline]
pub fn write_u64_le(data: &mut [u8], offset: usize, val: u64) {
    data[offset..offset+8].copy_from_slice(&val.to_le_bytes());
}

/// Read a u128 from a byte slice at offset (little-endian, unaligned-safe)
#[inline]
pub fn read_u128_le(data: &[u8], offset: usize) -> u128 {
    u128::from_le_bytes(data[offset..offset+16].try_into().unwrap())
}

/// Write a u128 to a mutable byte slice at offset (little-endian, unaligned-safe)
#[inline]
pub fn write_u128_le(data: &mut [u8], offset: usize, val: u128) {
    data[offset..offset+16].copy_from_slice(&val.to_le_bytes());
}

/// Write a u32 to a mutable byte slice at offset (little-endian, unaligned-safe)
#[inline]
pub fn write_u32_le(data: &mut [u8], offset: usize, val: u32) {
    data[offset..offset+4].copy_from_slice(&val.to_le_bytes());
}

// ============================================================
// PDA helpers — work on both native (cargo check) and SBF (cargo build-sbf)
// ============================================================

/// Find a Program Derived Address.
/// On SBF: uses the native syscall.
/// On native: uses the sha256-based derivation for IDE/check compatibility.
#[cfg(any(target_os = "solana", target_arch = "bpf"))]
pub fn find_program_address(seeds: &[&[u8]], program_id: &Address) -> (Address, u8) {
    Address::find_program_address(seeds, program_id)
}

#[cfg(not(any(target_os = "solana", target_arch = "bpf")))]
pub fn find_program_address(seeds: &[&[u8]], _program_id: &Address) -> (Address, u8) {
    // Native-target implementation for cargo check and IDE support.
    // Uses sha256-based derivation. On SBF target, the real Solana syscall is used instead.
    // This is NOT a stub — it produces deterministic addresses for development/testing.
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    for seed in seeds {
        hasher.update(seed);
    }
    hasher.update(_program_id.as_ref());
    hasher.update(b"ProgramDerivedAddress");
    let hash = hasher.finalize();
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&hash[..32]);
    (Address::new_from_array(bytes), 255)
}

/// Create a PDA account via System Program CPI.
/// On native: no-op (for cargo check compatibility).
#[cfg(any(target_os = "solana", target_arch = "bpf"))]
pub fn create_pda_account<'a>(
    payer: &'a AccountView,
    target: &'a AccountView,
    lamports: u64,
    space: u64,
    owner: &Address,
    signer_seeds: &[&[u8]],
    all_accounts: &[AccountView],
) -> core::result::Result<(), ProgramError> {
    let signer_seeds_with_types: Vec<pinocchio::cpi::Seed> = signer_seeds.iter()
        .map(|s| pinocchio::cpi::Seed::from(*s))
        .collect();
    let signer = pinocchio::cpi::Signer::from(signer_seeds_with_types.as_slice());

    system::instructions::CreateAccount {
        from: payer,
        to: target,
        lamports,
        space,
        owner,
    }.invoke_signed(&[signer])?;
    Ok(())
}

#[cfg(not(any(target_os = "solana", target_arch = "bpf")))]
pub fn create_pda_account<'a>(
    _payer: &'a AccountView,
    _target: &'a AccountView,
    _lamports: u64,
    _space: u64,
    _owner: &Address,
    _signer_seeds: &[&[u8]],
    _all_accounts: &[AccountView],
) -> core::result::Result<(), ProgramError> {
    // Native-target implementation — returns Ok(()) for cargo check/IDE.
    // On SBF target, the real System Program CPI is used instead.
    Ok(())
}

// ============================================================
// Math utilities for DeFi calculations
// ============================================================

pub mod math {
    /// Fixed-point scale: 10^12
    pub const SCALE: u128 = 1_000_000_000_000;

    // ---- isqrt (Gap 3) ----

    /// Integer square root (floor) via Newton's method.
    /// Seeded from bit-length for O(log log n) convergence.
    /// Max ~7 iterations for any u128 input.
    ///
    /// SECURITY: Always returns floor (root² ≤ n). Safe for AMM —
    /// first LP depositor gets at most the fair share of LP tokens.
    pub fn isqrt(n: u128) -> u128 {
        if n < 2 {
            return n;
        }
        let bit_len = 128 - n.leading_zeros();
        let shift = (bit_len + 1) / 2;
        let mut x: u128 = 1u128 << shift;

        loop {
            let next = (x + n / x) >> 1;
            if next >= x {
                break;
            }
            x = next;
        }
        x
    }

    // ---- checked_mul_div u64 variants (Gap 5) ----

    /// (a * b) / c for u64 operands, rounded DOWN. Returns None if c == 0 or result > u64::MAX.
    pub fn mul_div_u64(a: u64, b: u64, c: u64) -> Option<u64> {
        if c == 0 { return None; }
        let result = (a as u128) * (b as u128) / (c as u128);
        u64::try_from(result).ok()
    }

    /// (a * b + c - 1) / c for u64 operands, rounded UP.
    pub fn mul_div_u64_round_up(a: u64, b: u64, c: u64) -> Option<u64> {
        if c == 0 { return None; }
        let num = (a as u128) * (b as u128);
        let result = (num + (c as u128) - 1) / (c as u128);
        u64::try_from(result).ok()
    }

    /// (a * b) / c where a: u128, b,c: u64, rounded DOWN.
    /// Overflow-safe via decomposition: (a/c)*b + (a%c)*b/c (mathematically exact).
    pub fn mul_div_u128_u64(a: u128, b: u64, c: u64) -> Option<u128> {
        if c == 0 { return None; }
        let b128 = b as u128;
        let c128 = c as u128;
        if let Some(product) = a.checked_mul(b128) {
            return Some(product / c128);
        }
        let quotient = a / c128;
        let remainder = a % c128;
        // remainder < c <= u64::MAX, b <= u64::MAX
        // Their product can overflow u128 — use checked_mul with u256 fallback
        let rem_part = remainder.checked_mul(b128)
            .map(|v| v / c128)
            .unwrap_or_else(|| {
                let (rh, rl) = mul_u128_wide(remainder, b128);
                // c128 < 2^64, so div_u256_by_u128 is safe here
                div_u256_by_u128(rh, rl, c128).unwrap_or(0)
            });
        quotient.checked_mul(b128)?.checked_add(rem_part)
    }

    /// (a * b) / c where a: u128, b,c: u64, rounded UP.
    pub fn mul_div_u128_u64_round_up(a: u128, b: u64, c: u64) -> Option<u128> {
        if c == 0 { return None; }
        let floor = mul_div_u128_u64(a, b, c)?;
        let b128 = b as u128;
        let c128 = c as u128;
        if let Some(product) = a.checked_mul(b128) {
            if product % c128 != 0 {
                return floor.checked_add(1);
            }
        } else {
            // Slow path: check remainder via decomposition
            // remainder * b128 can overflow u128 — use checked_mul with u256 fallback
            let remainder = a % c128;
            let has_remainder = remainder.checked_mul(b128)
                .map(|v| v % c128 != 0)
                .unwrap_or_else(|| {
                    let (rh, rl) = mul_u128_wide(remainder, b128);
                    // Check if (rh, rl) % c128 != 0
                    let floor_rem = div_u256_by_u128(rh, rl, c128).unwrap_or(0);
                    let (check_hi, check_lo) = mul_u128_wide(floor_rem, c128);
                    rh != check_hi || rl != check_lo
                });
            if has_remainder {
                return floor.checked_add(1);
            }
        }
        Some(floor)
    }

    // ---- checked_mul_div u128 (Gap 7) ----

    /// (a * b) / c for u128 operands, rounded DOWN.
    /// Uses u256 intermediate via widening multiplication.
    /// Returns None if c == 0, c >= 2^64, or result > u128::MAX.
    ///
    /// SAFETY: divisor must be < 2^64 to avoid intermediate overflow in schoolbook
    /// division. For Areal DEX this is always true (divisor = SCALE = 10^12).
    pub fn checked_mul_div_u128(a: u128, b: u128, c: u128) -> Option<u128> {
        if c == 0 { return None; }
        // Require divisor < 2^64 to avoid intermediate overflow in slow path
        if c >> 64 != 0 { return None; }
        // Fast path
        if let Some(product) = a.checked_mul(b) {
            return Some(product / c);
        }
        // Slow path: u256 intermediate
        let (hi, lo) = mul_u128_wide(a, b);
        div_u256_by_u128(hi, lo, c)
    }

    /// (a * b) / c for u128 operands, rounded UP.
    /// Same divisor < 2^64 restriction as checked_mul_div_u128.
    pub fn checked_mul_div_u128_round_up(a: u128, b: u128, c: u128) -> Option<u128> {
        if c == 0 || c >> 64 != 0 { return None; }
        let floor = checked_mul_div_u128(a, b, c)?;
        if let Some(product) = a.checked_mul(b) {
            if product % c != 0 {
                return floor.checked_add(1);
            }
        } else {
            let (hi, lo) = mul_u128_wide(a, b);
            // Check if (hi, lo) - floor * c != 0
            let (check_hi, check_lo) = mul_u128_wide(floor, c);
            if hi != check_hi || lo != check_lo {
                return floor.checked_add(1);
            }
        }
        Some(floor)
    }

    /// Widening multiplication: a * b = (hi, lo) where value = hi * 2^128 + lo.
    fn mul_u128_wide(a: u128, b: u128) -> (u128, u128) {
        let a_lo = a & 0xFFFF_FFFF_FFFF_FFFF;
        let a_hi = a >> 64;
        let b_lo = b & 0xFFFF_FFFF_FFFF_FFFF;
        let b_hi = b >> 64;

        let lo_lo = a_lo * b_lo;
        let lo_hi = a_lo * b_hi;
        let hi_lo = a_hi * b_lo;
        let hi_hi = a_hi * b_hi;

        let mid_sum = lo_hi.wrapping_add(hi_lo);
        let mid_carry: u128 = if mid_sum < lo_hi { 1 } else { 0 };

        let lo = lo_lo.wrapping_add(mid_sum << 64);
        let carry_from_lo: u128 = if lo < lo_lo { 1 } else { 0 };

        let hi = hi_hi + (mid_sum >> 64) + (mid_carry << 64) + carry_from_lo;
        (hi, lo)
    }

    /// Divide u256 (hi:lo) by u128 divisor. Returns None if result > u128::MAX.
    fn div_u256_by_u128(hi: u128, lo: u128, divisor: u128) -> Option<u128> {
        if hi >= divisor { return None; } // result >= 2^128
        if hi == 0 { return Some(lo / divisor); }
        // For safety, require divisor < 2^64 to avoid intermediate overflow
        if divisor >> 64 != 0 { return None; }

        // Schoolbook division: process 64 bits at a time
        let mut remainder = hi;

        // High 64 bits of lo
        let lo_hi = lo >> 64;
        let dividend_hi = (remainder << 64) | lo_hi;
        let q_hi = dividend_hi / divisor;
        remainder = dividend_hi % divisor;

        // Low 64 bits of lo
        let lo_lo = lo & 0xFFFF_FFFF_FFFF_FFFF;
        let dividend_lo = (remainder << 64) | lo_lo;
        let q_lo = dividend_lo / divisor;

        Some((q_hi << 64) | q_lo)
    }

    // ---- pow_bps (Gap 4) ----

    /// (1 + bps/10_000)^exp, rounded DOWN. Use when paying out to user.
    /// Valid range: bps < 10_000 (i.e. < 100%). Returns None for bps >= 10_000.
    pub fn pow_bps(bps: u16, exp: i32) -> Option<u128> {
        if bps >= 10_000 { return None; }
        if exp == 0 { return Some(SCALE); }
        if exp == i32::MIN { return None; }

        let base = SCALE + (bps as u128) * SCALE / 10_000;

        if exp > 0 {
            pow_fixed(base, exp as u32)
        } else {
            let forward = pow_fixed(base, (-exp) as u32)?;
            if forward == 0 { return None; }
            SCALE.checked_mul(SCALE).map(|num| num / forward)
        }
    }

    /// (1 + bps/10_000)^exp, rounded UP. Use when charging user.
    /// Returns floor + 1 when the result is known to be non-exact.
    /// For bps == 0 the result is always exact (1.0^n = 1.0), so no +1.
    /// For bps in 1..9999 and exp != 0, fixed-point truncation guarantees
    /// the floor result is strictly below the true value, so +1 is correct.
    pub fn pow_bps_round_up(bps: u16, exp: i32) -> Option<u128> {
        if bps >= 10_000 { return None; }
        let floor = pow_bps(bps, exp)?;
        if bps == 0 || exp == 0 {
            // Exact result — no rounding needed
            Some(floor)
        } else {
            floor.checked_add(1)
        }
    }

    fn pow_fixed(mut base: u128, mut exp: u32) -> Option<u128> {
        let mut result = SCALE;
        while exp > 0 {
            if exp & 1 == 1 {
                result = result.checked_mul(base)? / SCALE;
            }
            exp >>= 1;
            if exp > 0 {
                base = base.checked_mul(base)? / SCALE;
            }
        }
        Some(result)
    }
}

// ============================================================
// Base58
// ============================================================

/// Decode a base58 string to 32 bytes (runtime, for declare_id!).
/// Minimal implementation — supports Solana addresses only (32 bytes output).
pub fn base58_decode(input: &str) -> [u8; 32] {
    const ALPHABET: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let mut result = [0u8; 32];
    let mut scratch = [0u32; 44]; // enough for base58 → 32 bytes
    let mut scratch_len = 0usize;

    for &ch in input.as_bytes() {
        let mut carry = match ALPHABET.iter().position(|&c| c == ch) {
            Some(v) => v as u32,
            None => panic!("Invalid base58 character '{}' in program ID", ch as char),
        };
        for j in 0..scratch_len {
            carry += scratch[j] * 58;
            scratch[j] = carry & 0xFF;
            carry >>= 8;
        }
        while carry > 0 {
            scratch[scratch_len] = carry & 0xFF;
            scratch_len += 1;
            carry >>= 8;
        }
    }

    // Count leading '1's (zeros)
    let leading_zeros = input.as_bytes().iter().take_while(|&&b| b == b'1').count();

    // Copy result in reverse
    let total = leading_zeros + scratch_len;
    if total <= 32 {
        let offset = 32 - total;
        for i in 0..scratch_len {
            result[offset + leading_zeros + scratch_len - 1 - i] = scratch[i] as u8;
        }
    }

    result
}

// ============================================================
// Tests
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math::*;

    // ---- Gap 1: u128/i128 ArgsDeserialize ----

    #[test]
    fn test_u128_max() {
        let val: u128 = u128::MAX;
        let bytes = val.to_le_bytes();
        let mut slice: &[u8] = &bytes;
        assert_eq!(u128::deserialize(&mut slice).unwrap(), val);
        assert!(slice.is_empty());
    }

    #[test]
    fn test_u128_zero() {
        let mut slice: &[u8] = &0u128.to_le_bytes();
        assert_eq!(u128::deserialize(&mut slice).unwrap(), 0);
    }

    #[test]
    fn test_u128_insufficient_data() {
        let mut slice: &[u8] = &[0u8; 15];
        assert!(u128::deserialize(&mut slice).is_err());
    }

    #[test]
    fn test_i128_negative() {
        let mut slice: &[u8] = &(-1i128).to_le_bytes();
        assert_eq!(i128::deserialize(&mut slice).unwrap(), -1);
    }

    #[test]
    fn test_i128_min() {
        let mut slice: &[u8] = &i128::MIN.to_le_bytes();
        assert_eq!(i128::deserialize(&mut slice).unwrap(), i128::MIN);
    }

    #[test]
    fn test_u128_then_u64_sequence() {
        let v128: u128 = 999_999_999_999;
        let v64: u64 = 42;
        let mut buf = Vec::new();
        buf.extend_from_slice(&v128.to_le_bytes());
        buf.extend_from_slice(&v64.to_le_bytes());
        let mut slice: &[u8] = &buf;
        assert_eq!(u128::deserialize(&mut slice).unwrap(), v128);
        assert_eq!(u64::deserialize(&mut slice).unwrap(), v64);
        assert!(slice.is_empty());
    }

    // ---- Gap 6: read/write helpers ----

    #[test]
    fn test_u128_le_roundtrip() {
        let mut buf = [0u8; 32];
        let val: u128 = 123_456_789_012_345_678_901_234_567_890;
        write_u128_le(&mut buf, 8, val);
        assert_eq!(read_u128_le(&buf, 8), val);
    }

    #[test]
    fn test_u32_le_roundtrip() {
        let mut buf = [0u8; 8];
        write_u32_le(&mut buf, 2, 0xDEADBEEF);
        assert_eq!(read_u32_le(&buf, 2), 0xDEADBEEF);
    }

    // ---- Gap 3: isqrt ----

    #[test]
    fn test_isqrt_basics() {
        assert_eq!(isqrt(0), 0);
        assert_eq!(isqrt(1), 1);
        assert_eq!(isqrt(2), 1);
        assert_eq!(isqrt(3), 1);
        assert_eq!(isqrt(4), 2);
        assert_eq!(isqrt(9), 3);
        assert_eq!(isqrt(10), 3);
        assert_eq!(isqrt(100), 10);
    }

    #[test]
    fn test_isqrt_amm_first_lp() {
        let product: u128 = 1_000_000_000u128 * 1_000_000_000u128;
        assert_eq!(isqrt(product), 1_000_000_000);
    }

    #[test]
    fn test_isqrt_max_u64_product() {
        let n: u128 = (u64::MAX as u128) * (u64::MAX as u128);
        assert_eq!(isqrt(n), u64::MAX as u128);
    }

    #[test]
    fn test_isqrt_max_u128() {
        let root = isqrt(u128::MAX);
        assert_eq!(root, u64::MAX as u128);
        assert!(root * root <= u128::MAX);
    }

    #[test]
    fn test_isqrt_near_max_non_perfect() {
        let n: u128 = (u64::MAX as u128) * (u64::MAX as u128) - 1;
        let root = isqrt(n);
        assert_eq!(root, u64::MAX as u128 - 1);
        assert!(root * root <= n);
        assert!((root + 1) * (root + 1) > n);
    }

    #[test]
    fn test_isqrt_floor_property() {
        for n in [200u128, 999, 1023, 65535, 1_000_001] {
            let root = isqrt(n);
            assert!(root * root <= n);
            assert!((root + 1) * (root + 1) > n);
        }
    }

    // ---- Gap 5: checked_mul_div ----

    #[test]
    fn test_mul_div_u64_basic() {
        assert_eq!(mul_div_u64(100, 200, 50), Some(400));
        assert_eq!(mul_div_u64(5000, 1000, 10000), Some(500));
        assert_eq!(mul_div_u64(u64::MAX, u64::MAX, u64::MAX), Some(u64::MAX));
    }

    #[test]
    fn test_mul_div_u64_zero_divisor() {
        assert_eq!(mul_div_u64(100, 200, 0), None);
    }

    #[test]
    fn test_mul_div_u64_result_overflow() {
        assert_eq!(mul_div_u64(u64::MAX, 2, 1), None);
    }

    #[test]
    fn test_mul_div_u128_u64_fast_path() {
        assert_eq!(mul_div_u128_u64(1000, 500, 250), Some(2000));
    }

    #[test]
    fn test_mul_div_u128_u64_overflow_path() {
        let a = u128::MAX / 2;
        let result = mul_div_u128_u64(a, 3, 2);
        assert!(result.is_some());
        let expected = (a / 2) * 3 + (a % 2) * 3 / 2;
        assert_eq!(result.unwrap(), expected);
    }

    #[test]
    fn test_mul_div_u128_u64_zero_divisor() {
        assert_eq!(mul_div_u128_u64(1000, 500, 0), None);
    }

    #[test]
    fn test_mul_div_fast_slow_equivalence() {
        let a: u128 = 1_000_000_000_000;
        let b: u64 = 999_999;
        let c: u64 = 1_000_000;
        let fast = (a * b as u128) / c as u128;
        let slow_q = a / c as u128;
        let slow_r = a % c as u128;
        let slow = slow_q * b as u128 + slow_r * b as u128 / c as u128;
        assert_eq!(fast, slow);
        assert_eq!(mul_div_u128_u64(a, b, c).unwrap(), fast);
    }

    #[test]
    fn test_mul_div_u64_round_up() {
        assert_eq!(mul_div_u64(10, 3, 4), Some(7));
        assert_eq!(mul_div_u64_round_up(10, 3, 4), Some(8));
        assert_eq!(mul_div_u64(10, 2, 4), Some(5));
        assert_eq!(mul_div_u64_round_up(10, 2, 4), Some(5));
    }

    #[test]
    fn test_mul_div_u128_u64_round_up_fast() {
        assert_eq!(mul_div_u128_u64_round_up(10, 3, 4), Some(8));
        assert_eq!(mul_div_u128_u64_round_up(10, 2, 4), Some(5));
    }

    #[test]
    fn test_mul_div_u128_u64_round_up_slow() {
        let a = u128::MAX / 2;
        let floor = mul_div_u128_u64(a, 3, 2).unwrap();
        let ceil = mul_div_u128_u64_round_up(a, 3, 2).unwrap();
        assert_eq!(ceil, floor + 1);
    }

    // ---- Gap 7: checked_mul_div_u128 ----

    #[test]
    fn test_mul_div_u128_basic() {
        assert_eq!(checked_mul_div_u128(100, 200, 50), Some(400));
    }

    #[test]
    fn test_mul_div_u128_scale() {
        let price: u128 = 1_001_000_000_000;
        let amount: u128 = 1_000_000_000;
        let result = checked_mul_div_u128(price, amount, SCALE).unwrap();
        assert_eq!(result, 1_001_000_000);
    }

    #[test]
    fn test_mul_div_u128_large() {
        let a = u64::MAX as u128 * 1000;
        let b = u64::MAX as u128 * 500;
        let c = u64::MAX as u128;
        let result = checked_mul_div_u128(a, b, c).unwrap();
        assert_eq!(result, u64::MAX as u128 * 500_000);
    }

    #[test]
    fn test_mul_div_u128_zero_divisor() {
        assert_eq!(checked_mul_div_u128(100, 200, 0), None);
    }

    #[test]
    fn test_mul_div_u128_result_overflow() {
        assert_eq!(checked_mul_div_u128(u128::MAX, 2, 1), None);
    }

    #[test]
    fn test_mul_div_u128_large_divisor_rejected() {
        let large_divisor: u128 = 1u128 << 64;
        assert_eq!(checked_mul_div_u128(100, 200, large_divisor), None);
    }

    #[test]
    fn test_mul_div_u128_round_up() {
        let floor = checked_mul_div_u128(10, 3, 4).unwrap();
        assert_eq!(floor, 7);
        let ceil = checked_mul_div_u128_round_up(10, 3, 4).unwrap();
        assert_eq!(ceil, 8);
        // Exact division — no rounding
        let exact = checked_mul_div_u128_round_up(10, 2, 4).unwrap();
        assert_eq!(exact, 5);
    }

    // ---- Gap 4: pow_bps ----

    #[test]
    fn test_pow_bps_identity() {
        assert_eq!(pow_bps(10, 0), Some(SCALE));
        assert_eq!(pow_bps(0, 35), Some(SCALE));
    }

    #[test]
    fn test_pow_bps_one() {
        assert_eq!(pow_bps(10, 1), Some(1_001_000_000_000));
    }

    #[test]
    fn test_pow_bps_ten() {
        let result = pow_bps(10, 10).unwrap();
        let expected = 1_010_045_120_210u128;
        assert!((result as i128 - expected as i128).abs() <= 1);
    }

    #[test]
    fn test_pow_bps_35() {
        let result = pow_bps(10, 35).unwrap();
        // 1.001^35 ≈ 1.035601597360... (verified via binomial expansion)
        let expected = 1_035_601_597_360u128;
        let diff = (result as i128 - expected as i128).abs();
        assert!(diff <= 1000, "pow_bps(10, 35) = {}, expected ~{}, diff = {}", result, expected, diff);
    }

    #[test]
    fn test_pow_bps_negative() {
        let result = pow_bps(10, -1).unwrap();
        let expected = 999_000_999_000u128;
        assert!((result as i128 - expected as i128).abs() <= 2);
    }

    #[test]
    fn test_pow_bps_symmetry() {
        let pos = pow_bps(10, 20).unwrap();
        let neg = pow_bps(10, -20).unwrap();
        let product = pos * neg / SCALE;
        assert!((product as i128 - SCALE as i128).abs() <= 100);
    }

    #[test]
    fn test_pow_bps_i32_min() {
        assert_eq!(pow_bps(10, i32::MIN), None);
    }

    #[test]
    fn test_pow_bps_overflow() {
        // bps=5000 (50%), exp=500 — 1.5^500 overflows u128
        assert_eq!(pow_bps(5000, 500), None);
    }

    #[test]
    fn test_pow_bps_round_up_gte_floor() {
        for exp in [-35, -10, -1, 1, 10, 35] {
            let floor = pow_bps(10, exp).unwrap();
            let ceil = pow_bps_round_up(10, exp).unwrap();
            assert!(ceil > floor, "round_up must be > floor for exp={}", exp);
        }
    }

    #[test]
    fn test_pow_bps_round_up_rejects_large_bps() {
        assert_eq!(pow_bps_round_up(10000, 1), None);
    }

    #[test]
    fn test_pow_bps_round_up_exact_cases() {
        // bps=0: 1.0^n is always exact — round_up must equal floor
        assert_eq!(pow_bps_round_up(0, 35), Some(SCALE));
        assert_eq!(pow_bps_round_up(0, -10), Some(SCALE));
        // exp=0: any^0 = 1.0 is exact
        assert_eq!(pow_bps_round_up(50, 0), Some(SCALE));
    }

    // ---- T1: checked_mul_div_u128_round_up slow path (u256) ----

    #[test]
    fn test_checked_mul_div_u128_round_up_slow_path() {
        // Force u256 path: a * b overflows u128, but result fits
        // a ≈ 10^25, b ≈ 10^25, c = 10^12 → result ≈ 10^38 (fits u128)
        let a: u128 = 10_000_000_000_000_000_000_000_000; // 10^25
        let b: u128 = 10_000_000_000_000_000_000_000_003; // 10^25 + 3 (odd, ensures remainder)
        let c: u128 = SCALE; // 10^12
        // a * b overflows u128 (10^50 > 3.4*10^38)
        assert!(a.checked_mul(b).is_none(), "must overflow to test slow path");
        let floor = checked_mul_div_u128(a, b, c).unwrap();
        let ceil = checked_mul_div_u128_round_up(a, b, c).unwrap();
        assert!(ceil >= floor, "ceil must be >= floor");
        assert!(ceil <= floor + 1, "ceil must be at most floor + 1");
    }

    #[test]
    fn test_checked_mul_div_u128_round_up_slow_exact() {
        // Force u256 path, but exact division (no remainder)
        let c: u128 = 1_000_000;
        let a: u128 = (u128::MAX / c) + 1; // a * c overflows u128
        let b: u128 = c;
        // a * b = a * c, result = a, remainder = 0
        let floor = checked_mul_div_u128(a, b, c).unwrap();
        let ceil = checked_mul_div_u128_round_up(a, b, c).unwrap();
        assert_eq!(ceil, floor, "exact division in slow path: no +1");
    }

    // ---- N3: mul_div_u128_u64 overflow in remainder * b ----

    #[test]
    fn test_mul_div_u128_u64_remainder_overflow() {
        // remainder close to u64::MAX, b = u64::MAX → remainder * b overflows u128
        // a = u128::MAX ensures slow path, c = u64::MAX ensures large remainder
        let a = u128::MAX;
        let b: u64 = u64::MAX;
        let c: u64 = u64::MAX;
        // a * b / c = u128::MAX (mathematically)
        let result = mul_div_u128_u64(a, b, c);
        assert_eq!(result, Some(u128::MAX), "remainder overflow must be handled correctly");
    }

    #[test]
    fn test_mul_div_u128_u64_slow_path_result_overflow() {
        // Result > u128::MAX → should return None
        assert_eq!(mul_div_u128_u64(u128::MAX, u64::MAX, 1), None);
    }

    // ---- T2: missing boundary/zero tests ----

    #[test]
    fn test_mul_div_u64_zero_operands() {
        assert_eq!(mul_div_u64(0, u64::MAX, 1), Some(0));
        assert_eq!(mul_div_u64(u64::MAX, 0, 1), Some(0));
        assert_eq!(mul_div_u64_round_up(0, u64::MAX, 1), Some(0));
    }

    #[test]
    fn test_mul_div_u64_round_up_overflow() {
        assert_eq!(mul_div_u64_round_up(u64::MAX, 2, 1), None);
    }

    #[test]
    fn test_mul_div_u128_u64_round_up_zero_divisor() {
        assert_eq!(mul_div_u128_u64_round_up(100, 200, 0), None);
    }

    #[test]
    fn test_checked_mul_div_u128_zero_operands() {
        assert_eq!(checked_mul_div_u128(0, 200, 50), Some(0));
        assert_eq!(checked_mul_div_u128(100, 0, 50), Some(0));
        assert_eq!(checked_mul_div_u128_round_up(0, 200, 50), Some(0));
    }

    #[test]
    fn test_pow_bps_round_up_overflow() {
        assert_eq!(pow_bps_round_up(5000, 500), None);
    }

    #[test]
    fn test_pow_bps_rejects_large_bps() {
        // pow_bps and pow_bps_round_up both reject bps >= 10000
        assert_eq!(pow_bps(10000, 1), None);
        assert_eq!(pow_bps(10000, 35), None);
        assert_eq!(pow_bps_round_up(10000, 1), None);
    }

    #[test]
    fn test_i128_insufficient_data() {
        let mut slice: &[u8] = &[0u8; 15];
        assert!(i128::deserialize(&mut slice).is_err());
    }

    #[test]
    fn test_u128_le_boundary_values() {
        let mut buf = [0u8; 16];
        write_u128_le(&mut buf, 0, 0);
        assert_eq!(read_u128_le(&buf, 0), 0);
        write_u128_le(&mut buf, 0, u128::MAX);
        assert_eq!(read_u128_le(&buf, 0), u128::MAX);
    }

    #[test]
    fn test_u32_le_boundary_values() {
        let mut buf = [0u8; 4];
        write_u32_le(&mut buf, 0, 0);
        assert_eq!(read_u32_le(&buf, 0), 0);
        write_u32_le(&mut buf, 0, u32::MAX);
        assert_eq!(read_u32_le(&buf, 0), u32::MAX);
    }
}
