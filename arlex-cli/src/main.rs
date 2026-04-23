use clap::{Parser, Subcommand};
use colored::Colorize;

mod commands;
mod common;
mod idl;

#[derive(Parser)]
#[command(name = "arlex", version, about = "Arlex — Deploy Solana programs 14x cheaper\nhttps://arlex.io")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Create a new Arlex project
    Init {
        /// Project name (letters, digits, _ and - only)
        name: String,
    },
    /// Build the program (cargo build-sbf + size report)
    Build,
    /// Deploy the program to Solana
    Deploy {
        /// Network: devnet, mainnet, localnet
        #[arg(long, default_value = "devnet")]
        network: String,
        /// Program keypair path (for redeployment)
        #[arg(long)]
        program_id: Option<String>,
    },
    /// Run tests
    Test {
        /// Test filter
        #[arg(long)]
        filter: Option<String>,
        /// Skip build step
        #[arg(long)]
        skip_build: bool,
    },
    /// Generate Anchor-compatible IDL JSON
    Idl,
    /// Show program size and cost comparison vs Anchor
    Size {
        /// Program ID on mainnet (optional — checks on-chain program)
        program_id: Option<String>,
    },
}

fn main() {
    let cli = Cli::parse();

    let result = match cli.command {
        Commands::Init { name } => commands::init::run(&name),
        Commands::Build => commands::build::run(),
        Commands::Idl => commands::idl_cmd::run(),
        Commands::Deploy { network, program_id } => commands::deploy::run(&network, program_id.as_deref()),
        Commands::Test { filter, skip_build } => commands::test::run(filter.as_deref(), skip_build),
        Commands::Size { program_id } => commands::size::run(program_id.as_deref()),
    };

    if let Err(e) = result {
        eprintln!("{} {}", "Error:".red().bold(), e);
        std::process::exit(1);
    }
}
