mod extractors;
mod ipc;
mod scanner;
mod types;

use clap::{Parser, Subcommand};
use scanner::ScanOptions;

#[derive(Parser)]
#[command(name = "edo-scanner", about = "High-performance session scanner for Edo Tensei")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Scan {
        /// Filter sessions by workspace path
        #[arg(long)]
        workspace: Option<String>,

        /// Filter by IDE (claude, cursor, copilot, codex, kiro)
        #[arg(long)]
        ide: Option<String>,

        /// Keyword search across title, workspace path, and first message
        #[arg(long)]
        query: Option<String>,

        /// Only include sessions on or after this date (YYYY-MM-DD or ISO 8601)
        #[arg(long)]
        since: Option<String>,

        /// Include full message content in output (default: metadata + first message only)
        #[arg(long)]
        full: bool,

        /// Additional scan paths (can be repeated)
        #[arg(long = "scan-path")]
        scan_paths: Vec<String>,
    },
}

fn main() {
    let cli = Cli::parse();
    match cli.command {
        Commands::Scan { workspace, ide, query, since, full, scan_paths } => {
            scanner::run_scan(&ScanOptions {
                workspace_path: workspace,
                ide_filter: ide,
                query,
                since,
                full_messages: full,
                custom_scan_paths: scan_paths,
            });
        }
    }
}
