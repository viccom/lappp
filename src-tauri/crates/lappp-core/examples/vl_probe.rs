//! `vl_probe` — evaluate VL prompt templates against real library files.
//!
//! It reuses the product's own code path: `t_vl::render_prompt` builds the
//! prompt from a `PromptContext` read out of a library database, and
//! `t_vl::call_gateway` issues the request exactly as the app does (same
//! protocol adapter, same auth headers, same response parsing). Nothing here
//! re-implements the request; only the *inputs* (which template, which image
//! bytes) are chosen by the caller.
//!
//! The database is opened read-only, so a probe never writes to a library.
//!
//! ```text
//! cargo run --example vl_probe -- \
//!   --db <snapshot.db> --files 956,1018 \
//!   --templates <templates.json> --image app --out <results.json>
//! ```
//!
//! `--image app` (the default) sends what the app sends: the cached 512px
//! thumbnail, or the original when the file has no cached thumbnail. `thumb`
//! and `original` force one of the two for a resolution comparison.
//!
//! `--list-models` prints the gateway's model list with the facts the
//! pipeline depends on — vision capability, reasoning, output cap — and
//! exits; it needs no database.
//!
//! `--only` narrows the run to the named templates. `--with-card` inserts a
//! text file in front of the rules of every template, which is how a block
//! of context that is not a placeholder yet (a household profile, a glossary)
//! can be tried before it becomes one.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use lappp_core::t_vl::{self, VlRequest};
use lappp_core::{t_common, t_sqlite};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::{json, Value};

/// One template under test.
struct Template {
    name: String,
    prompt: String,
    system: String,
    spec: String,
}

struct Args {
    db: PathBuf,
    files: Vec<i64>,
    templates: Option<PathBuf>,
    image: String,
    out: Option<PathBuf>,
    library_id: String,
    cache_root: Option<PathBuf>,
    library: bool,
    /// Only the templates with these names.
    only: Option<String>,
    /// A text file inserted in front of the rules of every template.
    with_card: Option<PathBuf>,
}

fn usage() -> ! {
    eprintln!(
        "usage: vl_probe --db <snapshot.db> --files <id,id,...> --templates <templates.json> \
         [--image app|thumb|original] [--out <results.json>] [--library-id <id>] [--cache-root <dir>] \
         [--only <name,name>] [--with-card <file>]
         use --library to test the built-in template library of the product"
    );
    std::process::exit(2);
}

fn parse_args() -> Args {
    let mut db = None;
    let mut files = Vec::new();
    let mut templates = None;
    let mut library = false;
    let mut image = "app".to_string();
    let mut out = None;
    let mut library_id = "default".to_string();
    let mut cache_root = None;
    let mut only = None;
    let mut with_card = None;

    let raw: Vec<String> = std::env::args().skip(1).collect();
    let mut index = 0;
    while index < raw.len() {
        let key = raw[index].as_str();
        let mut value = || {
            index += 1;
            match raw.get(index) {
                Some(value) => value.clone(),
                None => usage(),
            }
        };
        match key {
            "--db" => db = Some(PathBuf::from(value())),
            "--files" => {
                files = value()
                    .split(',')
                    .filter_map(|part| part.trim().parse::<i64>().ok())
                    .collect()
            }
            "--templates" => templates = Some(PathBuf::from(value())),
            "--library" => library = true,
            "--image" => image = value(),
            "--out" => out = Some(PathBuf::from(value())),
            "--library-id" => library_id = value(),
            "--cache-root" => cache_root = Some(PathBuf::from(value())),
            "--only" => only = Some(value()),
            "--with-card" => with_card = Some(PathBuf::from(value())),
            _ => usage(),
        }
        index += 1;
    }

    let db = match db {
        Some(db) => db,
        None => usage(),
    };
    if files.is_empty() {
        usage();
    }
    if templates.is_none() && !library {
        usage();
    }

    Args {
        db,
        files,
        templates,
        library,
        image,
        out,
        library_id,
        cache_root,
        only,
        with_card,
    }
}

