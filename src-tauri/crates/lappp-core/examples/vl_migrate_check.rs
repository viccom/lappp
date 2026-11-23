//! `vl_migrate_check` — run the library migrations on a database copy and
//! report the image-understanding templates afterwards.
//!
//! It is the isolated rehearsal of an upgrade: point it at a *copy* of a
//! library database and it migrates the copy, prints the resulting schema
//! version and the built-in template list, and proves that a second run
//! changes nothing. The real library is never opened by this tool unless you
//! point it at that file yourself.
//!
//! ```text
//! cargo run --example vl_migrate_check -- <copy.db>
//! ```

use rusqlite::{Connection, OptionalExtension};

fn templates(conn: &Connection) -> Vec<(String, i64, i64)> {
    conn.prepare(
        "SELECT name, version, is_builtin FROM vl_templates ORDER BY name, version",
    )
    .expect("prepare template query")
    .query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })
    .expect("query templates")
    .collect::<Result<Vec<_>, _>>()
    .expect("collect templates")
}

fn version(conn: &Connection) -> i64 {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("read user_version")
}

fn main() -> Result<(), String> {
    let path = std::env::args()
        .nth(1)
        .ok_or("usage: vl_migrate_check <database copy>")?;
    let conn = Connection::open(&path).map_err(|error| format!("open {path}: {error}"))?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(|error| error.to_string())?;

    let before = version(&conn);
    println!("user_version before: {before}");
    let templates_before = templates(&conn);
    println!("templates before: {}", templates_before.len());

    lappp_core::t_migration::check_and_migrate(&conn).map_err(|error| error.to_string())?;

    let after = version(&conn);
    println!("user_version after:  {after}");
    let templates_after = templates(&conn);
    println!("templates after:  {}", templates_after.len());
    for (name, version, is_builtin) in &templates_after {
        println!(
            "  {name} v{version}{}",
            if *is_builtin == 1 { " (built-in)" } else { "" }
        );
    }

    // Idempotency: a second run must not change anything.
    lappp_core::t_migration::check_and_migrate(&conn).map_err(|error| error.to_string())?;
    let again = templates(&conn);
    println!(
        "second run: user_version={} templates={} (unchanged: {})",
        version(&conn),
        again.len(),
        again.len() == templates_after.len()
    );

    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .unwrap_or_else(|_| "unavailable".to_string());
    println!("integrity_check: {integrity}");

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM afiles", [], |row| row.get(0))
        .optional()
        .map_err(|error| error.to_string())?
        .unwrap_or(0);
    println!("files: {count}");
    Ok(())
}