fn load_templates(path: &Path) -> Vec<Template> {
    let raw = std::fs::read_to_string(path).expect("read templates file");
    let value: Value = serde_json::from_str(&raw).expect("parse templates file");
    let list = value
        .get("templates")
        .and_then(Value::as_array)
        .expect("templates file must hold a \"templates\" array");
    list.iter()
        .map(|item| Template {
            name: item
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("(unnamed)")
                .to_string(),
            prompt: item
                .get("prompt")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            system: item
                .get("system")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            spec: item
                .get("spec")
                .and_then(Value::as_str)
                .unwrap_or("{}")
                .to_string(),
        })
        .collect()
}

/// The built-in library exactly as the product ships it.
fn library_templates() -> Vec<Template> {
    lappp_core::t_vl_templates::library()
        .into_iter()
        .map(|(name, prompt, system, spec)| Template {
            name: name.to_string(),
            prompt,
            system: system.to_string(),
            spec: spec.to_string(),
        })
        .collect()
}

/// The cached thumbnail bytes of a file, the same bytes the app uploads.
fn thumbnail_bytes(
    conn: &Connection,
    file_id: i64,
    library_id: &str,
    cache_root: &Path,
) -> Result<Vec<u8>, String> {
    let row: Option<(Option<Vec<u8>>, Option<String>, Option<i64>, Option<String>)> = conn
        .query_row(
            "SELECT t.thumb_data, t.thumb_key, b.album_id, a.name
             FROM athumbs t
             JOIN afiles a ON a.id = t.file_id
             JOIN afolders b ON b.id = a.folder_id
             WHERE t.file_id = ?1",
            rusqlite::params![file_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let (blob, key, album_id, name) = row.ok_or_else(|| format!("no thumbnail row for {file_id}"))?;
    if let Some(data) = blob.filter(|data| !data.is_empty()) {
        return Ok(data);
    }
    let key = key.ok_or_else(|| "thumbnail has no key".to_string())?;
    let album_id = album_id.ok_or_else(|| "thumbnail has no album".to_string())?;
    let extension = name
        .as_deref()
        .and_then(|name| name.rsplit('.').next())
        .filter(|extension| extension.eq_ignore_ascii_case("png"))
        .unwrap_or("jpg");
    let path = cache_root
        .join(library_id)
        .join(album_id.to_string())
        .join(&key[..2])
        .join(format!("{key}.{extension}"));
    std::fs::read(&path).map_err(|error| format!("read {}: {error}", path.display()))
}

/// The context of one file, rendered into every template.
fn file_context(conn: &Connection, file_id: i64) -> Result<t_vl::PromptContext, String> {
    let file = t_sqlite::AFile::get_file_info_on(conn, file_id)?
        .ok_or_else(|| format!("file {file_id} is unknown"))?;
    Ok(t_vl::prompt_context_with_conn(conn, &file))
}

/// Print the gateway's models with the facts the VL pipeline depends on.
/// Only the ids and capabilities are printed, never the key.
async fn list_models() -> Result<(), String> {
    let list = t_vl::list_vl_models().await?;
    for model in &list.models {
        println!(
            "{}\tvision={:?}\treasoning={}\tmax_output={}\t{}",
            model.id,
            model.vision,
            model
                .reasoning
                .map(|value| value.to_string())
                .unwrap_or_else(|| "?".to_string()),
            model
                .max_output_tokens
                .map(|value| value.to_string())
                .unwrap_or_else(|| "?".to_string()),
            model.display_name.as_deref().unwrap_or("")
        );
    }
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), String> {
    if std::env::args().any(|argument| argument == "--list-models") {
        return list_models().await;
    }
    let args = parse_args();
    let mut templates = if args.library {
        library_templates()
    } else {
        load_templates(args.templates.as_deref().expect("templates file"))
    };
    if let Some(names) = &args.only {
        let wanted: Vec<&str> = names.split(',').map(str::trim).collect();
        templates.retain(|template| wanted.contains(&template.name.as_str()));
        if templates.is_empty() {
            return Err(format!("--only matched none of the templates: {names}"));
        }
    }
    if let Some(path) = &args.with_card {
        let card = std::fs::read_to_string(path)
            .map_err(|error| format!("read {}: {error}", path.display()))?;
        let card = card.trim();
        // The built-in templates end with their rules. The card goes in
        // front of the rules, where it reads as a fact about the photo.
        for template in &mut templates {
            match template.prompt.rfind("\n\n规则：") {
                Some(at) => template.prompt.insert_str(at, &format!("\n\n{card}")),
                None => template.prompt.push_str(&format!("\n\n{card}")),
            }
        }
    }
    let conn = Connection::open_with_flags(&args.db, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("open {}: {error}", args.db.display()))?;

    let cache_root = match args.cache_root.clone() {
        Some(path) => path,
        None => std::env::var("LOCALAPPDATA")
            .map(|base| PathBuf::from(base).join("com.julyx10.lap.debug"))
            .map_err(|_| "no cache root; pass --cache-root".to_string())?,
    };

    let config = t_vl::resolve_gateway_config()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| error.to_string())?;

    let mut results: Vec<Value> = Vec::new();

    for file_id in &args.files {
        let context = file_context(&conn, *file_id)?;
        let original_bytes = || -> Result<Vec<u8>, String> {
            let file = t_sqlite::AFile::get_file_info_on(&conn, *file_id)?
                .ok_or_else(|| format!("file {file_id} is unknown"))?;
            let path = file
                .file_path
                .ok_or_else(|| format!("file {file_id} has no path"))?;
            std::fs::read(&path).map_err(|error| format!("read {path}: {error}"))
        };
        // `app` is what the product sends: the cached thumbnail when there is
        // one, otherwise the original. `thumb` and `original` force one of the
        // two for the resolution comparison.
        let (bytes, image_source) = match args.image.as_str() {
            "original" => (original_bytes()?, "original".to_string()),
            "thumb" | "app" => {
                match thumbnail_bytes(&conn, *file_id, &args.library_id, &cache_root) {
                    Ok(bytes) => (bytes, "thumb".to_string()),
                    Err(_) => (original_bytes()?, "original-fallback".to_string()),
                }
            }
            other => return Err(format!("unknown --image {other}")),
        };
        let media_type = t_common::detect_image_mime(&bytes).to_string();
        let image_base64 = BASE64.encode(&bytes);

        for template in &templates {
            let prompt = t_vl::render_prompt(&template.prompt, &context);
            let system = t_vl::render_system(&template.system, &context);
            let request = VlRequest {
                image_base64: image_base64.clone(),
                media_type: media_type.clone(),
                prompt: prompt.clone(),
                system: Some(system.clone()),
            };
            let started = std::time::Instant::now();
            let outcome = t_vl::call_gateway(&client, &config, &request).await;
            let (status, text, parsed, error, stop_reason, usage) = match outcome {
                Ok(success) => {
                    // `result_json` returns (value, is_unparsed).
                    let (value, is_unparsed) = t_vl::result_json(&success.response.text, &template.spec);
                    (
                        if is_unparsed { "unparsed" } else { "ok" },
                        success.response.text.clone(),
                        value,
                        Value::Null,
                        json!(success.response.stop_reason),
                        json!({
                            "input": success.response.usage.input_tokens,
                            "output": success.response.usage.output_tokens,
                            "thinking": success.response.usage.thinking_tokens,
                            "model": success.response.model,
                            "raw_len": success.raw_body.len(),
                        }),
                    )
                }
                Err(failure) => (
                    "error",
                    String::new(),
                    Value::Null,
                    json!(failure.message),
                    Value::Null,
                    Value::Null,
                ),
            };
            let record = json!({
                "file_id": file_id,
                "template": template.name,
                "image": image_source,
                "image_bytes": bytes.len(),
                "media_type": media_type,
                "status": status,
                "error": error,
                "stop_reason": stop_reason,
                "usage": usage,
                "prompt": prompt,
                "system": system,
                "text": text,
                "result": parsed,
                "duration_ms": started.elapsed().as_millis() as i64,
            });
            eprintln!(
                "[vl_probe] file={file_id} template={} status={status} {}ms",
                template.name,
                started.elapsed().as_millis()
            );
            results.push(record);
        }
    }

    let grouped: BTreeMap<String, Vec<Value>> = results.iter().fold(BTreeMap::new(), |mut map, record| {
        let key = record
            .get("template")
            .and_then(Value::as_str)
            .unwrap_or("?")
            .to_string();
        map.entry(key).or_default().push(record.clone());
        map
    });
    let report = json!({ "results": results, "by_template": grouped });

    let rendered = serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?;
    match args.out {
        Some(path) => std::fs::write(&path, rendered).map_err(|error| error.to_string())?,
        None => println!("{rendered}"),
    }
    Ok(())
}
